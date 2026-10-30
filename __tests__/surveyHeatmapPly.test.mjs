import {
  buildSurveyHeatmapPly,
  savedSurveyDirection,
} from "../src/viewer3d/surveyHeatmapPly.js";
import fs from "node:fs";
import path from "node:path";

const caseManagementSource = fs.readFileSync(
  path.resolve("src/js/pages/caseManagement.js"),
  "utf8"
);

describe("survey heatmap PLY export", () => {
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
    expect(caseManagementSource).toContain('zip.file(`survey_heatmap/${jaw}.ply`');
  });
});
