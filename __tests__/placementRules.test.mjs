/**
 * Rules the generic placement engine enforces for every catalog pick:
 *   - one reciprocating element per tooth (clasp XOR plate),
 *   - a clasp/bar/rest auto-adds the default reciprocating plate,
 *   - assembly ids are never stored as placements,
 *   - a major connector is only offered where its span would actually reach.
 * Assembly layouts themselves live in assemblies.test.mjs.
 */
import { jest } from "@jest/globals";

const state = { teeth: {}, selectedComponentId: null, designMode: false, jawMaterial: null };
jest.mock("../src/js/2D/2DAnnotation.js", () => ({
  state,
  setMessage: () => {},
  getHistoryStateSignature: () => "",
  recordHistoryIfChanged: () => {},
  // The real module owns the material check the catalog gate reads; keep it faithful so the
  // full-acrylic cases below still exercise the real blocking rules.
  isFullAcrylic: () => state.jawMaterial === 2,
}));

import {
  applyRemovalSideEffectsForTooth,
  placeSelectedComponentOnTooth,
  toothSupportsMajorConnectorOverlay,
} from "../src/js/2D/annotationPlacement.js";
import {
  addPlacement,
  removePlacement,
  syncToothComponentsFromPlacements,
} from "../src/js/2D/annotationTeethModel.js";
import { assessPlacementCriteria } from "../src/js/2D/criteria.js";
import {
  ACTION_UPON_FAILURE,
  ASSEMBLY_REST_SUGGESTION_IDS,
  COMPONENT_BY_ID,
  computePalatalStrapPolygonPoints,
  ensureMajorConnectorPlacementsOnSupportedTeethInJaws,
  ensurePalatalBarPlacementsOnAnchoredUpperTeeth,
  isMajorConnectorComponent,
  pruneInvalidMajorConnectorPlacementsInJaw,
  removeNonBarMajorPlacementsFromUpperArch,
} from "../src/js/2D/components.js";
import { TOOTH_ORDER } from "../src/js/2D/constants.js";
import { switchMajorIn } from "./helpers/jawStructIO.mjs";

const RECIP = ["reciprocating-clasp", "plate-prox", "plate-crossmesh"];

function tooth(componentIds = [], { isPresent = true, toothId = "36" } = {}) {
  return {
    tooth_id: toothId,
    isPresent,
    components: [...componentIds],
    componentPlacements: componentIds.map((componentId) => ({ componentId, surface: null })),
  };
}

/** Install one tooth as the whole arch and return it. */
function toothAt(toothId, componentIds = [], isPresent = true) {
  const t = tooth(componentIds, { isPresent, toothId });
  state.teeth = { [toothId]: t };
  return t;
}

function place(componentId, toothId, surface) {
  state.selectedComponentId = componentId;
  placeSelectedComponentOnTooth(toothId, surface ? { surface } : null);
}

const idsOn = (t) => t.componentPlacements.map((p) => p.componentId);
const recipOn = (t) => idsOn(t).filter((id) => RECIP.includes(id));

/**
 * A tooth's reciprocating element is a single slot (Reciprocating.Tooth Type): a
 * reciprocating clasp OR a proximal/mesh plate — never both (e.g. at 37/47 under a
 * lingual plate).
 */
describe("reciprocating element is mutually exclusive (clasp XOR plate)", () => {
  it.each([
    ["plate-prox", "reciprocating-clasp"],
    ["plate-crossmesh", "reciprocating-clasp"],
    ["reciprocating-clasp", "plate-prox"],
    ["reciprocating-clasp", "plate-crossmesh"],
    ["plate-prox", "plate-crossmesh"],
    ["plate-crossmesh", "plate-prox"],
  ])("placing %s when the tooth already has ... conflicts", (existingId, placeId) => {
    const res = assessPlacementCriteria(tooth([existingId]), COMPONENT_BY_ID.get(placeId), COMPONENT_BY_ID);
    expect(res.pass).toBe(false);
    expect(res.failureData.conflictingComponents).toContain(existingId);
    expect(res.failureData.actionUponFailure).toBe(ACTION_UPON_FAILURE.REMOVE_THEN_PLACE);
  });

  it("a retainer clasp may coexist with a reciprocal plate (valid clasp assembly)", () => {
    const res = assessPlacementCriteria(tooth(["retainer-clasp"]), COMPONENT_BY_ID.get("plate-prox"), COMPONENT_BY_ID);
    expect(res.pass).toBe(true);
  });

  // addPlacement is the choke point used by compound assembly placements (which bypass
  // the catalog's conflictsWith), so it must enforce the single slot too.
  it("addPlacement drops a pre-existing reciprocating element", () => {
    const t = tooth();
    addPlacement(t, "plate-prox", null);
    addPlacement(t, "reciprocating-clasp", "mesial_lingual");
    expect(recipOn(t)).toEqual(["reciprocating-clasp"]);
    addPlacement(t, "plate-crossmesh", null);
    expect(recipOn(t)).toEqual(["plate-crossmesh"]);
  });

  it("addPlacement keeps a retainer clasp + reciprocal plate (different slot)", () => {
    const t = tooth();
    addPlacement(t, "retainer-clasp", "mesial_buccal");
    addPlacement(t, "plate-prox", null);
    expect(t.components).toEqual(expect.arrayContaining(["retainer-clasp", "plate-prox"]));
  });
});

