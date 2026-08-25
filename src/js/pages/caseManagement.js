import { lol } from "../shared/crypt.js";
import { buildThreeDViewerUrl } from "../shared/caseLinks.js";
import { toast, confirmModal, openThemedCalendar, attachThemedCalendar } from "../shared/toast.js";
import { logApi, statusLabel } from "../shared/apiLog.js";
import { reportHtmlToDocxBytes } from "../shared/accessibility.js";
import { setupAppSidebar } from "../shared/appSidebar.js";
import { buildReportHtml } from "../2D/noticeboard.js";
import {
  saveCaseDueDate,
  toDateInputValue,
  updateCaseDueDate,
  publishCaseComment,
  watchCaseComments,
} from "../2D/caseNote.js";
import {
  ENRICH_CONCURRENCY,
  caseIntIdOf,
  buildEnrichRequests,
  applyEnrichmentResponses,
  fetchReferenceImageRows,
} from "../shared/caseEnrichment.js";
import {
  API_BASE,
  MACHINE_ID,
  callerIdentity,
  fileToBase64,
  getLoggedInUser,
  uploadWithProgress,
} from "../shared/api.js";
import { timestampToMs, toDayMidnight } from "../shared/timestamps.js";
import { normalizeImageFile } from "../shared/imageFiles.js";
import { recordCollaborators, reconcileCollaborators } from "../shared/userSuggest.js";
import { confirmRemoveUserFromCase } from "../shared/caseRoles.js";

// Per-user cache of the last case list, painted instantly while
// /case/user/findall/get is in flight. Keyed by uuid so lists never cross accounts.
function caseListCacheKey() {
  const u = getLoggedInUser();
  return u?.uuid ? `caseList_cache_${u.uuid}` : null;
}
function saveCachedCases(list) {
  const key = caseListCacheKey();
  if (!key || !Array.isArray(list)) return;
  try {
    // Strip "__"-prefixed bookkeeping (e.g. the lazy-enrichment __enrich state)
    // so a cached "done" marker can't suppress re-fetching in a later session.
    const json = JSON.stringify(list, (k, v) => (k.startsWith("__") ? undefined : v));
    localStorage.setItem(key, json);
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
}
function loadCachedCases() {
  const key = caseListCacheKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let currentSortColumn = "recent";
let currentSortOrder = "desc";
let currentCases = [];
let existingUsers = [];

// Each card is a *stage* — a group of raw statuses, keyed by apiStatusToValue().
// "na" is deliberately in no stage, so N/A cases sit outside the stage counts.
const STATUS_GROUPS = {
  // Draft → 3D design approved.
  preparation: new Set([
    "draft",
    "2d_design_pending",
    "2d_design_drafted",
    "2d_design_approved",
    "3d_design_pending",
    "3d_design_drafted",
    "3d_design_approved",
  ]),
  // In production → delivered.
  delivery: new Set(["in_production", "out_for_delivery", "delivered"]),
  // Completed.
  completed: new Set(["completed"]),
};

// Which stat card is active ("all" = no stage filter). Toggled by clicking a
// card; a second click on the active card clears back to "all".
let activeStatusFilter = "all";

// The stage a case belongs to, or null if it matches none (shouldn't happen
// given the groups above cover every status).
function caseStatusGroup(caseItem) {
  const v = apiStatusToValue(caseItem?.new_status);
  for (const [group, set] of Object.entries(STATUS_GROUPS)) {
    if (set.has(v)) return group;
  }
  return null;
}

let currentThumbnails = [];
let currentImageIndex = 0;
window.selectedCaseId = null;
let caseListScrollTopBeforeDetails = 0;

function isMobileDetailLayout() {
  return window.matchMedia?.("(max-width: 860px)").matches || window.innerWidth <= 860;
}

function openMobileCaseDetails() {
  const page = document.querySelector(".cm-page");
  if (!page) return;
  const list = document.getElementById("caseList");
  caseListScrollTopBeforeDetails = list?.scrollTop || 0;
  page.classList.add("show-details");
  document.body.classList.add("show-details");
}

function closeMobileCaseDetails() {
  const page = document.querySelector(".cm-page");
  const detail = document.querySelector(".cm-detail");
  const active = document.activeElement;
  if (detail?.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
  page?.classList.remove("show-details");
  document.body.classList.remove("show-details");
  requestAnimationFrame(() => {
    const list = document.getElementById("caseList");
    if (list) list.scrollTop = caseListScrollTopBeforeDetails;
  });
}
// 获取用户的病例列表
async function fetchCases() {
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser) {
    console.error("User not logged in.");
    return null;
  }

  const requestBody = JSON.stringify([
    {
      machine_id: MACHINE_ID,
      uuid: loggedInUser.uuid,
    },
    { uuid: loggedInUser.uuid },
  ]);

  try {
    const response = await fetch(
      `${API_BASE}/case/user/findall/get`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      }
    );
    logApi(response, 'POST /case/user/findall/get');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? dedupeCases(data) : data;
  } catch (err) {
    console.error("❌ Failed to fetch cases:", err);
    // "Failed to fetch" covers both a CORS block and a dead network — surface it
    // rather than leaving the list silently empty.
    const isNetwork = err instanceof TypeError;
    if (typeof toast !== "undefined") {
      toast.error(
        isNetwork
          ? "Couldn't reach the server. Please wait a moment and try again."
          : `Failed to load cases (${err.message || err}).`
      );
    }
    return null;
  }
}

// Server can return the same case multiple times when the logged-in user has
// more than one role on it (owner + co-owner, etc.). Collapse to one entry.
function dedupeCases(list) {
  const seen = new Set();
  const out = [];
  for (const c of list) {
    const key = c?.id ?? c?.case_int_id ?? c?.case_id;
    if (key == null) { out.push(c); continue; }
    const k = String(key);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

// The case endpoints want the numeric id; a name string is passed through as-is.
function toNumericCaseId(caseId) {
  const n = typeof caseId === "number" ? caseId : Number(caseId);
  return Number.isFinite(n) ? n : caseId;
}

// 通用：删除指定 case
async function deleteCaseById(caseId, { skipConfirm = false } = {}) {
  const user = getLoggedInUser();
  if (!caseId || !user?.uuid) {
    toast.warning("Unable to delete: missing case id or login.");
    return false;
  }

  if (!skipConfirm) {
    const confirmed = await confirmModal({
      title: "Delete case?",
      message: "This will permanently remove the case and its files. This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      variant: "danger",
    });
    if (!confirmed) return false;
  }

  const caseIdForApi = toNumericCaseId(caseId);
  const requestBody = JSON.stringify([
    callerIdentity({ caseIntID: caseIdForApi }),
    { case_int_id: caseIdForApi },
  ]);

  console.log("[case/delete] →", { caseId: caseIdForApi, body: requestBody });

  try {
    const response = await fetch(
      `${API_BASE}/case/delete/${caseIdForApi}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      }
    );
    logApi(response, 'POST /case/delete/:id');
    const rawText = await response.text();
    console.log("[case/delete] ←", response.status, rawText);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${rawText.slice(0, 200)}`);
    }

    currentCases = currentCases.filter(
      (c) =>
        c.id !== caseId &&
        c.case_int_id !== caseId &&
        c.case_id !== caseId &&
        c.id !== caseIdForApi &&
        c.case_int_id !== caseIdForApi
    );
    populateTable(currentCases);

    if (
      window.selectedCaseId === caseId ||
      window.selectedCaseId === caseIdForApi
    ) {
      window.selectedCaseId = null;
      ["selected-case", "created-by", "date-created", "last-edited"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
      });
      const pill = document.getElementById("statusPill");
      if (pill) {
        pill.className = "cm-pill cm-pill-na";
        pill.textContent = "N/A";
      }
      const avatar = document.getElementById("assigneeAvatar");
      if (avatar) avatar.textContent = "·";
      renderSharedWith([]);
      renderCaseInstructions(null, "");
      currentThumbnails = [];
      currentImageIndex = 0;
      updateThumbnail();
    }

    return true;
  } catch (err) {
    console.error("❌ Delete failed:", err);
    toast.error(`Failed to delete case. ${err.message || err}`);
    return false;
  }
}

// Progress bar for work we can't measure (a server-side duplicate behind one
// POST): creeps to 90%, then snaps to 100%. Reuses createCase.css's .cc-loading-*.
function createProgressOverlay(label = "Working…") {
  const overlay = document.createElement("div");
  overlay.className = "cc-loading-overlay cc-loading-overlay--fixed";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="cc-loading-card">
      <div class="cc-loading-header">
        <span class="cc-loading-label"></span>
        <span class="cc-loading-percent">0%</span>
      </div>
      <div class="cc-loading-bar" aria-hidden="true">
        <div class="cc-loading-bar-fill"></div>
      </div>
    </div>`;
  const labelEl = overlay.querySelector(".cc-loading-label");
  const percentEl = overlay.querySelector(".cc-loading-percent");
  const fillEl = overlay.querySelector(".cc-loading-bar-fill");
  labelEl.textContent = label;
  document.body.appendChild(overlay);

  let pct = 0;
  const render = () => {
    const r = Math.round(pct);
    fillEl.style.width = `${r}%`;
    percentEl.textContent = `${r}%`;
  };
  render();

  // Ease toward 90% (asymptotic, so it never claims to be finished early) to
  // keep the bar feeling alive during the single duplicate request.
  const timer = setInterval(() => {
    if (pct < 90) {
      pct += (90 - pct) * 0.12;
      render();
    }
  }, 220);

  return {
    setLabel(text) {
      labelEl.textContent = text;
    },
    // Snap to 100%, hold briefly so the user sees completion, then remove.
    async finish() {
      clearInterval(timer);
      pct = 100;
      render();
      await new Promise((resolve) => setTimeout(resolve, 350));
      overlay.remove();
    },
    // Tear down immediately (e.g. on error).
    destroy() {
      clearInterval(timer);
      overlay.remove();
    },
  };
}

// Mirrors the C# RestAPI.DuplicateCase flow; the server answers with an InsertID.
// The list is reloaded so the new case arrives with full thumbnails/details.
async function duplicateCaseById(caseId, { skipConfirm = false } = {}) {
  const user = getLoggedInUser();
  if (!caseId || !user?.uuid) {
    toast.warning("Unable to duplicate: missing case id or login.");
    return false;
  }

  if (!skipConfirm) {
    const confirmed = await confirmModal({
      title: "Duplicate case?",
      message: "A new case will be created with the same files and details.",
      confirmText: "Duplicate",
      cancelText: "Cancel",
      variant: "info",
    });
    if (!confirmed) return false;
  }

  const caseIdForApi = toNumericCaseId(caseId);
  const requestBody = JSON.stringify([
    callerIdentity({ caseIntID: caseIdForApi }),
    { case_id: String(caseIdForApi) },
  ]);

  const progress = createProgressOverlay("Duplicating case…");

  try {
    const response = await fetch(
      `${API_BASE}/case/duplicate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      }
    );
    logApi(response, 'POST /case/duplicate');
    const rawText = await response.text();
    console.log("[case/duplicate] ←", response.status, rawText);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${rawText.slice(0, 200)}`);
    }

    let newId;
    try {
      const data = JSON.parse(rawText);
      newId = data?.id ?? data?.case_int_id ?? data?.insert_id;
    } catch {
      // server returned a non-JSON success body — that's fine, we'll just reload
    }

    toast.success(
      newId != null
        ? `Case duplicated (new id: ${newId}).`
        : "Case duplicated successfully."
    );

    // Hold at 100% so the user sees it finish, then reload (as refreshListBtn
    // does) to pick up the new case's server-side details.
    progress.setLabel("Finalizing…");
    await progress.finish();
    window.location.reload();
    return true;
  } catch (err) {
    progress.destroy();
    console.error("❌ Duplicate failed:", err);
    toast.error(`Failed to duplicate case. ${err.message || err}`);
    return false;
  }
}

function pinnedStorageKey() {
  const user = getLoggedInUser();
  return `pinnedCases:${user?.uuid || "anon"}`;
}

function getPinnedSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(pinnedStorageKey()) || "[]");
    return new Set(arr.map(String));
  } catch {
    return new Set();
  }
}

function setPinnedSet(set) {
  localStorage.setItem(pinnedStorageKey(), JSON.stringify([...set]));
}

function togglePinned(caseId) {
  const set = getPinnedSet();
  const id = String(caseId);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  setPinnedSet(set);
  return set.has(id);
}


function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The backend often stores jaw meshes as OFF; many CAD/slicer tools only open
// STL, so the download bundle ships an STL copy too. `bytes` starts with "OFF".
function isOffBytes(bytes) {
  return bytes && bytes[0] === 0x4f && bytes[1] === 0x46 && bytes[2] === 0x46;
}

// OFF text to binary STL, standalone (no THREE) so the case list stays light.
// Polygons are fan-triangulated; faces with missing vertices are dropped.
function offTextToBinaryStl(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length || lines[0].toUpperCase() !== "OFF") return null;
  const header = lines[1].split(/\s+/).map(Number);
  const numVertices = header[0];
  const numFaces = header[1];
  if (!Number.isFinite(numVertices) || !Number.isFinite(numFaces)) return null;

  const verts = new Array(numVertices);
  for (let i = 0; i < numVertices; i++) {
    const p = lines[2 + i].split(/\s+/).map(Number);
    verts[i] = [p[0], p[1], p[2]];
  }

  const tris = [];
  const faceStart = 2 + numVertices;
  for (let i = 0; i < numFaces; i++) {
    const p = lines[faceStart + i].split(/\s+/).map(Number);
    const n = p[0];
    for (let k = 2; k < n; k++) tris.push([p[1], p[k], p[k + 1]]); // fan
  }
  const valid = tris.filter(([a, b, c]) => verts[a] && verts[b] && verts[c]);

  const buffer = new ArrayBuffer(84 + valid.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, valid.length, true); // 80-byte header left zeroed
  let off = 84;
  for (const [ia, ib, ic] of valid) {
    const a = verts[ia];
    const b = verts[ib];
    const c = verts[ic];
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(off, nx / len, true); off += 4;
    view.setFloat32(off, ny / len, true); off += 4;
    view.setFloat32(off, nz / len, true); off += 4;
    for (const v of [a, b, c]) {
      view.setFloat32(off, v[0], true); off += 4;
      view.setFloat32(off, v[1], true); off += 4;
      view.setFloat32(off, v[2], true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2; // attribute byte count
  }
  return new Uint8Array(buffer);
}

function triggerBlobDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


function safeDownloadBase(name, fallback = "case") {
  return String(name || fallback).replace(/[^a-z0-9_\-]+/gi, "_").replace(/^_+|_+$/g, "") || fallback;
}

// Fetch the case's STL files, preferring processed STLs and falling back to raw.
async function fetchCaseStls(caseIntId, uuid) {
  const payload = [
    { machine_id: MACHINE_ID, uuid, caseIntID: caseIntId },
    { case_int_id: caseIntId },
  ];
  for (const endpoint of [`${API_BASE}/stl/get`, `${API_BASE}/stl/raw/get`]) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      logApi(res, `POST ${endpoint.replace(API_BASE, "")}`);
      if (!res.ok) continue;
      const data = await res.json();
      const files = (Array.isArray(data) ? data : [data]).filter((i) => i && i.data);
      if (files.length) return files;
    } catch (err) {
      console.warn("[case/download] STL endpoint failed", endpoint, err);
    }
  }
  return [];
}

// The four extra 3D slots (POST /stl/slot/), which /stl/get doesn't return. One
// at a time and decoded as they arrive — an occupied slot returns tens of MB.
async function fetchExtraStlSlots(caseIntId, uuid) {
  const auth = { machine_id: MACHINE_ID, uuid, caseIntID: caseIntId };
  const files = [];
  for (const slotNumber of EXTRA_STL_SLOTS) {
    try {
      const res = await fetch(`${API_BASE}/stl/slot/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([auth, { slotNumber }]),
      });
      if (!res.ok) continue; // 404 = empty slot
      const data = await res.json();
      const item = Array.isArray(data) ? data[0] : data;
      if (item?.data) {
        files.push({ slotNumber, filename: item.filename, bytes: base64ToBytes(item.data) });
      }
    } catch (err) {
      console.warn(`[case/download] extra 3D slot ${slotNumber} failed`, err);
    }
  }
  return files;
}

function sniffImageExt(bytes) {
  if (!bytes || bytes.length < 4) return "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  return "";
}

// Decode a stored image (data URL or bare base64) into bytes plus the extension
// its bytes actually call for — the stored name is often extension-less.
function decodeImagePayload(value) {
  const raw = String(value || "").trim();
  const isDataUrl = raw.startsWith("data:");
  const base64 = (isDataUrl ? raw.slice(raw.indexOf(",") + 1) : raw).replace(/\s+/g, "");
  const bytes = base64ToBytes(base64);
  let ext = isDataUrl ? (/^data:([^;,]+)/.exec(raw)?.[1] || "").split("/")[1] || "" : "";
  if (!ext) ext = sniffImageExt(bytes);
  if (ext === "jpeg") ext = "jpg";
  return { bytes, ext: ext || "png" };
}

function referenceImageName(row, index, ext, base) {
  const raw = String(row?.image_name || row?.filename || row?.name || "").trim();
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, "_");
  if (cleaned) return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.${ext}`;
  return `${base}_reference_${index + 1}.${ext}`;
}

// Two uploads can share a filename; the zip needs them distinct.
function uniqueDownloadName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${stem}_${n}${ext}`;
  while (used.has(candidate)) candidate = `${stem}_${++n}${ext}`;
  used.add(candidate);
  return candidate;
}

// Reference images as ready-to-write { name, bytes }, shared by the menu action
// and the bundle download so both ship identical files.
async function collectReferenceImageFiles(caseIntId, uuid, base) {
  const rows = await fetchReferenceImageRows(caseIntId, uuid);

  const used = new Set();
  const files = [];
  rows.forEach((row, index) => {
    try {
      const { bytes, ext } = decodeImagePayload(row.image_data ?? row.data);
      if (!bytes.length) return;
      files.push({ bytes, name: uniqueDownloadName(referenceImageName(row, index, ext, base), used) });
    } catch (err) {
      console.warn("[case/download] skipped unreadable reference image", index, err);
    }
  });
  return files;
}

