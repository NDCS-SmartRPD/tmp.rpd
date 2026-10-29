import {
  estimatedSurveyDirection,
  storedSurveyDirection,
} from "../src/js/2D/extraStlSurvey.js";
import fs from "node:fs";

describe("extra STL estimated survey direction", () => {
  test("normalizes a DLL direction supplied as vec", () => {
    expect(estimatedSurveyDirection({ vec: [0, 3, 4] })).toEqual([0, 0.6, 0.8]);
  });

  test("accepts x/y/z and rejects zero or invalid directions", () => {
    expect(estimatedSurveyDirection({ x: 2, y: 0, z: 0 })).toEqual([1, 0, 0]);
    expect(estimatedSurveyDirection({ vec: [0, 0, 0] })).toBeNull();
    expect(estimatedSurveyDirection({ vec: [1, "bad", 0] })).toBeNull();
  });

  test("stores the inverse desktop jaw transform used by saved survey angles", () => {
    expect(storedSurveyDirection("upper", [0.1, 0.2, 0.3])).toEqual([-0.1, -0.2, 0.3]);
    expect(storedSurveyDirection("lower", [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, -0.3]);
  });
});

describe("extra STL loading lifecycle", () => {
  const previewSource = fs.readFileSync("src/js/2D/preview3D.js", "utf8");

  test("does not start extra-slot loading from the default 3D preview load", () => {
    const defaultLoad = previewSource.slice(
      previewSource.indexOf("export async function loadInteractiveJawPreview"),
      previewSource.indexOf("function init3DPreview")
    );
    expect(defaultLoad).not.toMatch(/ensureExtraStlsLoaded\(\)/);
  });

  test("keeps mesh rendering available when survey estimation fails", () => {
    const prepare = previewSource.slice(
      previewSource.indexOf("async function prepareExtraJawStl"),
      previewSource.indexOf("async function replaceExtraStlSlot")
    );
    expect(prepare).toMatch(/catch/);
    expect(prepare).toMatch(/return \{ data: repairedData, undercutSurface: null \}/);
  });
});