describe("auto default reciprocating plate", () => {
  it.each([
    ["retainer-clasp", "mesial_buccal"],
    ["ring-clasp", "mesial_buccal"],
    ["bar-i", "bar_d1_distal"],
    ["rest-seat", "mesial"],
    ["rest-onlay", "mesial"],
  ])("placing %s adds plate-prox", (componentId, surface) => {
    const t = toothAt("36");
    place(componentId, "36", surface);
    expect(idsOn(t)).toEqual(expect.arrayContaining([componentId, "plate-prox"]));
  });

  it.each([
    ["a reciprocating clasp", "reciprocating-clasp", "retainer-clasp", "mesial_buccal"],
    ["a mesh plate", "plate-crossmesh", "bar-i", "bar_d1_distal"],
  ])("keeps %s the tooth already carries", (_name, existing, placeId, surface) => {
    const t = toothAt("36", [existing]);
    place(placeId, "36", surface);
    expect(idsOn(t)).toEqual(expect.arrayContaining([placeId, existing]));
    expect(idsOn(t)).not.toContain("plate-prox");
  });

  it("placing a reciprocating clasp itself is not overwritten by the default plate", () => {
    const t = toothAt("36");
    place("reciprocating-clasp", "36", "mesial_lingual");
    expect(idsOn(t)).toEqual(["reciprocating-clasp"]);
  });

  it("adds only one plate across repeated placements on the same tooth", () => {
    const t = toothAt("36");
    place("rest-seat", "36", "mesial");
    place("retainer-clasp", "36", "distal_buccal");
    expect(idsOn(t).filter((id) => id === "plate-prox")).toHaveLength(1);
  });
});

/**
 * Assemblies are macros placed from a rest-seat suggestion dot by their own
 * placeXAssemblyOnTooth. They need no surface, so a tap on the tooth body used to fall
 * through and store the assembly id itself — not a real component, and it then showed up
 * in the tooth's remove list.
 */
describe("assembly ids never become placements", () => {
  it.each([...ASSEMBLY_REST_SUGGESTION_IDS])("%s places nothing on a present tooth", (id) => {
    const t = toothAt("36");
    place(id, "36", null);
    expect(t.componentPlacements).toEqual([]);
    expect(t.components).toEqual([]);
  });

  it("also places nothing on a missing tooth (REMOVE_THEN_PLACE would otherwise force it)", () => {
    const t = toothAt("36", [], false);
    place("assembly-circ", "36", null);
    expect(t.componentPlacements).toEqual([]);
  });

  it("does not clear components a tooth already carries", () => {
    const t = toothAt("36");
    t.components = ["rest-seat"];
    t.componentPlacements = [{ componentId: "rest-seat", surface: "mesial" }];
    place("assembly-rpi", "36", null);
    expect(t.componentPlacements).toEqual([{ componentId: "rest-seat", surface: "mesial" }]);
  });
});

/**
 * The plate and the connector segment on one tooth are two components: erasing the plate
 * used to take the major connector with it, so there was no way to keep a connector run
 * whole while unplating a single tooth. The clasp still follows its reciprocation off.
 */