async function downloadCaseReferenceImages(caseIntId, caseLabel) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntId == null) {
    toast.warning("Unable to download: missing case info or login.");
    return;
  }

  const base = safeDownloadBase(caseLabel, `case_${caseIntId}`);
  toast.info("Preparing reference images...");

  try {
    const files = await collectReferenceImageFiles(caseIntId, user.uuid, base);
    if (!files.length) {
      toast.info("No reference images found for this case.");
      return;
    }

    if (files.length === 1) {
      triggerBlobDownload(files[0].bytes, files[0].name);
      toast.success("Reference image download ready.");
      return;
    }

    if (typeof window.JSZip === "function") {
      const zip = new window.JSZip();
      files.forEach((file) => zip.file(file.name, file.bytes));
      const blob = await zip.generateAsync({ type: "uint8array" });
      triggerBlobDownload(blob, `${base}_reference_images.zip`);
    } else {
      // No zip library — save them one by one, spaced out so the browser does
      // not treat the burst as a popup and drop all but the first.
      for (const file of files) {
        triggerBlobDownload(file.bytes, file.name);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    toast.success(`${files.length} reference images downloaded.`);
  } catch (err) {
    console.error("Failed to download reference images:", err);
    toast.error(`Failed to download reference images. ${err.message || err}`);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Re-encode an image data URL (or raw base64 PNG) to JPEG bytes for the zip.
async function dataUrlToJpegBytes(data) {
  const src = String(data).startsWith("data:") ? data : `data:image/png;base64,${data}`;
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return base64ToBytes(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
}

// The case's 2D design image (thumbnail slot 0 = composite 2D) as JPEG bytes.
async function fetchCase2dJpegBytes(caseIntId, uuid) {
  try {
    const res = await fetch(`${API_BASE}/thumbnails/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID, uuid, caseIntID: caseIntId },
        // Numeric id, not the case-name string — the admin-path lookup parses
        // this as caseIntID (string names 404 for admin accounts).
        { case_int_id: caseIntId },
      ]),
    });
    logApi(res, "POST /thumbnails/get");
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const slot0 = rows.find((r) => Number(r?.slot) === 0) || rows[0];
    if (!slot0?.data) return null;
    return await dataUrlToJpegBytes(slot0.data);
  } catch (err) {
    console.warn("[case/download] 2D thumbnail fetch failed", err);
    return null;
  }
}

// Bundles STLs, extra 3D uploads, the 2D JPEG, reference images and the .docx
// report into one zip. Each part is best-effort; only an empty result aborts.
async function downloadCaseFiles(caseIntId, caseLabel, apiStatus) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntId == null) {
    toast.warning("Unable to download: missing case info or login.");
    return;
  }
  if (typeof window.JSZip !== "function") {
    toast.error("Zip library failed to load. Please refresh and try again.");
    return;
  }

  toast.info("Preparing download…");
  const base = String(caseLabel || `case_${caseIntId}`).replace(/[^a-z0-9_\-]+/gi, "_");
  const zip = new window.JSZip();
  let added = 0;

  // 1) STL files.
  try {
    const files = await fetchCaseStls(caseIntId, user.uuid);
    const usedNames = new Set();
    files.forEach((file, idx) => {
      const type = String(file.type || file.jaw_type || "").toLowerCase();
      const suffix = type || `file_${idx + 1}`;
      let name = file.filename || `${base}_${suffix}.stl`;
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf(".");
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        name = `${stem}_${idx + 1}${ext}`;
      }
      usedNames.add(name);
      try {
        const bytes = base64ToBytes(file.data);
        zip.file(name, bytes);
        added += 1;
        // The mesh is often OFF; also emit an STL copy so STL-only tools work.
        if (isOffBytes(bytes)) {
          const stl = offTextToBinaryStl(new TextDecoder().decode(bytes));
          if (stl) {
            let stlName = /\.off$/i.test(name)
              ? name.replace(/\.off$/i, ".stl")
              : `${name.replace(/\.[^.]+$/, "")}.stl`;
            if (usedNames.has(stlName)) {
              stlName = `${stlName.replace(/\.stl$/i, "")}_${idx + 1}.stl`;
            }
            usedNames.add(stlName);
            zip.file(stlName, stl);
            added += 1;
          }
        }
      } catch (err) {
        console.error("❌ Failed to add STL to zip:", name, err);
      }
    });
  } catch (err) {
    console.warn("[case/download] STL bundling failed", err);
  }

  // 2) Extra 3D files, in their own folder so an uploaded name can't collide
  //     with a jaw mesh at the zip root.
  try {
    const extras = await fetchExtraStlSlots(caseIntId, user.uuid);
    const usedExtraNames = new Set();
    extras.forEach(({ slotNumber, filename, bytes }) => {
      let cleaned = String(filename || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
      // Stored names are upload names, but an extension-less one won't open.
      if (cleaned && !/\.[a-z0-9]{2,5}$/i.test(cleaned)) cleaned += ".stl";
      const name = uniqueDownloadName(
        cleaned || `${base}_extra_${slotNumber}.stl`,
        usedExtraNames
      );
      zip.file(`extra_3d/${name}`, bytes);
      added += 1;
    });
  } catch (err) {
    console.warn("[case/download] extra 3D files failed", err);
  }

  // 3) 2D design JPEG (thumbnail slot 0).
  try {
    const jpeg = await fetchCase2dJpegBytes(caseIntId, user.uuid);
    if (jpeg) {
      zip.file(`${base}_2D.jpg`, jpeg);
      added += 1;
    }
  } catch (err) {
    console.warn("[case/download] 2D JPEG failed", err);
  }

  // 4) Reference images, kept in their own folder so they don't collide with
  //     the STL/report names at the zip root.
  try {
    const refFiles = await collectReferenceImageFiles(caseIntId, user.uuid, base);
    refFiles.forEach((file) => {
      zip.file(`reference_images/${file.name}`, file.bytes);
      added += 1;
    });
  } catch (err) {
    console.warn("[case/download] reference images failed", err);
  }

  // 5) Design report as a Word .docx.
  try {
    const html = await buildReportHtml(caseIntId, { caseLabel, apiStatus });
    const docx = await reportHtmlToDocxBytes(html);
    zip.file(`${base}_report.docx`, docx);
    added += 1;
  } catch (err) {
    console.warn("[case/download] report .docx failed", err);
  }

  if (!added) {
    toast.info("No files available to download for this case.");
    return;
  }

  try {
    const blob = await zip.generateAsync({ type: "uint8array" });
    triggerBlobDownload(blob, `${base}.zip`);
    toast.success("Download ready.");
  } catch (err) {
    console.error("❌ Failed to generate zip:", err);
    toast.error(`Failed to generate zip: ${err.message || err}`);
  }
}

// API status to a CSS modifier for the pill colour. Keys stay broad — anything
// unrecognised falls back to a neutral "na" pill.
function statusPillClass(apiStatus) {
  const v = apiStatusToValue(apiStatus);
  if (!v || v === "na") return "cm-pill-na";
  if (v === "completed") return "cm-pill-completed";
  // 2D/3D design approved (+ 3D drafted) read as orange to match the
  // Preparation card.
  if (
    v === "draft" ||
   (v.endsWith("_pending") || v === "pending") ||
   (v.endsWith("_drafted") || v === "drafted") ||
   (v.endsWith("_approved") || v === "approved") 
  ) return "cm-pill-prep";
  if (
    v === "in_production" ||
    v === "out_for_delivery" ||
    v === "delivered" 
  ) return "cm-pill-progress";
}

// Exact status titles live in apiLog.js (shared with the dashboard and the
// generated report) so the pill reads identically everywhere.
function statusDisplayText(apiStatus) {
  return statusLabel(apiStatus);
}

// The pill doubles as its own edit control, so it carries a pencil. Built here
// because patchRowInPlace repaints it too — a textContent assign drops the icon.
function statusPillInner(apiStatus) {
  return (
    `<span class="cm-pill-label">${escapeAttr(statusDisplayText(apiStatus))}</span>` +
    `<i class="fa-regular fa-pen-to-square cm-pill-pencil" aria-hidden="true"></i>`
  );
}

// Paints the detail pane's read-only STATUS pill. The native <select> survives
// only as the invisible editing control.
function applyStatusPillToSelect(apiStatus) {
  const pill = document.getElementById("statusPillText");
  if (!pill) return;
  pill.className = `cm-pill ${statusPillClass(apiStatus)}`;
  pill.textContent = statusDisplayText(apiStatus);
}

function initialsFor(name) {
  const s = String(name || "").trim();
  if (!s) return "·";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

function escapeAttr(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// Co-owners as small name pills in SHARED WITH; an empty array renders an
// em-dash so the field never sits blank.
function renderSharedWith(coOwners) {
  const container = document.getElementById("shared-with-list");
  if (!container) return;
  const names = Array.isArray(coOwners) ? coOwners.filter(Boolean) : [];
  if (!names.length) {
    container.innerHTML = '<span class="cm-shared-empty">—</span>';
    return;
  }
  const joined = names.map((name) => escapeAttr(name)).join(", ");
  container.innerHTML = `<span class="cm-shared-name" title="${joined}">${joined}</span>`;
}

// Render the case list as a sortable table. The owner cell shows a "+N"
// badge (titled with the full list) when a case has co-owners.
function populateTable(cases) {
  // Legacy per-status dropdown (still present on the admin page).
  const sel = document.getElementById("filter-status");
  if (sel && sel.value !== "all") {
    cases = cases.filter((c) => apiStatusToValue(c.new_status) === sel.value);
  }

  // Stat-card stage filter (user case list). "all" = show everything.
  if (activeStatusFilter !== "all" && STATUS_GROUPS[activeStatusFilter]) {
    const group = STATUS_GROUPS[activeStatusFilter];
    cases = cases.filter((c) => group.has(apiStatusToValue(c.new_status)));
  }

  const pinnedSet = getPinnedSet();
  const dir = currentSortOrder === "asc" ? 1 : -1;
  cases = [...(cases || [])].sort((a, b) => {
    const aId = String(a.id ?? a.case_int_id ?? "");
    const bId = String(b.id ?? b.case_int_id ?? "");
    // Pinned cases always group above unpinned, regardless of the active sort.
    const pinDiff = Number(pinnedSet.has(bId)) - Number(pinnedSet.has(aId));
    if (pinDiff !== 0) return pinDiff;
    // Within each pin group, order by the chosen column. "recent" (the default)
    // floats the case you just opened, and follows you across devices.
    const av = sortValue(a, currentSortColumn);
    const bv = sortValue(b, currentSortColumn);
    const cmp =
      typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir;
  });

  // The only collaborator roster a non-admin can build, and what the invite box
  // suggests. Paired with the case id so one case counts once per person.
  recordCollaborators(
    cases.flatMap((c) => {
      const caseId = c.id ?? c.case_int_id;
      return [c.assigned_to || c.username, ...(c.co_owners || [])].map((name) => ({
        name,
        caseId,
      }));
    })
  );

  const body = document.getElementById("caseTableBody");
  const countBadge = document.getElementById("caseCountBadge");
  if (countBadge) countBadge.textContent = String(cases?.length || 0);
  // Reflect the current match count in the search bar (visible only while a
  // name/date/status search is active).
  updateSearchResultCount(cases?.length || 0);
  if (!body) return;
  // Rows are about to be torn down — drop their pending visibility watches;
  // the loop below re-registers whichever new rows still need enrichment.
  if (rowObserver) rowObserver.disconnect();
  body.innerHTML = "";

  if (!cases || cases.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="cm-list-empty" colspan="7">No cases found.</td>`;
    body.appendChild(tr);
    return;
  }

  cases.forEach((caseItem) => {
    const resolvedCaseId = caseItem.id ?? caseItem.case_int_id;
    const assignedTo = caseItem.assigned_to || caseItem.username || "N/A";
    const dueDate =
      caseItem.expected_date ||
      caseItem.due_date ||
      computeDefaultDueDate(caseItem.creation_date);
    // case_id IS the case name; the numeric UID stays on row.dataset.caseId for
    // the click handlers rather than in the label.
    const caseName = caseItem.case_id ? truncateWords(caseItem.case_id, 10) : null;
    const caseDisplayName = caseName || "N/A";

    const pinned = pinnedSet.has(String(resolvedCaseId));

    const row = document.createElement("tr");
    row.className = "cm-row";
    if (pinned) row.classList.add("is-pinned");
    // Admins receive soft-deleted cases too (server sets hideDeleted = !is_admin),
    // so flag them struck-through to give "Retrieve the Case" a target.
    if (isCaseDeleted(caseItem)) row.classList.add("cm-row-deleted");
    // Re-apply the selected highlight after a re-render (filter/refresh/sort/
    // pin), since the table body is rebuilt but window.selectedCaseId persists.
    if (
      window.selectedCaseId != null &&
      String(resolvedCaseId) === String(window.selectedCaseId)
    ) {
      row.classList.add("is-active");
    }
    row.dataset.caseId = resolvedCaseId;
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    // Urgency bar shown at the left of the row, colored by days remaining
    // until the due date (compared with today).
    const dueInd = dueDateIndicator(dueDate);
    const dueBarHtml = dueInd
      ? `<span class="cm-due-bar ${dueInd.cls}" title="${escapeAttr(dueInd.label)}" aria-hidden="true"></span>`
      : "";

    row.innerHTML = `
      <td class="cm-td-name">
        <div class="cm-name-line">
          <span class="cm-row-name" title="${escapeAttr(caseItem.case_id || "")}">${escapeAttr(caseDisplayName)}</span>
          <button class="cm-inline-edit cm-name-edit" type="button" title="Rename case" aria-label="Rename case" data-action="rename"><i class="fa-regular fa-pen-to-square"></i></button>${pinned ? '<i class="fa-solid fa-flag cm-row-pin" title="Pinned"></i>' : ""}
        </div>${dueBarHtml}
      </td>
      <td class="cm-td-status">
        <span class="cm-pill ${statusPillClass(caseItem.new_status)}" data-action="edit-status" role="button" tabindex="0" title="Change status">${statusPillInner(caseItem.new_status)}</span>
      </td>
      <td class="cm-td-date" data-label="Created">${formatDateTime(caseItem.creation_date)}</td>
      <td class="cm-td-date cm-due-date ${dueInd ? dueInd.cls : ""}" data-label="Due">
        <span class="cm-due-text">${dueDate ? formatDateOnly(dueDate) : "N/A"}</span>
        <button class="cm-due-edit" type="button" title="Edit due date" aria-label="Edit due date" data-action="edit-due"><i class="fa-regular fa-pen-to-square"></i></button>
      </td>
      <td class="cm-td-owner" data-label="Owner">
        <i class="fa-regular fa-circle-user"></i><span class="cm-owner-name" title="${escapeAttr(assignedTo)}">${escapeAttr(assignedTo)}</span>
      </td>
      <td class="cm-td-shared" data-label="Shared With">
        ${caseItem.co_owners?.length
          ? `<span class="cm-shared-names" title="${escapeAttr(caseItem.co_owners.join(", "))}">${escapeAttr(caseItem.co_owners.join(", "))}</span>`
          : '<span class="cm-shared-empty">—</span>'}
        <button class="cm-inline-edit cm-shared-edit" type="button" title="Manage shared users" aria-label="Manage shared users" data-action="edit-shared"><i class="fa-regular fa-pen-to-square"></i></button>
      </td>
      <td class="cm-td-actions">
        <button class="cm-row-icon" type="button" title="Download files" aria-label="Download files" data-action="download"><i class="fa-regular fa-circle-down"></i></button>
        <button class="cm-row-icon ${pinned ? "is-pinned" : ""}" type="button" title="${pinned ? "Unpin" : "Pin to top"}" aria-label="${pinned ? "Unpin" : "Pin to top"}" aria-pressed="${pinned}" data-action="flag"><i class="${pinned ? "fa-solid" : "fa-regular"} fa-star"></i></button>
        <button class="cm-row-icon cm-row-icon-danger" type="button" title="Delete" aria-label="Delete" data-action="delete"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;

    const selectRow = () => {
      handleRowClick(resolvedCaseId);
      body.querySelectorAll(".cm-row").forEach((r) => r.classList.remove("is-active"));
      row.classList.add("is-active");
    };

    row.addEventListener("click", selectRow);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectRow();
      }
    });

    row.querySelector('[data-action="download"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      // Pass the merged-in authoritative status: /case/get/:id, which the report
      // would otherwise read, omits it.
      await downloadCaseFiles(resolvedCaseId, caseItem.case_id, caseItem.new_status ?? null);
    });

    // Rename and share both reuse the detail-pane menu actions, which read
    // window.selectedCaseId — so select the row first, then trigger the item.
    row.querySelector('[data-action="rename"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      selectRow();
      document.getElementById("renameBtn")?.click();
    });

    row.querySelector('[data-action="edit-shared"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      selectRow();
      document.getElementById("editUserAccessBtn")?.click();
    });

    row.querySelector('[data-action="flag"]').addEventListener("click", (e) => {
      e.stopPropagation();
      togglePinned(resolvedCaseId);
      applyClientFilters();
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await deleteCaseById(resolvedCaseId);
      if (ok) toast.success("Case deleted successfully.");
    });

    // Inline "Edit due date" straight from the list (user feedback: allow
    // editing the Due Date on the main case-management page).
    const dueTd = row.querySelector(".cm-due-date");
    row.querySelector('[data-action="edit-due"]')?.addEventListener("click", (e) => {
      e.stopPropagation();
      // Recompute at click time: lazy enrichment may have patched the case's
      // due date after this row was rendered.
      const freshDue =
        caseItem.expected_date || caseItem.due_date || computeDefaultDueDate(caseItem.creation_date);
      openDueDateEditor(dueTd, caseItem, resolvedCaseId, freshDue);
    });

    // STATUS, which until now could only be changed from the detail pane after
    // selecting the case. The pill is the control itself — no separate pencil.
    const statusTd = row.querySelector(".cm-td-status");
    const statusPill = row.querySelector('[data-action="edit-status"]');
    statusPill?.addEventListener("click", (e) => {
      e.stopPropagation();
      openStatusEditor(statusTd, caseItem, resolvedCaseId);
    });
    // The row itself answers Enter/Space by selecting the case, so the pill has
    // to claim those keys before they bubble.
    statusPill?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      openStatusEditor(statusTd, caseItem, resolvedCaseId);
    });

    body.appendChild(row);

    // Lazy enrichment: un-enriched rows fetch their details/co-owners when
    // they scroll into view (see the enrichment section below).
    observeRowForEnrichment(row, caseItem);
  });

  // Refresh the admin overview cards whenever the table is (re)painted.
  scheduleAdminStats();
}

// 点击某一行时获取病例详情
async function handleRowClick(caseId) {
  window.selectedCaseId = caseId;
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser || !caseId) return;

  // The detail pane reads enriched fields off the list row, so jump this case to
  // the front of the lazy queue; syncDetailPaneIfSelected repaints on arrival.
  enqueueEnrichment(
    currentCases.find((c) => c.id === caseId || c.case_int_id === caseId),
    { front: true }
  );

  const requestBody = JSON.stringify([
    {
      machine_id: MACHINE_ID,
      uuid: loggedInUser.uuid,
      caseIntID: caseId,
    },
  ]);

  try {
    const response = await fetch(
      `${API_BASE}/case/get/${caseId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      }
    );
    logApi(response, 'POST /case/get/:id');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail = await response.json();

    // 把 currentCases 中对应行取出来
    const extra = currentCases.find(
      (c) => c.id === caseId || c.case_int_id === caseId
    );
    if (extra) {
      Object.assign(detail, {
        new_status: extra.new_status,
        expected_date: extra.expected_date,
        assigned_to: extra.assigned_to,
        comments: extra.comments,
        co_owners: extra.co_owners,
      });
    }

    // Carries the new_status/expected_date /case/get/:id omits. The UID stamp is
    // load-bearing: the stub outlives the selection, and a PUT is a full-row write.
    detail.case_int_id = detail.case_int_id ?? detail.id ?? caseId;
    window.selectedCaseStub = detail;

    // The 2D tab can't read window.selectedCaseStub, but localStorage is shared
    // same-origin — this is how its Case Note defaults "Date Required".
    saveCaseDueDate(
      caseId,
      toDateInputValue(
        detail.expected_date ||
          detail.due_date ||
          computeDefaultDueDate(detail.creation_date)
      )
    );

    displayCaseDetails(detail);
    await fetchThumbnails(caseId);

    // Selecting a row only previews it and must NOT reorder the list — the
    // last-opened bump fires from Start Case instead.
  } catch (err) {
    console.error("❌ Failed to get case detail:", err);
  }

  // Must match case_list.css's @media max-width: 860px, where the detail pane
  // goes off-canvas and stays hidden until .show-details is added.
  if (window.innerWidth <= 860) {
    document.querySelector(".cm-page")?.classList.add("show-details");
  }

}

// Optimistically update the local case's last_updated so the sort moves it
// immediately, without waiting for the server PUT to round-trip.
function bumpLocalLastUpdated(caseId) {
  const id = String(caseId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const c of currentCases) {
    if (String(c.id ?? c.case_int_id) === id) {
      c.last_updated = nowSeconds;
      break;
    }
  }
  applyClientFilters();
}

// Read one case's row straight from the server. Returns null when the request
// fails — a caller building a full-row PUT must then NOT write.
async function fetchCaseRow(caseId, user) {
  try {
    const res = await fetch(`${API_BASE}/case/get/${caseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID: caseId },
      ]),
    });
    logApi(res, "POST /case/get/:id");
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[caseManagement] case row read failed:", err);
    return null;
  }
}

// A no-op PUT re-sending the case's own fields, purely so the backend bumps
// last_updated — what the "recent" sort keys on.
//
// PUT /case/:id is a FULL-ROW write whose `case_id` is the case NAME: a missing
// `detail` blanks it, a stale one renames the case. Skip rather than write a default.
async function fireLastOpenedBump(caseId, detail, user) {
  const auth = {
    machine_id: MACHINE_ID,
    uuid: user.uuid,
    caseIntID: caseId,
  };
  const isThisCase =
    detail != null && String(caseIntIdOf(detail) ?? "") === String(caseId);
  const row = isThisCase ? detail : await fetchCaseRow(caseId, user);
  if (!row?.case_id) {
    console.warn(
      `[caseManagement] last-opened bump skipped for case ${caseId}: case row unavailable`
    );
    return;
  }
  const caseBody = {
    case_id: row.case_id,
    // Same row as the name: sending these from a stale copy would zero the
    // case's saved survey angles / jaw process flags.
    upper_insertion_angle_x: Number(row.upper_insertion_angle_x) || 0,
    upper_insertion_angle_y: Number(row.upper_insertion_angle_y) || 0,
    upper_insertion_angle_z: Number(row.upper_insertion_angle_z) || 0,
    lower_insertion_angle_x: Number(row.lower_insertion_angle_x) || 0,
    lower_insertion_angle_y: Number(row.lower_insertion_angle_y) || 0,
    lower_insertion_angle_z: Number(row.lower_insertion_angle_z) || 0,
    process_upper: Number(row.process_upper) || 0,
    process_lower: Number(row.process_lower) || 0,
  };
  const res = await fetch(
    `${API_BASE}/case/${caseId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([auth, caseBody]),
    }
  );
  logApi(res, 'PUT /case/:id');
  if (!res.ok) {
    throw new Error(`PUT /case/${caseId} status=${res.status}`);
  }
}

// QR code of the 3D viewer URL, generated fully client-side (qrcodejs) so the
// URL never reaches a third party. Offers a PNG download.
function showThreeDViewerQr(url) {
  if (typeof window.QRCode === "undefined") {
    toast.error("QR code library failed to load. Please try again.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "cm-qr-modal";
  overlay.innerHTML =
    '<div class="cm-qr-backdrop"></div>' +
    '<div class="cm-qr-panel" role="dialog" aria-modal="true" aria-label="3D viewer QR code">' +
    '<div class="cm-qr-header">' +
    '<h2 class="cm-qr-title">Scan to open 3D viewer</h2>' +
    '<button type="button" class="cm-qr-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
    "</div>" +
    '<div class="cm-qr-code" id="cmQrCode"></div>' +
    '<p class="cm-qr-url"></p>' +
    '<button type="button" class="cm-btn cm-btn-primary cm-qr-download">Save</button>' +
    "</div>";
  document.body.appendChild(overlay);

  const codeEl = overlay.querySelector("#cmQrCode");
  new window.QRCode(codeEl, {
    text: url,
    width: 220,
    height: 220,
    correctLevel: window.QRCode.CorrectLevel.M,
  });
  overlay.querySelector(".cm-qr-url").textContent = url;

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  overlay.querySelector(".cm-qr-backdrop").addEventListener("click", close);
  overlay.querySelector(".cm-qr-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);

  overlay.querySelector(".cm-qr-download").addEventListener("click", () => {
    const node = codeEl.querySelector("img") || codeEl.querySelector("canvas");
    let dataUrl = "";
    if (node?.tagName === "IMG") dataUrl = node.src;
    else if (node?.tagName === "CANVAS") dataUrl = node.toDataURL("image/png");
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `case_${window.selectedCaseId ?? "3d"}_qr.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

// 显示基本信息
function displayCaseDetails(data) {
  const caseIntId = data.id ?? data.case_int_id;

  const displayName = data.case_id
    ? caseIntId != null
      ? `UID ${caseIntId}-${data.case_id}`
      : data.case_id
    : "N/A";
  const nameHeader = document.getElementById("caseNameDisplay");
  if (nameHeader) nameHeader.textContent = "Case Details";

  // Case Details "CASE NAME" shows only the case name, not the "UID <id>-" prefix.
  const caseNameOnly = data.case_name || data.case_id || "N/A";
  document.getElementById("selected-case").textContent = caseNameOnly;
  const footerCaseName = document.getElementById("footerCaseName");
  if (footerCaseName) footerCaseName.textContent = data.case_name || displayName;
  const assignee = data.assigned_to || data.username || "N/A";
  document.getElementById("created-by").textContent = assignee;
  const avatar = document.getElementById("assigneeAvatar");
  if (avatar) avatar.textContent = initialsFor(assignee);

  renderSharedWith(data.co_owners);

  document.getElementById("date-created").textContent = formatDateTime(data.creation_date);
  document.getElementById("last-edited").textContent = formatDateTime(data.last_updated);

  renderCaseInstructions(caseIntId, data.comments);

  const statusSel = document.getElementById("status");
  if (statusSel) {
    statusSel.value = apiStatusToValue(data.new_status);
    applyStatusPillToSelect(data.new_status);
  }
  const statusText = document.getElementById("status-text");
  if (statusText) statusText.textContent = data.new_status || "-";

  const pill = document.getElementById("statusPill");
  if (pill) {
    pill.className = `cm-pill ${statusPillClass(data.new_status)}`;
    pill.textContent = statusDisplayText(data.new_status);
  }

  const webUrl = data.web_url || data.weburl || data.url || "-";
  const webUrlEl = document.getElementById("web-url");
  if (webUrlEl) webUrlEl.textContent = webUrl;

  // Delete/Retrieve are mutually exclusive. The authoritative deleted flag is on
  // the cached list row, not the /case/get payload merged into `data`.
  if (isCurrentUserAdmin()) {
    const caseObj =
      currentCases.find(
        (c) => String(c.id ?? c.case_int_id) === String(caseIntId)
      ) || data;
    const deleted = isCaseDeleted(caseObj);
    const retrieveBtn = document.getElementById("retrieveCaseBtn");
    const deleteBtn = document.getElementById("deleteCaseBtn");
    if (retrieveBtn) retrieveBtn.hidden = !deleted;
    if (deleteBtn) deleteBtn.hidden = deleted;
  }
}

function applyClientFilters() {
  // Two search boxes (desktop toolbar, phone header bar) but only one visible at
  // a time, so take whichever actually holds a query.
  const searchInput = document.getElementById("searchCaseInput");
  const mobileSearch = document.getElementById("mobileSearchInput");
  const dateInput = document.getElementById("dateFilterInput");
  const todayOnly = document.getElementById("todayOnly");

  // Keep the stat-card counts in sync with the underlying list (they reflect
  // the whole non-deleted list, independent of the active stage/search).
  updateStatFilterCounts();
  // Grey the date/status controls while they hold no real selection.
  syncSearchPlaceholderState();

  const q = (mobileSearch?.value || searchInput?.value || "").trim().toLowerCase();
  const dateVal = dateInput?.value || "";
  const todayFlag = !!todayOnly?.checked;

  const today = new Date();
  const base = currentCases.filter((item) => {
    // Deleted cases are hidden by default; the "View" link under Total Deleted
    // Cases flips to showing ONLY deleted cases.
    if (deletedOnlyView) {
      if (!isCaseDeleted(item)) return false; // deleted-only view
    } else if (isCaseDeleted(item)) {
      return false; // default: hide removed cases
    }

    const caseName = (item.case_id || "").toLowerCase();
    const matchName = !q || caseName.includes(q);

    const createdDate = item.creation_date
      ? new Date(Number(item.creation_date) * (String(item.creation_date).length === 13 ? 1 : 1000))
      : null;

    const createdYmd = createdDate && !Number.isNaN(createdDate.getTime())
      ? `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}-${String(createdDate.getDate()).padStart(2, "0")}`
      : "";

    const matchDate = !dateVal || createdYmd === dateVal;
    const matchToday = !todayFlag || (
      createdDate &&
      createdDate.getFullYear() === today.getFullYear() &&
      createdDate.getMonth() === today.getMonth() &&
      createdDate.getDate() === today.getDate()
    );

    return matchName && matchDate && matchToday;
  });

  populateTable(base);
}

// Counts cover the WHOLE list and don't shrink as you filter, so the cards stay
// a stable overview.
function updateStatFilterCounts() {
  const counts = { all: 0, preparation: 0, delivery: 0, completed: 0 };
  for (const item of currentCases) {
    if (isCaseDeleted(item)) continue;
    counts.all += 1;
    const group = caseStatusGroup(item);
    if (group && group in counts) counts[group] += 1;
  }
  const ids = {
    all: "statAllCount",
    preparation: "statPreparationCount",
    delivery: "statDeliveryCount",
    completed: "statCompletedCount",
  };
  for (const [group, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(counts[group]);
  }
}

// Reflect the active stage on the cards (pressed state) so it's obvious which
// filter is on and which click will clear it.
function syncStatFilterActiveState() {
  document.querySelectorAll("[data-status-group]").forEach((btn) => {
    const on = btn.getAttribute("data-status-group") === activeStatusFilter;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
}

// Selects the card's stage, or toggles back to "all" when the active card is
// clicked again. "All Cases" always clears.
function applyStatFilter(group) {
  if (group === "all") {
    activeStatusFilter = "all";
  } else {
    activeStatusFilter = activeStatusFilter === group ? "all" : group;
  }
  syncStatFilterActiveState();
  applyClientFilters();
}

// Date inputs and <select>s have no ::placeholder, so an .is-empty class fakes
// the Name field's greyed look while they hold no real selection.
function syncSearchPlaceholderState() {
  const dateInput = document.getElementById("dateFilterInput");
  if (dateInput) dateInput.classList.toggle("is-empty", !dateInput.value);
  const statusSel = document.getElementById("filter-status");
  if (statusSel) statusSel.classList.toggle("is-empty", statusSel.value === "all");
}

// "N found" badge while any search is active — the date and status searches
// especially, where the match isn't obvious at a glance.
function updateSearchResultCount(count) {
  const el = document.getElementById("searchResultCount");
  if (!el) return;
  const nameQ = (document.getElementById("searchCaseInput")?.value || "").trim();
  const mobileQ = (document.getElementById("mobileSearchInput")?.value || "").trim();
  const dateV = document.getElementById("dateFilterInput")?.value || "";
  const statusV = document.getElementById("filter-status")?.value || "all";
  const searchActive = !!(nameQ || mobileQ || dateV || statusV !== "all");
  el.hidden = !searchActive;
  // Compact corner badge: show just the match count (99+ when it overflows).
  el.textContent = searchActive ? (count > 99 ? "99+" : String(count)) : "";
  el.setAttribute(
    "title",
    `${count} ${count === 1 ? "case" : "cases"} found`
  );
}

// Shows only the chosen mode's input and clears the other two, so a stale value
// can't keep filtering after a mode switch.
function updateSearchModeUI() {
  const mode = document.getElementById("searchMode")?.value || "name";
  const nameInput = document.getElementById("searchCaseInput");
  const dateInput = document.getElementById("dateFilterInput");
  const statusSel = document.getElementById("filter-status");

  if (nameInput) {
    nameInput.hidden = mode !== "name";
    if (mode !== "name") nameInput.value = "";
  }
  if (dateInput) {
    dateInput.hidden = mode !== "date";
    if (mode !== "date") dateInput.value = "";
  }
  if (statusSel) {
    statusSel.hidden = mode !== "status";
    if (mode !== "status") statusSel.value = "all";
  }
  applyClientFilters();
}

// In-list due-date edit via the themed calendar. Commits through
// updateCaseDueDate, mirrors to localStorage for the 2D page, then re-renders.
function openDueDateEditor(anchorTd, caseItem, caseId, currentDue) {
  if (!anchorTd) return;
  openThemedCalendar(anchorTd, {
    value: toDateInputValue(currentDue) || "",
    allowClear: true,
    onPick: async (iso) => {
      const ok = await updateCaseDueDate(caseId, iso || "");
      if (ok) {
        // additionalcasedetails.due_date is Unix *seconds*; mirror it so the
        // in-memory row (and redraw) show the new date immediately.
        let epochSec = null;
        if (iso) {
          const ms = Date.parse(`${iso}T00:00:00`);
          epochSec = Number.isNaN(ms) ? null : Math.floor(ms / 1000);
        }
        caseItem.expected_date = epochSec;
        caseItem.due_date = epochSec;
        saveCaseDueDate(caseId, iso || "");
        toast.success(iso ? "Due date updated." : "Due date cleared.");
      } else {
        toast.error("Failed to update due date. Please try again.");
      }
      applyClientFilters();
    },
  });
}

// Swaps the row's STATUS pill for a <select>, built on demand (a permanent one
// per row is 12 options per case). Cloned from #status so the two can't drift.
function openStatusEditor(anchorTd, caseItem, caseId) {
  if (!anchorTd || anchorTd.querySelector(".cm-status-inline")) return;
  const template = document.getElementById("status");
  if (!template) return;

  const pill = anchorTd.querySelector(".cm-pill");
  const select = document.createElement("select");
  select.className = "cm-status-inline";
  select.setAttribute("aria-label", "Change status");
  select.innerHTML = template.innerHTML;
  select.value = apiStatusToValue(caseItem.new_status);

  // Leave the row's own click handler alone — selecting a case out from under
  // the open editor would repaint the table and drop it.
  select.addEventListener("click", (e) => e.stopPropagation());

  let done = false;
  // `refocus` only for a deliberate cancel (Escape): on blur the user has
  // already clicked or tabbed elsewhere, and pulling focus back would fight them.
  const close = ({ refocus = false } = {}) => {
    if (done) return;
    done = true;
    select.remove();
    if (pill) {
      pill.hidden = false;
      if (refocus) pill.focus();
    }
  };

  select.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close({ refocus: true });
    }
  });
  // Dismissing without choosing (click away, Tab out) restores the pill.
  select.addEventListener("blur", () => close());

  select.addEventListener("change", async () => {
    const apiValue = valueToApiStatus(select.value);
    const previous = caseItem.new_status;
    done = true;                 // the repaint below removes the row entirely
    select.disabled = true;

    try {
      // postNewStatus re-reads the stored record and merges, so this is safe on
      // a row lazy enrichment hasn't reached yet.
      await postNewStatus(caseItem, apiValue);
      caseItem.new_status = apiValue;
      syncDetailPaneIfSelected(caseItem);
      toast.success("Status updated.");
    } catch (err) {
      console.error("Status update failed:", err);
      caseItem.new_status = previous;
      toast.error("Failed to update status.");
    }
    // Repaint from the model: the pill, the stage filter counts and this row's
    // place in them all follow the status.
    applyClientFilters();
  });

  if (pill) pill.hidden = true;
  anchorTd.appendChild(select);
  select.focus();
}

// Default due date: 14 days after creation.
function computeDefaultDueDate(creationTs) {
  const ms = timestampToMs(creationTs);
  return ms == null ? null : ms + 14 * 24 * 60 * 60 * 1000;
}

// Used by the Due Date column, where the time of day is noise.
function formatDateOnly(ts) {
  const ms = timestampToMs(ts);
  return ms == null ? "N/A" : new Date(ms).toLocaleDateString();
}

// Truncate a string to at most `max` whole words, appending an ellipsis when
// it's clipped. Used to keep the Case Name column compact.
function truncateWords(str, max) {
  const words = String(str).trim().split(/\s+/);
  if (words.length <= max) return String(str);
  return words.slice(0, max).join(" ") + "…";
}

function formatDateTime(ts) {
  const ms = timestampToMs(ts);
  return ms == null ? "N/A" : new Date(ms).toLocaleString();
}

// Whole calendar days until due, so "due today" is 0 whatever the time:
// <0 is-overdue, 0 is-due, 1-5 is-soon, 6-14 is-ok, >14 null. Colours in CSS.
function dueDateIndicator(dueTs) {
  const dueMid = toDayMidnight(dueTs);
  if (dueMid == null) return null;

  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  const gap = Math.round((dueMid - todayMid) / DAY); // days remaining until due

  const days = (d) => `${d} day${Math.abs(d) === 1 ? "" : "s"}`;
  if (gap < 0) return { cls: "is-overdue", label: `Overdue by ${days(-gap)}` };
  if (gap === 0) return { cls: "is-due", label: "Due today" };
  if (gap <= 5) return { cls: "is-soon", label: `Due in ${days(gap)}` };
  if (gap <= 14) return { cls: "is-ok", label: `Due in ${days(gap)}` };
  return null; // due more than 14 days out — no indicator
}

// Numeric columns return a number, text columns a lowercased string for
// localeCompare. Keep these keyed off the same fields the card renders.
function sortValue(caseItem, column) {
  switch (column) {
    case "name":
      return (caseItem.case_id || "").toLowerCase();
    case "status":
      return statusDisplayText(caseItem.new_status).toLowerCase();
    case "owner":
      return (caseItem.assigned_to || caseItem.username || "").toLowerCase();
    case "created":
      return Number(caseItem.creation_date) || 0;
    case "due": {
      const due =
        caseItem.expected_date ||
        caseItem.due_date ||
        computeDefaultDueDate(caseItem.creation_date);
      return Number(due) || 0;
    }
    case "recent":
    default:
      return Number(caseItem.last_updated) || 0;
  }
}

// 缩略图切换
function updateThumbnail() {
  const image = document.getElementById("caseImage");
  const counter = document.getElementById("imageCounter");
  const area = image?.closest(".cm-image-area");

  if (!image || !counter) return;

  if (currentThumbnails.length === 0) {
    image.removeAttribute("src");
    image.alt = "No images available";
    counter.textContent = "IMAGE 0 OF 0";
    area?.classList.remove("has-image");
    return;
  }

  image.src = "data:image/png;base64," + currentThumbnails[currentImageIndex];
  image.alt = `Case thumbnail ${currentImageIndex + 1}`;
  counter.textContent = `IMAGE ${currentImageIndex + 1} OF ${currentThumbnails.length}`;
  area?.classList.add("has-image");
}

// Move the inline carousel by delta (wraps around) and re-render.
function stepThumbnail(delta) {
  if (currentThumbnails.length === 0) return;
  currentImageIndex =
    (currentImageIndex + delta + currentThumbnails.length) % currentThumbnails.length;
  updateThumbnail();
}

// onSwipe(1) for a left swipe, onSwipe(-1) for right. Vertical drags and taps
// are ignored so scrolling and click-to-zoom still work.
function attachSwipeNav(el, onSwipe) {
  if (!el || el.dataset.swipeBound) return;
  el.dataset.swipeBound = "1";
  const THRESHOLD = 40; // min horizontal travel (px) to count as a swipe
  let startX = 0;
  let startY = 0;
  let tracking = false;
  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true }
  );
  el.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Require a mostly-horizontal gesture past the threshold.
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
}

// Lightbox for the thumbnail carousel, with prev/next and a counter kept in sync
// with the small one. Built once and reused; closes on ×, backdrop or Escape.
function openThumbnailPreview() {
  if (currentThumbnails.length === 0) return;
  let overlay = document.getElementById("thumbPreviewOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "thumbPreviewOverlay";
    overlay.className = "thumb-preview-overlay hidden";
    overlay.innerHTML = `
      <button type="button" class="thumb-preview-close" aria-label="Close preview">&times;</button>
      <button type="button" class="thumb-preview-nav thumb-preview-prev" aria-label="Previous image"><i class="fa fa-chevron-left"></i></button>
      <img class="thumb-preview-img" alt="Case thumbnail preview" />
      <button type="button" class="thumb-preview-nav thumb-preview-next" aria-label="Next image"><i class="fa fa-chevron-right"></i></button>
      <span class="thumb-preview-counter"></span>`;
    document.body.appendChild(overlay);

    const close = () => overlay.classList.add("hidden");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector(".thumb-preview-close").addEventListener("click", close);
    overlay.querySelector(".thumb-preview-prev").addEventListener("click", (e) => {
      e.stopPropagation();
      stepThumbnailPreview(-1);
    });
    overlay.querySelector(".thumb-preview-next").addEventListener("click", (e) => {
      e.stopPropagation();
      stepThumbnailPreview(1);
    });
    document.addEventListener("keydown", (e) => {
      if (overlay.classList.contains("hidden")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") stepThumbnailPreview(-1);
      else if (e.key === "ArrowRight") stepThumbnailPreview(1);
    });

    // Swipe left/right on the enlarged image to move between photos (mobile).
    attachSwipeNav(overlay.querySelector(".thumb-preview-img"), stepThumbnailPreview);
  }
  renderThumbnailPreview();
  overlay.classList.remove("hidden");
}

function stepThumbnailPreview(delta) {
  if (currentThumbnails.length === 0) return;
  currentImageIndex =
    (currentImageIndex + delta + currentThumbnails.length) % currentThumbnails.length;
  updateThumbnail(); // keep the small carousel in sync with the lightbox
  renderThumbnailPreview();
}

function renderThumbnailPreview() {
  const overlay = document.getElementById("thumbPreviewOverlay");
  if (!overlay || currentThumbnails.length === 0) return;
  const img = overlay.querySelector(".thumb-preview-img");
  const counter = overlay.querySelector(".thumb-preview-counter");
  const multi = currentThumbnails.length > 1;
  img.src = "data:image/png;base64," + currentThumbnails[currentImageIndex];
  counter.textContent = `IMAGE ${currentImageIndex + 1} OF ${currentThumbnails.length}`;
  overlay.querySelectorAll(".thumb-preview-nav").forEach((b) => {
    b.style.display = multi ? "" : "none";
  });
}

// 判断2D图像逻辑（白底 + 宽高比）
function classifyThumbnails(images) {
  const is2D = (base64) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;

        // ✅ 如果 height ≥ width 或 width/height 比例 < 1.3，可能是 2D 图
        const is2D = h >= w || w / h < 1.3;
        resolve({ base64, is2D });
      };
      img.onerror = () => resolve({ base64, is2D: false });
      img.src = "data:image/png;base64," + base64;
    });
  };

  return Promise.all(images.map((img) => is2D(img))).then((results) => {
    const twoD = results.filter((r) => r.is2D).map((r) => r.base64);
    const threeD = results.filter((r) => !r.is2D).map((r) => r.base64);
    return [...twoD, ...threeD];
  });
}

// Storage slot of a /thumbnails/get row (0 = composite 2D, 1 = upper, 2 = lower).
// Tolerates a few field-name variants; null when the row carries none.
function thumbnailSlot(row) {
  const v = row?.slot ?? row?.slot_index ?? row?.slot_id;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Forces the carousel order 2D -> upper -> lower whatever order the API returns.
// Rows predating slot tagging fall back to the legacy aspect-ratio grouping.
async function orderThumbnailsBySlot(rows) {
  const withData = rows.filter((r) => r && r.data);
  const haveSlots = withData.some((r) => thumbnailSlot(r) != null);
  if (!haveSlots) {
    return classifyThumbnails(withData.map((r) => r.data));
  }
  return withData
    .slice()
    .sort((a, b) => (thumbnailSlot(a) ?? 999) - (thumbnailSlot(b) ?? 999))
    .map((r) => r.data);
}

// Raw /thumbnails/get rows, or null on failure. Split out of fetchThumbnails so
// the uploader can read occupied slots without repainting the carousel.
async function fetchThumbnailRows(caseId) {
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser) return null;

  // NUMERICALLY, never by case-name string: the ADMIN lookup parses the payload
  // identifier as a numeric caseIntID, so a name 404s every case for admins.
  const requestBody = JSON.stringify([
    {
      machine_id: MACHINE_ID,
      uuid: loggedInUser.uuid,
      caseIntID: caseId,
    },
    {
      case_int_id: caseId,
    },
  ]);

  try {
    // resilientFetch retries a momentary 403/5xx rather than failing to a blank
    // pane; a fresh breaker keeps it pure retry, free of the shared one's state.
    const res = await resilientFetch(
      `${API_BASE}/thumbnails/get`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      },
      makeBreaker(BREAKER_FAILURE_THRESHOLD)
    );
    if (!res || !res.ok) {
      console.warn("⚠️ No images found or request failed:", res ? res.status : "no response");
      return null;
    }
    logApi(res, 'POST /thumbnails/get');

    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error("❌ Failed to fetch thumbnails:", err);
    return null;
  }
}

// 获取缩略图 — load the case's images into the detail pane's carousel.
async function fetchThumbnails(caseId) {
  if (!getLoggedInUser()) return;
  const rows = await fetchThumbnailRows(caseId);
  currentThumbnails = rows ? await orderThumbnailsBySlot(rows) : [];
  currentImageIndex = 0;
  updateThumbnail();
}

// ---------------------------------------------------------------------------
// Admin case-list extras: stat cards, and detail actions replacing Start Case /
// 3D link. Cosmetic only — every admin endpoint re-checks is_admin server-side.
// ---------------------------------------------------------------------------

function isCurrentUserAdmin() {
  return Number(getLoggedInUser()?.isAdmin) === 1;
}

// Cases the admin receives include soft-deleted ones; the flag name isn't
// guaranteed, so accept the common spellings and treat 1/true as deleted.
function isCaseDeleted(caseItem) {
  const v = caseItem?.deleted ?? caseItem?.is_deleted ?? caseItem?.isDeleted;
  return v === 1 || v === true || v === "1";
}

// Which month each "…(month)" card shows: 0 = current month, -1 = last month, …
// The Deleted and New cards step independently. Never positive (no future).
let deletedMonthOffset = 0;
let newMonthOffset = 0;

// When true, the list is filtered to deleted cases only (the "View" link under
// the Total Deleted Cases card).
let deletedOnlyView = false;

// [start, end) ms bounds for the month at `offset` relative to the current one.
function monthRangeMs(offset) {
  const n = new Date();
  return {
    start: new Date(n.getFullYear(), n.getMonth() + offset, 1).getTime(),
    end: new Date(n.getFullYear(), n.getMonth() + offset + 1, 1).getTime(),
  };
}

// Recomputed from the full loaded list, not the filtered view. Completed/Ongoing
// depend on new_status, so scheduleAdminStats() re-runs it as rows enrich.
function renderAdminStats(cases) {
  const bar = document.getElementById("adminStatsBar");
  if (!bar || bar.hidden) return; // non-admin / bar not shown
  const list = Array.isArray(cases) ? cases : [];
  const delRange = monthRangeMs(deletedMonthOffset); // Deleted card's month
  const newRange = monthRangeMs(newMonthOffset);     // New card's month

  let total = 0, completed = 0, deletedTotal = 0, deletedMonth = 0, newMonth = 0;
  for (const c of list) {
    const createdMs = toDayMidnight(c.creation_date);
    const inDelMonth = createdMs != null && createdMs >= delRange.start && createdMs < delRange.end;
    const inNewMonth = createdMs != null && createdMs >= newRange.start && createdMs < newRange.end;

    if (isCaseDeleted(c)) {
      deletedTotal++; // all-time deleted count
      // No deletion timestamp is exposed, so approximate "deleted in month"
      // by cases created in that month that are now deleted.
      if (inDelMonth) deletedMonth++;
      continue; // deleted cases are excluded from the active totals
    }

    total++;
    const status = apiStatusToValue(c.new_status);
    // Completed → Completed; anything else except N/A counts as active.
    if (status === "completed") completed++;
    if (inNewMonth) newMonth++;
  }

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
  };
  set("statTotal", total);
  set("statCompleted", completed);
  set("statDeletedTotal", deletedTotal);
  set("statDeleted", deletedMonth);
  set("statNew", newMonth);

  // Name each card's shown month, e.g. "July" (add the year when not this year).
  const now = new Date();
  const monthLabelFor = (offset) => {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const name = d.toLocaleString(undefined, { month: "long" });
    return d.getFullYear() === now.getFullYear() ? name : `${name} ${d.getFullYear()}`;
  };
  set("statDeletedLabel", `Deleted Cases (${monthLabelFor(deletedMonthOffset)})`);
  set("statNewLabel", `New Cases (${monthLabelFor(newMonthOffset)})`);

  // Can't step into the future: disable each card's "next" arrow at offset 0.
  document
    .querySelectorAll('[data-month-target="deleted"][data-month-delta="1"]')
    .forEach((b) => (b.disabled = deletedMonthOffset >= 0));
  document
    .querySelectorAll('[data-month-target="new"][data-month-delta="1"]')
    .forEach((b) => (b.disabled = newMonthOffset >= 0));
}

// Enrichment updates rows one at a time; debounce so we recompute once per
// burst instead of O(N) times.
let _adminStatsTimer = null;
function scheduleAdminStats() {
  if (!isCurrentUserAdmin()) return;
  clearTimeout(_adminStatsTimer);
  _adminStatsTimer = setTimeout(() => renderAdminStats(currentCases), 150);
}

// Resolve a username → uuid via user/uuid/get. Returns the uuid string or null.
async function resolveUuidByUsername(username) {
  const me = getLoggedInUser();
  const res = await fetch(`${API_BASE}/user/uuid/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { machine_id: MACHINE_ID, uuid: me?.uuid },
      { username },
    ]),
  });
  logApi(res, "POST /user/uuid/get");
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  // Model selects `uuid`; response may be a row array or a bare object.
  if (Array.isArray(data)) return data[0]?.uuid ?? null;
  return data?.uuid ?? null;
}

// Suggests only the case's co-owners (the usual transfer target); any other
// username still types through. Skips the current owner and dedupes caselessly.
function populateTransferOptions(caseObj) {
  const dl = document.getElementById("transferOwnerOptions");
  if (!dl) return;
  const seen = new Set(
    [(caseObj?.assigned_to || caseObj?.username || "").toLowerCase()]
  );
  dl.textContent = "";
  for (const co of caseObj?.co_owners || []) {
    const name = String(co ?? "").trim();
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const opt = document.createElement("option");
    opt.value = name;
    opt.label = "Shared co-owner"; // shown next to the value in most browsers
    dl.appendChild(opt);
  }
}

// Transfer ownership: resolve the entered username, then PUT /role/owner
// (changeOwner is admin-only server-side).
async function submitOwnershipTransfer() {
  const errEl = document.getElementById("transferOwnerError");
  const input = document.getElementById("transferOwnerInput");
  const btn = document.getElementById("confirmTransferBtn");
  if (errEl) errEl.textContent = "";

  const caseId = window.selectedCaseId;
  if (!caseId) {
    if (errEl) errEl.textContent = "Select a case first.";
    return;
  }
  const username = (input?.value || "").trim();
  if (!username) {
    if (errEl) errEl.textContent = "Enter the new owner's username.";
    return;
  }

  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(caseId)
  );
  // No-op guard: transferring to the user who already owns the case.
  const currentOwner = caseObj?.assigned_to || caseObj?.username || "";
  if (currentOwner && currentOwner.toLowerCase() === username.toLowerCase()) {
    if (errEl) errEl.textContent = `"${currentOwner}" already owns this case.`;
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const newUuid = await resolveUuidByUsername(username);
    if (!newUuid) {
      if (errEl) errEl.textContent = `No user found with username "${username}".`;
      return;
    }
    const me = getLoggedInUser();
    const res = await fetch(`${API_BASE}/role/owner`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID, uuid: me?.uuid },
        { uuid: newUuid, case_int_id: Number(caseId) },
      ]),
    });
    logApi(res, "PUT /role/owner");
    if (!res.ok) {
      // Surface the server's own message: changeOwner answers 404 for an unknown
      // case/owner pairing and 500 on SQL errors, and the admin needs to know which.
      const body = await res.json().catch(() => null);
      const detail =
        (body?.serverErrorMessage && body.serverErrorMessage !== "..." && body.serverErrorMessage) ||
        body?.sqlMessage || `HTTP ${res.status}`;
      throw new Error(detail);
    }

    // Reflect the new owner locally so the row *and* the open detail pane
    // update without a reload.
    if (caseObj) {
      caseObj.assigned_to = username;
      patchRowInPlace(caseObj);
      syncDetailPaneIfSelected(caseObj);
    }
    closeTransferModal();
    toast.success(`Ownership transferred to "${username}".`);
  } catch (err) {
    console.error("Transfer ownership failed:", err);
    if (errEl) errEl.textContent = `Transfer failed — ${err.message || "please try again."}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openTransferModal() {
  if (!window.selectedCaseId) {
    toast.warning("Select a case first.");
    return;
  }
  const modal = document.getElementById("transferOwnerModal");
  const input = document.getElementById("transferOwnerInput");
  const errEl = document.getElementById("transferOwnerError");
  if (errEl) errEl.textContent = "";
  if (input) input.value = "";

  // Name the case being transferred + fill the "current owner" side of the
  // owner → owner flow so the admin can confirm they picked the right row.
  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(window.selectedCaseId)
  );
  const lineEl = document.getElementById("transferOwnerCaseLine");
  if (lineEl) {
    lineEl.textContent = caseObj?.case_id || `Case ${window.selectedCaseId}`;
    lineEl.title = lineEl.textContent;
  }
  const owner = caseObj?.assigned_to || caseObj?.username || "";
  const ownerNameEl = document.getElementById("transferOwnerCurrentName");
  const ownerAvatarEl = document.getElementById("transferOwnerCurrentAvatar");
  if (ownerNameEl) {
    ownerNameEl.textContent = owner || "Unknown";
    ownerNameEl.title = owner || "";
  }
  if (ownerAvatarEl) ownerAvatarEl.textContent = (owner || "?").charAt(0);

  // Suggestions: the case's shared co-owners (already on the enriched row).
  populateTransferOptions(caseObj);

  // .modal is display:none until .show lands (createCase.css) — removing
  // .hidden alone leaves it invisible, which read as "nothing happens".
  modal?.classList.remove("hidden");
  modal?.classList.add("show");
  input?.focus();
}

function closeTransferModal() {
  const modal = document.getElementById("transferOwnerModal");
  modal?.classList.remove("show");
  modal?.classList.add("hidden");
}

// Retrieve (restore) the selected soft-deleted case via POST /case/undelete/:id.
async function retrieveSelectedCase() {
  const caseId = window.selectedCaseId;
  if (!caseId) {
    toast.warning("Select a case first.");
    return;
  }
  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(caseId)
  );
  if (caseObj && !isCaseDeleted(caseObj)) {
    toast.info("This case is not deleted.");
    return;
  }

  const confirmed = await confirmModal({
    title: "Retrieve this case?",
    message: "The case will be restored and visible to its members again.",
    confirmText: "Retrieve",
    cancelText: "Cancel",
    variant: "info",
  });
  if (!confirmed) return;

  try {
    const me = getLoggedInUser();
    const res = await fetch(`${API_BASE}/case/undelete/${Number(caseId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ machine_id: MACHINE_ID, uuid: me?.uuid }]),
    });
    logApi(res, "POST /case/undelete/:id");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (caseObj) {
      caseObj.deleted = 0;
      const row = document.querySelector(
        `#caseTableBody tr[data-case-id="${CSS.escape(String(caseId))}"]`
      );
      row?.classList.remove("cm-row-deleted");
    }
    // Flip the detail CTA from Retrieve → Delete.
    const retrieveBtn = document.getElementById("retrieveCaseBtn");
    const deleteBtn = document.getElementById("deleteCaseBtn");
    if (retrieveBtn) retrieveBtn.hidden = true;
    if (deleteBtn) deleteBtn.hidden = false;
    scheduleAdminStats();
    applyClientFilters();
    toast.success("Case retrieved.");
  } catch (err) {
    console.error("Retrieve case failed:", err);
    toast.error("Failed to retrieve case.");
  }
}

