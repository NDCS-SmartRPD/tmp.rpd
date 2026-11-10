// Per-case "Case Note" helpers: mostly localStorage `caseNote:<caseIntID>`, except
// Date Required / Tooth Shade / Special Instruction, which live in additionalcasedetails.

import { confirmModal, toast } from "../shared/toast.js";
import { API_BASE, MACHINE_ID, getLoggedInUser } from "../shared/api.js";
import { toDateInputValue } from "../shared/timestamps.js";
import { createCaseHistory } from "../shared/caseHistory.js";
import { auditedCaseWrite } from "../shared/caseActivitySignal.js";

// getLoggedInUser rather than ApiClient.js's shared VIEWER_UUID: these case
// endpoints authenticate as the signed-in user.

// POST `body` as JSON to `${API_BASE}/${path}`. Returns the Response, or null if
// the request itself throws (offline / CORS). Callers check `res?.ok`.
async function postJson(path, body) {
  try {
    return await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

export const WORK_CATEGORY_OPTIONS = [
  { value: "", label: "Select…" },
  { value: "metal", label: "Metal" },
  { value: "full-acrylic", label: "Full Acrylic" },
];

export const WORK_CATEGORY_LABELS = Object.fromEntries(
  WORK_CATEGORY_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label])
);

// Work Category mirrors the case's denture-base material (state.jawMaterial:
// 0 = metal, 2 = full acrylic, null = not chosen yet). "" when unset.
export const WORK_CATEGORY_JAW_MATERIAL = {
  0: "metal",
  2: "full-acrylic",
};

export function workCategoryForJawMaterial(material) {
  return WORK_CATEGORY_JAW_MATERIAL[material] ?? "";
}

const STORAGE_PREFIX = "caseNote:";
const DUE_DATE_PREFIX = "caseDueDate:";

const storageKey = (prefix, caseIntID) => `${prefix}${caseIntID ?? "unknown"}`;

// localStorage wrappers that degrade gracefully when the store is unavailable
// (private mode / quota). lsSet removes the key for a null/empty value.
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export { toDateInputValue };

// Persists the due date so the 2D Case Note can default to it: the 2D tab can't read
// window.selectedCaseStub, but localStorage is shared same-origin.
export function saveCaseDueDate(caseIntID, isoDate) {
  return lsSet(storageKey(DUE_DATE_PREFIX, caseIntID), isoDate);
}

export function loadCaseDueDate(caseIntID) {
  return lsGet(storageKey(DUE_DATE_PREFIX, caseIntID)) || "";
}

const COMMENT_PREFIX = "caseComment:";
const TOOTH_SHADE_PREFIX = "caseToothShade:";

// Announces a saved comment to other tabs — `storage` fires in every OTHER document, the
// only same-origin channel. The timestamp keeps a repeat save of identical text firing.
export function publishCaseComment(caseIntID, text) {
  return lsSet(
    storageKey(COMMENT_PREFIX, caseIntID),
    JSON.stringify({ text: text ?? "", at: Date.now() })
  );
}

