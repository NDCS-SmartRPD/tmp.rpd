/**
 * @jest-environment jsdom
 *
 * In a full-acrylic case the retainer clasp is wire set in the acrylic base, so its art is
 * marked `is-acrylic`, which the stylesheet paints in the metal grey of plates and
 * connectors. Other clasps, and every clasp in a metal case, keep their colours.
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
  const image = group.querySelector(`image[data-component-id="${componentId}"]`);
  expect(image).not.toBeNull();
  return image;
}

describe("the retainer clasp in a full-acrylic case", () => {
  it.each([
    ["16", "upper"],
    ["26", "upper"],
    ["46", "lower"],
    ["36", "lower"],
  ])("draws %s's retainer in the metal grey", (toothId, jaw) => {
    expect(drawClasp(toothId, jaw, FULL_ACRYLIC).classList.contains("is-acrylic")).toBe(true);
  });

  it.each(["reciprocating-clasp", "ring-clasp"])("leaves the %s in its own colours", (componentId) => {
    expect(drawClasp("16", "upper", FULL_ACRYLIC, componentId).classList.contains("is-acrylic")).toBe(false);
  });
});

describe("the retainer clasp in a metal case", () => {
  it("keeps its coloured art", () => {
    expect(drawClasp("26", "upper", METAL).classList.contains("is-acrylic")).toBe(false);
  });
});
