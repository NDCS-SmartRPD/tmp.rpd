import {
  buildSurveyHeatmapPly,
  heatmapPlyFilename,
  savedSurveyDirection,
} from "../src/viewer3d/surveyHeatmapPly.js";
import {
  isPlyBytes,
  plyBytesToBinaryStl,
} from "../src/viewer3d/meshFileSupport.js";
import fs from "node:fs";
import path from "node:path";

const caseManagementSource = fs.readFileSync(
  path.resolve("src/js/pages/caseManagement.js"),
  "utf8"
);
const caseListStyles = fs.readFileSync(path.resolve("css/case_list.css"), "utf8");

describe("survey heatmap PLY export", () => {
  test("keeps the saved jaw filename stem and safely changes its extension", () => {
    expect(heatmapPlyFilename("SWIFT_R008_-_Model_(Upper).stl", "upper"))
      .toBe("SWIFT_R008_-_Model_(Upper).ply");
    expect(heatmapPlyFilename("folder\\Lower Jaw.off", "lower"))
      .toBe("Lower Jaw.ply");
    expect(heatmapPlyFilename(null, "upper")).toBe("upper.ply");
  });

  test("restores the DLL direction from a saved upper survey angle", () => {
    expect(savedSurveyDirection({
      upper_insertion_angle_x: 0,
      upper_insertion_angle_y: 3,
      upper_insertion_angle_z: 4,
    }, "upper")).toEqual([0, -0.6, 0.8]);
  });

  test("bakes survey bands into an OFF mesh as binary PLY vertex colours", () => {
    const mesh = new TextEncoder().encode([
      "OFF",
      "3 1 0",
      "0 0 0",
      "1 0 0",
      "0 1 0",
      "3 0 1 2",
    ].join("\n"));

    const ply = buildSurveyHeatmapPly(mesh, { surveying_values: [0, 0.3, 0.8] });
    const headerEnd = new TextDecoder().decode(ply).indexOf("end_header\n") + 11;

    expect(new TextDecoder().decode(ply.subarray(0, headerEnd))).toContain("element vertex 3");
    expect(Array.from(ply.subarray(headerEnd + 15 + 12, headerEnd + 15 + 15)))
      .toEqual([253, 140, 0]);
    expect(Array.from(ply.subarray(headerEnd + 30 + 12, headerEnd + 30 + 15)))
      .toEqual([170, 0, 3]);
  });

  test("adds recomputed surveyed jaws to the case-list download bundle", () => {
    expect(caseManagementSource).toContain("/dll/compute-surveying-no-pd");
    expect(caseManagementSource).toContain("buildSurveyHeatmapPly");
    expect(caseManagementSource).toContain("surveyHeatmapSourceBytes");
    expect(caseManagementSource).toContain("zip.file(filename, ply)");
    expect(caseManagementSource).not.toContain('zip.file(`survey_heatmap/${filename}`');
  });

  test("normalizes a stored PLY payload before survey colours are baked", () => {
    const source = new TextEncoder().encode("ply\nformat ascii 1.0\nend_header\n");
    const dispose = jest.fn();
    const geometry = {
      attributes: {
        position: {
          count: 3,
          getX: (index) => [0, 1, 0][index],
          getY: (index) => [0, 0, 1][index],
          getZ: () => 0,
        },
      },
      index: null,
      dispose,
    };
    const parse = jest.fn(() => geometry);

    expect(isPlyBytes(source)).toBe(true);
    const stl = plyBytesToBinaryStl(source, class { parse = parse; });

    expect(parse).toHaveBeenCalledTimes(1);
    expect(new DataView(stl).getUint32(80, true)).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("shows responsive non-blocking packaging progress for the case ZIP", () => {
    expect(caseManagementSource).toContain("beginCaseDownloadProgress");
    expect(caseManagementSource).toContain("updateCaseDownloadProgress");
    expect(caseManagementSource).toContain("finishCaseDownloadProgress");
    expect(caseManagementSource).toContain("percent * 0.15");
    expect(caseListStyles).toContain(".cm-download-progress");
    expect(caseListStyles).toContain("pointer-events: none");
    expect(caseListStyles).toContain("env(safe-area-inset-bottom");
    expect(caseListStyles).toContain("calc(100vw - 24px)");
  });
});
