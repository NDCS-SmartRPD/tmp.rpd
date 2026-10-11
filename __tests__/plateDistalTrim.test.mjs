/**
 * The last plate of a run gets a straight distal cut instead of wrapping its molar: always on
 * an 8, and on a lower 7 only when nothing continues onto the 8. Upper 7s stay whole.
 */
import { getPlateDistalTrim, isPlateUncutAtRunEnd } from "../src/js/2D/components.plate.js";
import { TOOTH_ORDER } from "../src/js/2D/constants.js";
import { freshTeeth } from "./helpers/teeth.mjs";

const jawOf = (tooth) => (Number(tooth[0]) <= 2 ? "upper" : "lower");
const trimmed = (tooth, teeth, id = "plate-prox") => Boolean(getPlateDistalTrim(id, tooth, jawOf(tooth), teeth));

function place(teeth, tooth, componentId, { missing = false } = {}) {
  Object.assign(teeth[tooth], {
    isPresent: !missing,
    status: missing ? "missing" : "presence",
    components: [componentId],
    componentPlacements: [{ componentId, surface: null }],
  });
  return teeth;
}

describe("plate distal trim", () => {
  test("an 8 always ends its run, for both plate types", () => {
    const teeth = freshTeeth();
    for (const tooth of ["18", "28", "38", "48"]) {
      expect(trimmed(tooth, teeth)).toBe(true);
      expect(trimmed(tooth, teeth, "plate-crossmesh")).toBe(true);
    }
  });

  test("a lower 7 is cut only when the 8 carries no plate or mesh", () => {
    expect(trimmed("47", freshTeeth())).toBe(true);
    expect(trimmed("47", place(freshTeeth(), "48", "plate-prox"))).toBe(false);
    expect(trimmed("37", place(freshTeeth(), "38", "mesh-flange", { missing: true }))).toBe(false);
    // A mesh id left on a present 8 is not drawn, so the 7 still ends the run.
    expect(trimmed("37", place(freshTeeth(), "38", "mesh-flange"))).toBe(true);
  });

  test("upper 7s keep their whole plate when they end the run", () => {
    const teeth = freshTeeth();
    for (const tooth of ["17", "27"]) {
      expect(trimmed(tooth, teeth)).toBe(false);
      expect(isPlateUncutAtRunEnd(tooth)).toBe(true);
    }
    for (const tooth of ["18", "28", "37", "47"]) expect(isPlateUncutAtRunEnd(tooth)).toBe(false);
  });

  test("no other tooth or component is ever cut", () => {
    const teeth = freshTeeth();
    for (const jaw of Object.keys(TOOTH_ORDER)) {
      for (const tooth of TOOTH_ORDER[jaw]) {
        if (Number(tooth[1]) < 7) expect(trimmed(tooth, teeth)).toBe(false);
      }
    }
    expect(getPlateDistalTrim("mesh-flange", "18", "upper", teeth)).toBeNull();
  });

  test("the cut stays on the distal side of the plate centre", () => {
    // Upper plate art runs distally down its image and lower art up it, so the kept centre
    // sits above the cut on the upper molars and below it on the lower ones.
    const teeth = freshTeeth();
    for (const tooth of ["18", "28", "37", "38", "47", "48"]) {
      const { left, right } = getPlateDistalTrim("plate-prox", tooth, jawOf(tooth), teeth);
      if (jawOf(tooth) === "upper") expect(Math.min(left, right)).toBeGreaterThan(0);
      else expect(Math.max(left, right)).toBeLessThan(0);
    }
  });
});
