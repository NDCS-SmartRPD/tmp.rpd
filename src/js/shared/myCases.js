// The signed-in user's cases and notifications for the profile and dashboard
// pages. Reuses the case list's per-user cache (same key and shape as
// caseListCacheKey() in pages/caseManagement.js), so a visit after the case
// list costs one request; only cases the cache has no details for are fetched,
// at the case list's concurrency, and written back for the case list to reuse.

import { API_BASE, MACHINE_ID, getLoggedInUser } from "./api.js";
import { logApi } from "./apiLog.js";
import {
  ENRICH_CONCURRENCY,
  applyEnrichmentResponses,
  buildEnrichRequests,
  caseIntIdOf,
} from "./caseEnrichment.js";
import { hasDetails } from "./caseStats.js";

const DETAIL_FIELDS = ["expected_date", "new_status", "assigned_to", "comments", "tooth_shade", "co_owners"];

const cacheKey = (uuid) => `caseList_cache_${uuid}`;

function readCache(uuid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey(uuid)) || "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCache(uuid, cases) {
  try {
    // Same "__" stripping as the case list's saveCachedCases().
    localStorage.setItem(cacheKey(uuid), JSON.stringify(cases, (k, v) => (k.startsWith("__") ? undefined : v)));
  } catch {
    /* quota or blocked storage — the next visit just refetches */
  }
}

// Admin lists include soft-deleted cases; the flag's spelling varies.
function isDeleted(c) {
  const v = c?.deleted ?? c?.is_deleted ?? c?.isDeleted;
  return v === 1 || v === true || v === "1";
}

async function fetchBaseList(uuid) {
  const res = await fetch(`${API_BASE}/case/user/findall/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ machine_id: MACHINE_ID, uuid }, { uuid }]),
  });
  logApi(res, "POST /case/user/findall/get");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  // One entry per case: the server repeats a case for each role you hold on it.
  const seen = new Set();
  return data.filter((c) => {
    const key = String(caseIntIdOf(c) ?? c?.case_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Calls onUpdate(cases, state) as soon as the list is known and again as details
// arrive. state: { stale, pending } — stale when the server was unreachable and
// the cached list is shown; pending = cases still without details.
export async function loadMyCases({ onUpdate = () => {} } = {}) {
  const user = getLoggedInUser();
  if (!user?.uuid) return { cases: [], stale: true, pending: 0 };

  const cached = readCache(user.uuid);
  let cases;
  let stale = false;
  try {
    const base = await fetchBaseList(user.uuid);
    const prevById = new Map(cached.map((c) => [String(caseIntIdOf(c)), c]));
    for (const c of base) {
      const prev = prevById.get(String(caseIntIdOf(c)));
      if (!prev) continue;
      for (const k of DETAIL_FIELDS) if (c[k] === undefined && prev[k] !== undefined) c[k] = prev[k];
    }
    cases = base;
  } catch (err) {
    console.warn("[myCases] case list unavailable, showing the cached copy", err);
    cases = cached;
    stale = true;
  }
  cases = cases.filter((c) => !isDeleted(c));

  const queue = stale ? [] : cases.filter((c) => !hasDetails(c));
  const report = () => onUpdate(cases, { stale, pending: cases.filter((c) => !hasDetails(c)).length });
  report();

  // The backend 403s request bursts, so stop at the first refusal; whatever is
  // left shows as "still loading" and is retried on the next visit.
  let refused = false;
  const worker = async () => {
    while (queue.length && !refused) {
      const c = queue.shift();
      const [[detailUrl, detailOpts], [rolesUrl, rolesOpts]] = buildEnrichRequests(caseIntIdOf(c), user.uuid);
      const [detailRes, rolesRes] = await Promise.all([
        fetch(detailUrl, detailOpts).catch(() => null),
        fetch(rolesUrl, rolesOpts).catch(() => null),
      ]);
      if ([detailRes, rolesRes].some((r) => r && (r.status === 403 || r.status === 429))) {
        refused = true;
        break;
      }
      if (!(await applyEnrichmentResponses(c, detailRes, rolesRes, logApi))) {
        refused = true;
        break;
      }
      // No details row at all is the case list's N/A — record it so the case
      // isn't refetched on every visit.
      if (detailRes?.ok && !hasDetails(c)) c.new_status = null;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, queue.length) }, worker));

  if (!stale) writeCache(user.uuid, cases);
  return { cases, stale, pending: cases.filter((c) => !hasDetails(c)).length };
}

// Alerts addressed to the user on their own cases, newest first — the same
// request the notification bell makes.
export async function fetchMyAlerts(cases) {
  const user = getLoggedInUser();
  if (!user?.uuid) return [];
  const username = user.username || (user.email ? user.email.split("@")[0] : "");
  const ids = cases.map(caseIntIdOf).filter((id) => id != null);
  const res = await fetch(`${API_BASE}/alerts/getallbytouser`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([
      { machine_id: MACHINE_ID, uuid: user.uuid, caseIntID: ids[0] || 0 },
      { to_user: username },
    ]),
  });
  logApi(res, "POST /alerts/getallbytouser");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) return [];
  const idSet = new Set(ids.map(String));
  const byId = new Map();
  for (const a of list) {
    if (!a.case_int_id || idSet.has(String(a.case_int_id))) byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => b.id - a.id);
}