// Unlike deleteCaseById, admins keep the case in view — struck-through and
// retrievable — so the Delete/Retrieve toggle stays coherent without a refetch.
async function deleteSelectedCase() {
  const caseId = window.selectedCaseId;
  if (!caseId) {
    toast.warning("Select a case first.");
    return;
  }
  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(caseId)
  );
  if (caseObj && isCaseDeleted(caseObj)) {
    toast.info("This case is already deleted.");
    return;
  }

  const confirmed = await confirmModal({
    title: "Delete this case?",
    message: "The case will be removed from its members. You can retrieve it later.",
    confirmText: "Delete",
    cancelText: "Cancel",
    variant: "danger",
  });
  if (!confirmed) return;

  try {
    const me = getLoggedInUser();
    const res = await fetch(`${API_BASE}/case/delete/${Number(caseId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID, uuid: me?.uuid, caseIntID: Number(caseId) },
        { case_int_id: Number(caseId) },
      ]),
    });
    logApi(res, "POST /case/delete/:id");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (caseObj) {
      caseObj.deleted = 1;
      const row = document.querySelector(
        `#caseTableBody tr[data-case-id="${CSS.escape(String(caseId))}"]`
      );
      row?.classList.add("cm-row-deleted");
    }
    // Flip the detail CTA from Delete → Retrieve.
    const retrieveBtn = document.getElementById("retrieveCaseBtn");
    const deleteBtn = document.getElementById("deleteCaseBtn");
    if (retrieveBtn) retrieveBtn.hidden = false;
    if (deleteBtn) deleteBtn.hidden = true;
    scheduleAdminStats();
    applyClientFilters();
    toast.success("Case deleted.");
  } catch (err) {
    console.error("Delete case failed:", err);
    toast.error("Failed to delete case.");
  }
}