describe("plate and major connector are removed independently", () => {
  /** 15-17 / 25-27 plated, horseshoe switched on: a real run with interior teeth. */
  function platedUpperArch() {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["15", "16", "17", "25", "26", "27"]) {
      teeth[id] = tooth(["plate-prox"], { toothId: id });
    }
    state.teeth = teeth;
    switchMajorIn(teeth, "major-upper-horseshoe", "upper");
    return teeth;
  }

  const MAJOR_BY_TOOTH = [
    ["15", "major-upper-palatal-strap"],
    ["12", "major-upper-palatal-strap"],
    ["16", "major-upper-horseshoe"],
    ["36", "major-lower-lingual-plate"],
  ];

  it.each(MAJOR_BY_TOOTH)("tooth %s: toggling plate-prox off keeps %s", (toothId, majorId) => {
    const t = toothAt(toothId, ["plate-prox", majorId]);
    place("plate-prox", toothId, null);
    expect(idsOn(t)).toEqual([majorId]);
    expect(t.components).toEqual([majorId]);
  });

  it.each(MAJOR_BY_TOOTH)("tooth %s: the remove list keeps %s too", (toothId, majorId) => {
    const t = toothAt(toothId, ["plate-prox", majorId]);
    const removed = { componentId: "plate-prox", surface: null };
    removePlacement(t, "plate-prox", null);
    applyRemovalSideEffectsForTooth(t, removed);
    expect(idsOn(t)).toEqual([majorId]);
  });

  it("removing the major connector leaves the plate in place", () => {
    const t = toothAt("15", ["plate-prox", "major-upper-palatal-strap"]);
    const removed = { componentId: "major-upper-palatal-strap", surface: null };
    removePlacement(t, "major-upper-palatal-strap", null);
    applyRemovalSideEffectsForTooth(t, removed);
    expect(idsOn(t)).toEqual(["plate-prox"]);
  });

  it("a clasp still goes with the plate that reciprocates it", () => {
    const t = toothAt("15", ["plate-prox", "retainer-clasp", "major-upper-palatal-strap"]);
    place("plate-prox", "15", null);
    expect(idsOn(t)).toEqual(["major-upper-palatal-strap"]);
  });

  /** The render prune is the other half: a segment kept here must survive the next frame,
   *  which it does as long as its run still holds an anchor elsewhere. */
  it("the unplated tooth keeps its segment through the render prune", () => {
    const teeth = platedUpperArch();

    place("plate-prox", "16");
    pruneInvalidMajorConnectorPlacementsInJaw(teeth, COMPONENT_BY_ID, "upper");

    expect(idsOn(teeth["16"])).toEqual(["major-upper-horseshoe"]);
  });

  /** An interior segment comes off on its own, neighbours on both sides or not. */
  it("an interior segment is removed while its neighbours keep theirs", () => {
    const teeth = platedUpperArch();

    place("major-upper-horseshoe", "16");

    expect(idsOn(teeth["16"])).toEqual(["plate-prox"]);
    for (const id of ["15", "17"]) {
      expect(idsOn(teeth[id])).toContain("major-upper-horseshoe");
    }
  });
});

/**
 * The anteriors 13-23 used to be walled off under Palatal Bar: no segment could be placed
 * there and any major was cleared and hidden. The plating decides now, exactly as it does
 * on the posterior teeth — and an unwanted segment is one click away from gone.
 */
describe("Palatal Bar follows the plating onto the anteriors", () => {
  const BAR = "major-upper-palatal-bar";

  /** 15-17 / 25-27 plated, plus whichever other teeth the case asks for; bar picked. */
  function barredArch(...plated) {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["15", "16", "17", "25", "26", "27", ...plated]) {
      teeth[id] = tooth(["plate-prox"], { toothId: id });
    }
    state.teeth = teeth;
    pickPalatalBar(teeth);
    return teeth;
  }

  /** What the catalog does when Palatal Bar is picked. */
  function pickPalatalBar(teeth) {
    ensurePalatalBarPlacementsOnAnchoredUpperTeeth(teeth, COMPONENT_BY_ID);
    removeNonBarMajorPlacementsFromUpperArch(teeth);
    for (const id of TOOTH_ORDER.upper) syncToothComponentsFromPlacements(teeth[id]);
  }

  const hasBarOn = (teeth, id) =>
    teeth[id].componentPlacements.some((e) => e.componentId === BAR);

  it.each(["13", "12", "11", "21", "22", "23"])("a plated %s gets a bar segment", (toothId) => {
    const teeth = barredArch(toothId);
    expect(hasBarOn(teeth, toothId)).toBe(true);
    expect(idsOn(teeth[toothId])).toContain("plate-prox");
  });

  it("an unplated anterior gets nothing", () => {
    const teeth = barredArch("13");
    for (const id of ["12", "11", "21", "22", "23"]) {
      expect(hasBarOn(teeth, id)).toBe(false);
      expect(idsOn(teeth[id])).toEqual([]);
    }
  });

  it("the outgoing connector is cleared off the whole arch, plated or not", () => {
    const teeth = barredArch("13");
    addPlacement(teeth["11"], "major-upper-horseshoe", null);
    addPlacement(teeth["13"], "major-upper-horseshoe", null);

    pickPalatalBar(teeth);

    expect(idsOn(teeth["11"])).toEqual([]);
    expect(idsOn(teeth["13"])).toEqual(["plate-prox", BAR]);
  });

  it("an anterior segment survives the render prune and comes off on a click", () => {
    const teeth = barredArch("13");
    pruneInvalidMajorConnectorPlacementsInJaw(teeth, COMPONENT_BY_ID, "upper");
    expect(hasBarOn(teeth, "13")).toBe(true);

    place(BAR, "13");
    expect(hasBarOn(teeth, "13")).toBe(false);
    expect(idsOn(teeth["13"])).toEqual(["plate-prox"]);
  });

  it("and is placed back by clicking the plated tooth again", () => {
    const teeth = barredArch("13");
    place(BAR, "13");

    place(BAR, "13");

    expect(hasBarOn(teeth, "13")).toBe(true);
  });
});