// Call `cb(caseIntID, text)` when another tab publishes. Returns an unsubscribe.
export function watchCaseComments(cb) {
  const onStorage = (e) => {
    if (!e.key?.startsWith(COMMENT_PREFIX) || !e.newValue) return;
    const raw = e.key.slice(COMMENT_PREFIX.length);
    const n = Number(raw);
    try {
      cb(raw !== "" && Number.isFinite(n) ? n : raw, JSON.parse(e.newValue).text ?? "");
    } catch {
      /* malformed payload — ignore */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function saveCaseToothShadeDraft(caseIntID, toothShade) {
  return lsSet(storageKey(TOOTH_SHADE_PREFIX, caseIntID), toothShade?.trim() || "");
}

export function loadCaseToothShadeDraft(caseIntID) {
  const raw = lsGet(storageKey(TOOTH_SHADE_PREFIX, caseIntID)) || "";
  try {
    return JSON.parse(raw)?.text ?? "";
  } catch {
    return raw;
  }
}

export function publishCaseToothShade(caseIntID, toothShade) {
  return lsSet(
    storageKey(TOOTH_SHADE_PREFIX, caseIntID),
    JSON.stringify({ text: toothShade ?? "", at: Date.now() })
  );
}

export function watchCaseToothShade(cb) {
  const onStorage = (e) => {
    if (!e.key?.startsWith(TOOTH_SHADE_PREFIX) || !e.newValue) return;
    const raw = e.key.slice(TOOTH_SHADE_PREFIX.length);
    const n = Number(raw);
    try {
      const parsed = JSON.parse(e.newValue);
      cb(raw !== "" && Number.isFinite(n) ? n : raw, parsed.text ?? "");
    } catch {
      cb(raw !== "" && Number.isFinite(n) ? n : raw, e.newValue ?? "");
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

// `YYYY-MM-DD` to the Unix SECONDS additionalcasedetails.due_date uses, parsed in local
// time so the displayed day round-trips. Returns null for empty/invalid.
function dateInputToEpochSeconds(isoDate) {
  if (!isoDate) return null;
  const ms = Date.parse(`${isoDate}T00:00:00`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// Reads the additional-details row. POST is a full upsert, so an update MUST read first.
// { ok:false } = request failed, don't write; { ok:true, detail:null } = no row yet.
export async function fetchAdditionalCaseDetails(caseIntID) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntID == null) return { ok: false, detail: null };
  const res = await postJson("additionalcasedetails/getall", [
    { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID },
  ]);
  // 404 = this case has no row yet, which is a valid starting point — a brand
  // new case (createCase.js's post-creation due-date/comment write) always
  // hits this on its first save. Without this, patchAdditionalCaseDetails
  // below reads it as a failure and silently refuses to write at all.
  if (res?.status === 404) return { ok: true, detail: null };
  if (!res?.ok) return { ok: false, detail: null };
  try {
    const arr = await res.json();
    const detail = Array.isArray(arr) ? arr.at(-1) ?? null : null;
    return { ok: true, detail };
  } catch {
    return { ok: false, detail: null };
  }
}

// A post REPLACES the whole additionalcasedetails row, so read it first and carry every
// field forward except `changes`. Bails without writing if the read fails.
async function patchAdditionalCaseDetails(caseIntID, changes) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntID == null) return false;
  const { ok, detail } = await fetchAdditionalCaseDetails(caseIntID);
  if (!ok) return false;
  const legacy = {
    assigned_to: detail?.assigned_to ?? null,
    due_date: detail?.due_date ?? null,
    comments: detail?.comments ?? null,
    new_status: detail?.new_status ?? null,
    tooth_shade: detail?.tooth_shade ?? null,
    ...changes,
  };
  const res = await auditedCaseWrite("details",
    { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID },
    { caseIntID: Number(caseIntID), changes, initial: legacy },
    "additionalcasedetails", "POST", legacy).catch(() => null);
  return res?.ok ?? false;
}

// `comment`: a string writes it through; undefined preserves the existing one.
export async function updateCaseDueDate(caseIntID, isoDate, comment) {
  const changes = { due_date: dateInputToEpochSeconds(isoDate) };
  if (comment !== undefined) changes.comments = comment?.trim() ? comment : null;
  return patchAdditionalCaseDetails(caseIntID, changes);
}

// The case list's CASE INSTRUCTIONS box. Leaves due_date alone — Approve owns it.
export async function updateCaseComment(caseIntID, comment) {
  return patchAdditionalCaseDetails(caseIntID, { comments: comment?.trim() ? comment : null });
}

export async function updateCaseToothShade(caseIntID, toothShade) {
  const value = toothShade?.trim() ? toothShade.trim() : null;
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntID == null) return false;

  try {
    const res = await postJson("additionalcasedetails/toothshade", [
      { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID },
      { case_int_id: caseIntID, tooth_shade: value },
    ]);
    if (res?.ok) return true;
    if (res && ![404, 405].includes(Number(res.status))) return false;
  } catch {
    // Fall back to the full-row merge below for older local servers.
  }

  return patchAdditionalCaseDetails(caseIntID, { tooth_shade: value });
}

// The status strings the backend stores for an approved design. Both are values
// the case list already filters on (see its status <select>) — not new labels.
export const STATUS_2D_DESIGN_APPROVED = "2D design approved";
export const STATUS_3D_DESIGN_APPROVED = "3D design approved";

export async function updateCaseStatus(caseIntID, newStatus) {
  const updated = await patchAdditionalCaseDetails(caseIntID, { new_status: newStatus });
  if (updated) await createCaseHistory(caseIntID, newStatus);
  return updated;
}

export function loadCaseNote(caseIntID) {
  const raw = lsGet(storageKey(STORAGE_PREFIX, caseIntID));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCaseNote(caseIntID, note) {
  return lsSet(storageKey(STORAGE_PREFIX, caseIntID), JSON.stringify(note));
}

// ---------------------------------------------------------------------------
// Case users + email — who is on the case, and how the Approve dialog notifies them.
// ---------------------------------------------------------------------------

// Loose on purpose: the backend is the real validator. This only catches the
// obvious typo before spending a request.
export const EMAIL_RE = /^\S+@\S+\.\S+$/;

// The case's people from the role table as { ok, users }; ok=false is a failed request, not
// an empty case. `email` is mostly absent — fetchCaseUsersWithEmails fills the gaps.
export async function fetchCaseUsers(caseIntID) {
  const user = getLoggedInUser();
  if (!user?.uuid || caseIntID == null) return { ok: false, users: [] };
  const res = await postJson("role/all/get", [
    { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID },
    { case_int_id: caseIntID },
  ]);
  if (!res?.ok) return { ok: false, users: [] };
  try {
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: true, users: [] };
    // The role table can hold more than one row per person (a re-share writes
    // another), so collapse on uuid, falling back to the username.
    const byKey = new Map();
    for (const row of rows) {
      if (!row) continue;
      const username = row.username || "";
      const email = row.email || "";
      if (!username && !email) continue;
      const key = row.uuid || username.toLowerCase();
      const existing = byKey.get(key);
      // Prefer whichever duplicate actually carries an address.
      if (existing && (existing.email || !email)) continue;
      byKey.set(key, {
        username: username || email.split("@")[0],
        role: row.role || "",
        uuid: row.uuid || "",
        email,
      });
    }
    // Owner first, then co-owners, then anything else — matches the reading
    // order of the dashboard's Access table.
    const rank = (r) => (r === "owner" ? 0 : r === "coowner" ? 1 : 2);
    const users = [...byKey.values()].sort(
      (a, b) =>
        rank(String(a.role).toLowerCase()) - rank(String(b.role).toLowerCase()) ||
        a.username.localeCompare(b.username)
    );
    return { ok: true, users };
  } catch {
    return { ok: false, users: [] };
  }
}

// Human-readable role for the UI ("coowner" reads better hyphenated, same call
// the dashboard's Access panel makes).
export function roleLabel(role) {
  const r = String(role || "").toLowerCase();
  if (r === "coowner") return "co-owner";
  return role || "—";
}

// Joins email lines for the wire: the mailer renders the message as HTML, so breaks MUST
// be <br> and text must be escaped first. Every custom email goes through here.
// A { html } line is already markup (see emailLinkHtml) and passes through as-is.
export function emailBodyHtml(lines) {
  return lines
    .map((line) =>
      line?.html != null
        ? line.html
        : String(line).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]))
    )
    .join("<br>\n");
}