// Download the selected case's files (STL/OFF, extra 3D uploads, 2D JPEG, report
// .docx) as a zip — the same bundle the case-list row's download action produces.
function downloadSelectedCaseFiles() {
  const caseId = window.selectedCaseId;
  if (!caseId) {
    toast.warning("Select a case first.");
    return;
  }
  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(caseId)
  );
  const caseLabel = caseObj?.case_id || window.selectedCaseStub?.case_id;
  const apiStatus = caseObj?.new_status ?? window.selectedCaseStub?.new_status ?? null;
  return downloadCaseFiles(caseId, caseLabel, apiStatus);
}

// Wire the admin-only UI once, from the init handler.
// The selected case plus the signed-in user, or null after warning why not.
function requireSelectedCase() {
  const caseId = window.selectedCaseId;
  const user = getLoggedInUser();
  if (!caseId || !user?.uuid) {
    toast.warning("Please select a case first.");
    return null;
  }
  const caseObj = currentCases.find((c) => c.id === caseId || c.case_id === caseId);
  if (!caseObj) {
    toast.warning("Case not found in current list.");
    return null;
  }
  return { caseObj, user };
}

function setupAdminCaseList() {
  if (!isCurrentUserAdmin()) return;

  document.body.classList.add("is-admin");

  // Populate the branded header's user chip from the logged-in account.
  const _me = getLoggedInUser();
  const _uname = _me?.username || "User";
  const nameEl = document.getElementById("adminUserName");
  const avatarEl = document.getElementById("adminUserAvatar");
  if (nameEl) nameEl.textContent = _uname;
  if (avatarEl) avatarEl.textContent = _uname.charAt(0);

  // User chip → dropdown (holds Logout). The logout item keeps class .logout so
  // the existing logout handler wires it.
  const chip = document.getElementById("adminUserChip");
  const chipMenu = document.getElementById("adminUserDropdown");
  if (chip && chipMenu) {
    const toggle = (e) => {
      e.stopPropagation();
      const open = chipMenu.classList.toggle("hidden") === false;
      chip.setAttribute("aria-expanded", String(open));
    };
    chip.addEventListener("click", toggle);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
    document.addEventListener("click", (e) => {
      if (chipMenu.classList.contains("hidden")) return;
      if (!chipMenu.contains(e.target) && !chip.contains(e.target)) {
        chipMenu.classList.add("hidden");
        chip.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Reveal the overview cards and the admin detail actions.
  const statsBar = document.getElementById("adminStatsBar");
  if (statsBar) statsBar.hidden = false;
  document.querySelectorAll(".cm-admin-cta").forEach((el) => (el.hidden = false));

  document.getElementById("transferOwnershipBtn")?.addEventListener("click", openTransferModal);
  document.getElementById("retrieveCaseBtn")?.addEventListener("click", retrieveSelectedCase);
  document.getElementById("deleteCaseBtn")?.addEventListener("click", deleteSelectedCase);
  document.getElementById("downloadFilesBtn")?.addEventListener("click", downloadSelectedCaseFiles);

  // Month steppers: each card (Deleted / New) has its own offset so they move
  // independently. Never step into the future.
  document.querySelectorAll("[data-month-delta]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.dataset.monthDelta);
      const target = btn.dataset.monthTarget;
      if (target === "deleted") {
        const next = deletedMonthOffset + delta;
        if (next > 0) return;
        deletedMonthOffset = next;
      } else if (target === "new") {
        const next = newMonthOffset + delta;
        if (next > 0) return;
        newMonthOffset = next;
      }
      renderAdminStats(currentCases);
    });
  });

  // "View" link under Total Deleted Cases: toggle a deleted-only list filter.
  const viewDeletedLink = document.getElementById("viewDeletedLink");
  viewDeletedLink?.addEventListener("click", (e) => {
    e.preventDefault();
    deletedOnlyView = !deletedOnlyView;
    // The link carries an icon + a text span, so update those in place instead
    // of overwriting textContent (which would drop the icon).
    const label = viewDeletedLink.querySelector(".cm-stat-link-text");
    const text = deletedOnlyView ? "Back to active cases" : "View";
    if (label) label.textContent = text;
    else viewDeletedLink.textContent = text;
    const icon = viewDeletedLink.querySelector("i");
    if (icon) icon.className = deletedOnlyView ? "fa fa-arrow-left" : "fa fa-eye";
    viewDeletedLink.classList.toggle("is-active", deletedOnlyView);
    applyClientFilters();
  });

  document.getElementById("closeTransferModal")?.addEventListener("click", closeTransferModal);
  document.getElementById("cancelTransferBtn")?.addEventListener("click", closeTransferModal);
  document.getElementById("confirmTransferBtn")?.addEventListener("click", submitOwnershipTransfer);
  document.getElementById("transferOwnerModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeTransferModal();
  });
  document.getElementById("transferOwnerInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitOwnershipTransfer(); }
  });

  renderAdminStats(currentCases);
}