/**
 * toothSupportsMajorConnectorOverlay gates BOTH the ghost the arch draws while a major is
 * selected and the click that places it, so it must not be looser than the placement rules:
 * a tooth it accepts but the design never covers renders a connector stub hanging off the
 * arch — the terminal molars 18/28 under A-P Strap / Palatal Bar.
 */
describe("a major connector is only offered where its span reaches", () => {
  const UPPER_MAJORS = [...COMPONENT_BY_ID.values()]
    .filter((d) => isMajorConnectorComponent(d) && d.section === "upper")
    .map((d) => d.id);

  /** Bilateral posterior saddles meshed, abutments plated + clasped, anteriors bare. */
  function upperArch(terminalMolars = []) {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["16", "26"]) teeth[id] = tooth(["mesh-hole"], { isPresent: false, toothId: id });
    for (const id of ["15", "17", "25", "27"]) {
      teeth[id] = tooth(["plate-prox", "retainer-clasp"], { toothId: id });
    }
    for (const id of ["18", "28"]) teeth[id] = tooth(terminalMolars, { toothId: id });
    state.teeth = teeth;
    return teeth;
  }

  const hasMajor = (t) =>
    Boolean(t?.componentPlacements.some((e) => isMajorConnectorComponent(e.componentId)));

  it.each(UPPER_MAJORS)("%s: every offered tooth is one the design covers, bare 18/28 least of all", (majorId) => {
    const teeth = upperArch();
    ensureMajorConnectorPlacementsOnSupportedTeethInJaws(teeth, majorId, COMPONENT_BY_ID, ["upper"]);
    const offeredButBare = TOOTH_ORDER.upper.filter(
      (id) =>
        !hasMajor(teeth[id]) && toothSupportsMajorConnectorOverlay(teeth[id], id, majorId, teeth)
    );
    expect(offeredButBare).toEqual([]);

    // The terminal molars sit distal of every anchor, so no run reaches them. A-P Strap
    // (palatal hole) and Palatal Bar used to accept them unconditionally.
    for (const id of ["18", "28"]) {
      expect(toothSupportsMajorConnectorOverlay(teeth[id], id, majorId, teeth)).toBe(false);
    }
  });

  it("bare anteriors between the anchors and the midline stay offered (span carries them)", () => {
    const teeth = upperArch();
    for (const id of ["14", "13", "12", "11", "21", "22", "23", "24"]) {
      expect(toothSupportsMajorConnectorOverlay(teeth[id], id, "major-upper-palatal-hole", teeth)).toBe(true);
    }
  });

  it("a meshed 18/28 anchors the connector itself and is offered", () => {
    const teeth = upperArch(["mesh-hole"]);
    for (const id of ["18", "28"]) {
      teeth[id].isPresent = false;
      expect(toothSupportsMajorConnectorOverlay(teeth[id], id, "major-upper-palatal-hole", teeth)).toBe(true);
      expect(toothSupportsMajorConnectorOverlay(teeth[id], id, "major-upper-palatal-bar", teeth)).toBe(true);
    }
  });

  /**
   * The lower arch had the same hole, wider: the lingual bar accepted ANY lower tooth with
   * connector art. It cannot simply be anchor-gated, though — a bar plates nothing, so
   * picking one strips the plate-prox that anchored the run, and gating on anchors alone
   * would declare the bar's own arch unplaceable ("can't place the MJ again").
   */
  describe("lower: the lingual bar's run, not the whole arch", () => {
    const LOWER_MAJORS = ["major-lower-lingual-bar", "major-lower-lingual-plate", "major-lower-lingual-kennedy"];

    /** Anterior saddle meshed, 34/37/44/47 plated (NO clasps), 38/48 present and bare. */
    function lowerArch() {
      const teeth = {};
      for (const id of TOOTH_ORDER.lower) teeth[id] = tooth([], { toothId: id });
      for (const id of ["33", "32", "31", "41", "42", "43"]) {
        teeth[id] = tooth(["mesh-hole"], { isPresent: false, toothId: id });
      }
      for (const id of ["34", "37", "44", "47"]) teeth[id] = tooth(["plate-prox"], { toothId: id });
      state.teeth = teeth;
      return teeth;
    }

    it.each(LOWER_MAJORS)("%s: every offered tooth is one the design covers, bare 38/48 least of all", (majorId) => {
      const teeth = lowerArch();
      ensureMajorConnectorPlacementsOnSupportedTeethInJaws(teeth, majorId, COMPONENT_BY_ID, ["lower"]);
      const offeredButBare = TOOTH_ORDER.lower.filter(
        (id) => !hasMajor(teeth[id]) && toothSupportsMajorConnectorOverlay(teeth[id], id, majorId, teeth)
      );
      expect(offeredButBare).toEqual([]);
      for (const id of ["38", "48"]) {
        expect(toothSupportsMajorConnectorOverlay(teeth[id], id, majorId, teeth)).toBe(false);
      }
    });

    /** Pick a bar the way the catalog does, so the plate-stripping really happens. */
    const switchToBar = (teeth) => switchMajorIn(teeth, "major-lower-lingual-bar", "lower");

    // What the old blanket rule was really guarding: a bar plates nothing, so after the
    // switch NOTHING in the run anchors it any more. The run must survive that on its own.
    it("a bar that stripped its own plate anchors keeps its whole run", () => {
      const teeth = lowerArch();
      switchToBar(teeth);
      expect(TOOTH_ORDER.lower.filter((id) => teeth[id].components.includes("plate-prox"))).toEqual([]);
      expect(TOOTH_ORDER.lower.filter((id) => hasMajor(teeth[id]))).toEqual([
        "37", "36", "35", "34", "33", "32", "31", "41", "42", "43", "44", "45", "46", "47",
      ]);
      // ...and 38/48 stay out of it, which is the bug this describe block is about.
      for (const id of ["38", "48"]) {
        expect(toothSupportsMajorConnectorOverlay(teeth[id], id, "major-lower-lingual-bar", teeth)).toBe(false);
      }
    });

    /**
     * The one behaviour the span gate takes away. Removing the DISTAL END of a run leaves a
     * tooth that anchors nothing, because the bar already stripped its plate. It is then
     * outside the run and cannot be clicked back: re-anchor it, or switch back to the plate.
     * The alternative — letting a run grow one tooth distally — is exactly what drew the
     * 18/28/38/48 stubs, since those teeth are always the next one out.
     */
    it("removing a run's end tooth under a bar needs a re-anchor to undo", () => {
      const teeth = lowerArch();
      switchToBar(teeth);
      removePlacement(teeth["37"], "major-lower-lingual-bar", null);
      syncToothComponentsFromPlacements(teeth["37"]);

      expect(toothSupportsMajorConnectorOverlay(teeth["37"], "37", "major-lower-lingual-bar", teeth)).toBe(false);

      addPlacement(teeth["37"], "plate-prox", null);
      syncToothComponentsFromPlacements(teeth["37"]);
      expect(toothSupportsMajorConnectorOverlay(teeth["37"], "37", "major-lower-lingual-bar", teeth)).toBe(true);
    });
  });
});