// A real anchor, because Yahoo does not auto-linkify bare URLs in message text.
// Anything not http(s) is emitted as plain text rather than a clickable scheme.
export function emailLinkHtml(url) {
  const href = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(href)) return emailBodyHtml([href]);
  const safe = href.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
  return `<a href="${safe}">${safe}</a>`;
}

// /sendCustomEmail takes a FLAT body (no [{auth},{payload}], no uuid) and ONE address, so
// multi-recipient is a request each. `images` is unused — they inline into `message`.
export async function sendCustomEmail({ email, subject, message }) {
  if (!email || !EMAIL_RE.test(email)) return false;
  const res = await postJson("sendCustomEmail", {
    customEmail: email,
    subject: subject || "SmartRPD notification",
    message: message || "",
  });
  return res?.ok ?? false;
}

// Address lookup by username, the same call the case-share box makes. Takes only a
// machine_id, so it is NOT is_admin-gated — unlike user/getall, which 401s non-admins.
async function lookupUserEmail(username) {
  if (!username) return "";
  const res = await postJson("user/checkifusernameexists/get", [
    { machine_id: MACHINE_ID },
    { username },
  ]);
  if (!res?.ok) return "";
  try {
    const body = await res.json();
    const email = (Array.isArray(body) ? body[0] : body)?.email || "";
    return EMAIL_RE.test(email) ? email : "";
  } catch {
    return "";
  }
}