// 初始化页面
document.addEventListener("DOMContentLoaded", async () => {
  // Role-based routing between admin_case_list.html and case_list.html, so
  // neither audience is shown the other's UI.
  {
    const me = getLoggedInUser();
    if (me) {
      const onAdminPage = document.body.dataset.adminPage === "1";
      const admin = Number(me.isAdmin) === 1;
      // Relative to the CURRENT page: case_list.html is in src/pages/ and
      // admin_case_list.html in src/pages/admin/, one directory apart.
      if (admin && !onAdminPage) { window.location.replace("admin/admin_case_list.html"); return; }
      if (!admin && onAdminPage) { window.location.replace("../case_list.html"); return; }
    }
  }

  // Instant paint FIRST, before any other setup or the network call, so the table
  // is never blank while /case/user/findall/get is in flight.
  let cachedForPaint = null;
  try {
    cachedForPaint = loadCachedCases();
    if (cachedForPaint && cachedForPaint.length) {
      currentCases = cachedForPaint;
      populateTable(currentCases);
      applyClientFilters();
    }
  } catch (err) {
    console.warn("[caseList] instant cached paint failed", err);
  }

  const footerUserName = document.getElementById("footerUserName");
  if (footerUserName) {
    const u = getLoggedInUser();
    footerUserName.textContent = u?.username || "—";
  }

  // Admins get stat cards + Transfer/Retrieve, with Start Case / 3D link / Actions
  // hidden via the `is-admin` body class. A no-op for non-admins.
  setupAdminCaseList();
  // index.html is at the web root; admin_case_list.html lives one level deeper
  // (src/pages/admin/) than the normal case_list.html (src/pages/).
  const _inAdminDir = /\/admin\//.test(window.location.pathname);
  setupAppSidebar({ indexHref: _inAdminDir ? "../../../index.html" : "../../index.html" });

  updateThumbnail();
  const cases = await fetchCases();

  if (cases) {
    // Stale-while-revalidate: the fresh base list carries no details/co-owners, so
    // reuse last session's enrichment until each row re-fetches on becoming visible.
    if (cachedForPaint?.length) {
      const cachedByKey = new Map(
        cachedForPaint.map((c) => [String(c.id ?? c.case_int_id), c])
      );
      for (const c of cases) {
        const prev = cachedByKey.get(String(c.id ?? c.case_int_id));
        if (!prev) continue;
        for (const k of ["expected_date", "new_status", "assigned_to", "comments", "co_owners"]) {
          if (c[k] === undefined && prev[k] !== undefined) c[k] = prev[k];
        }
      }
    }
    // Persist for the next load's instant paint.
    saveCachedCases(cases);
    // Enrichment never gates the first render: rows fetch their own details when
    // scrolled into view, never as an eager 2xN burst (which the backend 403s).
    currentCases = cases;
    // Prune the invite roster against the full list — populateTable() below only
    // adds, and sees a filtered subset.
    reconcileCollaborators(cases.map((c) => c.id ?? c.case_int_id));
    populateTable(currentCases);
    applyClientFilters();

    const searchInput = document.getElementById("searchCaseInput");
    const dateInput = document.getElementById("dateFilterInput");
    const clearDateBtn = document.getElementById("clearDateBtn");
    const todayOnly = document.getElementById("todayOnly");
    const refreshListBtn = document.getElementById("refreshListBtn");
    const searchBtn = document.getElementById("searchBtn");

    searchInput?.addEventListener("input", applyClientFilters);
    // WebKit's <input type="search"> self-clears on Escape, wiping the active
    // filter — swallow it so the query and the filtered list stay put.
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Esc") e.preventDefault();
    });

    // Header search mode picker (Name / Date / Status). Switching modes swaps
    // the visible control and re-applies filters.
    document.getElementById("searchMode")?.addEventListener("change", updateSearchModeUI);

    // Stage filters: clicking a card filters to it, clicking again (or "All
    // Cases") clears.
    document.querySelectorAll("[data-status-group]").forEach((btn) => {
      btn.addEventListener("click", () =>
        applyStatFilter(btn.getAttribute("data-status-group"))
      );
    });
    syncStatFilterActiveState();

    // The filter toolbar is CSS-hidden at this width, so "+" reuses its create
    // button rather than duplicating createCase.js's open logic.
    const mobileSearchBtn = document.getElementById("mobileSearchBtn");
    const mobileSearchBar = document.getElementById("mobileSearchBar");
    const mobileSearchInput = document.getElementById("mobileSearchInput");
    mobileSearchInput?.addEventListener("input", applyClientFilters);
    mobileSearchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.key === "Esc") e.preventDefault();
    });
    if (mobileSearchBtn && mobileSearchBar && mobileSearchInput) {
      mobileSearchBtn.addEventListener("click", () => {
        const opening = mobileSearchBar.classList.contains("hidden");
        mobileSearchBar.classList.toggle("hidden", !opening);
        mobileSearchBtn.setAttribute("aria-expanded", String(opening));
        if (opening) {
          mobileSearchInput.focus();
        } else if (mobileSearchInput.value) {
          // Closing the bar drops the filter — otherwise the list would stay
          // filtered by a query the user can no longer see.
          mobileSearchInput.value = "";
          applyClientFilters();
        }
      });
    }
    document.getElementById("mobileSearchClear")?.addEventListener("click", () => {
      if (!mobileSearchInput) return;
      mobileSearchInput.value = "";
      applyClientFilters();
      mobileSearchInput.focus();
    });
    document.getElementById("mobileCreateCaseBtn")?.addEventListener("click", () => {
      document.getElementById("createCaseBtn")?.click();
    });
    // Themed calendar for the "Search by Date" filter (allow clearing the filter).
    if (dateInput) attachThemedCalendar(dateInput, { allowClear: true });
    dateInput?.addEventListener("change", applyClientFilters);
    todayOnly?.addEventListener("change", applyClientFilters);
    searchBtn?.addEventListener("click", applyClientFilters);
    clearDateBtn?.addEventListener("click", () => {
      if (!dateInput) return;
      dateInput.value = "";
      applyClientFilters();
    });
    // Each reload fires ~30 parallel calls, and a burst earns a 403 with no CORS
    // header (reported as a CORS error). Disabled in flight to absorb extra clicks.
    let refreshInFlight = false;
    refreshListBtn?.addEventListener("click", () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      refreshListBtn.disabled = true;
      refreshListBtn.style.opacity = "0.5";
      refreshListBtn.style.cursor = "wait";
      window.location.reload();
    });

    // No reload-on-becoming-visible: the camera and the file picker HIDE the page
    // on Android, so returning with a photo fired it and wiped the open dialog
    // along with the capture. The refresh button above is the only way in.

    // Wire every logout affordance (the user-chip dropdown item + the
    // mobile-only header logout button both carry class .logout).
    const handleLogout = async () => {
      const confirmed = await confirmModal({
        title: "Log out?",
        message: "You'll need to sign in again to access your cases.",
        confirmText: "Log out",
        cancelText: "Cancel",
        variant: "info",
      });
      if (!confirmed) return;
      // Drop the cached case list (compute the key while the user is still known)
      // so the next account doesn't briefly see this one's list on instant paint.
      const cacheKey = caseListCacheKey();
      if (cacheKey) { try { localStorage.removeItem(cacheKey); } catch { /* ignore */ } }
      localStorage.removeItem("loggedInUser");
      // admin_case_list.html is one directory deeper (src/pages/admin/) than the
      // normal case_list.html (src/pages/); index.html sits at the web root.
      window.location.href = /\/admin\//.test(window.location.pathname)
        ? "../../../index.html"
        : "../../index.html";
    };
    document.querySelectorAll(".logout").forEach((btn) =>
      btn.addEventListener("click", handleLogout)
    );

    const headWrap = document.querySelector(".table-head-wrapper");
    const bodyWrap = document.querySelector(".table-body-wrapper");
    if (headWrap && bodyWrap) {
      let syncing = false;
      const sync = (src, dst) => {
        if (syncing) return;
        syncing = true;
        dst.scrollLeft = src.scrollLeft;
        syncing = false;
      };
      bodyWrap.addEventListener("scroll", () => sync(bodyWrap, headWrap));
      headWrap.addEventListener("scroll", () => sync(headWrap, bodyWrap));
    }

    document.getElementById("backToListBtn")?.addEventListener("click", closeMobileCaseDetails);

    const filterSel = document.getElementById("filter-status");