/**
 * Full acrylic (jawMaterial 2) changes which components the catalog offers and how they are
 * tinted — NOT how a major connector is placed. It used to span 7-to-7 anchor-free, which
 * put the horseshoe on 17/27 with no plate under them, and it skipped the plating sync so
 * the anteriors it covered never got their plate-prox.
 */
describe("full acrylic places a major exactly as metal does", () => {
  /** The reported case: plates on 16/26 only, 17/27 and the anteriors bare. */
  function acrylicUpperArch() {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["16", "26"]) teeth[id] = tooth(["plate-prox"], { toothId: id });
    state.teeth = teeth;
    state.jawMaterial = 2;
    return teeth;
  }

  const upperWith = (teeth, componentId) =>
    TOOTH_ORDER.upper.filter((id) => teeth[id].componentPlacements.some((e) => e.componentId === componentId));

  afterEach(() => {
    state.jawMaterial = null;
  });

  it("stops the span at the anchor: no connector on the plateless 17/27", () => {
    const teeth = acrylicUpperArch();
    switchMajorIn(teeth, "major-upper-horseshoe", "upper");
    expect(upperWith(teeth, "major-upper-horseshoe").sort()).toEqual(
      ["11", "12", "13", "14", "15", "16", "21", "22", "23", "24", "25", "26"]
    );
    for (const id of ["17", "18", "27", "28"]) {
      expect(toothSupportsMajorConnectorOverlay(teeth[id], id, "major-upper-horseshoe", teeth)).toBe(false);
    }
  });

  it("auto-fills plate-prox on the anteriors it covers", () => {
    const teeth = acrylicUpperArch();
    switchMajorIn(teeth, "major-upper-horseshoe", "upper");
    expect(upperWith(teeth, "plate-prox").sort()).toEqual(
      ["11", "12", "13", "14", "15", "16", "21", "22", "23", "24", "25", "26"]
    );
  });

  it("the placed span survives the render prune", () => {
    const teeth = acrylicUpperArch();
    switchMajorIn(teeth, "major-upper-horseshoe", "upper");
    const before = upperWith(teeth, "major-upper-horseshoe");
    pruneInvalidMajorConnectorPlacementsInJaw(teeth, COMPONENT_BY_ID, "upper");
    expect(upperWith(teeth, "major-upper-horseshoe")).toEqual(before);
  });
});

