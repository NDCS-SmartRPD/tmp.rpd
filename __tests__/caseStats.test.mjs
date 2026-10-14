/**
 * src/js/shared/caseStats.js — the case math behind the profile and dashboard
 * pages. Stage rules must match the case list's STATUS_GROUPS.
 */
import {
  caseStats,
  createdInPreviousWindow,
  createdSeries,
  createdWithin,
  designState,
  designStateCounts,
  needsAction,
  recentCases,
  stageOf,
} from "../src/js/shared/caseStats.js";

const NOW = new Date(2026, 9, 13, 12, 0).getTime(); // 13 Oct 2026, noon local
const day = (offset, hour = 9) => new Date(2026, 9, 13 + offset, hour).getTime();

describe("stageOf", () => {
  test.each([
    ["Draft", "preparation"],
    ["2D design pending", "preparation"],
    ["3D design approved", "preparation"],
    ["In production", "delivery"],
    ["out_for_delivery", "delivery"],
    ["Delivered", "delivery"],
    ["Completed", "completed"],
    [null, "unset"],
    ["", "unset"],
    ["something new", "unset"],
  ])("%s → %s", (status, stage) => {
    expect(stageOf(status)).toBe(stage);
  });
});

test("needs action is 2D pending/drafted and 3D drafted only", () => {
  expect(["2D design pending", "2D design drafted", "3D design drafted"].every(needsAction)).toBe(true);
  expect(["2D design approved", "3D design pending", "Draft", null].some(needsAction)).toBe(false);
});

describe("designState", () => {
  test.each([
    ["Draft", "not_started", "not_started"],
    ["2D design pending", "pending", "not_started"],
    ["2D design drafted", "in_progress", "not_started"],
    ["2D design approved", "done", "not_started"],
    ["3D design pending", "done", "pending"],
    ["3D design drafted", "done", "in_progress"],
    ["3D design approved", "done", "done"],
    ["Completed", "done", "done"],
    [null, "not_started", "not_started"],
  ])("%s → 2D %s, 3D %s", (status, twoD, threeD) => {
    expect(designState(status, "2d")).toBe(twoD);
    expect(designState(status, "3d")).toBe(threeD);
  });
});

describe("caseStats", () => {
  const cases = [
    { case_id: "A", username: "me", new_status: "2D design drafted", expected_date: day(-2) },
    { case_id: "B", assigned_to: "Me", new_status: "3D design drafted", expected_date: day(3) },
    { case_id: "C", assigned_to: "dr.tan", new_status: "In production", expected_date: day(-5) },
    { case_id: "D", assigned_to: "dr.tan", new_status: "Completed", expected_date: day(-9) },
    { case_id: "E", username: "me", new_status: null },
    { case_id: "F", username: "me" }, // details not fetched yet
  ];
  const s = caseStats(cases, "me", NOW);

  test("stages, needs action and N/A match the case list", () => {
    expect(s).toMatchObject({ total: 6, preparation: 2, delivery: 1, completed: 1, unset: 2, needsAction: 2 });
  });

  test("owner is case-insensitive and falls back to username", () => {
    expect(s).toMatchObject({ owned: 4, shared: 2 });
  });

  test("a design counts once it has been drafted", () => {
    expect(s).toMatchObject({ designs2d: 4, designs3d: 3 });
  });

  test("overdue and due-soon skip completed cases", () => {
    // A (2 days late) and C (5 days late) are overdue; D is completed; B is due in 3 days.
    expect(s).toMatchObject({ overdue: 2, dueSoon: 1 });
  });

  test("counts cases still waiting for details", () => {
    expect(s.withoutDetails).toBe(1);
  });

  test("2D design states add up to the case count", () => {
    const counts = designStateCounts(cases, "2d");
    expect(counts).toEqual({ not_started: 2, pending: 0, in_progress: 1, done: 3 });
  });
});

describe("period windows", () => {
  test("last N days includes today and N-1 days back", () => {
    expect(createdWithin({ creation_date: day(0) }, 7, NOW)).toBe(true);
    expect(createdWithin({ creation_date: day(-6) }, 7, NOW)).toBe(true);
    expect(createdWithin({ creation_date: day(-7) }, 7, NOW)).toBe(false);
    expect(createdWithin({ creation_date: day(-400) }, null, NOW)).toBe(true);
    expect(createdWithin({}, 7, NOW)).toBe(false);
  });

  test("the previous window is the N days before that", () => {
    expect(createdInPreviousWindow({ creation_date: day(-7) }, 7, NOW)).toBe(true);
    expect(createdInPreviousWindow({ creation_date: day(-13) }, 7, NOW)).toBe(true);
    expect(createdInPreviousWindow({ creation_date: day(-14) }, 7, NOW)).toBe(false);
    expect(createdInPreviousWindow({ creation_date: day(-3) }, 7, NOW)).toBe(false);
  });

  test("accepts Unix seconds as the backend sends them", () => {
    expect(createdWithin({ creation_date: Math.floor(day(-1) / 1000) }, 7, NOW)).toBe(true);
  });
});

describe("createdSeries", () => {
  test("one bucket per day, oldest first", () => {
    const series = createdSeries(
      [{ creation_date: day(0) }, { creation_date: day(0, 11) }, { creation_date: day(-6) }, { creation_date: day(-7) }],
      7,
      NOW
    );
    expect(series).toHaveLength(7);
    expect(series.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 0, 2]);
  });

  test("all time buckets the last 12 months", () => {
    const series = createdSeries(
      [{ creation_date: day(0) }, { creation_date: new Date(2026, 0, 5).getTime() }, { creation_date: new Date(2024, 0, 5).getTime() }],
      null,
      NOW
    );
    expect(series).toHaveLength(12);
    expect(series[11].count).toBe(1); // October 2026
    expect(series[2].count).toBe(1); // January 2026
    expect(series.reduce((n, b) => n + b.count, 0)).toBe(2); // 2024 is outside the window
  });
});

test("recentCases is newest first and puts undated cases last", () => {
  const list = recentCases(
    [{ case_id: "old", creation_date: day(-9) }, { case_id: "none" }, { case_id: "new", creation_date: day(0) }],
    5
  );
  expect(list.map((c) => c.case_id)).toEqual(["new", "old", "none"]);
});