if (filterSel) filterSel.addEventListener("change", () => applyClientFilters());


    // Clicking the active header flips direction. Re-renders go through
    // applyClientFilters so the active filters survive a sort.
    const sortableHeaders = document.querySelectorAll(".cm-th-sort");

    // Default direction per column: names/owners/status read best A→Z, while
    // date columns default to newest-first.
    const defaultOrderFor = (col) =>
      col === "name" || col === "owner" || col === "status" ? "asc" : "desc";

    const sortSelectMobile = document.getElementById("sortFieldMobile");

    // Keep both sort UIs in lockstep: clicking a table header updates the
    // mobile select's value, picking a mobile option updates the table carets.
    const syncSortUi = () => {
      sortableHeaders.forEach((th) => {
        const active = th.dataset.sort === currentSortColumn;
        th.classList.toggle("is-sorted", active);
        const caret = th.querySelector(".cm-sort-caret");
        if (!caret) return;
        caret.classList.remove("fa-sort", "fa-sort-up", "fa-sort-down");
        caret.classList.add(
          !active
            ? "fa-sort"
            : currentSortOrder === "asc"
            ? "fa-sort-up"
            : "fa-sort-down"
        );
      });
      if (sortSelectMobile) {
        const want = `${currentSortColumn}|${currentSortOrder}`;
        // Only set if the option exists — header clicks can produce
        // combinations the mobile picker doesn't expose (e.g. recent|asc).
        const hasOption = [...sortSelectMobile.options].some((o) => o.value === want);
        if (hasOption) sortSelectMobile.value = want;
      }
    };

    sortableHeaders.forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (currentSortColumn === col) {
          currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
        } else {
          currentSortColumn = col;
          currentSortOrder = defaultOrderFor(col);
        }
        syncSortUi();
        applyClientFilters();
      });
    });

    sortSelectMobile?.addEventListener("change", () => {
      const [col, dir] = sortSelectMobile.value.split("|");
      if (!col || !dir) return;
      currentSortColumn = col;
      currentSortOrder = dir;
      syncSortUi();
      applyClientFilters();
    });

    syncSortUi();

    // 缩略图切换按钮绑定
    document.getElementById("prevBtn").addEventListener("click", () => stepThumbnail(-1));
    document.getElementById("nextBtn").addEventListener("click", () => stepThumbnail(1));

    // Swipe left/right on the preview to move between photos (mobile devices).
    attachSwipeNav(document.querySelector(".cm-image-area"), stepThumbnail);

    // Click the thumbnail to open it enlarged in a lightbox preview.
    document.getElementById("caseImage")?.addEventListener("click", () => {
      openThumbnailPreview();
    });

    document
      .getElementById("upload3dFileBtn")
      ?.addEventListener("click", () => openUploadChooser());

    // No Save button: the note commits on Enter or on losing focus. The box grows
    // while edited and collapses once committed.
    const instructionsBox = document.getElementById("caseInstructions");
    if (instructionsBox) {
      instructionsBox.addEventListener("focus", () => autoGrowInstructions(instructionsBox));
      instructionsBox.addEventListener("input", () => {
        autoGrowInstructions(instructionsBox);
        setInstructionsStatus("");
      });
      instructionsBox.addEventListener("blur", () => saveCaseInstructions());
      // Same field as the 2D page's Special Instruction box, edited in another
      // tab: fold the save in so the row, the stub and the open pane all follow.
      watchCaseComments((caseIntId, text) => {
        const cached = currentCases.find(
          (c) => String(c.id ?? c.case_int_id) === String(caseIntId)
        );
        if (cached) {
          cached.comments = text || null;
          scheduleEnrichCacheSave();
        }
        if (String(window.selectedCaseId) !== String(caseIntId)) return;
        if (window.selectedCaseStub) window.selectedCaseStub.comments = text || null;
        renderCaseInstructions(caseIntId, text);
      });
      // Enter commits, Shift+Enter inserts a newline. Blurring rather than saving
      // directly keeps one commit path, so the following blur can't save twice.
      instructionsBox.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          instructionsBox.blur();
        }
      });
    }
  }

  // ✅ START CASE 按钮绑定逻辑（使用 class 绑定方案 B）
  const startBtn = document.querySelector(".start-case-button");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      const caseId = window.selectedCaseId;
      console.log("🔹 Selected case ID:", caseId);

      if (!caseId) {
        toast.warning("Please select a case first.");
        return;
      }

      const encryptedId = lol(caseId);
      const isGitHubPages = window.location.hostname.includes("github.io");
      const queryConnector = "?";
      const basePath = isGitHubPages
        ? `/${window.location.pathname.split("/").filter(Boolean)[0] || ""}`
        : "";

      const targetURL = `${window.location.origin}${basePath}/src/pages/2DAnnotation.html${queryConnector}id=${encryptedId}`;
      window.open(targetURL, "_blank");

      // Entering the case bumps it to the top, not merely selecting the row. The
      // local timestamp moves it now; the background PUT makes it stick.
      const loggedInUser = getLoggedInUser();
      if (loggedInUser) {
        bumpLocalLastUpdated(caseId);
        fireLastOpenedBump(caseId, window.selectedCaseStub, loggedInUser).catch(
          (err) => {
            console.warn("[caseManagement] last-opened bump failed:", err);
          }
        );
      }
    });
  }

  // Generate a QR code of the selected case's 3D viewer link.
  const generateQrBtn = document.getElementById("generateQrBtn");
  if (generateQrBtn) {
    generateQrBtn.addEventListener("click", () => {
      const url3d = buildThreeDViewerUrl(window.selectedCaseId, { forShare: true });
      if (!url3d) {
        toast.warning("Please select a case first.");
        return;
      }
      showThreeDViewerQr(url3d);
    });
  }

  // Copy the selected case's 3D viewer link to the clipboard.
  const copy3dLinkBtn = document.getElementById("copy3dLinkBtn");
  if (copy3dLinkBtn) {
    copy3dLinkBtn.addEventListener("click", async () => {
      const url3d = buildThreeDViewerUrl(window.selectedCaseId, { forShare: true });
      if (!url3d) {
        toast.warning("Please select a case first.");
        return;
      }
      try {
        await navigator.clipboard.writeText(url3d);
        toast.success("3D viewer link copied.");
      } catch (err) {
        console.warn("Failed to copy 3D viewer link", err);
        toast.error("Couldn't copy the link.");
      }
    });
  }

  // Open the 3D viewer as the currently logged-in user (no identity swap).
  const export3dLinkBtn = document.getElementById("export3dLinkBtn");
  if (export3dLinkBtn) {
    export3dLinkBtn.addEventListener("click", () => {
      const url3d = buildThreeDViewerUrl(window.selectedCaseId);
      if (!url3d) {
        toast.warning("Please select a case first.");
        return;
      }
      window.open(url3d, "_blank");
    });
  }

  // ✅ 👇 在这里添加 ⋯ 按钮展开菜单逻辑
  const dropdownToggle = document.querySelector(".dropdown-toggle");
  const dropdownMenu = document.getElementById("caseDropdown");

  if (dropdownToggle && dropdownMenu) {
    const setDropdownOpen = (open) => {
      dropdownMenu.classList.toggle("hidden", !open);
      dropdownToggle.setAttribute("aria-expanded", String(open));
    };

    dropdownToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      setDropdownOpen(dropdownMenu.classList.contains("hidden"));
    });

    // Clicking anywhere outside closes it.
    document.addEventListener("click", () => setDropdownOpen(false));

    // Every entry is an action, so picking one closes the menu. Delegated to the
    // menu rather than bound per item so entries added later behave the same.
    dropdownMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target.closest(".dropdown-item")) setDropdownOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setDropdownOpen(false);
    });
  }

  const deleteBtn = document.getElementById("deleteBtn");

  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const caseId = window.selectedCaseId;
      if (!caseId) {
        toast.warning("Please select a case first.");
        return;
      }
      const ok = await deleteCaseById(caseId);
      if (ok) toast.success("Case deleted successfully.");
    });
  }

  const duplicateBtn = document.getElementById("duplicateBtn");

  if (duplicateBtn) {
    duplicateBtn.addEventListener("click", async () => {
      const caseId = window.selectedCaseId;
      if (!caseId) {
        toast.warning("Please select a case first.");
        return;
      }
      duplicateBtn.classList.add("is-disabled");
      try {
        await duplicateCaseById(caseId);
      } finally {
        duplicateBtn.classList.remove("is-disabled");
      }
    });
  }

  const downloadReferencesBtn = document.getElementById("downloadReferencesBtn");

  if (downloadReferencesBtn) {
    downloadReferencesBtn.addEventListener("click", async () => {
      const caseId = window.selectedCaseId;
      if (!caseId) {
        toast.warning("Please select a case first.");
        return;
      }
      const caseObj = currentCases.find((c) => {
        const resolvedId = c?.id ?? c?.case_int_id;
        return String(resolvedId) === String(caseId);
      }) || window.selectedCaseStub || null;

      downloadReferencesBtn.classList.add("is-disabled");
      try {
        await downloadCaseReferenceImages(caseId, caseObj?.case_id);
      } finally {
        downloadReferencesBtn.classList.remove("is-disabled");
        dropdownMenu?.classList.add("hidden");
      }
    });
  }

  const editUserAccessBtn = document.getElementById("editUserAccessBtn");

  if (editUserAccessBtn) {
    editUserAccessBtn.addEventListener("click", async () => {
      const selection = requireSelectedCase();
      if (!selection) return;
      const { caseObj, user } = selection;

      const caseName = caseObj.case_id;
      const caseIntID = caseObj.id;
      const uuid = user.uuid;
      const machine_id = MACHINE_ID;

      // ✅ 打开弹窗 (explicit lookup — was leaning on the implicit window.<id> global)
      const userAccessModal = document.getElementById("userAccessModal");
      userAccessModal.classList.remove("hidden");
      userAccessModal.classList.add("show");

      // ✅ 动态显示 Case Name
      document.querySelectorAll(".case-name-display").forEach((el) => {
        el.textContent = caseName;
      });

      // ✅ 设置上下文变量
      window._inviteContext = {
        caseName,
        caseIntID,
        uuid,
        machine_id,
      };

      // ✅ 获取已有共享用户
      try {
        const rolePayload = [
          { machine_id, uuid, caseIntID },
          { case_int_id: caseIntID },
        ];

        const roleRes = await fetch(
          `${API_BASE}/role/all/get`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rolePayload),
          }
        );
        logApi(roleRes, 'POST /role/all/get');
        const text = await roleRes.text();
        if (!roleRes.ok)
          throw new Error(`Role fetch failed: ${roleRes.status}`);

        const roleData = JSON.parse(text);
        existingUsers = roleData;

        renderSharedUserList(); // ✅ 渲染已有成员
      } catch (err) {
        console.error("❌ Failed to fetch roles:", err);
        const listEl = document.getElementById("sharedUserList");
        if (listEl) listEl.innerHTML = "<li>Failed to load users.</li>";
      }
    });
  }

  const renameBtn = document.getElementById("renameBtn");
  const renameCaseModal = document.getElementById("renameCaseModal");
  const renameCaseInput = document.getElementById("renameCaseInput");
  const closeRenameModalBtn = document.getElementById("closeRenameModal");
  const cancelRenameBtn = document.getElementById("cancelRenameBtn");
  const confirmRenameBtn = document.getElementById("confirmRenameBtn");

  const closeRenameModal = () => {
    if (!renameCaseModal) return;
    renameCaseModal.classList.add("hidden");
    renameCaseModal.classList.remove("show");
    window._renameContext = null;
  };

  const openRenameModal = (caseObj, user) => {
    if (!renameCaseModal || !renameCaseInput) return;
    window._renameContext = { caseObj, user };
    renameCaseInput.value = caseObj.case_id || "";
    renameCaseModal.classList.remove("hidden");
    renameCaseModal.classList.add("show");
    setTimeout(() => {
      renameCaseInput.focus();
      renameCaseInput.select();
    }, 0);
  };

  const submitRename = async () => {
    const ctx = window._renameContext;
    if (!ctx || !renameCaseInput) return;
    const { caseObj, user } = ctx;
    const newCaseName = renameCaseInput.value.trim();
    if (!newCaseName) {
      renameCaseInput.focus();
      return;
    }
    if (newCaseName === caseObj.case_id) {
      closeRenameModal();
      return;
    }

    const requestData = [
      {
        machine_id: MACHINE_ID,
        uuid: user.uuid,
        caseIntID: caseObj.id,
      },
      { case_id: newCaseName },
    ];

    confirmRenameBtn.disabled = true;
    try {
      const response = await fetch(
        `${API_BASE}/case/rename/${caseObj.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestData),
        }
      );
      logApi(response, 'POST /case/rename/:id');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      caseObj.case_id = newCaseName;
      populateTable(currentCases);
      document.getElementById("caseNameDisplay").textContent = newCaseName;

      const caseListItems = document.querySelectorAll(".case-list-item");
      caseListItems.forEach((item) => {
        if (item.dataset.caseId === caseObj.id) {
          const nameElement = item.querySelector(".case-name");
          if (nameElement) nameElement.textContent = newCaseName;
        }
      });

      document.querySelectorAll(".case-name-display").forEach((el) => {
        el.textContent = newCaseName;
      });

      // (renderCaseTable no longer exists anywhere — the typeof-guarded call was
      // dead code; the rename above already patches the visible row.)
      console.log("✅ Case renamed successfully:", newCaseName);
      closeRenameModal();
    } catch (error) {
      console.error("❌ Failed to rename case:", error);
      toast.error(`Failed to rename case: ${error.message}`);
    } finally {
      confirmRenameBtn.disabled = false;
    }
  };

  if (renameBtn) {
    renameBtn.addEventListener("click", () => {
      const selection = requireSelectedCase();
      if (selection) openRenameModal(selection.caseObj, selection.user);
    });
  }

  closeRenameModalBtn?.addEventListener("click", closeRenameModal);
  cancelRenameBtn?.addEventListener("click", closeRenameModal);
  confirmRenameBtn?.addEventListener("click", submitRename);

  renameCaseModal?.addEventListener("click", (e) => {
    if (e.target === renameCaseModal) closeRenameModal();
  });

  renameCaseInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeRenameModal();
    }
  });

    /* ===== 状态下拉框保存 ===== */
  const statusSel = document.getElementById("status");
  if (statusSel) {
  statusSel.addEventListener("change", async (e) => {
    const newVal   = e.target.value;           // 下划线或 "na"
    const apiValue = valueToApiStatus(newVal); // 空格或 ""

    const caseId = window.selectedCaseId;
    const user   = getLoggedInUser();
    if (!caseId || !user?.uuid) {
      toast.warning("Please select a case first.");
      e.target.value = "na";
      return;
    }

    const caseObj = currentCases.find(
      (c) => c.id === caseId || c.case_int_id === caseId
    );
    if (!caseObj) return;

    try {
      await postNewStatus(caseObj, apiValue);   // ← 发送空格写法
      caseObj.new_status = apiValue;            // 本地同步
      applyStatusPillToSelect(apiValue);        // recolor the select pill
      applyClientFilters();
    } catch (err) {
      console.error("Status update failed:", err);
      toast.error("Failed to update status.");
      e.target.value = apiStatusToValue(caseObj.new_status);
      applyStatusPillToSelect(caseObj.new_status);
    }
  });
}

const openWebUrlBtn = document.getElementById("openWebUrl");
if (openWebUrlBtn) {
  openWebUrlBtn.addEventListener("click", () => {
    const value = document.getElementById("web-url")?.textContent?.trim();
    if (!value || value === "-") return;
    const url = value.startsWith("http") ? value : `https://${value}`;
    window.open(url, "_blank");
  });
}

const copyWebUrlBtn = document.getElementById("copyWebUrl");
if (copyWebUrlBtn) {
  copyWebUrlBtn.addEventListener("click", async () => {
    const value = document.getElementById("web-url")?.textContent?.trim();
    if (!value || value === "-") return;
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      console.warn("Failed to copy URL", err);
    }
  });
}

});

function renderSharedUserList() {
  const container = document.getElementById("sharedUserList");

  if (!container) {
    console.warn("⚠️ Missing element: #sharedUserList");
    return;
  }

  // 清空旧内容
  container.innerHTML = "";

  // 如果没有用户，显示提示
  if (!existingUsers || existingUsers.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No users found.";
    emptyItem.style.color = "#888";
    emptyItem.style.fontStyle = "italic";
    container.appendChild(emptyItem);
    return;
  }

  // 遍历用户并渲染每个条目
  existingUsers.forEach((user) => {
    const li = document.createElement("li");
    li.className = "shared-user-item";
    li.style.position = "relative"; // 用于定位小 ×
    // Read back by the invite box (createCase.js) to keep people already on the
    // case out of its suggestions.
    li.dataset.username = user.username || "";

    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = `👤 ${user.username}`;

    const roleSpan = document.createElement("span");
    roleSpan.className = "user-role";
    roleSpan.textContent = user.role;

    // ✅ 删除按钮（右上角 ×）
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "×";
    deleteBtn.title = "Remove user";
    deleteBtn.className = "delete-user-btn";

    // ⚠️ 如果缺失 uuid，不显示删除按钮
    if (!user.uuid || user.role === "owner") {
      deleteBtn.style.display = "none";
    }

    deleteBtn.addEventListener("click", async () => {
      if (await confirmRemoveUserFromCase(user)) {
        toast.success(`User ${user.username} removed.`);
        existingUsers = existingUsers.filter((u) => u.uuid !== user.uuid);
        renderSharedUserList();

        // Keep SHARED WITH in sync by dropping the user from the cached co_owners.
        // Only co-owners appear there — the owner shows in ASSIGNED TO.
        if (user.role === "coowner") {
          const caseObj = currentCases.find(
            (c) => (c.id ?? c.case_int_id) === window._inviteContext?.caseIntID
          );
          if (caseObj) {
            caseObj.co_owners = (caseObj.co_owners || []).filter(
              (n) => n !== user.username
            );
            if (String(window.selectedCaseId) === String(window._inviteContext?.caseIntID)) {
              renderSharedWith(caseObj.co_owners);
            }
          }
        }
      }
    });

    li.appendChild(nameSpan);
    li.appendChild(roleSpan);
    li.appendChild(deleteBtn); // ✅ 添加到右上角
    container.appendChild(li);
  });
}

// --- resilience for the per-case enrichment --------------------------------
// The detail/co-owner endpoints have no batch variant, so enrichment is one
// request per case and a throttled backend produces a wall of console errors.
//   • retry+backoff rides out an ISOLATED transient failure;
//   • a shared circuit breaker stops firing once the backend is clearly
//     refusing, then half-opens after a cooldown so scrolling resumes it.
const BREAKER_FAILURE_THRESHOLD = 6; // consecutive failures before we stop
const BREAKER_COOLDOWN_MS = 30000; // how long an open breaker stays closed to traffic
const PER_CASE_FETCH_RETRIES = 2; // extra attempts for a transient failure
const PER_CASE_FETCH_TIMEOUT_MS = 10000; // abort a hung request so the breaker can trip

// "Refusing this burst", not an answer: 429, and 403 (which this backend returns
// once a fan-out trips its throttle). 401/404 are answers, so deliberately absent.
const THROTTLE_STATUSES = new Set([403, 429]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Opens after `threshold` consecutive failures; any success resets it. After
// `cooldownMs` it half-opens, letting one attempt through to close or re-trip it.
function makeBreaker(threshold, cooldownMs = 0) {
  let consecutiveFailures = 0;
  let openedAt = 0;
  return {
    isOpen() {
      if (!openedAt) return false;
      if (cooldownMs && Date.now() - openedAt >= cooldownMs) {
        openedAt = 0;
        consecutiveFailures = 0;
        return false;
      }
      return true;
    },
    recordSuccess() {
      consecutiveFailures = 0;
      openedAt = 0;
    },
    recordFailure() {
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold && !openedAt) openedAt = Date.now();
    },
  };
}

// A Response whatever its status (callers handle 4xx), or null when the request
// failed outright or the breaker is open. Only 5xx and THROTTLE_STATUSES retry.
async function resilientFetch(url, options, breaker) {
  for (let attempt = 0; attempt <= PER_CASE_FETCH_RETRIES; attempt += 1) {
    if (breaker.isOpen()) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_CASE_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 500 || THROTTLE_STATUSES.has(res.status)) {
        throw new Error(`HTTP ${res.status}`);
      }
      breaker.recordSuccess();
      return res;
    } catch {
      clearTimeout(timer);
      breaker.recordFailure();
      if (breaker.isOpen() || attempt === PER_CASE_FETCH_RETRIES) return null;
      // Exponential backoff with jitter so retries don't resynchronize.
      await sleep(250 * 2 ** attempt + Math.random() * 150);
    }
  }
  return null;
}

// --- lazy per-case enrichment (visible rows only) ---------------------------
// Rows enrich themselves when scrolled into view: an IntersectionObserver feeds
// a small queue (<= ENRICH_CONCURRENCY in flight) and results are patched IN
// PLACE, never re-rendered, so the table can't re-sort under the user. NEVER
// fetch all cases eagerly — that 2xN burst trips the backend into a 403 wall.
//
// Per-case state on the case object as `__enrich`:
//   undefined → not fetched (the observer queues it when its row is seen)
//   "queued" / "inflight" → in the pipeline, don't double-queue
//   "wait"   → refused; a timer re-observes after the breaker cooldown
//   "done"   → enriched; skipped by the observer on later re-renders
// "__" keys are stripped from the localStorage cache.
const enrichBreaker = makeBreaker(BREAKER_FAILURE_THRESHOLD, BREAKER_COOLDOWN_MS);
const enrichQueue = [];
let enrichWorkersActive = 0;
let enrichWarnedAt = 0;
let enrichCacheSaveTimer = null;

// One shared observer, rooted on the table's scroll container. rootMargin
// prefetches slightly early so data lands about when the user's eyes do.
let rowObserver = null;
function getRowObserver() {
  if (rowObserver !== null) return rowObserver;
  if (typeof IntersectionObserver === "undefined") {
    rowObserver = false; // no observer support: enqueue immediately instead
    return rowObserver;
  }
  rowObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        rowObserver.unobserve(entry.target);
        enqueueEnrichment(entry.target.__caseObj);
      }
    },
    { root: document.getElementById("caseList"), rootMargin: "200px 0px" }
  );
  return rowObserver;
}