/**
 * Full acrylic refuses metal mesh, the open palatal majors, and what its catalog hides (bars,
 * reciprocating and ring clasps); rests and the wire clasp place as on metal.
 */
describe("full acrylic material gate", () => {
  beforeEach(() => {
    state.jawMaterial = 2;
  });

  afterEach(() => {
    state.jawMaterial = null;
  });

  it.each([
    ["rest-seat", "mesial"],
    ["rest-onlay", "mesial"],
    ["retainer-clasp", "mesial_buccal"],
  ])("places %s", (componentId, surface) => {
    const t = toothAt("36");
    place(componentId, "36", surface);
    expect(t.components).toContain(componentId);
  });

  it.each([
    ["bar-i", "bar_d1_distal"],
    ["reciprocating-clasp", "mesial_lingual"],
    ["ring-clasp", "mesial_buccal"],
  ])("refuses %s, hidden from the acrylic catalog", (componentId, surface) => {
    const t = toothAt("36");
    place(componentId, "36", surface);
    expect(t.components).not.toContain(componentId);
  });

  it("still refuses metal mesh but takes the flange", () => {
    const t = toothAt("36", [], false);
    place("mesh-hole", "36");
    expect(t.components).toEqual([]);
    place("mesh-flange", "36");
    expect(t.components).toContain("mesh-flange");
  });
});

/**
 * The connector follows the tooth the dentist changed, and only that tooth. A plate or mesh
 * they placed themselves beside a run END joins the run; the plate-prox a clasp/bar/rest
 * auto-adds as reciprocation does NOT — that used to make an I-bar on a bare 17 sprout a
 * horseshoe plate there unasked. Nothing beyond the changed tooth is ever re-derived.
 */
