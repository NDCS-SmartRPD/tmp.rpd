/**
 * @jest-environment jsdom
 *
 * readCaseDetails / postNewStatus (src/js/pages/caseManagement.js) — the case
 * list's own status-change save path. Exported for testing only; nothing else
 * imports them (the page uses them as plain in-module functions).
 *
 * This is deliberately a SEPARATE implementation from caseNote.js's
 * fetchAdditionalCaseDetails/updateCaseComment/updateCaseDueDate, not a
 * redundant copy of it — two behaviors caseNote.js's version doesn't have:
 *   1. readCaseDetails throws on ANY non-ok response, including 404 — it does
 *      NOT treat "no row yet" as valid the way caseNote.js's does.
 *   2. postNewStatus's merge falls back to the in-memory caseObj's own fields
 *      (assigned_to/expected_date/comments) when there's no stored row,
 *      instead of always falling back to null.
 *   3. It fires best-effort "status changed" alerts to the case's other
 *      members (POST /alerts) after the write succeeds.
 */
import { jest } from "@jest/globals";

// caseManagement.js pulls in its whole page's dependency graph just to reach
// readCaseDetails/postNewStatus. Stub out the branches Babel can't parse
// (accessibility.js's `import.meta.url`) or that drag in unrelated 2D/3D
// annotation internals (noticeboard.js) — neither is exercised by these tests.
jest.mock("../src/js/shared/accessibility.js", () => ({
  reportHtmlToDocxBytes: jest.fn(),
}));
jest.mock("../src/js/2D/noticeboard.js", () => ({ buildReportHtml: jest.fn() }));

import { readCaseDetails, postNewStatus } from "../src/js/pages/caseManagement.js";
import { API_BASE } from "../src/js/shared/api.js";

const UUID = "user-uuid-123";
const GETALL_URL = `${API_BASE}/additionalcasedetails/getall`;
const WRITE_URL = `${API_BASE}/additionalcasedetails`;
const ROLE_URL = `${API_BASE}/role/all/get`;
const ALERTS_URL = `${API_BASE}/alerts`;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Answers each endpoint from the matching *Response arg (defaults: getall ->
// empty row set, role -> no other members, alerts/write -> ok). Records every
// POST body it receives (parsed), keyed by URL.
function stubFetch({ getAllResponse, writeResponse, roleResponse, alertsResponse } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url) === GETALL_URL) return getAllResponse ?? jsonResponse([]);
    if (String(url) === WRITE_URL) return writeResponse ?? jsonResponse({ ok: true });
    if (String(url).endsWith("/case/activity/details")) {
      return { ...jsonResponse(null, 404), headers: { get: () => "text/html" } };
    }
    if (String(url) === ROLE_URL) return roleResponse ?? jsonResponse([]);
    if (String(url) === ALERTS_URL) return alertsResponse ?? jsonResponse({ ok: true });
    return jsonResponse({}, 404);
  });
  return calls;
}

beforeEach(() => {
  localStorage.setItem(
    "loggedInUser",
    JSON.stringify({ uuid: UUID, username: "acting_user" })
  );
  // Several tests here deliberately drive non-ok responses (that's the point
  // of readCaseDetails' 404/500 tests); apiLog.js's logApi warns on every one.
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
  localStorage.clear();
  jest.restoreAllMocks();
});

describe("readCaseDetails", () => {
  test("returns the newest stored row", async () => {
    stubFetch({
      getAllResponse: jsonResponse([
        { assigned_to: "alice", comments: "old" },
        { assigned_to: "bob", comments: "newest" },
      ]),
    });

    const row = await readCaseDetails(3111, UUID);

    expect(row).toMatchObject({ assigned_to: "bob", comments: "newest" });
  });

  test("returns null when no row exists yet (empty array)", async () => {
    stubFetch({ getAllResponse: jsonResponse([]) });

    expect(await readCaseDetails(3111, UUID)).toBeNull();
  });

  test("throws on a genuine server failure (500)", async () => {
    stubFetch({ getAllResponse: jsonResponse({}, 500) });

    await expect(readCaseDetails(3111, UUID)).rejects.toThrow("HTTP 500");
  });

  // The key behavioral gap vs caseNote.js's fetchAdditionalCaseDetails: this
  // function has no 404-is-valid special case, so a brand-new case (which
  // 404s here exactly like it does in caseNote.js) throws instead of
  // resolving to null. Documents current behavior — not asserting this is
  // correct, since it reproduces the same "brand-new case" shape as the
  // due-date bug fixed elsewhere this session.
  test("currently throws on 404 rather than treating it as no-row-yet", async () => {
    stubFetch({ getAllResponse: jsonResponse({}, 404) });

    await expect(readCaseDetails(3111, UUID)).rejects.toThrow("HTTP 404");
  });
});

