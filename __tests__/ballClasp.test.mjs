/**
 * Ball clasps sit in the embrasure between two teeth, upper or lower. A placement is stored
 * on the tooth behind the contact, as its mesial (11's and 41's mesials are the midlines),
 * needs both teeth present, and saves as Retainer Type 4 — the one retainer slot it shares
 * with a clasp, ring or bar, so those replace each other on a tooth.
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
import { addPlacement } from "../src/js/2D/annotationTeethModel.js";
import {
  COMPONENT_BY_ID,
  getBallClaspPartnerToothId,
  getBallClaspRenderScale,
  getBallClaspSurfacesForTooth,
  getBallClaspVisual,
  getMinorConnectorSupportSides,
  isClaspComponent,
  pruneInvalidBallClaspPlacementsInJaw,
} from "../src/js/2D/components.js";
import { getNeighborToothIds, TOOTH_ORDER } from "../src/js/2D/constants.js";
import { encodeJawStructText, parseJawStructText } from "../src/js/2D/jawStructCodec.js";
import { saveAndReload } from "./helpers/jawStructIO.mjs";
import { freshTeeth, rowsOn } from "./helpers/teeth.mjs";

const OWNERS_BY_JAW = {
  upper: ["11", "12", "13", "14", "15", "16", "17", "18", "22", "23", "24", "25", "26", "27", "28"],
  lower: ["41", "42", "43", "44", "45", "46", "47", "48", "32", "33", "34", "35", "36", "37", "38"],
};
const OWNERS = [...OWNERS_BY_JAW.upper, ...OWNERS_BY_JAW.lower];

function arch(missing = []) {
  state.teeth = freshTeeth(missing);
  return state.teeth;
}

function place(componentId, toothId, surface) {
  state.selectedComponentId = componentId;
  placeSelectedComponentOnTooth(toothId, surface ? { surface } : null);
}

const ballsOn = (t) =>
  t.componentPlacements.filter((p) => p.componentId === "ball-clasp").map((p) => p.surface);
const pageAsset = (href) => existsSync(join(process.cwd(), "src", "pages", href));

describe("ball clasp catalog entry", () => {
  it("is a CLASPS item with its own icon", () => {
    const def = COMPONENT_BY_ID.get("ball-clasp");
    expect(def).toMatchObject({ label: "Ball Clasp", tab: "clasps" });
    expect(pageAsset(def.icon)).toBe(true);
  });

  it("is not a circumferential clasp, so it brings no reciprocating plate", () => {
    expect(isClaspComponent("ball-clasp")).toBe(false);
  });
});

describe("ball clasp contacts", () => {
  it("belong to the tooth behind each contact, one per tooth, with 11 and 41 holding the midlines", () => {
    for (const id of OWNERS) expect(getBallClaspSurfacesForTooth(id)).toEqual(["mesial"]);
    for (const id of ["21", "31"]) expect(getBallClaspSurfacesForTooth(id)).toEqual([]);
  });

  it.each([
    ["11", "21"],
    ["12", "11"],
    ["18", "17"],
    ["22", "21"],
    ["28", "27"],
    ["41", "31"],
    ["42", "41"],
    ["48", "47"],
    ["32", "31"],
    ["38", "37"],
  ])("%s's sits against %s", (owner, partner) => {
    expect(getBallClaspPartnerToothId(owner, "mesial")).toBe(partner);
    expect(getBallClaspPartnerToothId(owner, "distal")).toBeNull();
  });

  it.each([
    ["14", "24", "Ball_U_3D_4M"],
    ["44", "34", "Ball_L_3D_4M"],
  ])("draws %s's art as-is and mirrors it for %s", (screenLeft, screenRight, file) => {
    const href = expect.stringMatching(new RegExp(`/${file}\\.svg$`));
    expect(getBallClaspVisual(screenLeft, "mesial")).toMatchObject({ mirrored: false, href });
    expect(getBallClaspVisual(screenRight, "mesial")).toMatchObject({ mirrored: true, href });
  });

  it("gives each jaw its own midline art", () => {
    expect(getBallClaspVisual("11", "mesial").href).toMatch(/\/Ball_U_1M\.svg$/);
    expect(getBallClaspVisual("41", "mesial").href).toMatch(/\/Ball_L_1M\.svg$/);
  });

  it("has art on disk for every contact", () => {
    const missing = OWNERS.map((id) => getBallClaspVisual(id, "mesial").href).filter((href) => !pageAsset(href));
    expect(missing).toEqual([]);
  });

  // A re-exported file with a new viewBox would otherwise be squeezed into the old box,
  // drawing the clasp smaller and off its ball.
  it("sizes every art file by its own viewBox, at its region's scale", () => {
    for (const id of OWNERS) {
      const { href, image } = getBallClaspVisual(id, "mesial");
      const svg = readFileSync(join(process.cwd(), "src", "pages", href), "utf8");
      const [, , width, height] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
      expect(image.width / width).toBeCloseTo(getBallClaspRenderScale(id), 6);
      expect(image.height / height).toBeCloseTo(getBallClaspRenderScale(id), 6);
    }
  });

  it("draws premolar and molar ball clasps 30% larger than anterior ones", () => {
    for (const [anterior, posterior] of [["13", "14"], ["23", "28"], ["43", "44"], ["41", "36"]]) {
      expect(getBallClaspRenderScale(posterior)).toBeCloseTo(getBallClaspRenderScale(anterior) * 1.3, 6);
    }
  });
});

describe("placing a ball clasp", () => {
  it("goes on the owner's mesial and brings no reciprocating plate", () => {
    const teeth = arch();
    place("ball-clasp", "13", "mesial");
    expect(rowsOn(teeth, "13")).toEqual(["ball-clasp:mesial"]);
  });

  it("goes on a lower owner the same way", () => {
    const teeth = arch();
    place("ball-clasp", "43", "mesial");
    expect(rowsOn(teeth, "43")).toEqual(["ball-clasp:mesial"]);
  });

  it("needs the tooth across the contact", () => {
    const teeth = arch(["12", "41"]);
    place("ball-clasp", "13", "mesial");
    place("ball-clasp", "42", "mesial");
    expect(teeth["13"].componentPlacements).toEqual([]);
    expect(teeth["42"].componentPlacements).toEqual([]);
  });

  it("is not placed by a click on the tooth body or on a surface without a contact", () => {
    const teeth = arch();
    place("ball-clasp", "13");
    place("ball-clasp", "13", "distal");
    place("ball-clasp", "21", "mesial");
    place("ball-clasp", "31", "mesial");
    for (const id of ["13", "21", "31"]) expect(teeth[id].componentPlacements).toEqual([]);
  });

  it("comes off when placed again", () => {
    const teeth = arch();
    place("ball-clasp", "15", "mesial");
    place("ball-clasp", "15", "mesial");
    expect(teeth["15"].componentPlacements).toEqual([]);
  });
});

describe("one retainer per tooth", () => {
  it.each([
    ["retainer-clasp", "distal_buccal"],
    ["ring-clasp", "distal_buccal"],
    ["bar-i", "bar_d1_distal"],
  ])("a ball clasp and %s replace each other", (rivalId, surface) => {
    const teeth = arch();
    place(rivalId, "15", surface);
    place("ball-clasp", "15", "mesial");
    expect(teeth["15"].components).toContain("ball-clasp");
    expect(teeth["15"].components).not.toContain(rivalId);

    place(rivalId, "15", surface);
    expect(teeth["15"].components).toContain(rivalId);
    expect(teeth["15"].components).not.toContain("ball-clasp");
  });

  it("holds for an assembly writing a clasp straight onto the tooth", () => {
    const teeth = arch();
    place("ball-clasp", "15", "mesial");
    addPlacement(teeth["15"], "retainer-clasp", "mesial_buccal");
    expect(teeth["15"].components).toEqual(["retainer-clasp"]);
  });

  it("leaves the tooth's reciprocating plate alone", () => {
    const teeth = arch();
    addPlacement(teeth["15"], "plate-prox", null);
    place("ball-clasp", "15", "mesial");
    expect(rowsOn(teeth, "15")).toEqual(["ball-clasp:mesial", "plate-prox:null"]);
  });
});

// The wire crosses its contact, so both teeth there count: the arch draws one shared
// connector at that embrasure (the higher id draws it, which is 21 at the upper midline).
describe("the ball clasp's minor connector", () => {
  const sidesOf = (teeth, id) => {
    const jaw = TOOTH_ORDER.upper.includes(id) ? "upper" : "lower";
    const ids = getNeighborToothIds(id, jaw);
    return getMinorConnectorSupportSides(teeth[id], {
      mesial: teeth[ids.mesial] || null,
      distal: teeth[ids.distal] || null,
    });
  };
  const none = { mesial: false, distal: false };

  it.each([
    ["14", "13", "15"],
    ["44", "43", "45"],
    ["24", "23", "25"],
  ])("joins %s's contact on both teeth and no other", (owner, partner, behind) => {
    const teeth = arch();
    place("ball-clasp", owner, "mesial");
    expect(sidesOf(teeth, owner)).toEqual({ mesial: true, distal: false });
    expect(sidesOf(teeth, partner)).toEqual({ mesial: false, distal: true });
    expect(sidesOf(teeth, behind)).toEqual(none);
  });

  it.each([
    ["11", "21"],
    ["41", "31"],
  ])("meets at the midline for %s and %s", (owner, partner) => {
    const teeth = arch();
    place("ball-clasp", owner, "mesial");
    expect(sidesOf(teeth, owner)).toEqual({ mesial: true, distal: false });
    expect(sidesOf(teeth, partner)).toEqual({ mesial: true, distal: false });
  });

  it("still joins the owner's side without neighbours to look at", () => {
    const teeth = arch();
    place("ball-clasp", "44", "mesial");
    expect(getMinorConnectorSupportSides(teeth["44"])).toEqual({ mesial: true, distal: false });
  });

  it("joins the contact even beside a wrapped (back-action) arm", () => {
    const teeth = arch();
    addPlacement(teeth["13"], "retainer-clasp", "mesial_buccal");
    addPlacement(teeth["13"], "reciprocating-clasp", "distal_lingual");
    expect(sidesOf(teeth, "13")).toEqual({ mesial: true, distal: false });
    place("ball-clasp", "14", "mesial");
    expect(sidesOf(teeth, "13")).toEqual({ mesial: true, distal: true });
  });

  it("goes with the ball clasp", () => {
    const teeth = arch();
    place("ball-clasp", "14", "mesial");
    place("ball-clasp", "14", "mesial");
    expect(sidesOf(teeth, "14")).toEqual(none);
    expect(sidesOf(teeth, "13")).toEqual(none);
  });
});

describe("keeping ball clasps valid", () => {
  it("drops one whose contact lost a tooth and keeps the rest", () => {
    const teeth = arch();
    place("ball-clasp", "13", "mesial");
    place("ball-clasp", "15", "mesial");
    teeth["12"].isPresent = false;
    pruneInvalidBallClaspPlacementsInJaw(teeth, "upper");
    expect(ballsOn(teeth["13"])).toEqual([]);
    expect(teeth["13"].components).not.toContain("ball-clasp");
    expect(ballsOn(teeth["15"])).toEqual(["mesial"]);
  });
});

describe("saving ball clasps", () => {
  it.each([
    ["upper", "13", "12"],
    ["lower", "43", "42"],
  ])("writes Retainer Type 4 on the %s owner tooth", (jaw, owner, partner) => {
    arch();
    place("ball-clasp", owner, "mesial");
    const parsed = parseJawStructText(encodeJawStructText(state, jaw));
    const retainerOf = (toothId) =>
      Object.values(parsed.teeth).find(
        (t) =>
          t.fields["Tooth Main.Tooth Index.Major Index"] === toothId[0] &&
          t.fields["Tooth Main.Tooth Index.Minor Index"] === toothId[1]
      ).fields["Tooth Main.Tooth Retainer.Retainer Type"];
    expect(retainerOf(owner)).toBe("4");
    expect(retainerOf(partner)).toBe("0");
  });

  it.each(["upper", "lower"])("brings every %s contact's ball clasp back on reload", (jaw) => {
    arch();
    for (const id of OWNERS_BY_JAW[jaw]) place("ball-clasp", id, "mesial");
    const reloaded = saveAndReload(state, jaw);
    for (const id of TOOTH_ORDER[jaw]) expect(rowsOn(reloaded, id)).toEqual(rowsOn(state.teeth, id));
    expect(OWNERS_BY_JAW[jaw].every((id) => ballsOn(reloaded[id]).length === 1)).toBe(true);
  });
});
