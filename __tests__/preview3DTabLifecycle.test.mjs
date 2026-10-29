import fs from "node:fs";

const source = fs.readFileSync("src/js/2D/preview3D.js", "utf8");

describe("2D preview tab lifecycle", () => {
  test("loads extras only from the Extra 3D tab and keeps them cached", () => {
    const initialLoad = source.slice(
      source.indexOf("export async function loadInteractiveJawPreview"),
      source.indexOf("function init3DPreview")
    );
    const closeTab = source.slice(
      source.indexOf("export function closeUpload3dModal"),
      source.indexOf("function setSlotUploadProgress")
    );

    expect(initialLoad).not.toContain("ensureExtraStlsLoaded()");
    expect(closeTab).not.toContain("disposeExtraStls()");
    expect(closeTab).not.toContain("extrasLoadPromise = null");
  });

  test("opens Extra 3D in undercut mode and hides extras on exit", () => {
    const enterTab = source.slice(
      source.indexOf("function enterExtraStlStage"),
      source.indexOf("function exitExtraStlStage")
    );
    const exitTab = source.slice(
      source.indexOf("function exitExtraStlStage"),
      source.indexOf("function captureExtraSlotShot")
    );

    expect(enterTab).toContain("setHeatmapEnabled(true)");
    expect(exitTab).toContain("setExtraStlsVisible(false)");
  });

  test("downloads extra slots without navigating to or rendering the Extra 3D tab", () => {
    const downloadMenu = source.slice(
      source.indexOf("function ensureDownloadJawProfileModal"),
      source.indexOf("// ---- Jaw panel rows")
    );

    expect(downloadMenu).toContain("Download Extra 3D files");
    expect(downloadMenu).toContain("downloadExtraStlsAsZip()");
    expect(downloadMenu).toContain("fetchExtraStlSlot(slotNumber)");
    expect(downloadMenu).not.toContain("openUpload3dModal()");
    expect(downloadMenu).not.toContain("renderExtraStl(");
  });
});