describe("postNewStatus", () => {
  test("merges the stored row's other fields forward and writes new_status", async () => {
    const calls = stubFetch({
      getAllResponse: jsonResponse([
        { assigned_to: "alice", due_date: 555, comments: "cast in cobalt chrome" },
      ]),
    });

    await postNewStatus({ id: 3111 }, "in progress");

    const write = calls.find((c) => c.url === WRITE_URL);
    expect(write.body[1]).toMatchObject({
      assigned_to: "alice",
      due_date: 555,
      comments: "cast in cobalt chrome",
      new_status: "in progress",
    });
  });

  // The other behavioral gap vs caseNote.js: falls back to caseObj's own
  // fields, not null, when there's no stored row.
  test("with no stored row, falls back to the in-memory caseObj's fields instead of null", async () => {
    const calls = stubFetch({ getAllResponse: jsonResponse([]) });

    await postNewStatus(
      { id: 3111, assigned_to: "carol", expected_date: 777, comments: "rush" },
      "in progress"
    );

    const write = calls.find((c) => c.url === WRITE_URL);
    expect(write.body[1]).toMatchObject({
      assigned_to: "carol",
      due_date: 777,
      comments: "rush",
      new_status: "in progress",
    });
  });

  test("accepts case_int_id as a fallback to id", async () => {
    const calls = stubFetch({ getAllResponse: jsonResponse([]) });

    await postNewStatus({ case_int_id: 4200 }, "in progress");

    for (const call of calls) {
      expect(call.body[0].caseIntID).toBe(4200);
    }
  });

  test("notifies the case's other members, excluding the acting user", async () => {
    const calls = stubFetch({
      getAllResponse: jsonResponse([]),
      roleResponse: jsonResponse([
        { role: "owner", username: "acting_user" }, // self — must be excluded
        { role: "coowner", username: "other_lab" },
        { role: "viewer", username: "should_not_be_notified" }, // not owner/coowner/lab
      ]),
    });

    await postNewStatus({ id: 3111 }, "in progress");

    const alertCalls = calls.filter((c) => c.url === ALERTS_URL);
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].body[1]).toMatchObject({
      to_user: "other_lab",
      from_user: "acting_user",
      new_status: "in progress",
    });
  });

  // Exclusion is case-insensitive, but the dedup itself is a plain Set on the
  // raw string — two members whose usernames differ only in case both get an
  // alert (documenting current behavior, not asserting it's ideal).
  test("dedup is exact-case only: differently-cased duplicates both get notified", async () => {
    const calls = stubFetch({
      getAllResponse: jsonResponse([]),
      roleResponse: jsonResponse([
        { role: "coowner", username: "other_lab" },
        { role: "lab", username: "OTHER_LAB" },
      ]),
    });

    await postNewStatus({ id: 3111 }, "in progress");

    const alertCalls = calls.filter((c) => c.url === ALERTS_URL);
    expect(alertCalls.map((c) => c.body[1].to_user).sort()).toEqual(["OTHER_LAB", "other_lab"]);
  });

  test("skips notifying anyone when there are no other members", async () => {
    const calls = stubFetch({
      getAllResponse: jsonResponse([]),
      roleResponse: jsonResponse([{ role: "owner", username: "acting_user" }]),
    });

    await postNewStatus({ id: 3111 }, "in progress");

    expect(calls.some((c) => c.url === ALERTS_URL)).toBe(false);
  });

  // createStatusAlerts wraps its own fetch in try/catch, so the role lookup
  // failing must not stop the status write from having already succeeded.
  test("a failed member lookup does not undo the status write", async () => {
    stubFetch({ getAllResponse: jsonResponse([]), roleResponse: jsonResponse({}, 500) });

    await expect(postNewStatus({ id: 3111 }, "in progress")).resolves.toBeDefined();
  });

  test("propagates the read failure and never writes when the read 500s", async () => {
    const calls = stubFetch({ getAllResponse: jsonResponse({}, 500) });

    await expect(postNewStatus({ id: 3111 }, "in progress")).rejects.toThrow("HTTP 500");
    expect(calls.some((c) => c.url === WRITE_URL)).toBe(false);
  });

  // Same gap as readCaseDetails' own test above, seen through postNewStatus:
  // a brand-new case's 404 propagates as a thrown error rather than saving.
  test("currently fails to set status on a brand-new case (404 on the read)", async () => {
    const calls = stubFetch({ getAllResponse: jsonResponse({}, 404) });

    await expect(postNewStatus({ id: 3111 }, "in progress")).rejects.toThrow("HTTP 404");
    expect(calls.some((c) => c.url === WRITE_URL)).toBe(false);
  });
});
