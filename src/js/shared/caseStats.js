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
    withoutDetails: 0,
    overdue: 0,
    dueSoon: 0,
    scans: 0,
    jawStls: 0,
    extraStls: 0,
    designFiles: 0,
    filesPending: 0,
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
    // Files, set by caseFiles.js once the case is checked: jaw STLs (SmartRPD
    // 3D), extra-slot STLs (third-party 3D) and 2D design .txt files. Uploaded
    // scans are the STLs.
    if (c.case_files == null) {
      stats.filesPending += 1;
    } else {
      const { jaws, slots, designs } = c.case_files;
      stats.jawStls += jaws;
      stats.extraStls += slots.length;
      stats.scans += jaws + slots.length;
      stats.designFiles += designs;
    }
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

// The four extra 3D slots, named as the case list and 2D page name them
// (slotLabel there): framework slots 2 and 4 read "Monoblock" on a full-acrylic
// case and "Metal RPD" otherwise.
const SLOT_JAW_NAMES = { 1: "Upper jaw", 3: "Lower jaw" };
const FULL_ACRYLIC_MATERIAL = 2; // as in 2D/JawDesignProposal.js

// Files per extra slot over the checked cases, split by the cases' material.
export function slotStats(cases) {
  const rows = [1, 2, 3, 4].map((slot) => ({ slot, count: 0, metal: 0, acrylic: 0 }));
  for (const c of cases) {
    if (!c.case_files) continue;
    const acrylic = Number(c.case_files.material) === FULL_ACRYLIC_MATERIAL;
    for (const slot of c.case_files.slots) {
      const row = rows[slot - 1];
      if (!row) continue;
      row.count += 1;
      row[acrylic ? "acrylic" : "metal"] += 1;
    }
  }
  return rows;
}

// "Slot 1: Upper jaw", "Slot 2: Metal RPD"; a framework slot holding files from
// both kinds of case reads "Metal RPD / Monoblock".
export function slotLabel({ slot, metal = 0, acrylic = 0 }) {
  let name = SLOT_JAW_NAMES[slot];
  if (!name) name = !acrylic ? "Metal RPD" : metal ? "Metal RPD / Monoblock" : "Monoblock";
  return `Slot ${slot}: ${name}`;
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
