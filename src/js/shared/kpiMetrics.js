// Case KPIs for src/pages/case_kpis.html (KpiTable.tsx in the "Create User
// Profile Dashboard" prototype), computed from the signed-in user's case list.
// Pure: no DOM, no fetches.
//
// The server keeps no status history, so only the date-based metrics (all
// cases by creation date, cases created) have a previous value and a trend.
// Every other metric is a snapshot of now, with `previous` and `trend` null.

import { normalizeStatus } from "./apiLog.js";
import { timestampToMs, toDayMidnight } from "./timestamps.js";
import { caseStats, dueDateMs, stageOf } from "./caseStats.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
export const TREND_PERIODS = 7;

// Window k of `days` days counting back from now, as [start, end): k = 0 is
// the current window (today counts as day 1, as on the dashboard), k = 1 the
// one before it, and so on.
export function periodWindow(days, k, now = Date.now()) {
  const currentStart = toDayMidnight(now) - (days - 1) * DAY_MS;
  const start = currentStart - k * days * DAY_MS;
  return { start, end: k === 0 ? now + 1 : start + days * DAY_MS };
}

const inWindow = (ms, w) => ms != null && ms >= w.start && ms < w.end;

// The case list keys pins by `id ?? case_int_id`; alerts carry case_int_id.
const pinKey = (c) => String(c.id ?? c.case_int_id);
const alertKey = (c) => String(c.case_int_id ?? c.id);

// Not finished: completed and delivered cases have no deadline left to miss.
function isOpen(c) {
  return stageOf(c.new_status) !== "completed" && normalizeStatus(c.new_status) !== "delivered";
}

// Rows in table order. `value` is null when there is no data source yet
// (`unavailable`), or for unread updates until the alerts have loaded.
// `needsDetails` marks values that depend on per-case status details.
export function kpiRows(cases, { username, days, now = Date.now(), pinnedIds = new Set(), unreadCaseIds = null } = {}) {
  const windows = Array.from({ length: TREND_PERIODS }, (_, i) => periodWindow(days, TREND_PERIODS - 1 - i, now));
  const [current, previous] = [windows.at(-1), windows.at(-2)];
  const created = cases.map((c) => timestampToMs(c.creation_date));
  const createdIn = (w) => created.filter((ms) => inWindow(ms, w)).length;
  // Cases that existed by `end`; undated cases count as always there.
  const existedBy = (end) => created.filter((ms) => ms == null || ms < end).length;

  const s = caseStats(cases, username, now);
  const today = toDayMidnight(now);
  const staleBefore = now - STALE_DAYS * DAY_MS;
  let draft = 0, ready = 0, dueToday = 0, stale = 0, updated = 0, pinned = 0, unread = 0;
  for (const c of cases) {
    const status = normalizeStatus(c.new_status);
    if (status === "draft") draft += 1;
    if (status === "3d_design_approved") ready += 1;
    if (isOpen(c)) {
      if (toDayMidnight(dueDateMs(c)) === today) dueToday += 1;
      const touched = timestampToMs(c.last_updated ?? c.creation_date);
      if (touched != null && touched < staleBefore) stale += 1;
    }
    if (inWindow(timestampToMs(c.last_updated), current)) updated += 1;
    if (pinnedIds.has(pinKey(c))) pinned += 1;
    if (unreadCaseIds?.has(alertKey(c))) unread += 1;
  }

  const period = days === 1 ? "today" : `in the last ${days} days`;
  const row = (id, label, group, value, extra = {}) => ({ id, label, group, value, previous: null, trend: null, tone: "neutral", ...extra });
  const details = { needsDetails: true };
  return [
    row("all", "All cases", "Volume", cases.length, {
      previous: existedBy(current.start),
      trend: windows.map((w, i) => (i === windows.length - 1 ? cases.length : existedBy(w.end))),
      baseline: true,
    }),
    row("created", `Cases created ${period}`, "Volume", createdIn(current), {
      previous: createdIn(previous),
      trend: windows.map(createdIn),
      tone: "good",
    }),
    row("updated", `Cases updated ${period}`, "Volume", updated),
    row("preparation", "In preparation", "Status", s.preparation, details),
    row("draft", "Draft cases", "Status", draft, details),
    row("needsAction", "Needs action", "Status", s.needsAction, { ...details, tone: "warn" }),
    row("ready", "Ready for production", "Status", ready, { ...details, tone: "warn" }),
    row("production", "In production", "Status", s.delivery, details),
    row("completed", "Completed cases", "Status", s.completed, { ...details, tone: "good" }),
    row("dueToday", "Due today", "Deadlines", dueToday, { ...details, tone: "warn" }),
    row("due7", "Due in the next 7 days", "Deadlines", s.dueSoon, details),
    row("overdue", "Overdue cases", "Deadlines", s.overdue, { ...details, tone: "bad" }),
    row("stale", `Stale cases (no update ${STALE_DAYS}d)`, "Risk", stale, { ...details, tone: "bad" }),
    row("noStatus", "Cases without a status", "Risk", s.unset - s.withoutDetails, details),
    row("upper", "Upper-jaw cases", "Anatomy", null, { unavailable: true }),
    row("lower", "Lower-jaw cases", "Anatomy", null, { unavailable: true }),
    row("dual", "Dual-jaw cases", "Anatomy", null, { unavailable: true }),
    row("owned", "Cases owned by me", "My work", s.owned, details),
    row("shared", "Cases shared with me", "My work", s.shared, details),
    row("pinned", "Pinned cases", "My work", pinned, { device: true }),
    row("unread", "Cases with unread updates", "My work", unreadCaseIds ? unread : null, { tone: "warn", needsAlerts: true }),
  ];
}

// Case ids with at least one unread alert, keyed like alertKey().
export function unreadCaseIdsOf(alerts) {
  return new Set(alerts.filter((a) => Number(a.read_status) !== 1 && a.case_int_id).map((a) => String(a.case_int_id)));
}