// fetchCaseUsers plus addresses: anyone missing one is looked up by username, bounded by
// the case's handful of users so it never bursts the throttler. "" if unresolvable.
export async function fetchCaseUsersWithEmails(caseIntID) {
  const { ok, users } = await fetchCaseUsers(caseIntID);
  if (!ok || !users.length) return { ok, users };

  const byName = new Map(
    users.filter((u) => u.email).map((u) => [u.username.toLowerCase(), u.email])
  );
  const unresolved = users.filter((u) => !byName.has(u.username.toLowerCase()));
  if (unresolved.length) {
    const found = await Promise.all(unresolved.map((u) => lookupUserEmail(u.username)));
    unresolved.forEach((u, i) => {
      if (found[i]) byName.set(u.username.toLowerCase(), found[i]);
    });
  }

  return {
    ok,
    users: users.map((u) => ({ ...u, email: byName.get(u.username.toLowerCase()) || "" })),
  };
}

// In-app bell alerts, keyed by username not address, so they reach people mail can't.
// notifications.js already renders the status line — add to it, don't repeat it.
export async function sendCaseApprovalAlerts(
  caseIntID,
  { statusLabel = "", alertMessage = "" } = {}
) {
  const me = getLoggedInUser();
  if (!me?.uuid || caseIntID == null) return 0;
  const fromUser = me.username || "";

  const { ok, users } = await fetchCaseUsers(caseIntID);
  if (!ok) return 0;

  // Same role filter the case list uses, minus yourself — you don't need to be
  // told about your own approval.
  const recipients = users
    .filter((u) => ["owner", "coowner", "lab"].includes(String(u.role).toLowerCase()))
    .map((u) => u.username)
    .filter((name) => name && name.toLowerCase() !== fromUser.toLowerCase());
  if (!recipients.length) return 0;

  const results = await Promise.all(
    recipients.map((toUser) =>
      postJson("alerts", [
        { machine_id: MACHINE_ID, uuid: me.uuid, caseIntID },
        {
          case_int_id: caseIntID,
          to_user: toUser,
          from_user: fromUser,
          new_status: statusLabel,
          alert_message: alertMessage,
          read_status: 0,
          deleted: 0,
        },
      ]).then((res) => Boolean(res?.ok))
    )
  );
  return results.filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// The Case Note "Approve" confirmation: arch renders + upload tile left, roster and typed
// address right. Everything but the arches is SHARED with preview3DApproval.js. Sending is
// deliberately independent of Approve/Cancel, so cancelling can't unsend mail.
// ---------------------------------------------------------------------------

// The case NAME alone for outgoing mail and messages. The topbar renders
// "12 : name", but the id is a transfer key the recipient can't use.
export function resolveCaseLabel(caseIntID) {
  const topbarLabel = (document.getElementById("caseLabel")?.textContent || "")
    .replace(/^Case:\s*/i, "")
    .trim();
  // Anchored to the known id, so a case truly named "2270 : x" survives.
  const name = /^\d+$/.test(String(caseIntID ?? ""))
    ? topbarLabel.replace(new RegExp(`^${caseIntID}(\\s*:\\s*|$)`), "")
    : topbarLabel;
  return name || "Unknown";
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ── what is being approved ──────────────────────────────────────────────────

// One panel per arch from caller-captured PNGs; a null arch says so rather than showing an
// empty frame. selectedShots() returns the same shape with unticked arches nulled.
export function buildShotsSection(shots, { title = "Files", noun = "file" } = {}) {
  const section = el("section", "cn-approve-section");
  section.appendChild(el("h4", "cn-approve-section-title", title));

  const boxes = {};
  const wrap = el("div", "cn-approve-shots");
  for (const [jaw, label] of [["upper", "Upper"], ["lower", "Lower"]]) {
    const figure = el("figure", "cn-approve-shot");

    // The caption is the checkbox's label, so the whole "Upper"/"Lower" line
    // toggles whether that render is sent.
    const caption = el("label", "cn-approve-shot-label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cn-approve-shot-check";
    // An arch with no render has nothing to attach, so its box is inert.
    box.checked = !!shots?.[jaw];
    box.disabled = !shots?.[jaw];
    box.setAttribute("aria-label", `Attach the ${label.toLowerCase()} render to the email`);
    boxes[jaw] = box;
    caption.appendChild(box);
    caption.appendChild(el("span", null, label));
    figure.appendChild(caption);

    const frame = el("div", "cn-approve-shot-frame");
    if (shots?.[jaw]) {
      const img = document.createElement("img");
      img.className = "cn-approve-shot-img";
      img.src = shots[jaw];
      img.alt = `${label} ${noun}`;
      frame.appendChild(img);
    } else {
      frame.appendChild(
        el("p", "cn-approve-shot-empty", `No ${label.toLowerCase()} ${noun}.`)
      );
    }
    figure.appendChild(frame);
    wrap.appendChild(figure);
  }

  section.appendChild(wrap);
  return {
    section,
    selectedShots: () => ({
      upper: boxes.upper.checked ? shots?.upper || null : null,
      lower: boxes.lower.checked ? shots?.lower || null : null,
    }),
  };
}

// ── uploaded attachments ────────────────────────────────────────────────────

// Anything wider is re-encoded first: a phone photo is thousands of pixels and travels as
// base64, where one alone outweighs the rest of the message.
const ATTACHMENT_MAX_WIDTH = 1200;

// `images` is the only payload slot taking a file, so an attachment must BE an image.
// Anything else is refused with a reason rather than silently dropped.
const ATTACHMENT_ACCEPT = "image/*";

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

// One picked file as an { src, alt } attachment. Wide ones are redrawn as JPEG on a WHITE
// ground — a transparent PNG renders black in some mail clients.
async function fileToAttachment(file) {
  const src = await readFileDataUrl(file);
  const img = await loadImage(src);
  if (img.naturalWidth <= ATTACHMENT_MAX_WIDTH) return { src, alt: file.name };

  const canvas = document.createElement("canvas");
  canvas.width = ATTACHMENT_MAX_WIDTH;
  canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * ATTACHMENT_MAX_WIDTH);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL("image/jpeg", 0.9), alt: file.name };
}

// The upload tile plus a strip of what has been added (click or drop, removable).
// attachments() is read at SEND time, so files can change without reopening the dialog.
export function buildAttachmentsSection() {
  const section = el("section", "cn-approve-section");
  section.appendChild(el("h4", "cn-approve-section-title", "Attach files"));

  const items = [];

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ATTACHMENT_ACCEPT;
  input.multiple = true;
  input.className = "cn-approve-attach-input";

  const drop = el("button", "cn-approve-attach-drop");
  drop.type = "button";
  drop.innerHTML = '<i class="fa fa-cloud-arrow-up" aria-hidden="true"></i>';
  drop.appendChild(el("span", "cn-approve-attach-drop-text", "Upload files"));
  drop.appendChild(el("span", "cn-approve-attach-drop-hint", "Drag & drop or click to browse"));

  const list = el("div", "cn-approve-attach-list");
  const status = el("p", "cn-approve-attach-status");
  status.setAttribute("aria-live", "polite");

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  const renderList = () => {
    list.innerHTML = "";
    for (const item of items) {
      const tile = el("figure", "cn-approve-attach-tile");
      const img = document.createElement("img");
      img.className = "cn-approve-attach-thumb";
      img.src = item.src;
      img.alt = item.alt;
      tile.appendChild(img);

      const remove = el("button", "cn-approve-attach-remove", "×");
      remove.type = "button";
      remove.title = `Remove ${item.alt}`;
      remove.setAttribute("aria-label", `Remove ${item.alt}`);
      remove.addEventListener("click", () => {
        items.splice(items.indexOf(item), 1);
        renderList();
        setStatus(items.length ? `${items.length} file(s) attached.` : "");
      });
      tile.appendChild(remove);

      tile.appendChild(el("figcaption", "cn-approve-attach-name", item.alt));
      list.appendChild(tile);
    }
  };

  const add = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    setStatus("Reading…");

    const read = await Promise.all(
      images.map((file) =>
        fileToAttachment(file).catch((err) => {
          console.warn("[caseNote] attachment failed", file.name, err);
          return null;
        })
      )
    );
    items.push(...read.filter(Boolean));
    renderList();
    // The strip sits below the fold in the two-column layout, so a file added above would
    // otherwise land out of sight and read as nothing having happened.
    status.scrollIntoView({ block: "nearest" });

    // Says what was left out and why, rather than silently attaching fewer than picked.
    // Wrong-kind and failed-to-decode are counted apart.
    const notes = [];
    const rejected = files.length - images.length;
    const failed = images.length - read.filter(Boolean).length;
    if (rejected) notes.push(`${rejected} skipped — images only`);
    if (failed) notes.push(`${failed} couldn't be read`);
    const attached = `${items.length} file(s) attached.`;
    setStatus(notes.length ? `${attached} ${notes.join("; ")}.` : attached, notes.length > 0);
  };

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    add(input.files);
    // Cleared so picking the same file twice in a row still fires `change`.
    input.value = "";
  });

  // Drag & drop, matching the 3D preview's slot rows. dragover must be cancelled
  // or the browser navigates to the dropped file instead.
  drop.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-over");
    add(e.dataTransfer?.files);
  });

  section.appendChild(drop);
  section.appendChild(input);
  section.appendChild(list);
  section.appendChild(status);

  return { section, attachments: () => items.map((i) => ({ src: i.src, alt: i.alt })) };
}

