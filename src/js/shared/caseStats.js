// Pure case-list math for the profile and dashboard pages: stages, design
// progress, ownership, due dates and creation buckets. No DOM, no fetches.
// Stage rules mirror STATUS_GROUPS in pages/caseManagement.js — keep in sync.

import { normalizeStatus } from "./apiLog.js";
import { timestampToMs, toDayMidnight } from "./timestamps.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// The case pipeline, in order: a case at index i has passed every step before it.
export const STATUS_ORDER = [
  "draft",
  "2d_design_pending",
  "2d_design_drafted",
  "2d_design_approved",
  "3d_design_pending",
  "3d_design_drafted",
  "3d_design_approved",
  "in_production",
  "out_for_delivery",
  "delivered",
  "completed",
];

const NEEDS_ACTION = new Set(["2d_design_pending", "2d_design_drafted", "3d_design_drafted"]);

// Position in STATUS_ORDER; -1 for N/A or an unknown status.
export function pipelineRank(apiStatus) {
  return STATUS_ORDER.indexOf(normalizeStatus(apiStatus));
}

// "preparation" (draft → 3D approved), "delivery" (in production → delivered),
// "completed", or "unset" for N/A — the case list's stage cards.
export function stageOf(apiStatus) {
  const rank = pipelineRank(apiStatus);
  if (rank < 0) return "unset";
  if (rank <= STATUS_ORDER.indexOf("3d_design_approved")) return "preparation";
  if (rank <= STATUS_ORDER.indexOf("delivered")) return "delivery";
  return "completed";
}

// Needs action is a subset of preparation, as on the case list.
export function needsAction(apiStatus) {
  return NEEDS_ACTION.has(normalizeStatus(apiStatus));
}

export const DESIGN_STATES = ["not_started", "pending", "in_progress", "done"];
export const DESIGN_STATE_LABELS = {
  not_started: "—",
  pending: "Pending",
  in_progress: "In progress",
  done: "Done",
};

const DESIGN_EXISTS = new Set(["in_progress", "done"]);

// How far the case is through its 2D or 3D design step: pending → drafted
// (in progress) → approved or any later status (done).
export function designState(apiStatus, step) {
  const pending = STATUS_ORDER.indexOf(step === "3d" ? "3d_design_pending" : "2d_design_pending");
  const rank = pipelineRank(apiStatus);
  if (rank < pending) return "not_started";
  if (rank === pending) return "pending";
  if (rank === pending + 1) return "in_progress";
  return "done";
}

// Whether the per-case details (status, due date, owner) have been fetched.
// Cases straight from /case/user/findall/get don't carry them.
export function hasDetails(caseObj) {
  return !!caseObj && "new_status" in caseObj;
}

export function caseOwner(caseObj) {
  return caseObj?.assigned_to || caseObj?.username || "";
}

export function isOwnedBy(caseObj, username) {
  return !!username && caseOwner(caseObj).toLowerCase() === String(username).toLowerCase();
}

export function dueDateMs(caseObj) {
  return timestampToMs(caseObj?.expected_date ?? caseObj?.due_date);
}

// Created within the last `days` days (today counts as day 1); null = all time.
export function createdWithin(caseObj, days, now = Date.now()) {
  if (days == null) return true;
  const created = timestampToMs(caseObj?.creation_date);
  if (created == null) return false;
  const start = toDayMidnight(now) - (days - 1) * DAY_MS;
  return created >= start && created <= now;
}

// The `days` days before that window, for "vs the previous period".
export function createdInPreviousWindow(caseObj, days, now = Date.now()) {
  const created = timestampToMs(caseObj?.creation_date);
  if (created == null || days == null) return false;
  const end = toDayMidnight(now) - (days - 1) * DAY_MS;
  return created >= end - days * DAY_MS && created < end;
}

export function caseStats(cases, username, now = Date.now()) {
  const stats = {
    total: 0,
    preparation: 0,
    needsAction: 0,
    delivery: 0,
    completed: 0,
    unset: 0,
    owned: 0,
    shared: 0,
    designs2d: 0,
    designs3d: 0,
    withoutDetails: 0,
    overdue: 0,
    dueSoon: 0,
  };
  const today = toDayMidnight(now);
  for (const c of cases) {
    stats.total += 1;
    if (!hasDetails(c)) stats.withoutDetails += 1;
    const stage = stageOf(c.new_status);
    stats[stage] += 1;
    if (needsAction(c.new_status)) stats.needsAction += 1;
    if (isOwnedBy(c, username)) stats.owned += 1;
    else stats.shared += 1;
    // A design exists once it has been drafted.
    if (DESIGN_EXISTS.has(designState(c.new_status, "2d"))) stats.designs2d += 1;
    if (DESIGN_EXISTS.has(designState(c.new_status, "3d"))) stats.designs3d += 1;
    const due = toDayMidnight(dueDateMs(c));
    if (due != null && stage !== "completed" && normalizeStatus(c.new_status) !== "delivered") {
      if (due < today) stats.overdue += 1;
      else if (due <= today + 7 * DAY_MS) stats.dueSoon += 1;
    }
  }
  return stats;
}

export function designStateCounts(cases, step) {
  const counts = Object.fromEntries(DESIGN_STATES.map((s) => [s, 0]));
  for (const c of cases) counts[designState(c.new_status, step)] += 1;
  return counts;
}

// Newest first by creation_date; cases without a date go last.
export function recentCases(cases, limit = 5) {
  return [...cases]
    .sort((a, b) => (timestampToMs(b.creation_date) ?? -Infinity) - (timestampToMs(a.creation_date) ?? -Infinity))
    .slice(0, limit);
}

// Cases created per bucket: one bucket per day for `days` days, or per month
// for the last 12 months when `days` is null (all time).
export function createdSeries(cases, days, now = Date.now()) {
  const buckets = [];
  if (days != null) {
    const first = toDayMidnight(now) - (days - 1) * DAY_MS;
    for (let i = 0; i < days; i++) buckets.push({ start: first + i * DAY_MS, count: 0 });
  } else {
    const d = new Date(now);
    for (let i = 11; i >= 0; i--) {
      buckets.push({ start: new Date(d.getFullYear(), d.getMonth() - i, 1).getTime(), count: 0 });
    }
  }
  for (const c of cases) {
    const created = timestampToMs(c.creation_date);
    if (created == null || created > now || created < buckets[0].start) continue;
    let i = buckets.length - 1;
    while (i > 0 && buckets[i].start > created) i -= 1;
    buckets[i].count += 1;
  }
  return buckets;
}
