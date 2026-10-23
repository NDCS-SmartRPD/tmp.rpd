/**
 * Retainer Types 5–7, web additions after the ball clasp's 4: the Adams clasp, the pink
 * acrylic clasp (the retainer clasp in flange pink) and the Roach clasp (a Y bar drawn in
 * clasp grey). Each fills the tooth's one Retainer Type slot and survives a save and reload.
 */
import { jest } from "@jest/globals";

const state = { teeth: {}, selectedComponentId: null, designMode: false, jawMaterial: null };
jest.mock("../src/js/2D/2DAnnotation.js", () => ({
  state,
  setMessage: () => {},
  getHistoryStateSignature: () => "",
  recordHistoryIfChanged: () => {},
  isFullAcrylic: () => state.jawMaterial === 2,
}));

import { placeSelectedComponentOnTooth } from "../src/js/2D/annotationPlacement.js";
import { addPlacement } from "../src/js/2D/annotationTeethModel.js";
import {
  COMPONENT_BY_ID,
  getBarPlacementAssetReference,
  getBarPlacementSurfaceForTooth,
  isClaspComponent,
  isComponentHiddenForMaterial,
  isRetainerClaspComponent,
} from "../src/js/2D/components.js";
import { encodeJawStructText, parseJawStructText } from "../src/js/2D/jawStructCodec.js";
import { RETAINER_TYPE } from "../src/js/2D/jawStructCodes.js";
import { saveAndReload } from "./helpers/jawStructIO.mjs";
import { freshTeeth, rowsOn } from "./helpers/teeth.mjs";

function arch(missing = []) {
  state.teeth = freshTeeth(missing);
  return state.teeth;
}

function place(componentId, toothId, surface) {
  state.selectedComponentId = componentId;
  placeSelectedComponentOnTooth(toothId, surface ? { surface } : null);
}

/** A lower arch with 46 missing and meshed, so 45 and 47 can take a bar (or a Roach clasp). */
function archWithLowerSaddle() {
  const teeth = arch(["46"]);
  addPlacement(teeth["46"], "mesh-hole", null);
  return teeth;
}

function retainerFields(jaw, toothId) {
  const parsed = parseJawStructText(encodeJawStructText(state, jaw));
  const tooth = Object.values(parsed.teeth).find(
    (t) =>
      t.fields["Tooth Main.Tooth Index.Major Index"] === toothId[0] &&
      t.fields["Tooth Main.Tooth Index.Minor Index"] === toothId[1]
  );
  return {
    type: tooth.fields["Tooth Main.Tooth Retainer.Retainer Type"],
    claspType: tooth.fields["Tooth Main.Tooth Retainer.Retainer Clasp Type"],
  };
}

describe("Retainer Type codes", () => {
  it("map 5, 6 and 7 to the Adams, acrylic and Roach clasps", () => {
    expect(RETAINER_TYPE.get(5)).toBe("adams-clasp");
    expect(RETAINER_TYPE.get(6)).toBe("acrylic-clasp");
    expect(RETAINER_TYPE.get(7)).toBe("roach-clasp");
  });
});

describe("catalog entries", () => {
  it.each([
    ["acrylic-clasp", "Acrylic Clasp"],
    ["roach-clasp", "Roach Clasp"],
  ])("%s is a CLASPS item that a full-acrylic case keeps", (id, label) => {
    expect(COMPONENT_BY_ID.get(id)).toMatchObject({ label, tab: "clasps" });
    expect(isComponentHiddenForMaterial(id, 2)).toBe(false);
  });

  it("makes the acrylic clasp a circumferential retainer, sharing its anchors and art", () => {
    expect(isRetainerClaspComponent("acrylic-clasp")).toBe(true);
    expect(isClaspComponent("acrylic-clasp")).toBe(true);
  });

  it("draws the Roach clasp with the Y bar's art at the Y bar's position", () => {
    const teeth = archWithLowerSaddle();
    const surface = getBarPlacementSurfaceForTooth("45", "lower", teeth);
    expect(surface).toBeTruthy();
    expect(getBarPlacementAssetReference("roach-clasp", "45", surface)).toBe(
      getBarPlacementAssetReference("bar-y", "45", surface)
    );
  });
});