// ── who is on the case ──────────────────────────────────────────────────────

// The roster as checkboxes — this IS the recipient picker. selectedRecipients() is read by
// the email section at send time, so the two stay decoupled.
export function buildRecipientsSection(caseIntID) {
  const section = el("section", "cn-approve-section");
  section.appendChild(el("h4", "cn-approve-section-title", "Users on this case"));

  const list = el("div", "cn-approve-users");
  list.appendChild(el("p", "cn-approve-users-state", "Loading users…"));
  section.appendChild(list);

  const boxes = [];

  (async () => {
    const { ok, users } = await fetchCaseUsersWithEmails(caseIntID);
    list.innerHTML = "";
    if (!ok) {
      list.appendChild(
        el("p", "cn-approve-users-state is-error", "Couldn't load the users on this case.")
      );
      return;
    }
    if (!users.length) {
      list.appendChild(el("p", "cn-approve-users-state", "No users found on this case."));
      return;
    }
    for (const user of users) {
      const hasEmail = EMAIL_RE.test(user.email);
      const row = el("label", "cn-approve-user is-pick");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "cn-approve-user-check";
      // Pre-selected when reachable: the point of the list is to notify the case,
      // so opting someone out should be the deliberate action.
      box.checked = hasEmail;
      box.disabled = !hasEmail;
      box.dataset.email = user.email || "";
      // Carried so the email can open with this user's name.
      box.dataset.username = user.username || "";
      box.setAttribute("aria-label", `Email ${user.username}`);
      row.appendChild(box);
      boxes.push(box);

      // Name + role on top, address underneath: side by side they fight over a
      // 280px column and both end up ellipsed.
      const text = el("span", "cn-approve-user-text");
      const nameRow = el("span", "cn-approve-user-name");
      nameRow.appendChild(el("span", "cn-approve-user-username", user.username));
      const badge = el("span", "cn-approve-user-role", roleLabel(user.role));
      if (String(user.role || "").toLowerCase() === "owner") badge.classList.add("is-owner");
      nameRow.appendChild(badge);
      text.appendChild(nameRow);
      // Says why a box is disabled, rather than leaving it looking broken: the
      // username lookup found no address for this user.
      text.appendChild(
        el("span", "cn-approve-user-email", hasEmail ? user.email : "no address available")
      );
      row.appendChild(text);
      if (!hasEmail) row.classList.add("is-unreachable");

      list.appendChild(row);
    }
  })();

  return {
    section,
    // { email, username } per tick — the username is what the mail greets.
    selectedRecipients: () =>
      boxes
        .filter((b) => b.checked && !b.disabled)
        .map((b) => ({ email: b.dataset.email, username: b.dataset.username })),
  };
}