describe("the connector follows the changed tooth only", () => {
  /** Plates on 16/26, everything else bare — the connector stops at 16 and 26. */
  function archEndingAtSixes() {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["16", "26"]) teeth[id] = tooth(["plate-prox"], { toothId: id });
    state.teeth = teeth;
    switchMajorIn(teeth, "major-upper-horseshoe", "upper");
    return teeth;
  }

  const hasMajorOn = (teeth, id) =>
    teeth[id].componentPlacements.some((e) => e.componentId === "major-upper-horseshoe");
  const hasMajorIdOn = (teeth, id, majorId) =>
    teeth[id].componentPlacements.some((e) => e.componentId === majorId);
  const runIn = (teeth) => TOOTH_ORDER.upper.filter((id) => hasMajorOn(teeth, id));

  it("plating a bare 17 beside a run ending at 16 extends it onto 17", () => {
    const teeth = archEndingAtSixes();
    expect(hasMajorOn(teeth, "17")).toBe(false);

    place("plate-prox", "17");
    expect(hasMajorOn(teeth, "17")).toBe(true);
  });

  it("meshing a missing 17 beside the run extends it onto 17", () => {
    const teeth = archEndingAtSixes();
    teeth["17"] = tooth([], { isPresent: false, toothId: "17" });

    place("mesh-hole", "17");
    expect(teeth["17"].components).toContain("mesh-hole");
    expect(hasMajorOn(teeth, "17")).toBe(true);
  });

  /** The bug report: the plate is reciprocation for the retentive element, not a decision
   *  to grow the connector, so 17 gains plate-prox but no horseshoe. */
  it.each([
    ["bar-i", "mesial"],
    ["rest-seat", "mesial"],
    ["retainer-clasp", "distal_buccal"],
    ["ring-clasp", "distal_buccal"],
    ["reciprocating-clasp", "distal_lingual"],
  ])("%s on a bare 17 leaves it connector-free despite the plate it auto-adds", (componentId, surface) => {
    const teeth = archEndingAtSixes();
    place(componentId, "17", surface);
    expect(teeth["17"].components).toContain(componentId);
    expect(hasMajorOn(teeth, "17")).toBe(false);
  });

  it("does not walk past the changed tooth onto an already-plated 18", () => {
    const teeth = archEndingAtSixes();
    addPlacement(teeth["18"], "plate-prox", null);
    syncToothComponentsFromPlacements(teeth["18"]);

    place("plate-prox", "17");
    expect([hasMajorOn(teeth, "17"), hasMajorOn(teeth, "18")]).toEqual([true, false]);
  });

  it("does not jump a bare tooth: plating 18 alone leaves 17 and 18 out", () => {
    const teeth = archEndingAtSixes();
    place("plate-prox", "18");
    expect([hasMajorOn(teeth, "17"), hasMajorOn(teeth, "18")]).toEqual([false, false]);
  });

  it("leaves the other arch alone", () => {
    const teeth = archEndingAtSixes();
    for (const id of TOOTH_ORDER.lower) teeth[id] = tooth([], { toothId: id });
    place("plate-prox", "17");
    expect(TOOTH_ORDER.lower.some((id) => teeth[id].componentPlacements.length)).toBe(false);
  });

  it("changes nothing anywhere else in the arch", () => {
    const teeth = archEndingAtSixes();
    const before = runIn(teeth);
    place("plate-prox", "17");
    expect(runIn(teeth)).toEqual([...before, "17"].sort((a, b) => TOOTH_ORDER.upper.indexOf(a) - TOOTH_ORDER.upper.indexOf(b)));
  });

  it("switching to Palatal Strap keeps a newly extended third molar endpoint", () => {
    const teeth = archEndingAtSixes();
    place("plate-prox", "17");
    place("plate-prox", "18");

    switchMajorIn(teeth, "major-upper-palatal-strap", "upper");

    expect(hasMajorIdOn(teeth, "18", "major-upper-palatal-strap")).toBe(true);
    expect(hasMajorIdOn(teeth, "17", "major-upper-palatal-strap")).toBe(true);
    expect(hasMajorIdOn(teeth, "13", "major-upper-palatal-strap")).toBe(false);

    const points = computePalatalStrapPolygonPoints(teeth);
    expect(points[6].y).toBeGreaterThan(320);
  });

  it("switching to Palatal Strap connects a manually added canine proximal plate", () => {
    const teeth = archEndingAtSixes();
    addPlacement(teeth["23"], "plate-prox", null);
    syncToothComponentsFromPlacements(teeth["23"]);

    switchMajorIn(teeth, "major-upper-palatal-strap", "upper");

    expect(idsOn(teeth["23"])).toContain("plate-prox");
    expect(hasMajorIdOn(teeth, "23", "major-upper-palatal-strap")).toBe(true);
    expect(hasMajorIdOn(teeth, "22", "major-upper-palatal-strap")).toBe(false);
  });

  it.each(["11", "12", "21", "22"])(
    "switching to Palatal Strap connects a manually added incisor proximal plate on %s",
    (toothId) => {
      const teeth = archEndingAtSixes();
      addPlacement(teeth[toothId], "plate-prox", null);
      syncToothComponentsFromPlacements(teeth[toothId]);

      switchMajorIn(teeth, "major-upper-palatal-strap", "upper");

      expect(idsOn(teeth[toothId])).toContain("plate-prox");
      expect(hasMajorIdOn(teeth, toothId, "major-upper-palatal-strap")).toBe(true);
    }
  );

  it("removes an interior Palatal Strap segment after anterior extension", () => {
    const teeth = archEndingAtSixes();
    for (const toothId of ["11", "12", "21", "22"]) {
      addPlacement(teeth[toothId], "plate-prox", null);
      syncToothComponentsFromPlacements(teeth[toothId]);
    }
    switchMajorIn(teeth, "major-upper-palatal-strap", "upper");
    expect(hasMajorIdOn(teeth, "12", "major-upper-palatal-strap")).toBe(true);

    place("major-upper-palatal-strap", "12");

    expect(hasMajorIdOn(teeth, "12", "major-upper-palatal-strap")).toBe(false);
    expect(hasMajorIdOn(teeth, "11", "major-upper-palatal-strap")).toBe(true);
    expect(idsOn(teeth["12"])).toContain("plate-prox");
  });

  it.each(["11", "12", "13", "21", "22", "23"])(
    "removing an anterior proximal plate keeps its Palatal Strap segment, removable on its own, on %s",
    (toothId) => {
      const teeth = archEndingAtSixes();
      addPlacement(teeth[toothId], "plate-prox", null);
      syncToothComponentsFromPlacements(teeth[toothId]);
      switchMajorIn(teeth, "major-upper-palatal-strap", "upper");

      place("plate-prox", toothId);

      expect(idsOn(teeth[toothId])).not.toContain("plate-prox");
      expect(hasMajorIdOn(teeth, toothId, "major-upper-palatal-strap")).toBe(true);

      place("major-upper-palatal-strap", toothId);
      expect(hasMajorIdOn(teeth, toothId, "major-upper-palatal-strap")).toBe(false);
    }
  );
});

