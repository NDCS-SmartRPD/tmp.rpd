/** @jest-environment jsdom */
import { getAppBasePath } from "../src/js/shared/pageContext.js";
import { buildThreeDViewerUrl, createSharedThreeDViewerUrl } from "../src/js/shared/caseLinks.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const originalLocation = window.location;
afterAll(() => Object.defineProperty(window, "location", { configurable: true, value: originalLocation }));
afterEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

test.each([
  ["https://ndcs-smartrpd.github.io/tmp.rpd/src/pages/ThreeDViewer.html?id=case", "/tmp.rpd"],
  ["https://faid123.github.io/.tmp-test-web/src/pages/2DAnnotation.html", "/.tmp-test-web"],
  ["https://example.com/apps/rpd/src/pages/admin/admin_case_list.html", "/apps/rpd"],
  ["https://example.com/src/pages/case_list.html", ""],
  ["http://localhost:8089/src/pages/ThreeDViewer.html", ""],
  ["https://ndcs-smartrpd.github.io/tmp.rpd/index.html", "/tmp.rpd"],
])("routes stay within the app root at %s", (href, expected) => {
  Object.defineProperty(window, "location", { configurable: true, value: new URL(href) });
  expect(getAppBasePath()).toBe(expected);
  expect(buildThreeDViewerUrl("123")).toContain(`${window.location.origin}${expected}/src/pages/ThreeDViewer.html?id=`);
});

test("localhost share links use the new live repository", () => {
  Object.defineProperty(window, "location", { configurable: true, value: new URL("http://localhost:8089/src/pages/case_list.html") });
  expect(buildThreeDViewerUrl("123", { forShare: true })).toContain("https://ndcs-smartrpd.github.io/tmp.rpd/src/pages/ThreeDViewer.html?id=");
});

test("server-issued share tokens are placed in the URL fragment", async () => {
  Object.defineProperty(window, "location", { configurable: true, value: new URL("http://localhost:8089/src/pages/case_list.html") });
  localStorage.setItem("loggedInUser", JSON.stringify({ uuid: "owner-uuid" }));
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ token: "safe_token", expiresAt: "2099-01-01T00:00:00Z" }),
  });

  const link = await createSharedThreeDViewerUrl("123");

  expect(link).toContain("/ThreeDViewer.html?id=");
  expect(link.endsWith("#share=safe_token")).toBe(true);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/case/share/replace"),
    expect.objectContaining({ method: "POST" })
  );
});

test.each(["ThreeDViewer", "VersionHistory", "AnnotationHistory"])("%s bootstrap loads assets inside the deployed repository", (page) => {
  const html = readFileSync(`src/pages/${page}.html`, "utf8");
  const bootstrap = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  for (const root of ["https://ndcs-smartrpd.github.io/tmp.rpd", "http://localhost:8089", "https://example.com/apps/rpd"]) {
    let written = "";
    vm.runInNewContext(bootstrap, { URL, window: { location: new URL(`${root}/src/pages/${page}.html?id=case`) }, document: { write: (value) => { written += value; } } });
    const paths = [...written.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => new URL(match[1], root).href);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(path.startsWith(`${root}/`)).toBe(true);
    expect(written).not.toContain(".tmp-test-web");
  }
});
