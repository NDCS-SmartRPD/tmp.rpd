/**
 * A flange rounds its buccal corner on each end of its run: the side whose neighbour
 * draws no mesh picks the _mesial / _distal / _mesial_distal art for that tooth.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { getComponentAssetReference, getFlangeFreeEnds } from "../src/js/2D/components.mesh.js";
import { TOOTH_ORDER } from "../src/js/2D/constants.js";
import { freshTeeth } from "./helpers/teeth.mjs";

/** Mark teeth missing and carrying `meshId`, the way placement leaves them. */
function withMesh(teeth, ids, meshId = "mesh-flange") {
  for (const id of ids) {
    Object.assign(teeth[id], {
      isPresent: false,
      status: "missing",
      components: [meshId],
      componentPlacements: [{ componentId: meshId, surface: null }],
    });
  }
  return teeth;
}

const flangeFile = (teeth, toothId, jaw) =>
  getComponentAssetReference("mesh-flange", toothId, getFlangeFreeEnds(teeth, toothId, jaw))
    .split("/")
    .pop();

describe("flange free ends", () => {
  test("a lone flange rounds both buccal corners", () => {
    const teeth = withMesh(freshTeeth(), ["16"]);
    expect(getFlangeFreeEnds(teeth, "16", "upper")).toEqual({ mesial: true, distal: true });
    expect(flangeFile(teeth, "16", "upper")).toBe("16-flange_mesial_distal.svg");
  });

  test("a run rounds only the corners at its two ends", () => {
    const teeth = withMesh(freshTeeth(), ["15", "16", "17"]);
    expect(flangeFile(teeth, "15", "upper")).toBe("15-flange_mesial.svg");
    expect(flangeFile(teeth, "16", "upper")).toBe("16-flange.svg");
    expect(flangeFile(teeth, "17", "upper")).toBe("17-flange_distal.svg");
  });

  test("any mesh on the neighbour continues the run, a bare missing tooth ends it", () => {
    const teeth = withMesh(withMesh(freshTeeth(["14"]), ["15"]), ["16"], "mesh-hole");
    expect(getFlangeFreeEnds(teeth, "15", "upper")).toEqual({ mesial: true, distal: false });
  });

  test("a mesh id left on a present tooth is not drawn, so it ends the run", () => {
    const teeth = withMesh(freshTeeth(), ["16"]);
    teeth["17"].components = ["mesh-flange"];
    expect(getFlangeFreeEnds(teeth, "16", "upper").distal).toBe(true);
  });

  test("the run continues across the midline", () => {
    const teeth = withMesh(freshTeeth(), ["11", "21"]);
    expect(flangeFile(teeth, "11", "upper")).toBe("11-flange_distal.svg");
    // Quadrant 2 reuses the quadrant 1 art, mirrored, so mesial stays mesial.
    expect(flangeFile(teeth, "21", "upper")).toBe("11-flange_distal.svg");
  });

  test("the last tooth of the arch always ends its run distally", () => {
    const teeth = withMesh(freshTeeth(), ["17", "18"]);
    expect(getFlangeFreeEnds(teeth, "18", "upper")).toEqual({ mesial: false, distal: true });
    expect(flangeFile(teeth, "18", "upper")).toBe("18-flange_distal.svg");
  });

  test("lower arch: mesial is toward the midline, quadrant 3 uses the quadrant 4 art", () => {
    const teeth = withMesh(freshTeeth(), ["46", "47", "36"]);
    expect(flangeFile(teeth, "46", "lower")).toBe("46-flange_mesial.svg");
    expect(flangeFile(teeth, "47", "lower")).toBe("47-flange_distal.svg");
    expect(flangeFile(teeth, "36", "lower")).toBe("46-flange_mesial_distal.svg");
  });

  test("only the flange has per-end art", () => {
    const bothFree = { mesial: true, distal: true };
    expect(getComponentAssetReference("mesh-hole", "16", bothFree)).toMatch(/\/16-hole_mesh\.svg$/);
    expect(getComponentAssetReference("mesh-flange", "16")).toMatch(/\/16-flange\.svg$/);
  });

  test("every flange file the arch can ask for exists", () => {
    const missing = [];
    for (const jaw of Object.keys(TOOTH_ORDER)) {
      for (const toothId of TOOTH_ORDER[jaw]) {
        for (const mesial of [false, true]) {
          for (const distal of [false, true]) {
            const ref = getComponentAssetReference("mesh-flange", toothId, { mesial, distal });
            // Asset paths are relative to the pages in src/pages/.
            if (!existsSync(join(process.cwd(), "src", "pages", ref))) missing.push(ref);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