/**
 * A clasp is not a seat for the major connector — only a plate (present) or mesh (missing)
 * is. This bites on the reciprocating clasp specifically: it owns the tooth's reciprocating
 * slot, so unlike a retainer/ring clasp no plate-prox is auto-added behind it, and the run
 * used to fill onto a tooth with nothing under it. Clicking one on by hand still works.
 */
describe("only a plate or mesh anchors the major connector", () => {
  /** Plates on 15/25 anchor the run; 16/26 carry the component under test. */
  function upperArchWithSixes(sixComponents, { isPresent = true } = {}) {
    const teeth = {};
    for (const id of TOOTH_ORDER.upper) teeth[id] = tooth([], { toothId: id });
    for (const id of ["15", "25"]) teeth[id] = tooth(["plate-prox"], { toothId: id });
    for (const id of ["16", "26"]) {
      teeth[id] = tooth(sixComponents, { isPresent, toothId: id });
    }
    state.teeth = teeth;
    state.designMode = true;
    return teeth;
  }

  const MAJOR = "major-upper-horseshoe";
  const hasMajorOn = (teeth, id) =>
    teeth[id].componentPlacements.some((e) => e.componentId === MAJOR);

  it("a reciprocating clasp alone does NOT auto-fill the connector onto its tooth", () => {
    const teeth = upperArchWithSixes(["reciprocating-clasp"]);
    switchMajorIn(teeth, MAJOR, "upper");
    expect(hasMajorOn(teeth, "16")).toBe(false);
    expect(hasMajorOn(teeth, "26")).toBe(false);
    // ...and the run it did place still reaches the plated teeth behind them.
    expect(hasMajorOn(teeth, "15")).toBe(true);
  });

  it.each(["retainer-clasp", "ring-clasp"])(
    "a %s does not anchor on its own either",
    (claspId) => {
      const teeth = upperArchWithSixes([claspId]);
      switchMajorIn(teeth, MAJOR, "upper");
      expect(hasMajorOn(teeth, "16")).toBe(false);
    }
  );

  it.each(["plate-prox", "plate-crossmesh"])("a %s anchors it", (plateId) => {
    const teeth = upperArchWithSixes([plateId]);
    switchMajorIn(teeth, MAJOR, "upper");
    expect(hasMajorOn(teeth, "16")).toBe(true);
  });

  it("a clasp backed by a plate anchors it through the plate", () => {
    const teeth = upperArchWithSixes(["reciprocating-clasp", "plate-prox"]);
    switchMajorIn(teeth, MAJOR, "upper");
    expect(hasMajorOn(teeth, "16")).toBe(true);
  });

  it("mesh on a missing tooth anchors it", () => {
    const teeth = upperArchWithSixes(["mesh-hole"], { isPresent: false });
    switchMajorIn(teeth, MAJOR, "upper");
    expect(hasMajorOn(teeth, "16")).toBe(true);
  });

  it("the follow-the-change rule does not fill onto a new reciprocating clasp", () => {
    const teeth = upperArchWithSixes([]);
    switchMajorIn(teeth, MAJOR, "upper");
    expect(hasMajorOn(teeth, "16")).toBe(false);

    place("reciprocating-clasp", "16", "distal_lingual");
    expect(idsOn(teeth["16"])).toContain("reciprocating-clasp");
    expect(hasMajorOn(teeth, "16")).toBe(false);
  });

  it("a reci-clasped tooth can still be given the connector by hand", () => {
    const teeth = upperArchWithSixes(["reciprocating-clasp"]);
    switchMajorIn(teeth, MAJOR, "upper");
    expect(toothSupportsMajorConnectorOverlay(teeth["16"], "16", MAJOR, teeth)).toBe(true);

    place(MAJOR, "16");
    expect(hasMajorOn(teeth, "16")).toBe(true);
  });
});
