// File counts for the profile and dashboard pages, per case: the jaw STLs
// (SmartRPD 3D), the files in its four extra 3D slots (third-party 3D) and its
// 2D design .txt files from /jawstruct/l2/getall; uploaded scans are the STLs.
// The server has no count for these, so each case is checked with its own
// requests, one case at a time (the backend 403s bursts). Results are kept per
// case in this browser and re-checked when the case's last_updated changes.

import { decodeJawStructResponse, decodedJawMaterial } from "../2D/jawStructCodec.js";
import { API_BASE, callerIdentity, getLoggedInUser } from "./api.js";
import { logApi } from "./apiLog.js";
import { caseIntIdOf } from "./caseEnrichment.js";

const EXTRA_STL_SLOTS = [1, 2, 3, 4];
// Enough of a full slot's reply to see its `data` field.
const PROBE_HEAD_BYTES = 64 * 1024;

const cacheKey = (uuid) => `caseFiles_cache_${uuid}`;

function readCache(uuid) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(uuid)) || "{}") || {};
  } catch {
    return {};
  }
}

function writeCache(uuid, cache) {
  try {
    localStorage.setItem(cacheKey(uuid), JSON.stringify(cache));
  } catch {
    /* quota or blocked storage — the next visit just checks again */
  }
}

// A burst refusal: stop, and pick up on the next visit. (A refusal can also
// arrive without CORS headers, which fetch throws as a network error.)
const refused = (res) => res.status === 403 || res.status === 429;

const postCase = (path, caseIntId, payload) =>
  fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([callerIdentity({ caseIntID: caseIntId }), ...(payload ? [payload] : [])]),
  });

// The first `maxBytes` of a reply, then the rest is cancelled. Same as the case
// list's readResponseHead.
async function readHead(res, maxBytes) {
  const reader = res.body?.getReader?.();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let head = "";
  let read = 0;
  try {
    while (read < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      read += value.byteLength;
      head += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return head;
}

// Whether an extra slot holds a file. /stl/slot/get streams back the whole STL,
// so only the head is read.
async function slotHasFile(caseIntId, slotNumber) {
  const res = await postCase("/stl/slot/get", caseIntId, { slotNumber });
  if (refused(res)) throw new Error(`HTTP ${res.status}`);
  if (!res.ok) return false; // 404 = empty slot
  return /"data"\s*:\s*"[^"]/.test(await readHead(res, PROBE_HEAD_BYTES));
}

// Upper and lower jaw STLs, from the process_upper / process_lower flags the
// case was created with. /case/get/:id is asked only when the list row lacks them.
async function jawStlCount(caseObj, caseIntId) {
  let row = caseObj;
  if (row.process_upper === undefined) {
    const res = await postCase(`/case/get/${caseIntId}`, caseIntId);
    logApi(res, "POST /case/get/:id");
    if (refused(res)) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) return 0;
    row = await res.json();
  }
  return (Number(row?.process_upper) ? 1 : 0) + (Number(row?.process_lower) ? 1 : 0);
}

// 2D design files: the .txt jaw structs saved for the case (one per jaw, about
// 45 KB each, so the whole reply is read), and the denture-base material they
// were saved with, which names the framework slots (null without a design).
async function checkDesigns(caseIntId) {
  const res = await postCase("/jawstruct/l2/getall", caseIntId, { case_id: caseIntId });
  if (refused(res)) throw new Error(`HTTP ${res.status}`);
  if (!res.ok) return { designs: 0, material: null }; // 404 = no design saved
  const records = await res.json().catch(() => null);
  if (!Array.isArray(records)) return { designs: 0, material: null };
  const files = records.filter((r) => /\.txt$/i.test(r?.filename || "") && r.data);
  return { designs: files.length, material: decodedJawMaterial(decodeJawStructResponse(files)) };
}

// { jaws: 0–2, slots: extra slot numbers holding a file, designs: 2D .txt
// files, material: 0 metal / 2 full acrylic / null }.
async function checkCase(caseObj) {
  const id = caseIntIdOf(caseObj);
  const jaws = await jawStlCount(caseObj, id);
  const slots = [];
  for (const slot of EXTRA_STL_SLOTS) {
    if (await slotHasFile(id, slot)) slots.push(slot);
  }
  const { designs, material } = await checkDesigns(id);
  return { jaws, slots, designs, material };
}

// Sets case_files on each case, from the cache when the case hasn't changed since
// it was checked, and calls onUpdate as results come in. Stops at the first
// refusal; cases left without case_files are checked on the next visit.
export async function loadCaseFiles(cases, { onUpdate = () => {} } = {}) {
  const uuid = getLoggedInUser()?.uuid;
  if (!uuid) return;
  const cache = readCache(uuid);
  const toCheck = [];
  for (const c of cases) {
    const hit = cache[caseIntIdOf(c)];
    // Entries saved before the material was recorded are checked again.
    const current = hit?.files && hit.files.material !== undefined;
    if (current && String(hit.updated) === String(c.last_updated)) c.case_files = hit.files;
    else toCheck.push(c);
  }
  onUpdate();

  for (const c of toCheck) {
    try {
      c.case_files = await checkCase(c);
    } catch (err) {
      console.warn("[caseFiles] stopped; unchecked cases wait for the next visit", err);
      break;
    }
    cache[caseIntIdOf(c)] = { files: c.case_files, updated: c.last_updated };
    writeCache(uuid, cache);
    onUpdate();
  }
}
