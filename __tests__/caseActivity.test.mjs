import { auditedCaseWrite, reportCaseActivity } from "../src/js/shared/caseActivitySignal.js";

const originalFetch = global.fetch;
const caller = { uuid: "actor" };
const payload = { caseIntID: 32, name: "Renamed" };

function response(status, type) {
  return { status, headers: { get: () => type } };
}

afterEach(() => {
  global.fetch = originalFetch;
});

test("does not retry an audited mutation on the legacy route after an API error", async () => {
  global.fetch = jest.fn().mockResolvedValue(response(500, "text/plain"));
  const result = await auditedCaseWrite("rename", caller, payload, "case/rename/32", "POST", { case_id: payload.name });
  expect(result.status).toBe(500);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/case\/activity\/rename$/);
  expect(JSON.parse(options.body)).toEqual([caller, { ...payload, operation: expect.any(String) }]);
});

test("preserves the legacy write when the audited route is absent", async () => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(404, "text/html; charset=utf-8"))
    .mockResolvedValueOnce(response(200, "application/json"));
  const result = await auditedCaseWrite("rename", caller, payload, "case/rename/32", "POST", { case_id: payload.name });
  expect(result.status).toBe(200);
  expect(global.fetch.mock.calls[1][0]).toMatch(/\/case\/rename\/32$/);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual([caller, { case_id: payload.name }]);
});

test("sends the viewer page without changing the legacy case-open action", () => {
  global.fetch = jest.fn().mockResolvedValue(response(204));
  reportCaseActivity(32, "Case opened", "reported", "share-token", "3D Viewer");
  const [, request] = global.fetch.mock.calls[0];
  expect(JSON.parse(request.body)[1]).toMatchObject({
    caseIntID: 32, action: "Case opened", page: "3D Viewer",
  });
});