// ── custom email + send ─────────────────────────────────────────────────────

// The mail's title block, above everything else in the body.
function emailTitleHtml(text) {
  return (
    `<h2 style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:18px;` +
    `font-weight:600;">${emailBodyHtml([text])}</h2>`
  );
}

function escapeAttr(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
  );
}

// The renders, labelled by alt, for the middle of the body. Same data: URIs the
// mailer's own `images` block uses — inlined here only so they sit above the text.
export function emailImagesHtml(images) {
  return (images || [])
    .filter((image) => image?.src)
    .map(
      (image) =>
        `<b>${emailBodyHtml([image.alt || "Attachment"])}:</b><br>` +
        `<img src="${escapeAttr(image.src)}" alt="${escapeAttr(image.alt)}"` +
        ` style="max-width:100%;height:auto;display:block;margin:4px 0 16px;">`
    )
    .join("\n");
}

// THE email body, shared by both approval dialogs — edit the wording here only. Images are
// INLINED, not passed as `images`: that payload is what forces them below the text.
export function caseEmailBody(caseIntID, { recipient, link, images } = {}) {
  const sender = getLoggedInUser()?.username || "";
  const lines = [];
  if (recipient?.username) lines.push(`Hi ${recipient.username}`, "");
  lines.push(
    "Here is the:",
    { html: emailLinkHtml(link) },
    "",
    "Please confirm if it is ok to go on?",
    "",
    "Thanks"
  );
  if (sender) lines.push("", `Sent by ${sender}.`);
  return [
    emailTitleHtml(resolveCaseLabel(caseIntID)),
    emailImagesHtml(images),
    emailBodyHtml(lines),
  ]
    .filter(Boolean)
    .join("\n");
}

