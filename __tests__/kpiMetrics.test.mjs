/**
 * src/js/shared/kpiMetrics.js — the numbers behind the Case KPIs page.
 */
import { kpiRows, periodWindow, unreadCaseIdsOf } from "../src/js/shared/kpiMetrics.js";

const NOW = new Date(2026, 9, 13, 12, 0).getTime(); // 13 Oct 2026, noon local
const day = (offset, hour = 9) => new Date(2026, 9, 13 + offset, hour).getTime();
const midnight = (offset) => new Date(2026, 9, 13 + offset).getTime();

const mk = (id, created, extra = {}) => ({ id, case_id: `C${id}`, creation_date: created, username: "me", ...extra });
const CASES = [
  mk(1, day(0), { new_status: "Draft", last_updated: day(0) }),
  mk(2, day(-3), { new_status: "2D design drafted", expected_date: day(0), last_updated: day(-20) }),
  mk(3, day(-8), { new_status: "3D design approved", expected_date: day(-2) }),
  mk(4, day(-10), { new_status: "Completed", expected_date: day(0), last_updated: day(-30) }),
  mk(5, day(-40), { new_status: null, last_updated: day(-1) }),
  mk(6, day(-2)), // details not fetched yet
  { id: 7, case_id: "C7", username: "other", new_status: "Delivered", expected_date: day(0) }, // undated
];

const rowsFor = (opts = {}) =>
  Object.fromEntries(
    kpiRows(CASES, { username: "me", days: 7, now: NOW, ...opts }).map((k) => [k.id, k])
  );

describe("periodWindow", () => {
  test("the current window runs from midnight `days - 1` days ago through now", () => {
    expect(periodWindow(7, 0, NOW)).toEqual({ start: midnight(-6), end: NOW + 1 });
  });

  test("earlier windows sit back to back before it", () => {
    expect(periodWindow(7, 1, NOW)).toEqual({ start: midnight(-13), end: midnight(-6) });
    expect(periodWindow(1, 1, NOW)).toEqual({ start: midnight(-1), end: midnight(0) });
  });
});

describe("kpiRows — date-based metrics", () => {
  const k = rowsFor();

  test("all cases: previous counts cases that existed before this period", () => {
    expect(k.all).toMatchObject({ value: 7, previous: 4, baseline: true });
    expect(k.all.trend.at(-1)).toBe(7);
    expect(k.all.trend.at(-2)).toBe(4);
  });

  test("cases created: this period vs the one before, with a 7-period trend", () => {
    expect(k.created).toMatchObject({ label: "Cases created in the last 7 days", value: 3, previous: 2 });
    expect(k.created.trend).toEqual([0, 1, 0, 0, 0, 2, 3]);
  });

  test("cases updated counts last_updated in this period and has no history", () => {
    expect(k.updated).toMatchObject({ value: 2, previous: null, trend: null });
  });

  test("the Today period compares with yesterday", () => {
    const today = rowsFor({ days: 1 });
    expect(today.created).toMatchObject({ label: "Cases created today", value: 1, previous: 0 });
  });
});

describe("kpiRows — snapshot metrics", () => {
  const k = rowsFor({ pinnedIds: new Set(["1", "7", "99"]), unreadCaseIds: new Set(["2"]) });

  test("status counts", () => {
    expect(k.draft.value).toBe(1);
    expect(k.needsAction.value).toBe(1);
    expect(k.ready.value).toBe(1);
    expect(k.completed.value).toBe(1);
    expect(k.production.value).toBe(1);
  });

  test("deadlines skip completed and delivered cases", () => {
    expect(k.dueToday.value).toBe(1);
    expect(k.overdue.value).toBe(1);
  });

  test("stale = open with no update for 14 days, falling back to the creation date", () => {
    expect(k.stale.value).toBe(1);
  });

  test("cases without a status leave out the ones still loading", () => {
    expect(k.noStatus.value).toBe(1);
  });

  test("ownership, pins and unread updates", () => {
    expect(k.owned.value).toBe(6);
    expect(k.shared.value).toBe(1);
    expect(k.pinned).toMatchObject({ value: 2, device: true });
    expect(k.unread.value).toBe(1);
  });

  test("snapshots carry no previous value or trend", () => {
    expect(k.overdue).toMatchObject({ previous: null, trend: null, needsDetails: true });
  });

  test("unread is null until the alerts load; jaw counts have no source", () => {
    const none = rowsFor();
    expect(none.unread.value).toBeNull();
    for (const id of ["upper", "lower", "dual"]) expect(none[id]).toMatchObject({ value: null, unavailable: true });
  });
});

test("unreadCaseIdsOf keeps unread alerts that name a case", () => {
  const alerts = [
    { case_int_id: 2, read_status: 0 },
    { case_int_id: 3, read_status: 1 },
    { case_int_id: 0, read_status: 0 },
    { case_int_id: 4, read_status: "0" },
  ];
  expect([...unreadCaseIdsOf(alerts)]).toEqual(["2", "4"]);
});
