/**
 * src/js/shared/caseListFilter.js — the dashboard's "View all" links into the
 * case list. Both pages must agree on the URL and on which cases match.
 */
import {
  caseListFilterText,
  caseListHref,
  matchesCaseListFilter,
  parseCaseListFilter,
} from "../src/js/shared/caseListFilter.js";

const NOW = new Date(2026, 9, 13, 12, 0).getTime(); // 13 Oct 2026, noon local
const day = (offset) => new Date(2026, 9, 13 + offset, 9).getTime();
const TWO_D = ["2d_design_pending", "2d_design_drafted", "2d_design_approved"];

describe("caseListHref and parseCaseListFilter", () => {
  test("a card's filter round-trips through the case list URL", () => {
    const href = caseListHref({ statuses: TWO_D, days: 30, scope: "owned" });
    expect(href.startsWith("./case_list.html?")).toBe(true);
    expect(parseCaseListFilter(href.slice(href.indexOf("?")))).toEqual({ statuses: TWO_D, days: 30, scope: "owned" });
  });

  test("nothing to filter gives the bare page, and no filter is read back", () => {
    expect(caseListHref({ days: null, scope: "all" })).toBe("./case_list.html");
    expect(parseCaseListFilter("")).toBeNull();
    expect(parseCaseListFilter("?days=abc&scope=everyone")).toBeNull();
  });
});

describe("matchesCaseListFilter", () => {
  const filter = { statuses: TWO_D, days: 7, scope: "owned" };
  const mk = (extra) => ({ creation_date: day(-1), new_status: "2D design drafted", username: "me", ...extra });

  test("keeps cases at one of the statuses, created in the period, owned by the user", () => {
    expect(matchesCaseListFilter(filter, mk(), "me", NOW)).toBe(true);
    expect(matchesCaseListFilter(filter, mk({ assigned_to: "Me" }), "me", NOW)).toBe(true);
  });

  test("drops a case that fails any part", () => {
    expect(matchesCaseListFilter(filter, mk({ new_status: "3D design pending" }), "me", NOW)).toBe(false);
    expect(matchesCaseListFilter(filter, mk({ creation_date: day(-9) }), "me", NOW)).toBe(false);
    expect(matchesCaseListFilter(filter, mk({ assigned_to: "dr.tan" }), "me", NOW)).toBe(false);
    expect(matchesCaseListFilter({ scope: "shared" }, mk({ assigned_to: "dr.tan" }), "me", NOW)).toBe(true);
  });

  test("no filter keeps every case", () => {
    expect(matchesCaseListFilter(null, mk({ new_status: null }), "me", NOW)).toBe(true);
  });
});

test("caseListFilterText says what the list is showing", () => {
  expect(caseListFilterText({ statuses: TWO_D, days: 30, scope: "owned" })).toBe(
    "2D design pending, drafted or approved · created in the last 30 days · owned by me"
  );
  expect(caseListFilterText({ statuses: ["3d_design_approved"], days: 1, scope: null })).toBe("3D design approved · created today");
  expect(caseListFilterText({ statuses: null, days: null, scope: "shared" })).toBe("shared with me");
});
