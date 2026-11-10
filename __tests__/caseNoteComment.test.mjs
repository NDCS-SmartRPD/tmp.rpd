/**
 * @jest-environment jsdom
 *
 * fetchAdditionalCaseDetails / updateCaseComment (src/js/2D/caseNote.js) — the
 * exported, shared read-merge-write pair. Already covered indirectly through
 * updateCaseDueDate in caseDueDate.test.mjs; this file exercises the same pair
 * through its OTHER caller (updateCaseComment — the 2D annotation pages' path
 * for saving a case's comment, per annotationCatalog.js/preview3D.js) and the
 * raw read function directly, since neither is tested elsewhere.
 *
 * Deliberately NOT the same function as caseManagement.js's own
 * readCaseDetails/postNewStatus (see caseManagementStatus.test.mjs) — that one
 * throws on 404 and falls back to an in-memory caseObj; this one treats 404 as
 * a valid empty row and always falls back to null.
 */
import { jest } from "@jest/globals";
import { fetchAdditionalCaseDetails, updateCaseComment } from "../src/js/2D/caseNote.js";
import { API_BASE, MACHINE_ID } from "../src/js/shared/api.js";

const UUID = "user-uuid-123";
const GETALL_URL = `${API_BASE}/additionalcasedetails/getall`;
const WRITE_URL = `${API_BASE}/additionalcasedetails`;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function stubFetch(getAllResponse) {
  const calls = [];
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    if (String(url) === GETALL_URL) return getAllResponse;
    if (String(url) === WRITE_URL) return jsonResponse({ ok: true });
    if (String(url).endsWith("/case/activity/details")) {
      return { ...jsonResponse(null, 404), headers: { get: () => "text/html" } };
    }
    return jsonResponse({}, 404);
  });
  return calls;
}

beforeEach(() => {
  localStorage.setItem("loggedInUser", JSON.stringify({ uuid: UUID }));
});

afterEach(() => {
  delete global.fetch;
  localStorage.clear();
});

describe("fetchAdditionalCaseDetails", () => {
  test("returns the newest row when several exist", async () => {
    stubFetch(jsonResponse([{ comments: "old" }, { comments: "newest" }]));

    const { ok, detail } = await fetchAdditionalCaseDetails(3111);

    expect(ok).toBe(true);
    expect(detail).toMatchObject({ comments: "newest" });
  });

  // The behavior updateCaseDueDate/updateCaseComment/updateCaseStatus all lean
  // on: a brand-new case (no row yet) is a valid starting point, not a failure.
  test("treats 404 as ok with a null detail, not a failure", async () => {
    stubFetch(jsonResponse({}, 404));

    expect(await fetchAdditionalCaseDetails(3111)).toEqual({ ok: true, detail: null });
  });

  test("a genuine server failure (500) reports ok:false", async () => {
    stubFetch(jsonResponse({}, 500));

    expect(await fetchAdditionalCaseDetails(3111)).toEqual({ ok: false, detail: null });
  });

  test("no signed-in user refuses without touching the network", async () => {
    localStorage.clear();
    const calls = stubFetch(jsonResponse({}, 404));

    expect(await fetchAdditionalCaseDetails(3111)).toEqual({ ok: false, detail: null });
    expect(calls).toHaveLength(0);
  });

  test("a null caseIntID refuses without touching the network", async () => {
    const calls = stubFetch(jsonResponse({}, 404));

    expect(await fetchAdditionalCaseDetails(null)).toEqual({ ok: false, detail: null });
    expect(calls).toHaveLength(0);
  });
});

describe("updateCaseComment", () => {
  test("a brand-new case (404 on the read) still saves the comment", async () => {
    const calls = stubFetch(jsonResponse({}, 404));

    const ok = await updateCaseComment(3111, "Please rush this one.");

    expect(ok).toBe(true);
    const write = calls.find((c) => c.url === WRITE_URL);
    expect(write.body[1]).toMatchObject({
      assigned_to: null,
      due_date: null,
      comments: "Please rush this one.",
      new_status: null,
    });
  });

  test("leaves due_date and other fields untouched on an existing row", async () => {
    const calls = stubFetch(
      jsonResponse([
        { assigned_to: "alice", due_date: 555, comments: "old note", new_status: "In Progress" },
      ])
    );

    await updateCaseComment(3111, "new note");

    const write = calls.find((c) => c.url === WRITE_URL);
    expect(write.body[1]).toMatchObject({
      assigned_to: "alice",
      due_date: 555,
      comments: "new note",
      new_status: "In Progress",
    });
  });

  test("a blank comment clears it rather than leaving the prior one in place", async () => {
    const calls = stubFetch(jsonResponse([{ comments: "old note" }]));

    await updateCaseComment(3111, "   ");

    const write = calls.find((c) => c.url === WRITE_URL);
    expect(write.body[1].comments).toBeNull();
  });

  test("a genuine read failure (500) blocks the write instead of guessing", async () => {
    const calls = stubFetch(jsonResponse({}, 500));

    const ok = await updateCaseComment(3111, "new note");

    expect(ok).toBe(false);
    expect(calls.some((c) => c.url === WRITE_URL)).toBe(false);
  });

  test("carries the machine id, signed-in uuid, and case id on both requests", async () => {
    const calls = stubFetch(jsonResponse({}, 404));

    await updateCaseComment(3111, "new note");

    for (const call of calls) {
      expect(call.body[0]).toEqual({ machine_id: MACHINE_ID, uuid: UUID, caseIntID: 3111 });
    }
  });
});
