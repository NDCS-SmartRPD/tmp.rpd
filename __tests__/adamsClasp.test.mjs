/**
 * Adams clasps wrap one premolar or molar buccally. They are surfaceless (a click on the
 * tooth places one) and their art is drawn in the tooth art's own frame, so it scales and
 * mirrors exactly like the tooth.
 */
import { jest } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const state = { teeth: {}, selectedComponentId: null, designMode: false, jawMaterial: null };
jest.mock("../src/js/2D/2DAnnotation.js", () => ({
  state,
  setMessage: () => {},
  getHistoryStateSignature: () => "",
  recordHistoryIfChanged: () => {},
  isFullAcrylic: () => state.jawMaterial === 2,
}));

import { placeSelectedComponentOnTooth } from "../src/js/2D/annotationPlacement.js";
import {
  canPlaceAdamsClasp,
  COMPONENT_BY_ID,
  getAdamsClaspVisual,
  isClaspComponent,
} from "../src/js/2D/components.js";
import { TOOTH_IMAGE_HEIGHT } from "../src/js/2D/constants.js";
import { freshTeeth, rowsOn } from "./helpers/teeth.mjs";

const POSTERIOR = ["14", "15", "16", "17", "18", "24", "25", "26", "27", "28",
  "34", "35", "36", "37", "38", "44", "45", "46", "47", "48"];
const ANTERIOR = ["11", "12", "13", "21", "22", "23", "31", "32", "33", "41", "42", "43"];

function arch(missing = []) {
  state.teeth = freshTeeth(missing);
  return state.teeth;
}

function place(toothId) {
  state.selectedComponentId = "adams-clasp";
  placeSelectedComponentOnTooth(toothId, null);
}

const pageAsset = (href) => join(process.cwd(), "src", "pages", href);

describe("Adams clasp catalog entry", () => {
  it("is a CLASPS item", () => {
    expect(COMPONENT_BY_ID.get("adams-clasp")).toMatchObject({ label: "Adams Clasp", tab: "clasps" });
  });

  it("is not a circumferential clasp, so it brings no reciprocating plate", () => {
    expect(isClaspComponent("adams-clasp")).toBe(false);
  });
});

describe("Adams clasp art", () => {
  it("exists for every premolar and molar, and for no anterior tooth", () => {
    expect(POSTERIOR.filter((id) => !existsSync(pageAsset(getAdamsClaspVisual(id).href)))).toEqual([]);
    expect(ANTERIOR.map(getAdamsClaspVisual).filter(Boolean)).toEqual([]);
  });

  // The art shares the tooth PNGs' pixel grid (182 px drawn TOOTH_IMAGE_HEIGHT tall); a
  // re-export with a new viewBox would otherwise be squeezed into the old box.
  it("is sized by its own viewBox at the tooth art's scale", () => {
    for (const id of POSTERIOR) {
      const { href, width, height } = getAdamsClaspVisual(id);
      const svg = readFileSync(pageAsset(href), "utf8");
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
      expect(width / w).toBeCloseTo(TOOTH_IMAGE_HEIGHT / 182, 6);
      expect(height / h).toBeCloseTo(TOOTH_IMAGE_HEIGHT / 182, 6);
    }
  });

  it("reuses the Q1/Q4 art unflipped on the other side; the tooth's mirrored scale flips it", () => {
    expect(getAdamsClaspVisual("26")).toEqual(getAdamsClaspVisual("16"));
    expect(getAdamsClaspVisual("36")).toEqual(getAdamsClaspVisual("46"));
  });
});

describe("placing an Adams clasp", () => {
  it("goes on a premolar or molar with a click on the tooth", () => {
    const teeth = arch();
    for (const id of ["14", "26", "37", "48"]) place(id);
    for (const id of ["14", "26", "37", "48"]) expect(rowsOn(teeth, id)).toEqual(["adams-clasp:null"]);
  });

  it("is refused on anterior teeth", () => {
    const teeth = arch();
    for (const id of ANTERIOR) place(id);
    expect(ANTERIOR.filter((id) => teeth[id].componentPlacements.length)).toEqual([]);
    expect(ANTERIOR.filter(canPlaceAdamsClasp)).toEqual([]);
  });

  it("comes off when placed again", () => {
    const teeth = arch();
    place("16");
    place("16");
    expect(teeth["16"].componentPlacements).toEqual([]);
  });
});