// One request per { email, username } since /sendCustomEmail takes a single recipient; a
// failed address doesn't sink the rest. `subject` defaults to the case alone.
export async function sendCaseEmails(
  caseIntID,
  recipients,
  { link, images = [], subject = resolveCaseLabel(caseIntID) } = {}
) {
  if (!recipients?.length) return 0;

  const sendOne = async (recipient) => {
    const email = recipient.email;
    const message = caseEmailBody(caseIntID, { recipient, link, images });
    if (await sendCustomEmail({ email, subject, message })) return true;
    // The images make the request many times larger, so a failure is retried
    // text-only: a notification without the renders beats no notification.
    if (!images.length) return false;
    return sendCustomEmail({
      email,
      subject,
      message: caseEmailBody(caseIntID, { recipient, link }),
    });
  };

  const results = await Promise.all(recipients.map(sendOne));
  return results.filter(Boolean).length;
}

// Send reaches the checked users AND the typed address; pendingRecipients is those not yet
// mailed, so pressing Send first can't double-send. `sendButton` false drops the button.
export function buildEmailSection({
  caseIntID,
  selectedRecipients,
  images,
  link,
  subject,
  sendButton = true,
}) {
  const section = el("section", "cn-approve-section");
  section.appendChild(el("h4", "cn-approve-section-title", "Send email"));

  const row = el("div", "cn-approve-message-row");

  const input = document.createElement("input");
  input.type = "email";
  input.className = "cn-approve-email-input";
  input.placeholder = "Add another email address";
  input.autocomplete = "email";
  input.setAttribute("aria-label", "Email address");
  row.appendChild(input);
  section.appendChild(row);

  // Addresses this dialog has already mailed, so approving afterwards doesn't
  // send the same person a second copy. Stays empty without the Send button.
  const alreadySent = new Set();

  // Deduped BY ADDRESS, keeping the ticked copy: it carries the username the mail greets,
  // where a typed address is just an address.
  const chosen = () => {
    const typed = input.value.trim();
    const byEmail = new Map(selectedRecipients().map((r) => [r.email, r]));
    if (typed && EMAIL_RE.test(typed) && !byEmail.has(typed)) {
      byEmail.set(typed, { email: typed, username: "" });
    }
    return [...byEmail.values()];
  };

  if (sendButton) {
    const side = el("div", "cn-approve-message-side");
    const sendBtn = el("button", "cn-approve-send-btn", "Send Email");
    sendBtn.type = "button";
    const status = el("span", "cn-approve-send-status");
    status.setAttribute("aria-live", "polite");
    side.appendChild(sendBtn);
    side.appendChild(status);
    row.appendChild(side);

    const setStatus = (text, isError = false) => {
      status.textContent = text;
      status.classList.toggle("is-error", isError);
    };

    const send = async () => {
      const typed = input.value.trim();
      if (typed && !EMAIL_RE.test(typed)) {
        setStatus("Enter a valid email address.", true);
        input.focus();
        return;
      }
      const recipients = chosen();
      if (!recipients.length) {
        setStatus("Pick a user or enter an address.", true);
        return;
      }

      sendBtn.disabled = true;
      setStatus("Sending…");
      const sent = await sendCaseEmails(caseIntID, recipients, {
        link: link(),
        images: images(),
        subject,
      });
      sendBtn.disabled = false;

      if (sent === recipients.length) {
        for (const r of recipients) alreadySent.add(r.email);
        setStatus(`Sent to ${sent}.`);
        toast.success(`Email sent to ${recipients.map((r) => r.email).join(", ")}.`);
        input.value = "";
      } else if (sent) {
        // Which of them succeeded isn't reported per address, so none are marked
        // sent: approving may re-send, which beats silently dropping a recipient.
        setStatus(`Sent to ${sent} of ${recipients.length}.`, true);
        toast.warning(`Email failed for ${recipients.length - sent} recipient(s).`);
      } else {
        setStatus("Send failed.", true);
        toast.error("Couldn't send the email.");
      }
    };

    sendBtn.addEventListener("click", send);
    // Enter in the field sends, but must not reach the dialog's Approve button.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      send();
    });
  } else {
    // Nothing to send from here, but Enter must still be swallowed — otherwise
    // it reaches the dialog and confirms from inside the address field.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  return {
    section,
    pendingRecipients: () => chosen().filter((r) => !alreadySent.has(r.email)),
  };
}