// Called by populateTable for every rendered row that still needs data.
function observeRowForEnrichment(row, caseObj) {
  if (!caseObj || caseObj.__enrich) return; // done/queued/inflight/wait
  row.__caseObj = caseObj;
  const obs = getRowObserver();
  if (obs) obs.observe(row);
  else enqueueEnrichment(caseObj); // ancient browser: degrade to queue-all
}

function enqueueEnrichment(caseObj, { front = false } = {}) {
  if (!caseObj || caseObj.__enrich === "done" || caseObj.__enrich === "queued" || caseObj.__enrich === "inflight") {
    return;
  }
  caseObj.__enrich = "queued";
  if (front) enrichQueue.unshift(caseObj);
  else enrichQueue.push(caseObj);
  pumpEnrichQueue();
}

function pumpEnrichQueue() {
  while (enrichWorkersActive < ENRICH_CONCURRENCY && enrichQueue.length) {
    const caseObj = enrichQueue.shift();
    enrichWorkersActive += 1;
    enrichOneCase(caseObj).finally(() => {
      enrichWorkersActive -= 1;
      pumpEnrichQueue();
    });
  }
}

// Fetches one case's details + co-owner roles into the case object and its row.
// A refusal parks the case in "wait" and re-observes after the breaker cooldown.
async function enrichOneCase(caseObj) {
  const logged = getLoggedInUser();
  const caseIntID = caseIntIdOf(caseObj);
  if (!logged || caseIntID == null) {
    caseObj.__enrich = "done"; // nothing we can ever fetch for this row
    return;
  }
  caseObj.__enrich = "inflight";

  const [detailRes, rolesRes] = await Promise.all(
    buildEnrichRequests(caseIntID, logged.uuid).map(([url, options]) =>
      resilientFetch(url, options, enrichBreaker)
    )
  );

  // false = both refused (throttle/outage or breaker already open): park and
  // retry after the cooldown. Fold details are in caseEnrichment.js.
  if (!(await applyEnrichmentResponses(caseObj, detailRes, rolesRes, logApi))) {
    scheduleEnrichRetry(caseObj);
    return;
  }

  caseObj.__enrich = "done";
  patchRowInPlace(caseObj);
  syncDetailPaneIfSelected(caseObj);
  scheduleEnrichCacheSave();
}

// Refused by throttle/outage: warn once per breaker window, then re-observe
// the row after the cooldown so a still-visible row retries automatically.
function scheduleEnrichRetry(caseObj) {
  caseObj.__enrich = "wait";
  if (Date.now() - enrichWarnedAt > BREAKER_COOLDOWN_MS) {
    enrichWarnedAt = Date.now();
    console.warn(
      "[cases] Case enrichment paused — backend refusing requests (rate-limited or unreachable). Retrying automatically in " +
        Math.round(BREAKER_COOLDOWN_MS / 1000) +
        "s."
    );
  }
  setTimeout(() => {
    caseObj.__enrich = undefined;
    const id = String(caseObj.id ?? caseObj.case_int_id);
    const row = document.querySelector(`#caseTableBody tr[data-case-id="${CSS.escape(id)}"]`);
    // Re-observing an on-screen row fires the observer at once and re-queues it;
    // off-screen rows wait for the next populateTable pass.
    if (row) observeRowForEnrichment(row, caseObj);
  }, BREAKER_COOLDOWN_MS + Math.random() * 2000);
}

// Patches just this row's cells — NOT populateTable(), which would re-sort under
// the user. An active status filter is the exception and re-filters properly.
function patchRowInPlace(caseObj) {
  const sel = document.getElementById("filter-status");
  if (sel && sel.value !== "all") {
    applyClientFilters();
    return;
  }

  const id = String(caseObj.id ?? caseObj.case_int_id);
  const row = document.querySelector(`#caseTableBody tr[data-case-id="${CSS.escape(id)}"]`);
  if (!row) return; // filtered out / re-rendered away — caseObj already holds the data

  const pill = row.querySelector(".cm-td-status .cm-pill");
  if (pill) {
    pill.className = `cm-pill ${statusPillClass(caseObj.new_status)}`;
    pill.innerHTML = statusPillInner(caseObj.new_status);
  }

  const dueDate =
    caseObj.expected_date || caseObj.due_date || computeDefaultDueDate(caseObj.creation_date);
  const dueInd = dueDateIndicator(dueDate);
  const dueCell = row.querySelector(".cm-due-date");
  if (dueCell) {
    dueCell.className = `cm-td-date cm-due-date ${dueInd ? dueInd.cls : ""}`;
    const text = dueCell.querySelector(".cm-due-text");
    if (text) text.textContent = dueDate ? formatDateOnly(dueDate) : "N/A";
  }
  const nameCell = row.querySelector(".cm-td-name");
  if (nameCell) {
    nameCell.querySelector(".cm-due-bar")?.remove();
    if (dueInd) {
      const bar = document.createElement("span");
      bar.className = `cm-due-bar ${dueInd.cls}`;
      bar.title = dueInd.label;
      bar.setAttribute("aria-hidden", "true");
      nameCell.appendChild(bar);
    }
  }

  const owner = caseObj.assigned_to || caseObj.username || "N/A";
  // Enrichment is where co-owners usually arrive, so this is the main feed.
  recordCollaborators(
    [owner, ...(caseObj.co_owners || [])].map((name) => ({ name, caseId: id }))
  );
  const ownerEl = row.querySelector(".cm-owner-name");
  if (ownerEl) {
    ownerEl.textContent = owner;
    ownerEl.title = owner;
  }

  // Replace only the names/em-dash span — the cell's inline "manage shared
  // users" button carries a click handler and must survive the patch.
  const sharedCell = row.querySelector(".cm-td-shared");
  if (sharedCell) {
    sharedCell.querySelector(".cm-shared-names, .cm-shared-empty")?.remove();
    const span = document.createElement("span");
    if (caseObj.co_owners?.length) {
      span.className = "cm-shared-names";
      span.textContent = caseObj.co_owners.join(", ");
      span.title = span.textContent;
    } else {
      span.className = "cm-shared-empty";
      span.textContent = "—";
    }
    sharedCell.prepend(span);
  }

  // Status may have just resolved from enrichment — refresh the admin counters.
  scheduleAdminStats();
}

// If the enriched case is the one open in the detail pane, fold the fresh
// fields into the stub (dashboard reads it) and repaint the pane.
function syncDetailPaneIfSelected(caseObj) {
  const id = String(caseObj.id ?? caseObj.case_int_id);
  if (String(window.selectedCaseId) !== id || !window.selectedCaseStub) return;
  Object.assign(window.selectedCaseStub, {
    new_status: caseObj.new_status,
    expected_date: caseObj.expected_date,
    assigned_to: caseObj.assigned_to,
    comments: caseObj.comments,
    co_owners: caseObj.co_owners,
  });
  displayCaseDetails(window.selectedCaseStub);
}

// Enrichment lands incrementally now, so persist the cache on a debounce
// instead of once-per-case (2400 cases scrolling by = 2400 JSON.stringify).
function scheduleEnrichCacheSave() {
  clearTimeout(enrichCacheSaveTimer);
  enrichCacheSaveTimer = setTimeout(() => saveCachedCases(currentCases), 1500);
}

// --- Case uploads ----------------------------------------------------------
// The upload button covers both kinds of file a case takes, so it asks which:
//   • reference images — a /referenceimages row mirrored into a free thumbnail
//     slot, exactly as the create-case form stores them;
//   • an extra 3D file — the same POST /stl/slot/ mechanism the 2D page's 3D
//     preview uses, so an STL can be attached without opening the case.
const EXTRA_STL_SLOTS = [1, 2, 3, 4];

// The auth object every per-case endpoint takes as payload element 0.
function caseAuth(caseIntId) {
  const user = getLoggedInUser();
  return {
    machine_id: MACHINE_ID,
    uuid: user?.uuid || "",
    caseIntID: caseIntId,
  };
}

// The selected case's name (case_id IS the name), from the list row or the stub
// the detail pane keeps for it.
function selectedCaseName() {
  const caseObj = currentCases.find(
    (c) => String(c.id ?? c.case_int_id) === String(window.selectedCaseId)
  );
  return caseObj?.case_id || window.selectedCaseStub?.case_id || "";
}

// What each upload kind accepts and where it lands. `matches` is the ONLY place
// a picked file is judged; the uploaders below take an already-filtered list.
const UPLOAD_KINDS = {
  reference: {
    accept: "image/*",
    label: "reference images",
    rejected: "images only",
    thumbnails: true,
    // Phones get the camera/gallery step first — see askSource.
    sources: true,
    matches: (f) => /^image\//i.test(f.type || "") || IMAGE_FILE_RE.test(f.name),
    upload: (files) => uploadCaseReferenceImages(files),
  },
  stl: {
    accept: ".stl",
    label: "3D files",
    rejected: ".stl only",
    thumbnails: false,
    matches: (f) => /\.stl$/i.test(f.name),
    upload: (files) => uploadCaseStlFiles(files),
  },
};

let uploadChooserEl = null;
// The staged files awaiting the Upload button: { kind, files, urls }. `urls` are
// object URLs for the image previews and have to be revoked when they go.
let pendingUpload = null;
// Which kind the camera/gallery step is picking for, so its two buttons and the
// Back out of it know where they came from.
let sourceStageKind = null;

