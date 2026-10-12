/**
 * @jest-environment jsdom
 *
 * In a full-acrylic case the retainer clasp is wire set in the acrylic base, so it draws
 * as steel (#metal-clasp). Chrome renders that lighting filter black on a mirrored element,
 * so the screen-right side mirrors the art on the image itself, never above the steel group.
 */
import { jest } from "@jest/globals";

const state = { teeth: {}, jawMaterial: null, selectedComponentId: null, designMode: false };
jest.mock("../src/js/2D/2DAnnotation.js", () => ({
  REST_CALIBRATION_COMPONENT_ID: "rest-seat",
  state,
  svgEl: (tagName, attrs = {}) => {
    const el = globalThis.document.createElementNS("http://www.w3.org/2000/svg", tagName);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    return el;
  },
  setMessage: () => {},
  openRemoveComponentPicker: () => {},
  positionAnteriorRestPanel: () => {},
  renderJaw: () => {},
  renderJaws: () => {},
  getHistoryStateSignature: () => "",
  recordHistoryIfChanged: () => {},
  isFullAcrylic: () => state.jawMaterial === 2,
}));

import { addPlacement } from "../src/js/2D/annotationTeethModel.js";
import { appendPlacedComponentMarkers } from "../src/js/2D/annotationVisuals.js";
import { freshTeeth } from "./helpers/teeth.mjs";

const FULL_ACRYLIC = 2;
const METAL = 0;

function drawClasp(toothId, jaw, material, componentId = "retainer-clasp") {
  state.jawMaterial = material;
  state.teeth = freshTeeth();
  addPlacement(state.teeth[toothId], componentId, "mesial_buccal");
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  appendPlacedComponentMarkers(group, state.teeth[toothId], toothId, jaw);
  return group;
}

const claspImage = (group, componentId = "retainer-clasp") =>
  group.querySelector(`image[data-component-id="${componentId}"]`);

/** True when `el` or an ancestor below `stop` flips the drawing horizontally. */
function isMirroredBetween(el, stop) {
  for (let node = el; node && node !== stop; node = node.parentNode) {
    if (/scale\(\s*-1/.test(node.getAttribute("transform") || "")) return true;
  }
  return false;
}

describe("the retainer clasp in a full-acrylic case", () => {
  it.each([
    ["16", "upper"],
    ["26", "upper"],
    ["46", "lower"],
    ["36", "lower"],
  ])("draws %s's retainer as steel, with no mirror above the steel", (toothId, jaw) => {
    const group = drawClasp(toothId, jaw, FULL_ACRYLIC);
    const metal = group.querySelector(".clasp-placement-metal");
    expect(metal).not.toBeNull();
    expect(metal.contains(claspImage(group))).toBe(true);
    expect(isMirroredBetween(metal, group)).toBe(false);
  });

  it.each([
    ["26", "upper", "scale(-1 1)"],
    ["36", "lower", "scale(-1 1)"],
    ["16", "upper", null],
    ["46", "lower", null],
  ])("still mirrors %s's art on the image itself", (toothId, jaw, transform) => {
    expect(claspImage(drawClasp(toothId, jaw, FULL_ACRYLIC)).getAttribute("transform")).toBe(transform);
  });

  it.each(["reciprocating-clasp", "ring-clasp"])("leaves the %s in its own colours", (componentId) => {
    const group = drawClasp("16", "upper", FULL_ACRYLIC, componentId);
    expect(claspImage(group, componentId)).not.toBeNull();
    expect(group.querySelector(".clasp-placement-metal")).toBeNull();
  });
});

describe("the retainer clasp in a metal case", () => {
  it("keeps its coloured art", () => {
    const group = drawClasp("26", "upper", METAL);
    expect(claspImage(group)).not.toBeNull();
    expect(group.querySelector(".clasp-placement-metal")).toBeNull();
  });
});