describe("placing the new retainers", () => {
  it("puts an acrylic clasp on a clasp suggestion surface", () => {
    const teeth = arch();
    place("acrylic-clasp", "15", "distal_buccal");
    expect(rowsOn(teeth, "15")).toContain("acrylic-clasp:distal_buccal");
  });

  it("puts a Roach clasp on its bar surface beside a meshed saddle", () => {
    const teeth = archWithLowerSaddle();
    const surface = getBarPlacementSurfaceForTooth("45", "lower", teeth);
    place("roach-clasp", "45", surface);
    expect(rowsOn(teeth, "45")).toContain(`roach-clasp:${surface}`);
  });
});

describe("one retainer per tooth", () => {
  const RIVALS = [
    ["retainer-clasp", "mesial_buccal"],
    ["ball-clasp", "mesial"],
    ["adams-clasp", null],
    ["acrylic-clasp", "distal_buccal"],
  ];
  it.each([
    ["adams-clasp", null],
    ["acrylic-clasp", "distal_buccal"],
  ])("%s replaces any other retainer, and is replaced by it", (newId, surface) => {
    for (const [rivalId, rivalSurface] of RIVALS) {
      if (rivalId === newId) continue;
      const teeth = arch();
      place(rivalId, "15", rivalSurface);
      place(newId, "15", surface);
      expect(teeth["15"].components).toContain(newId);
      expect(teeth["15"].components).not.toContain(rivalId);

      place(rivalId, "15", rivalSurface);
      expect(teeth["15"].components).toContain(rivalId);
      expect(teeth["15"].components).not.toContain(newId);
    }
  });

  it("lets a Roach clasp and a Y bar replace each other", () => {
    const teeth = archWithLowerSaddle();
    const surface = getBarPlacementSurfaceForTooth("45", "lower", teeth);
    place("bar-y", "45", surface);
    place("roach-clasp", "45", surface);
    expect(teeth["45"].components).toContain("roach-clasp");
    expect(teeth["45"].components).not.toContain("bar-y");
    place("bar-y", "45", surface);
    expect(teeth["45"].components).not.toContain("roach-clasp");
  });

  it("holds for an assembly writing a clasp straight onto the tooth", () => {
    const teeth = arch();
    place("adams-clasp", "16");
    addPlacement(teeth["16"], "retainer-clasp", "mesial_buccal");
    expect(teeth["16"].components).not.toContain("adams-clasp");
  });
});

describe("saving the new retainers", () => {
  it("writes the Adams clasp as Retainer Type 5 and brings it back", () => {
    arch();
    place("adams-clasp", "16");
    expect(retainerFields("upper", "16").type).toBe("5");
    expect(rowsOn(saveAndReload(state, "upper"), "16")).toEqual(rowsOn(state.teeth, "16"));
  });

  it("writes the acrylic clasp as Retainer Type 6 with its side, and brings it back", () => {
    arch();
    place("acrylic-clasp", "25", "distal_buccal");
    place("retainer-clasp", "24", "distal_buccal");
    const acrylic = retainerFields("upper", "25");
    expect(acrylic.type).toBe("6");
    expect(acrylic.claspType).toBe(retainerFields("upper", "24").claspType);
    const reloaded = saveAndReload(state, "upper");
    expect(rowsOn(reloaded, "25")).toEqual(rowsOn(state.teeth, "25"));
    expect(rowsOn(reloaded, "25")).toContain("acrylic-clasp:distal_buccal");
  });

  it("writes the Roach clasp as Retainer Type 7 and brings it back on its bar surface", () => {
    const teeth = archWithLowerSaddle();
    const surface = getBarPlacementSurfaceForTooth("45", "lower", teeth);
    place("roach-clasp", "45", surface);
    expect(retainerFields("lower", "45").type).toBe("7");
    const reloaded = saveAndReload(state, "lower");
    expect(rowsOn(reloaded, "45")).toEqual(rowsOn(state.teeth, "45"));
    expect(rowsOn(reloaded, "45")).toContain(`roach-clasp:${surface}`);
  });
});
