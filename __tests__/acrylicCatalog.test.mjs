/**
 * The full-acrylic (material 2) catalog: BARS and ASSEMBLY tabs and the reciprocating/ring
 * clasps hide, and the wire clasps take their stainless-steel names. Metal (0) hides only the
 * acrylic denture's ball, Adams, acrylic and Roach clasps.
 */
import {
  COMPONENT_BY_ID,
  componentLabel,
  isComponentHiddenForMaterial,
  isTabHiddenForMaterial,
} from "../src/js/2D/components.js";

const METAL = 0;
const ACRYLIC = 2;

describe("acrylic catalog", () => {
  test("hides the BARS and ASSEMBLY tabs in acrylic only", () => {
    for (const tab of ["bars", "assembly"]) {
      expect(isTabHiddenForMaterial(tab, ACRYLIC)).toBe(true);
      expect(isTabHiddenForMaterial(tab, METAL)).toBe(false);
      expect(isTabHiddenForMaterial(tab, null)).toBe(false);
    }
    for (const tab of ["mesh", "rests", "clasps", "major", "plate"]) {
      expect(isTabHiddenForMaterial(tab, ACRYLIC)).toBe(false);
    }
  });

  test("hides reciprocating and ring clasps, and every part of a hidden tab", () => {
    for (const id of ["reciprocating-clasp", "ring-clasp", "bar-i", "assembly-rpi"]) {
      expect(isComponentHiddenForMaterial(id, ACRYLIC)).toBe(true);
      expect(isComponentHiddenForMaterial(id, METAL)).toBe(false);
    }
    for (const id of ["retainer-clasp", "ball-clasp", "rest-seat", "rest-onlay", "mesh-flange"]) {
      expect(isComponentHiddenForMaterial(id, ACRYLIC)).toBe(false);
    }
  });

  test("hides metal mesh and the open palatal majors, keeping the flange and base connectors", () => {
    const unusable = [
      "mesh-tori", "mesh-stripe", "mesh-hole", "mesh-cross", "mesh-plate",
      "major-upper-palatal-strap", "major-upper-palatal-hole", "major-upper-palatal-bar",
    ];
    for (const id of unusable) {
      expect(isComponentHiddenForMaterial(id, ACRYLIC)).toBe(true);
      expect(isComponentHiddenForMaterial(id, METAL)).toBe(false);
    }
    const usable = [
      "mesh-flange", "major-upper-palatal-plate", "major-upper-horseshoe",
      "major-lower-lingual-plate", "plate-prox", "plate-crossmesh",
    ];
    for (const id of usable) {
      expect(isComponentHiddenForMaterial(id, ACRYLIC)).toBe(false);
    }
  });

  test("hides the acrylic denture's clasps in metal only", () => {
    for (const id of ["ball-clasp", "adams-clasp", "acrylic-clasp", "roach-clasp"]) {
      expect(isComponentHiddenForMaterial(id, METAL)).toBe(true);
      expect(isComponentHiddenForMaterial(id, ACRYLIC)).toBe(false);
      expect(isComponentHiddenForMaterial(id, null)).toBe(false);
    }
    for (const id of ["retainer-clasp", "reciprocating-clasp", "ring-clasp", "bar-y"]) {
      expect(isComponentHiddenForMaterial(id, METAL)).toBe(false);
    }
  });

  test("names the wire clasps SS_Wire_Clasp and SS_Ball_Clasp in acrylic", () => {
    expect(componentLabel(COMPONENT_BY_ID.get("retainer-clasp"), ACRYLIC)).toBe("SS_Wire_Clasp");
    expect(componentLabel(COMPONENT_BY_ID.get("ball-clasp"), ACRYLIC)).toBe("SS_Ball_Clasp");
    expect(componentLabel(COMPONENT_BY_ID.get("retainer-clasp"), METAL)).toBe("Retainer");
    expect(componentLabel(COMPONENT_BY_ID.get("ball-clasp"), null)).toBe("Ball Clasp");
    expect(componentLabel(COMPONENT_BY_ID.get("rest-seat"), ACRYLIC)).toBe("Rest Seat");
  });
});