// ── entry point ─────────────────────────────────────────────────────────────

// Resolves { confirmed, recipients, images }, not a boolean: the caller mails those only
// after the note and status writes land, so a failed approval is never announced.
export async function confirmCaseNoteApproval({
  caseIntID,
  caseNumber,
  statusLabel,
  shots = null,
} = {}) {
  const content = el("div", "cn-approve");

  content.appendChild(
    el(
      "p",
      "cn-approve-lede",
      `Approving saves the case note, sets case ${caseNumber ?? caseIntID ?? "—"} to "${statusLabel}" and emails the ticked users. Everyone on the case sees the new status.`
    )
  );

  // Design left, recipients right, so the arches stay in view while the message is
  // written. Collapses to one column when the dialog is too narrow to split.
  const cols = el("div", "cn-approve-cols");
  const renders = buildShotsSection(shots, { title: "2D design", noun: "arch design" });
  const uploads = buildAttachmentsSection();
  const main = el("div", "cn-approve-main");
  main.appendChild(renders.section);
  main.appendChild(uploads.section);
  cols.appendChild(main);

  // Everything that goes out with the mail: the ticked arches first, then the
  // uploads, in the order they were added.
  const images = () => [
    { src: renders.selectedShots().upper, alt: "Upper arch design" },
    { src: renders.selectedShots().lower, alt: "Lower arch design" },
    ...uploads.attachments(),
  ].filter((image) => !!image.src);

  const recipients = buildRecipientsSection(caseIntID);
  const email = buildEmailSection({
    caseIntID,
    selectedRecipients: recipients.selectedRecipients,
    images,
    // This dialog only ever runs on the 2D annotation page, so the page's own
    // URL already carries the right host and the encrypted `id` param.
    link: () => window.location.href,
  });
  const side = el("div", "cn-approve-side");
  side.appendChild(recipients.section);
  side.appendChild(email.section);
  cols.appendChild(side);

  content.appendChild(cols);

  const confirmed = await confirmModal({
    title: "Approve 2D design?",
    confirmText: "Approve",
    cancelText: "Cancel",
    variant: "warning",
    size: "lg",
    content,
  });

  // Read the ticks before the dialog's DOM goes away, and only when approving —
  // cancelling sends nothing.
  return {
    confirmed,
    recipients: confirmed ? email.pendingRecipients() : [],
    images: confirmed ? images() : [],
  };
}