// Injected rather than written into the markup: this module drives both
// case_list.html and admin_case_list.html, and one dialog can't drift.
function getUploadChooser() {
  if (uploadChooserEl) return uploadChooserEl;

  const modal = document.createElement("div");
  modal.id = "uploadChoiceModal";
  modal.className = "modal hidden";
  modal.innerHTML = `
    <div class="modal-content upload-choice-modal" role="dialog" aria-modal="true" aria-labelledby="uploadChoiceTitle">
      <span class="close-btn" data-upload-action="cancel" role="button" tabindex="0" aria-label="Close">&times;</span>
      <h3 class="modal-title" id="uploadChoiceTitle">Upload to Case</h3>

      <div class="upload-stage" data-stage="choose">
        <p class="upload-choice-sub">
          What would you like to attach to <strong id="uploadChoiceCaseName"></strong>?
        </p>
        <div class="upload-choice-grid">
          <button type="button" class="upload-choice-card" data-upload-choice="reference">
            <i class="fa-regular fa-images" aria-hidden="true"></i>
            <span class="upload-choice-title">Reference images</span>
            <span class="upload-choice-desc">
              Photos or scans, added to this case's image carousel. Select as many as you like.
            </span>
          </button>
          <button type="button" class="upload-choice-card" data-upload-choice="stl">
            <i class="fa fa-cube" aria-hidden="true"></i>
            <span class="upload-choice-title">Extra 3D files</span>
            <span class="upload-choice-desc">
              .stl files, into the case's four extra 3D slots. Select up to 4 at once.
            </span>
          </button>
        </div>
        <div class="modal-actions upload-choice-actions">
          <button type="button" class="cm-btn cm-btn-secondary" data-upload-action="cancel">Cancel</button>
        </div>
      </div>

      <div class="upload-stage hidden" data-stage="source">
        <p class="upload-choice-sub">Where should the photos come from?</p>
        <div class="upload-choice-grid">
          <button type="button" class="upload-choice-card" data-upload-source="camera">
            <i class="fa fa-camera" aria-hidden="true"></i>
            <span class="upload-choice-title">Take a photo</span>
            <span class="upload-choice-desc">
              Opens the camera and attaches the shot you take.
            </span>
          </button>
          <button type="button" class="upload-choice-card" data-upload-source="gallery">
            <i class="fa-regular fa-images" aria-hidden="true"></i>
            <span class="upload-choice-title">Choose from gallery</span>
            <span class="upload-choice-desc">
              Pick one or more photos already saved on this device.
            </span>
          </button>
        </div>
        <div class="modal-actions upload-choice-actions">
          <button type="button" class="cm-btn cm-btn-secondary" data-upload-action="source-back">Back</button>
        </div>
      </div>

      <div class="upload-stage hidden" data-stage="preview">
        <p class="upload-choice-sub" id="uploadPreviewSub"></p>
        <ul class="upload-preview-list" id="uploadPreviewList"></ul>
        <div class="modal-actions upload-preview-actions">
          <button type="button" class="cm-btn cm-btn-secondary upload-add-more" data-upload-action="add-more">
            <i class="fa fa-plus" aria-hidden="true"></i><span>Add more</span>
          </button>
          <button type="button" class="cm-btn cm-btn-secondary" data-upload-action="back">Back</button>
          <button type="button" class="cm-btn cm-btn-primary" data-upload-action="upload" id="uploadConfirmBtn">
            Upload
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    // An upload in flight owns the dialog until it settles — dismissing it
    // mid-batch would leave the user with no idea what did or didn't land.
    if (modal.classList.contains("is-uploading")) return;

    const kind = e.target.closest("[data-upload-choice]")?.dataset.uploadChoice;
    if (kind) {
      beginPick(kind);
      return;
    }
    const source = e.target.closest("[data-upload-source]")?.dataset.uploadSource;
    if (source) {
      stagePickedFiles(sourceStageKind, {
        capture: source === "camera" ? "environment" : null,
      });
      return;
    }
    const removeAt = e.target.closest("[data-remove-index]")?.dataset.removeIndex;
    if (removeAt != null) {
      removePendingFile(Number(removeAt));
      return;
    }
    const action =
      e.target === modal // backdrop
        ? "cancel"
        : e.target.closest("[data-upload-action]")?.dataset.uploadAction;
    if (action === "cancel") closeUploadChooser();
    else if (action === "back") showUploadStage("choose");
    // Backing out of the source step reached via "Add more" must not throw away
    // what is already staged.
    else if (action === "source-back")
      showUploadStage(pendingUpload?.files.length ? "preview" : "choose");
    else if (action === "add-more") beginPick(pendingUpload?.kind);
    else if (action === "upload") startPendingUpload();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.classList.contains("show") || modal.classList.contains("is-uploading")) return;
    closeUploadChooser();
  });

  uploadChooserEl = modal;
  return modal;
}

function showUploadStage(stage) {
  const modal = getUploadChooser();
  modal.querySelectorAll("[data-stage]").forEach((el) => {
    el.classList.toggle("hidden", el.dataset.stage !== stage);
  });
  if (stage === "choose") clearPendingUpload();
}

// Drop the staged files and the object URLs their previews were using.
function clearPendingUpload() {
  pendingUpload?.urls.forEach((url) => URL.revokeObjectURL(url));
  pendingUpload = null;
  sourceStageKind = null;
}

function closeUploadChooser() {
  clearPendingUpload();
  if (!uploadChooserEl) return;
  uploadChooserEl.classList.add("hidden");
  uploadChooserEl.classList.remove("show");
}

function openUploadChooser() {
  if (window.selectedCaseId == null) {
    toast.warning("Please select a case first.");
    return;
  }
  const modal = getUploadChooser();
  const nameEl = modal.querySelector("#uploadChoiceCaseName");
  if (nameEl) nameEl.textContent = selectedCaseName() || "this case";
  showUploadStage("choose");
  modal.classList.remove("hidden");
  modal.classList.add("show");
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// Whether to offer "Take a photo" at all: `capture` is honoured on phones and
// tablets and ignored on desktop, where both buttons would open the same file
// dialog. Coarse pointer = touch is the primary input.
function askSource() {
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

// Entry point for every pick. Images on a touch device get the camera/gallery
// step first: Chrome on Android 13+ routes an `image/*` input to the system photo
// picker, which is gallery-only and never offers the camera, so `capture` has to
// be set deliberately. (iOS Safari asks on its own, but the extra tap is the same
// on both, and one path is one thing to keep working.)
function beginPick(kind) {
  const spec = UPLOAD_KINDS[kind];
  if (!spec) return;
  if (spec.sources && askSource()) {
    sourceStageKind = kind;
    showUploadStage("source");
    return;
  }
  stagePickedFiles(kind);
}

// Open the picker for `kind` and stage what comes back for review. Nothing is
// sent yet — the preview's Upload button is what commits.
function stagePickedFiles(kind, { capture } = {}) {
  const spec = UPLOAD_KINDS[kind];
  if (!spec) return;
  pickFiles(spec.accept, (picked) => {
    const accepted = picked.filter(spec.matches);
    const skipped = picked.length - accepted.length;
    if (skipped) {
      toast.warning(`${skipped} file${skipped > 1 ? "s" : ""} skipped — ${spec.rejected}.`);
    }
    if (!accepted.length && pendingUpload?.kind !== kind) return;

    if (pendingUpload?.kind !== kind) {
      clearPendingUpload();
      pendingUpload = { kind, files: [], urls: [] };
    }
    // Re-picking the same file (easy to do via "Add more") would otherwise
    // upload it twice, into two slots.
    for (const file of accepted) {
      const dup = pendingUpload.files.some(
        (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
      );
      if (!dup) pendingUpload.files.push(file);
    }
    renderUploadPreview();
    showUploadStage("preview");
  }, { capture });
}

function removePendingFile(index) {
  if (!pendingUpload) return;
  pendingUpload.files.splice(index, 1);
  if (!pendingUpload.files.length) {
    showUploadStage("choose");
    return;
  }
  renderUploadPreview();
}

function renderUploadPreview() {
  const modal = getUploadChooser();
  const list = modal.querySelector("#uploadPreviewList");
  const sub = modal.querySelector("#uploadPreviewSub");
  const confirm = modal.querySelector("#uploadConfirmBtn");
  if (!pendingUpload || !list) return;

  const spec = UPLOAD_KINDS[pendingUpload.kind];
  const { files } = pendingUpload;

  // Previews are re-made from scratch on every render, so the previous batch's
  // object URLs are dead the moment the nodes go.
  pendingUpload.urls.forEach((url) => URL.revokeObjectURL(url));
  pendingUpload.urls = [];

  list.innerHTML = "";
  files.forEach((file, i) => {
    const li = document.createElement("li");
    li.className = "upload-preview-item";

    const thumb = document.createElement("span");
    thumb.className = "upload-preview-thumb";
    if (spec.thumbnails) {
      const url = URL.createObjectURL(file);
      pendingUpload.urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      thumb.appendChild(img);
    } else {
      // An STL has no cheap preview — parsing one to render it would cost more
      // than the upload itself.
      thumb.innerHTML = '<i class="fa fa-cube" aria-hidden="true"></i>';
    }

    const meta = document.createElement("span");
    meta.className = "upload-preview-meta";
    const name = document.createElement("span");
    name.className = "upload-preview-name";
    name.textContent = file.name;
    name.title = file.name;
    const size = document.createElement("span");
    size.className = "upload-preview-size";
    size.textContent = formatFileSize(file.size);
    meta.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "upload-preview-remove";
    remove.dataset.removeIndex = String(i);
    remove.title = `Remove ${file.name}`;
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.innerHTML = '<i class="fa fa-xmark" aria-hidden="true"></i>';

    li.append(thumb, meta, remove);
    list.appendChild(li);
  });

  if (sub) {
    sub.textContent = `${files.length} ${spec.label} ready to upload to ${
      selectedCaseName() || "this case"
    }.`;
  }
  if (confirm) {
    confirm.disabled = !files.length;
    confirm.textContent = `Upload ${files.length} file${files.length === 1 ? "" : "s"}`;
  }
}

// The dialog stays open with its buttons locked so the user can see what is
// being sent, and closes when done; per-file progress goes to the toasts.
async function startPendingUpload() {
  if (!pendingUpload?.files.length) return;
  const modal = getUploadChooser();
  const spec = UPLOAD_KINDS[pendingUpload.kind];
  const files = pendingUpload.files.slice();

  const buttons = modal.querySelectorAll(".upload-preview-actions button");
  buttons.forEach((b) => (b.disabled = true));
  modal.querySelector("#uploadConfirmBtn").textContent = "Uploading…";
  modal.classList.add("is-uploading");
  try {
    await spec.upload(files);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    modal.classList.remove("is-uploading");
    closeUploadChooser();
  }
}

// The lowest free extra slots, probed one at a time and only until `count` are
// found: an occupied slot returns its whole base64 STL, so probing all four is MBs.
async function findFreeStlSlots(caseIntId, count) {
  const auth = caseAuth(caseIntId);
  const free = [];
  for (const slotNumber of EXTRA_STL_SLOTS) {
    if (free.length >= count) break;
    try {
      const res = await fetch(`${API_BASE}/stl/slot/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([auth, { slotNumber }]),
      });
      if (!res.ok) {
        free.push(slotNumber); // 404 = empty slot
        continue;
      }
      const data = await res.json();
      const item = Array.isArray(data) ? data[0] : data;
      if (!item?.data) free.push(slotNumber);
    } catch (err) {
      console.warn(`⚠️ /stl/slot/get probe failed for slot ${slotNumber}`, err);
      free.push(slotNumber); // treat an unreachable probe as free and let the POST decide
    }
  }
  return free;
}

// `files` arrives already filtered to .stl by the preview stage.
async function uploadCaseStlFiles(files) {
  const caseIntId = window.selectedCaseId;
  if (caseIntId == null) {
    toast.warning("Please select a case first.");
    return;
  }

  const stls = files.slice();
  if (!stls.length) return;

  const btn = document.getElementById("upload3dFileBtn");
  if (btn) btn.disabled = true;
  let done = 0;
  try {
    const slots = await findFreeStlSlots(caseIntId, stls.length);
    if (!slots.length) {
      toast.warning("All 4 extra 3D file slots are in use. Delete one first.");
      return;
    }
    // Partial fit: take what the free slots allow rather than failing outright,
    // and say which files were left behind.
    if (slots.length < stls.length) {
      toast.warning(
        `Only ${slots.length} of the 4 extra 3D slots ${slots.length === 1 ? "is" : "are"} free — ` +
          `uploading the first ${slots.length} of ${stls.length} files.`
      );
      stls.length = slots.length;
    }

    // Sequential: an STL is a multi-MB base64 POST, and the backend
    // burst-throttles (see the enrichment breaker).
    for (let i = 0; i < stls.length; i++) {
      const file = stls[i];
      toast.info(
        stls.length > 1
          ? `Uploading ${file.name} (${i + 1} of ${stls.length})…`
          : `Uploading ${file.name}…`
      );
      const data = await fileToBase64(file);
      // case_id must ride in THIS object, not the auth one (same as POST /stl).
      // Without it the insert 500s with no CORS header, surfacing as "Failed to fetch".
      await uploadWithProgress("stl/slot/", 
        JSON.stringify([
          caseAuth(caseIntId),
          { case_id: caseIntId, slotNumber: slots[i], filename: file.name, data },
        ])
      );
      done++;
    }
    toast.success(
      done > 1 ? `${done} 3D files uploaded.` : `${stls[0].name} uploaded.`
    );
  } catch (err) {
    console.error("❌ 3D file upload failed", err);
    toast.error(
      done
        ? `Uploaded ${done} of ${stls.length}; the rest failed.`
        : "Upload failed. Please try again."
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

// One-shot multi-select file picker, removed after the pick. `capture` (mobile
// only) forces the camera instead of the gallery; a capture is a single photo and
// some Android builds ignore `capture` when `multiple` is also set, so it's one
// or the other.
function pickFiles(accept, onPick, { capture } = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  if (capture) input.setAttribute("capture", capture);
  else input.multiple = true;
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (files.length) onPick(files);
  });
  input.click();
}

// --- Reference images ------------------------------------------------------
// Slots 0-2 are reserved (composite 2D, upper jaw, lower jaw), so reference
// images take everything after them.
const REFERENCE_SLOT_START = 3;

// Extension fallback for the Android providers that hand over a File with an
// empty `type`. HEIC/HEIF are in the list deliberately: they are let through the
// filter so the upload can explain why they can't be read, rather than silently
// counting them as "skipped — images only".
const IMAGE_FILE_RE = /\.(png|jpe?g|gif|bmp|webp|hei[cf])$/i;

// `count` free slots at or above REFERENCE_SLOT_START, else null. A POST to an
// occupied slot REPLACES it, so a failed lookup writes nothing rather than guess.
async function nextFreeThumbnailSlots(caseIntId, count) {
  const rows = await fetchThumbnailRows(caseIntId);
  if (!rows) return null;

  const used = new Set();
  let untagged = 0;
  for (const row of rows) {
    if (!row?.data) continue;
    const slot = thumbnailSlot(row);
    if (slot == null) untagged++;
    else used.add(slot);
  }

  const slots = [];
  let next = REFERENCE_SLOT_START + untagged;
  while (slots.length < count) {
    while (used.has(next)) next++;
    slots.push(next++);
  }
  return slots;
}

// Same as the create-case form: /referenceimages is the record, and the mirrored
// thumbnail slot is what the carousel and the download fallback actually read.
// `image` is already through normalizeImageFile — see uploadCaseReferenceImages.
async function uploadReferenceImage(caseIntId, caseName, image, slot) {
  const { dataUrl, name } = image;
  const auth = caseAuth(caseIntId);

  // case_id here is the case NAME — the referenceImages writer keys off the name
  // string, unlike /thumbnails below, which wants the numeric id.
  const refRes = await fetch(`${API_BASE}/referenceimages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      auth,
      { case_id: caseName, image_name: name, image_data: dataUrl },
    ]),
  });
  logApi(refRes, "POST /referenceimages");
  if (!refRes.ok) throw new Error(`HTTP ${refRes.status}`);

  // The thumbnail payload takes bare base64, not the data URL.
  const comma = dataUrl.indexOf(",");
  const thumbRes = await fetch(`${API_BASE}/thumbnails`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      auth,
      { case_id: caseIntId, slot, data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl },
    ]),
  });
  logApi(thumbRes, "POST /thumbnails");
  if (!thumbRes.ok) throw new Error(`HTTP ${thumbRes.status}`);
}

async function uploadCaseReferenceImages(files) {
  const caseIntId = window.selectedCaseId;
  if (caseIntId == null) {
    toast.warning("Please select a case first.");
    return;
  }
  // The referenceImages row is keyed by the case name, so without one the write
  // would land on no case at all.
  const caseName = selectedCaseName();
  if (!caseName) {
    toast.warning("Case name unavailable — reopen the case and try again.");
    return;
  }

  const picked = files.slice();
  if (!picked.length) return;

  const btn = document.getElementById("upload3dFileBtn");
  if (btn) btn.disabled = true;
  let done = 0;
  let images = [];
  try {
    // Re-encode BEFORE any network call: a camera capture is multi-MB, and it
    // travels twice (the row, then the thumbnail slot). Anything that cannot be
    // decoded at all is dropped here, with its own reason, rather than uploaded
    // as bytes the carousel and the desktop app can't open.
    if (picked.length > 1) toast.info(`Preparing ${picked.length} images…`);
    for (const file of picked) {
      try {
        images.push(await normalizeImageFile(file));
      } catch (err) {
        console.warn("[refImages] skipped", file?.name, err);
        toast.error(err.message);
      }
    }
    if (!images.length) return;

    const slots = await nextFreeThumbnailSlots(caseIntId, images.length);
    if (!slots) {
      toast.error("Could not read the case's existing images. Please try again.");
      return;
    }
    // Sequential on purpose: each image is a base64 POST, and the backend
    // burst-throttles (see the enrichment breaker).
    for (let i = 0; i < images.length; i++) {
      toast.info(`Uploading ${images[i].name} (${i + 1} of ${images.length})…`);
      await uploadReferenceImage(caseIntId, caseName, images[i], slots[i]);
      done++;
    }
    toast.success(`${done} reference image${done > 1 ? "s" : ""} uploaded.`);
  } catch (err) {
    console.error("❌ Reference image upload failed", err);
    toast.error(
      done
        ? `Uploaded ${done} of ${images.length}; the rest failed.`
        : "Upload failed. Please try again."
    );
  } finally {
    if (btn) btn.disabled = false;
    // Repaint the carousel so the new images appear without reselecting the case.
    if (done && String(window.selectedCaseId) === String(caseIntId)) {
      await fetchThumbnails(caseIntId);
    }
  }
}

// --- Case instructions -----------------------------------------------------
// Free text for whatever the structured fields don't cover, stored in
// additionalcasedetails.comments — deliberately the 2D Case Note's field too.

// Grows the textarea to its content (no drag handle). Height is cleared so it can
// shrink, and the border added back on top of scrollHeight, which omits it.
function autoGrowInstructions(box) {
  if (!box) return;
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
}

// Drops the inline height back to the CSS resting size once a note is committed,
// so a long note doesn't permanently eat the detail panel.
function collapseInstructions(box) {
  if (box) box.style.height = "";
}

// Tracked so a slow save can't land on a case the user has switched away from,
// and so Save only enables on a real edit.
let instructionsLoadedFor = null;
let instructionsSavedValue = "";

function renderCaseInstructions(caseIntId, comments) {
  const box = document.getElementById("caseInstructions");
  if (!box) return;
  // Enrichment repaints the pane a moment after it opens — don't overwrite a
  // note being typed. Keep the text, take the server value as the saved baseline.
  const dirty = box.value.trim() !== instructionsSavedValue.trim();
  if (instructionsLoadedFor === (caseIntId ?? null) && (document.activeElement === box || dirty)) {
    instructionsSavedValue = comments ?? "";
    return;
  }
  instructionsLoadedFor = caseIntId ?? null;
  instructionsSavedValue = comments ?? "";
  box.value = instructionsSavedValue;
  box.disabled = caseIntId == null;
  // Opening a case shows the note at its resting size; it only expands once the
  // user focuses in to edit.
  collapseInstructions(box);
  setInstructionsStatus("");
}

function setInstructionsStatus(text, isError = false) {
  const status = document.getElementById("caseInstructionsStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-error", !!isError);
}

// The table is append-only, so the NEWEST row is the one to merge onto. ok=false
// means the read failed and the caller must NOT write; detail=null means no row.
async function fetchAdditionalCaseDetails(caseIntId) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntId == null) return { ok: false, detail: null };
  try {
    const res = await fetch(
      `${API_BASE}/additionalcasedetails/getall`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            machine_id: MACHINE_ID,
            uuid: user.uuid,
            caseIntID: caseIntId,
          },
        ]),
      }
    );
    logApi(res, "POST /additionalcasedetails/getall");
    // 404 = this case has no row yet, which is a valid starting point.
    if (res.status === 404) return { ok: true, detail: null };
    if (!res.ok) return { ok: false, detail: null };
    const arr = await res.json();
    return { ok: true, detail: Array.isArray(arr) ? arr.at(-1) ?? null : null };
  } catch (err) {
    console.error("❌ Failed to read additional case details:", err);
    return { ok: false, detail: null };
  }
}

// POST /additionalcasedetails is a FULL upsert: read first and carry
// assigned_to/due_date/new_status forward, or posting `comments` nulls the rest.
async function saveCaseInstructions() {
  const box = document.getElementById("caseInstructions");
  const caseIntId = instructionsLoadedFor;
  if (!box || caseIntId == null) return;

  const text = box.value.trim();
  // Blur fires every time focus leaves, including when the user just clicked in
  // and out. Nothing to write, so collapse and stay quiet.
  if (text === instructionsSavedValue.trim()) {
    collapseInstructions(box);
    return;
  }

  const user = getLoggedInUser();
  if (!user?.uuid) {
    setInstructionsStatus("Not signed in.", true);
    return;
  }

  setInstructionsStatus("Saving…");

  const { ok, detail } = await fetchAdditionalCaseDetails(caseIntId);
  if (!ok) {
    setInstructionsStatus("Couldn't save — try again.", true);
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/additionalcasedetails`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          {
            machine_id: MACHINE_ID,
            uuid: user.uuid,
            caseIntID: caseIntId,
          },
          {
            assigned_to: detail?.assigned_to ?? null,
            due_date: detail?.due_date ?? null,
            new_status: detail?.new_status ?? null,
            comments: text || null,
          },
        ]),
      }
    );
    logApi(res, "POST /additionalcasedetails");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Mirror into the cached list row and the dashboard stub so reopening the
    // case shows the saved text without waiting for a re-fetch.
    const cached = currentCases.find(
      (c) => String(c.id ?? c.case_int_id) === String(caseIntId)
    );
    if (cached) cached.comments = text || null;
    if (window.selectedCaseStub) window.selectedCaseStub.comments = text || null;
    // Persist it, or the next load's instant paint shows the pre-edit text.
    if (cached) scheduleEnrichCacheSave();
    // Tell the 2D page's Special Instruction box (another tab, same field).
    publishCaseComment(caseIntId, text);

    // The user may have switched cases mid-request; only touch the box if it is
    // still showing the case we saved.
    if (instructionsLoadedFor === caseIntId) {
      instructionsSavedValue = text;
      box.value = text;
      // Committed — shrink back to the resting size.
      collapseInstructions(box);
      setInstructionsStatus("Saved.");
      setTimeout(() => {
        const status = document.getElementById("caseInstructionsStatus");
        if (status?.textContent === "Saved.") setInstructionsStatus("");
      }, 2000);
    }
  } catch (err) {
    console.error("❌ Failed to save case instructions:", err);
    setInstructionsStatus("Couldn't save — try again.", true);
  }
}

// The stored additionalcasedetails row, or null when there is none. THROWS on a
// refusal, so a caller about to overwrite can abort rather than guess.
async function readCaseDetails(caseIntID, uuid) {
  const res = await fetch(
    `${API_BASE}/additionalcasedetails/getall`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: MACHINE_ID, uuid, caseIntID },
      ]),
    }
  );
  logApi(res, 'POST /additionalcasedetails/getall');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows.at(-1) : null) || null;
}

async function postNewStatus(caseObj, newStatus) {
  const uuid = getLoggedInUser().uuid;
  const caseIntID = caseObj.id || caseObj.case_int_id;

  // Replaces the WHOLE row, so read and merge rather than trust the in-memory
  // case — enrichment marks it "done" once EITHER of its two fetches succeeds.
  const stored = await readCaseDetails(caseIntID, uuid);

  const body = [
    {
      machine_id: MACHINE_ID,
      uuid,
      caseIntID,
    },
    {
      assigned_to: stored?.assigned_to ?? caseObj.assigned_to ?? null,
      due_date: stored?.due_date ?? caseObj.expected_date ?? null, // 你的 clean 已改名
      comments: stored?.comments ?? caseObj.comments ?? null,
      new_status: newStatus,
    },
  ];

  const res = await fetch(
    `${API_BASE}/additionalcasedetails`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  logApi(res, 'POST /additionalcasedetails');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  /* ★★★ 这三行是新加的 ★★★ */
await createStatusAlerts(
  caseObj,
  getLoggedInUser().username || "",   // from_user
  newStatus                          // 必要时写成 "" 也行
).catch(console.error);
  return res.json(); // ← 如需用返回值可接住
}


/*  当状态改完以后，为同一 case 的其它成员创建通知                    */
async function createStatusAlerts(caseObj, fromUser, newStatus) {
  const me         = getLoggedInUser();
  const myUuid     = me.uuid;
  const caseIntID  = caseObj.id || caseObj.case_int_id;

  /* 1️⃣ 拉角色列表 —— 把 owner / coowner / lab 都列进来 */
  let recipients = [];
  try {
    const res = await fetch(
      `${API_BASE}/role/all/get`,
      {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify([
          { machine_id: MACHINE_ID, uuid: myUuid, caseIntID },
          { case_int_id: caseIntID }
        ])
      }
    );
    logApi(res, 'POST /role/all/get');
    if (res.ok) {
      const arr = await res.json();
      recipients = arr
        .filter(r => ["owner", "coowner", "lab"].includes(r.role))
        .map(r =>
          r.username ||
          (r.email ? r.email.split("@")[0] : "") ||      // 回退到邮箱前缀
          r.uuid                                          // 最后用 uuid
        )
        .filter(Boolean);
    }
  } catch (err) {
    console.warn("[alerts] role fetch failed:", err);
  }

  /* 2️⃣ 排除自己 & 去重 */
  recipients = [...new Set(
    recipients.filter(u =>
      u && fromUser && u.toLowerCase() !== fromUser.toLowerCase()
    )
  )];

  if (!recipients.length) return;   // 没别人需要通知

  /* 3️⃣ 并发写 alerts */
  await Promise.all(
    recipients.map(async toName => {
      const body = [
        { machine_id: MACHINE_ID, uuid: myUuid, caseIntID },
        {
          case_int_id   : caseIntID,
          to_user       : toName,
          from_user     : fromUser,
          new_status    : newStatus,
          alert_message : "",          // 需要可自定义
          read_status   : 0,
          deleted       : 0
        }
      ];
      console.log("[alerts] push to", toName, body);  // 调试用

      try {
        const alertRes = await fetch(
          `${API_BASE}/alerts`,
          {
            method : "POST",
            headers: { "Content-Type": "application/json" },
            body   : JSON.stringify(body)
          }
        );
        logApi(alertRes, 'POST /alerts');
      } catch (e) {
        console.error("[alerts] create failed:", e);
      }
    })
  );
}



// 把后端的空格写法 -> 下划线写法
function apiStatusToValue(str) {
  if (!str) return "na";                  // 后端空/null → N/A
  return str.toLowerCase().replace(/ /g, "_");
}

// 把下划线写法 -> 后端需要的空格写法
function valueToApiStatus(val) {
  if (!val || val === "na") return "";    // N/A → 空字符串（等同 null）
  return val.replace(/_/g, " ");
}
