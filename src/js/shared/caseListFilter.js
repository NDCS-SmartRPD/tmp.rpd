// The dashboard's "View all" links and the case list share this: a link carries
// what a dashboard card counts in the case list URL, and the case list reads it
// back and shows just those cases.
//   status=2d_design_pending,…  exact statuses (the case list's status values)
//   days=N                      created in the last N days (the dashboard period)
//   scope=owned|shared          the dashboard's Cases filter

import { normalizeStatus, statusLabel } from "./apiLog.js";
import { createdWithin, isOwnedBy } from "./caseStats.js";

const SCOPES = new Set(["owned", "shared"]);

// The case list URL for a filter; the bare page when nothing is filtered.
export function caseListHref({ statuses = null, days = null, scope = "all" } = {}, page = "./case_list.html") {
  const params = new URLSearchParams();
  if (statuses?.length) params.set("status", statuses.join(","));
  if (days != null) params.set("days", String(days));
  if (SCOPES.has(scope)) params.set("scope", scope);
  const query = params.toString();
  return query ? `${page}?${query}` : page;
}

// The filter in a case list URL's query string, or null when it carries none.
export function parseCaseListFilter(search) {
  const params = new URLSearchParams(search);
  const statuses = (params.get("status") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const days = Number(params.get("days"));
  const scope = params.get("scope");
  const filter = {
    statuses: statuses.length ? statuses : null,
    days: Number.isInteger(days) && days > 0 ? days : null,
    scope: SCOPES.has(scope) ? scope : null,
  };
  return filter.statuses || filter.days || filter.scope ? filter : null;
}

// Whether a case is one the filter keeps — the same rules the dashboard counts by.
export function matchesCaseListFilter(filter, caseObj, username, now = Date.now()) {
  if (!filter) return true;
  if (filter.statuses && !filter.statuses.includes(normalizeStatus(caseObj?.new_status))) return false;
  if (filter.days && !createdWithin(caseObj, filter.days, now)) return false;
  if (filter.scope && isOwnedBy(caseObj, username) !== (filter.scope === "owned")) return false;
  return true;
}

// "2D design pending, drafted or approved · created in the last 30 days · owned by me".
export function caseListFilterText(filter) {
  if (!filter) return "";
  const parts = [];
  if (filter.statuses) parts.push(statusesText(filter.statuses));
  if (filter.days) parts.push(filter.days === 1 ? "created today" : `created in the last ${filter.days} days`);
  if (filter.scope) parts.push(filter.scope === "owned" ? "owned by me" : "shared with me");
  return parts.join(" · ");
}

// Status titles with their shared leading words said once.
function statusesText(statuses) {
  const words = statuses.map((s) => statusLabel(s).split(" "));
  let shared = 0;
  while (words.every((w) => w.length > shared + 1 && w[shared] === words[0][shared])) shared += 1;
  const tails = words.map((w) => w.slice(shared).join(" "));
  const list = tails.length > 1 ? `${tails.slice(0, -1).join(", ")} or ${tails.at(-1)}` : tails[0];
  return [...words[0].slice(0, shared), list].join(" ");
}
