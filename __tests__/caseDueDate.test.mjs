/**
 * @jest-environment jsdom
 *
 * updateCaseDueDate (src/js/2D/caseNote.js) — the write both the case list's
 * inline due-date editor and createCase.js (after creating a case) go through.
 * additionalcasedetails is a full-row upsert, so every write reads the row
 * first and carries its other fields forward; getting that read step wrong
 * either overwrites a co-owner's assigned_to/status/comments, or (the bug this
 * guards against) treats a brand-new case's normal 404 as a real failure and
 * silently refuses to save the date at all.
 */
import { jest } from "@jest/globals";
import { updateCaseDueDate } from "../src/js/2D/caseNote.js";
import { API_BASE, MACHINE_ID } from "../src/js/shared/api.js";

const UUID = "user-uuid-123";
const GETALL_URL = `${API_BASE}/additionalcasedetails/getall`;
const WRITE_URL = `${API_BASE}/additionalcasedetails`;

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Answers additionalcasedetails/getall from `getAllResponse`, records every
// POST body it receives (parsed), keyed by URL.
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

// The exact scenario createCase.js hits right after creating a case: no
// additionalcasedetails row exists for it yet, so the read 404s.
test("a brand-new case (404 on the read) still saves the due date", async () => {
  const calls = stubFetch(jsonResponse({}, 404));

  const ok = await updateCaseDueDate(3111, "2026-09-05");

  expect(ok).toBe(true);
  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1]).toMatchObject({
    assigned_to: null,
    comments: null,
    new_status: null,
  });
});

test("the picked date is saved as Unix seconds at local midnight, not the raw string", async () => {
  const calls = stubFetch(jsonResponse({}, 404));

  await updateCaseDueDate(3111, "2026-09-05");

  const write = calls.find((c) => c.url === WRITE_URL);
  const expectedSeconds = Math.floor(Date.parse("2026-09-05T00:00:00") / 1000);
  expect(write.body[1].due_date).toBe(expectedSeconds);
  expect(typeof write.body[1].due_date).toBe("number");
});

test("clearing the date (empty string) saves due_date as null", async () => {
  const calls = stubFetch(jsonResponse({}, 404));

  await updateCaseDueDate(3111, "");

  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1].due_date).toBeNull();
});

test("an existing row's other fields survive a date-only update", async () => {
  const calls = stubFetch(
    jsonResponse([
      { assigned_to: "alice", due_date: 1, comments: "cast in cobalt chrome", new_status: "In Progress" },
    ])
  );

  await updateCaseDueDate(3111, "2026-09-05");

  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1]).toMatchObject({
    assigned_to: "alice",
    comments: "cast in cobalt chrome",
    new_status: "In Progress",
  });
});

// createCase.js's new call passes both the Request Date and the instructions
// box in one write.
test("passing a comment writes both fields in the same request", async () => {
  const calls = stubFetch(jsonResponse({}, 404));

  await updateCaseDueDate(3111, "2026-09-05", "Please rush this one.");

  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1].comments).toBe("Please rush this one.");
  expect(write.body[1].due_date).not.toBeNull();
});

test("a blank comment clears it rather than leaving the prior one in place", async () => {
  const calls = stubFetch(
    jsonResponse([{ assigned_to: null, due_date: 1, comments: "old note", new_status: null }])
  );

  await updateCaseDueDate(3111, "2026-09-05", "   ");

  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1].comments).toBeNull();
});

// A comment argument that's never passed (caseManagement.js's own date-only
// edit path) must leave the existing comment untouched, not blank it.
test("omitting the comment argument entirely preserves the existing comment", async () => {
  const calls = stubFetch(
    jsonResponse([{ assigned_to: null, due_date: 1, comments: "old note", new_status: null }])
  );

  await updateCaseDueDate(3111, "2026-09-05");

  const write = calls.find((c) => c.url === WRITE_URL);
  expect(write.body[1].comments).toBe("old note");
});

test("a genuine read failure (500) blocks the write instead of guessing", async () => {
  const calls = stubFetch(jsonResponse({}, 500));

  const ok = await updateCaseDueDate(3111, "2026-09-05");

  expect(ok).toBe(false);
  expect(calls.some((c) => c.url === WRITE_URL)).toBe(false);
});

test("both requests carry the machine id, the signed-in uuid, and the case id", async () => {
  const calls = stubFetch(jsonResponse({}, 404));

  await updateCaseDueDate(3111, "2026-09-05");

  for (const call of calls) {
    expect(call.body[0]).toEqual({ machine_id: MACHINE_ID, uuid: UUID, caseIntID: 3111 });
  }
});

test("no signed-in user: refuses without throwing or touching the network", async () => {
  localStorage.clear();
  const calls = stubFetch(jsonResponse({}, 404));

  const ok = await updateCaseDueDate(3111, "2026-09-05");

  expect(ok).toBe(false);
  expect(calls).toHaveLength(0);
});
