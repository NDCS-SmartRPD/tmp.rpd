/**
 * A design proposal derived from each arch's Kennedy class: the major connector, and the
 * rest seats that class calls for.
 *
 * Connector, per the metal-RPD selection matrix — an A-P strap carries the distal-extension
 * classes, a single palatal strap suffices for the tooth-borne Class III, and the mandible
 * takes a lingual bar unless the anteriors need splinting. Full acrylic follows its own
 * table (see chooseAcrylicConnector).
 *
 * Rests, per the rest-placement rules — adjacent to the space on a bounded span, mesial on a
 * free-end terminal abutment, plus an indirect retainer where the class rotates.
 *
 * Clasps, per the clasp-placement rules — a circlet running away from a bounded space, the
 * RPI's infrabulge I-bar on a free-end canine or premolar, a ring on an isolated molar. The
 * T-bar and Y-bar are never proposed: their indications are the position of the undercut and
 * the shape of the survey line, and the 2D arch records neither. They stay manual picks.
 *
 * All of that is the CAST METAL design. A full-acrylic case is a different prosthesis and
 * gets a different, much simpler proposal: its own connector table, clasps only — no rests,
 * no bars — placed by planAcrylicClasps.
 *
 * Dimensional triggers throughout (floor-of-mouth depth, ridge resorption, tori, rest-seat
 * millimetres) are deliberately not modelled: the 2D arch measures no millimetres, so the
 * primary choice always wins. The alternatives that ARE knowable — a compromised abutment,
 * the size of the span — do switch the choice.
 *
 * Pure: mutates only the teeth map it is handed. No DOM, no annotation-state import.
 */
import {
  COMPONENT_BY_ID,
  ensureMeshPlacementsOnMissingTeeth,
  ensurePlatePlacementsOnPresentTeethInJaws,
  getBarPlacementSurfaceForTooth,
  isMeshComponent,
  switchMajorConnectorInJaws,
  syncReciprocatingPlatesToMajorConnector,
} from "./components.js";
import {
  forEachTooth,
  getNeighborToothIds,
  isAutoMeshPlacementExcludedToothId,
  TOOTH_ORDER,
} from "./constants.js";
import { classifyArch, sideOfToothId } from "./JawDesign.js";

/** state.jawMaterial for a full-acrylic case; 0/null are metal. */
export const FULL_ACRYLIC_MATERIAL = 2;

const UPPER_AP_STRAP = "major-upper-palatal-hole";
const UPPER_SINGLE_STRAP = "major-upper-palatal-strap";
const UPPER_FULL_PLATE = "major-upper-palatal-plate";
const UPPER_HORSESHOE = "major-upper-horseshoe";
const LOWER_LINGUAL_BAR = "major-lower-lingual-bar";
const LOWER_LINGUAL_PLATE = "major-lower-lingual-plate";

/** The flange is the one mesh the full-acrylic material gate lets through. */
const ACRYLIC_MESH_ID = "mesh-flange";
const DEFAULT_PLATE_ID = "plate-prox";
const REST_COMPONENT_ID = "rest-seat";

/** Indirect retainers seat on the first premolar, or the canine's cingulum behind it. */
const INDIRECT_REST_UNITS = Object.freeze([4, 3]);

const CONNECTOR_BY_CLASS = Object.freeze({
  upper: {
    1: { primary: UPPER_AP_STRAP, reason: "bilateral distal extension needs cross-arch rigidity" },
    2: { primary: UPPER_AP_STRAP, reason: "unilateral distal extension loads the arch asymmetrically" },
    3: { primary: UPPER_SINGLE_STRAP, reason: "tooth-borne, so palatal coverage stays minimal" },
    4: { primary: UPPER_AP_STRAP, reason: "anterior replacement needs rigidity against displacement" },
  },
  lower: {
    1: { primary: LOWER_LINGUAL_BAR, reason: "standard connector where the anteriors are sound" },
    2: { primary: LOWER_LINGUAL_BAR, reason: "standard connector where the anteriors are sound" },
    3: { primary: LOWER_LINGUAL_BAR, reason: "tooth-borne, no rotation to resist" },
    4: { primary: LOWER_LINGUAL_PLATE, reason: "plates the anterior abutments and gives indirect retention" },
  },
});

/** Upper acrylic: a bounded case this small keeps the palate open instead of plating it. */
const ACRYLIC_HORSESHOE_MAX_TEETH = 5;

/** Class III is fully tooth-supported, so it alone needs no indirect retainer. */
const NEEDS_INDIRECT_RETENTION = Object.freeze({ 1: true, 2: true, 3: false, 4: true });

const isAnteriorToothId = (fdi) => {
  const unit = Number(String(fdi).slice(1));
  return unit >= 1 && unit <= 3;
};

/** A span abutment with failing periodontal support — the matrix answers with full coverage. */
function hasCompromisedAbutment(teeth, classification) {
  return classification.spans.some((span) =>
    span.abutments.some((abutment) => teeth[abutment.fdi]?.status === "compromised")
  );
}

/** Compromised lower anteriors are the splinting case a lingual plate exists for. */
function hasCompromisedAnterior(teeth, jaw) {
  return (TOOTH_ORDER[jaw] || []).some((fdi) => {
    const tooth = teeth[fdi];
    return isAnteriorToothId(fdi) && tooth?.isPresent && tooth.status === "compromised";
  });
}

const describeChoice = (componentId, reason, classNumber) => ({
  componentId,
  label: COMPONENT_BY_ID.get(componentId)?.label || componentId,
  reason,
  needsIndirectRetention: Boolean(NEEDS_INDIRECT_RETENTION[classNumber]),
});

/** Teeth the design has to replace — the classified spans, so a missing third molar that
 *  Applegate rule 2 dropped is not counted against the arch. */
function countTeethToReplace(classification) {
  return classification.spans.reduce((total, span) => total + span.fdis.length, 0);
}

/**
 * Full acrylic is a different prosthesis, not a restricted metal one: mucosa-borne, so it
 * spreads the bite over the soft tissues rather than running a rigid connector between
 * abutments. A free-end saddle takes the plate on either arch. Above, a bounded case of
 * fewer than five teeth is light enough to leave the palate open with a horseshoe instead;
 * below there is no horseshoe, so the lingual plate answers every class.
 */
function chooseAcrylicConnector(classification) {
  const { jaw, classNumber } = classification;
  if (jaw !== "upper") {
    return { componentId: LOWER_LINGUAL_PLATE, reason: "full acrylic — the lingual plate carries the bite onto the soft tissues" };
  }
  const isFreeEnd = classNumber === 1 || classNumber === 2;
  if (isFreeEnd) {
    return { componentId: UPPER_FULL_PLATE, reason: "free-end saddle — plate coverage distributes the bite onto the soft tissues" };
  }
  if (countTeethToReplace(classification) < ACRYLIC_HORSESHOE_MAX_TEETH) {
    return { componentId: UPPER_HORSESHOE, reason: "tooth-borne and a short span — the horseshoe leaves the palate open" };
  }
  return { componentId: UPPER_FULL_PLATE, reason: "a long span to replace — plate coverage spreads the load" };
}

/**
 * The connector for one classified arch, or null when Kennedy gives the arch no class
 * (dentate — nothing to replace; edentulous — no abutments to carry a framework).
 */
export function chooseMajorConnector(classification, teeth, { material = null } = {}) {
  const { jaw, classNumber } = classification || {};
  const rule = CONNECTOR_BY_CLASS[jaw]?.[classNumber];
  if (!rule) return null;

  // Acrylic follows its own table — the metal matrix's strap/bar choices are not on offer.
  if (material === FULL_ACRYLIC_MATERIAL) {
    const acrylic = chooseAcrylicConnector(classification);
    return describeChoice(acrylic.componentId, acrylic.reason, classNumber);
  }

  let componentId = rule.primary;
  let reason = rule.reason;

  if (jaw === "upper" && componentId !== UPPER_FULL_PLATE && hasCompromisedAbutment(teeth, classification)) {
    componentId = UPPER_FULL_PLATE;
    reason = "compromised abutment — full palatal coverage spreads the load";
  }
  if (jaw === "lower" && componentId === LOWER_LINGUAL_BAR && hasCompromisedAnterior(teeth, jaw)) {
    componentId = LOWER_LINGUAL_PLATE;
    reason = "compromised anteriors need the plate's splinting";
  }

  return describeChoice(componentId, reason, classNumber);
}

const toothUnit = (fdi) => Number(String(fdi).slice(1));

/**
 * An anterior abutment carries its rest on the cingulum shelf rather than in an occlusal
 * fossa, which the placement model spells `lingual_mesial` / `lingual_distal`. Incisal rests
 * are the documented fallback for a canine that cannot take one, but nothing in the 2D model
 * records enamel thickness, so they are never proposed.
 */
function restSurfaceForTooth(fdi, surface) {
  return isAnteriorToothId(fdi) ? `lingual_${surface}` : surface;
}

/**
 * Sites the proposal may CHOOSE for itself exclude the terminal molars, the same four teeth
 * the arch already keeps out of automatic mesh and plating. A third molar that genuinely
 * bounds an edentulous span is still an abutment — that is not a choice, it is the anatomy.
 */
const isSelectableSite = (fdi) => !isAutoMeshPlacementExcludedToothId(fdi);

/** The present tooth furthest back in one quadrant — the Class IV indirect retainer. */
function posteriorMostPresentToothId(teeth, quadrantIds) {
  let best = null;
  for (const fdi of quadrantIds) {
    if (!teeth[fdi]?.isPresent || !isSelectableSite(fdi)) continue;
    if (!best || toothUnit(fdi) > toothUnit(best)) best = fdi;
  }
  return best;
}

/** First premolar, else canine — the classic indirect rest seats, anterior to the fulcrum. */
function anteriorIndirectToothId(teeth, quadrantIds) {
  for (const unit of INDIRECT_REST_UNITS) {
    const fdi = quadrantIds.find((id) => toothUnit(id) === unit);
    if (fdi && teeth[fdi]?.isPresent) return fdi;
  }
  return null;
}

function quadrantsOf(jaw) {
  const order = TOOTH_ORDER[jaw] || [];
  const mid = Math.floor(order.length / 2);
  return [order.slice(0, mid), order.slice(mid)];
}

/**
 * Primary rests: adjacent to the space on a tooth-bounded span (rule A), and on the MESIAL
 * of a free-end terminal abutment (rule B) — which is what moves the fulcrum forward so the
 * saddle rotates away from the abutment instead of levering it out.
 */
function planPrimaryRests(classification) {
  const rests = [];
  for (const span of classification.spans) {
    for (const abutment of span.abutments) {
      const surface = span.isDistalExtension ? "mesial" : abutment.facingSurface;
      if (!surface) continue;
      rests.push({
        fdi: abutment.fdi,
        surface: restSurfaceForTooth(abutment.fdi, surface),
        role: span.isDistalExtension ? "terminal" : "primary",
      });
    }
  }
  return rests;
}

/**
 * Indirect retainers (rule C) resist the saddle lifting away from the ridge, so they sit as
 * far from the fulcrum line as the arch allows:
 *   Class I  — both sides, on the first premolar or the canine.
 *   Class II — the side without the extension, where there is a fulcrum to lever against.
 *   Class IV — behind the anterior fulcrum instead of in front of it, so the posterior-most
 *              tooth of each quadrant takes it.
 * A tooth already carrying a primary rest is skipped; it is doing that job already.
 */
function planIndirectRests(teeth, classification, primaryRests) {
  const { jaw, classNumber } = classification;
  if (!NEEDS_INDIRECT_RETENTION[classNumber]) return [];

  const taken = new Set(primaryRests.map((rest) => rest.fdi));
  const extensionSides = new Set(
    classification.spans.filter((span) => span.isDistalExtension).flatMap((span) => span.sides)
  );

  const rests = [];
  for (const quadrantIds of quadrantsOf(jaw)) {
    const side = sideOfToothId(quadrantIds[0]);
    if (classNumber === 2 && extensionSides.has(side)) continue;

    const fdi =
      classNumber === 4
        ? posteriorMostPresentToothId(teeth, quadrantIds)
        : anteriorIndirectToothId(teeth, quadrantIds);
    if (!fdi || taken.has(fdi)) continue;

    taken.add(fdi);
    rests.push({ fdi, surface: restSurfaceForTooth(fdi, "mesial"), role: "indirect" });
  }
  return rests;
}

/** Every rest the class calls for, deduplicated per tooth surface. A tooth between two
 *  spans legitimately takes one on each side, so the key is the pair, not the tooth. */
function planRestSeats(teeth, classification, clasps = []) {
  const primary = planPrimaryRests(classification);
  // An embrasure clasp brings its own rest seat, cut across the shared marginal ridge.
  const bracing = clasps
    .filter((clasp) => clasp.type === "embrasure")
    .map((clasp) => ({
      fdi: clasp.fdi,
      surface: restSurfaceForTooth(clasp.fdi, clasp.rest),
      role: "bracing",
    }));
  const seated = [...primary, ...bracing];
  const all = [...seated, ...planIndirectRests(teeth, classification, seated)];
  const seen = new Set();
  return all.filter((rest) => {
    const key = `${rest.fdi}:${rest.surface}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const oppositeSurface = (surface) => (surface === "mesial" ? "distal" : "mesial");

/** A tooth reciprocates with ONE element — a reciprocal clasp or a plate, never both.
 *  Mirrors annotationTeethModel.addPlacement's slot rule, which this module can't import. */
const RECIPROCATING_SLOT_IDS = new Set(["reciprocating-clasp", "plate-prox", "plate-crossmesh"]);

/**
 * A view of `teeth` holding only the given jaws. The records are the SAME objects, so
 * mutating through the view mutates the arch — it just narrows what a jaw-agnostic helper
 * can reach, since those helpers skip a tooth id they cannot find.
 */
function teethForJaws(teeth, jawKeys) {
  if (jawKeys.length >= Object.keys(TOOTH_ORDER).length) return teeth;
  const view = {};
  for (const jaw of jawKeys) {
    for (const fdi of TOOTH_ORDER[jaw] || []) {
      if (teeth[fdi]) view[fdi] = teeth[fdi];
    }
  }
  return view;
}

/** Strip every placed component from these jaws, leaving presence and status alone.
 *  Same reach as the arch's own "clear components" action, minus the state it touches. */
function clearPlacementsInJaws(teeth, jawKeys) {
  for (const jaw of jawKeys) {
    for (const fdi of TOOTH_ORDER[jaw] || []) {
      const tooth = teeth[fdi];
      if (!tooth) continue;
      tooth.components = [];
      tooth.componentPlacements = [];
    }
  }
}

/** Add a placement unless the tooth already carries that exact component + surface. */
function placeOnce(tooth, componentId, surface) {
  if (!tooth) return;
  if (!Array.isArray(tooth.componentPlacements)) tooth.componentPlacements = [];
  if (RECIPROCATING_SLOT_IDS.has(componentId)) {
    tooth.componentPlacements = tooth.componentPlacements.filter(
      (entry) => !RECIPROCATING_SLOT_IDS.has(entry.componentId)
    );
  }
  const already = tooth.componentPlacements.some(
    (entry) => entry.componentId === componentId && entry.surface === surface
  );
  if (!already) tooth.componentPlacements.push({ componentId, surface });
}

/** Molars only — the ring clasp's indication is an isolated posterior molar. */
const isMolarToothId = (fdi) => toothUnit(fdi) >= 6;

function isIsolatedTooth(teeth, fdi, jaw) {
  const { mesial, distal } = getNeighborToothIds(fdi, jaw);
  const absent = (id) => !id || !teeth[id]?.isPresent;
  return absent(mesial) && absent(distal);
}

/**
 * A suprabulge circlet: the retentive arm runs AWAY from the space it is rested against,
 * and the reciprocal arm opposes it across the tooth (same corner, lingual) so the two
 * neutralise each other. Surfaces match what the ASSEMBLY tab's own circum macro places.
 */
function circletClasp(fdi, gapFacingSurface) {
  const away = oppositeSurface(gapFacingSurface);
  return {
    fdi,
    type: "circlet",
    placements: [
      { componentId: "retainer-clasp", surface: `${away}_buccal` },
      { componentId: "reciprocating-clasp", surface: `${away}_lingual` },
    ],
  };
}

/** The I-bar's own indication is the RPI system on a canine or premolar. */
const I_BAR_UNITS = new Set([3, 4, 5]);

/** Anteriors and premolars, where a suprabulge arm would show across the facial enamel.
 *  The selection matrix answers that with a bar clasp, which approaches from below. */
const AESTHETIC_ZONE_UNITS = new Set([1, 2, 3, 4, 5]);

/**
 * The surface an I-bar would take on this tooth, or null if none resolves. Always DERIVED,
 * never chosen: the label is keyed to per-tooth offset tuning rather than to anatomy (see
 * components.bar.getBarPlacementSurfaceForTooth). `bar_d1_` is required for the same reason
 * the ASSEMBLY tab's RPI macro requires it — the geometry is tuned for an adjacent saddle.
 */
function resolveIBarSurface(teeth, fdi, jaw) {
  const surface = getBarPlacementSurfaceForTooth(fdi, jaw, teeth);
  return surface?.startsWith("bar_d1_") ? surface : null;
}

/** An infrabulge bar and the proximal plate that reciprocates it. */
function barClasp(fdi, surface, type) {
  return {
    fdi,
    type,
    placements: [
      { componentId: "bar-i", surface },
      { componentId: "plate-prox", surface: null },
    ],
  };
}

/**
 * A free-end terminal abutment takes the stress-releasing RPI — the I-bar approaches the
 * saddle from below, so it disengages under load instead of levering the tooth out. Two
 * things rule it out here: an abutment the bar clasp isn't indicated on (a molar), and an
 * arch where no adjacent saddle resolves a bar surface for the arm to rise from. Either
 * falls back to RPA's Akers arm off the same proximal plate.
 */
function terminalAbutmentClasp(teeth, fdi, jaw) {
  const barSurface = I_BAR_UNITS.has(toothUnit(fdi))
    ? resolveIBarSurface(teeth, fdi, jaw)
    : null;
  if (barSurface) return barClasp(fdi, barSurface, "rpi");
  return {
    fdi,
    type: "rpa",
    placements: [
      { componentId: "retainer-clasp", surface: "mesial_buccal" },
      { componentId: "plate-prox", surface: null },
    ],
  };
}

/**
 * A tooth-bounded abutment normally takes a circlet, but on an anterior or premolar the
 * matrix prefers a bar clasp on aesthetic grounds — a suprabulge arm crosses the facial
 * enamel in view, while an infrabulge one rises from below the gingival margin. Molars fall
 * outside the aesthetic zone, and any tooth with no adjacent saddle keeps the circlet.
 */
function boundedAbutmentClasp(teeth, fdi, jaw, facingSurface) {
  if (AESTHETIC_ZONE_UNITS.has(toothUnit(fdi))) {
    const barSurface = resolveIBarSurface(teeth, fdi, jaw);
    if (barSurface) return barClasp(fdi, barSurface, "ibar");
  }
  return circletClasp(fdi, facingSurface);
}

/** An isolated molar is encircled from its distal rest to a mesial undercut — buccal on a
 *  tipped maxillary molar, lingual on a mandibular one. */
function ringClasp(fdi, jaw) {
  return {
    fdi,
    type: "ring",
    placements: [
      { componentId: "ring-clasp", surface: jaw === "upper" ? "mesial_buccal" : "mesial_lingual" },
      { componentId: "plate-prox", surface: null },
    ],
  };
}

/**
 * The embrasure (double Akers) pair for an unmodified quadrant: the two adjacent present
 * posterior teeth furthest back, rested against their shared embrasure with the retentive
 * arms running outward from it. Null when the quadrant has no such pair.
 */
function embrasurePairFor(teeth, quadrantIds, taken) {
  const posteriors = quadrantIds.filter(
    (fdi) =>
      toothUnit(fdi) >= 4 && teeth[fdi]?.isPresent && !taken.has(fdi) && isSelectableSite(fdi)
  );
  // Ordered mesial -> distal so the pair reads [front tooth, back tooth].
  posteriors.sort((a, b) => toothUnit(a) - toothUnit(b));
  for (let i = posteriors.length - 1; i > 0; i -= 1) {
    const back = posteriors[i];
    const front = posteriors[i - 1];
    if (toothUnit(back) - toothUnit(front) !== 1) continue;
    return [
      // The shared embrasure is the front tooth's distal and the back tooth's mesial.
      { ...circletClasp(front, "mesial"), type: "embrasure", rest: "distal" },
      { ...circletClasp(back, "distal"), type: "embrasure", rest: "mesial" },
    ];
  }
  return null;
}

/**
 * The arch as it will stand once the saddles are meshed. An I-bar bases from the denture
 * saddle, so its surface only resolves against a meshed span — and the plan is built
 * before anything is placed, which would otherwise rule RPI out of every proposal.
 * Mirrors ensureMeshPlacementsOnMissingTeeth, including its terminal-molar exclusion.
 */
function withPlannedMesh(teeth, meshId) {
  const projected = {};
  for (const [fdi, tooth] of Object.entries(teeth)) {
    const placements = tooth.componentPlacements || [];
    const needsMesh =
      !tooth.isPresent &&
      !isAutoMeshPlacementExcludedToothId(fdi) &&
      !placements.some((entry) => isMeshComponent(entry.componentId));
    projected[fdi] = needsMesh
      ? { ...tooth, componentPlacements: [...placements, { componentId: meshId, surface: null }] }
      : tooth;
  }
  return projected;
}

/** A space this long with teeth still standing behind it is clasped at both ends. */
const ACRYLIC_BOTH_ENDS_MIN_SPAN = 4;

/** The abutment on one side of the arch whose own `facing` surface meets the span. */
const spanAbutmentOnSide = (span, side, facing) =>
  span.abutments.find(
    (abutment) => abutment.facingSurface === facing && sideOfToothId(abutment.fdi) === side
  ) || null;

/** The span reaching furthest back on this side — the only one acrylic clasps. */
function posteriorMostSpanOnSide(spans, side) {
  let best = null;
  let bestUnit = -1;
  for (const span of spans) {
    if (!span.sides.includes(side)) continue;
    const unit = Math.max(
      ...span.fdis.filter((fdi) => sideOfToothId(fdi) === side).map(toothUnit)
    );
    if (unit > bestUnit) {
      bestUnit = unit;
      best = span;
    }
  }
  return best;
}

/**
 * An acrylic denture retains with plain wire clasps, so the proposal places clasps and
 * nothing else: no rest seats to cut, and no cast bars. Each clasp is a retainer
 * reciprocated by the plate rather than by a second arm, which is what an acrylic case is
 * normally built with.
 *
 * One clasp per side, on the tooth standing MESIAL to the most posterior space — the space
 * further forward is carried by the base and gets none. Two exceptions: a space of four
 * teeth or more that still has teeth behind it is held at both ends, and an anterior space
 * has no mesial abutment at all, so its distal neighbour takes the clasp.
 */
function planAcrylicClasps(teeth, jaw, classification) {
  const clasps = [];
  const claimed = new Set();
  const claim = (abutment) => {
    if (!abutment || claimed.has(abutment.fdi)) return;
    if (!teeth[abutment.fdi]?.isPresent) return;
    claimed.add(abutment.fdi);
    clasps.push({
      fdi: abutment.fdi,
      type: "acrylic",
      placements: [
        // The arm engages the corner AWAY from the space — the base already meets the tooth
        // on the saddle side, so an arm there would sit on top of it. Same convention as the
        // metal circlet and as the catalog's own circum macro.
        {
          componentId: "retainer-clasp",
          surface: `${oppositeSurface(abutment.facingSurface)}_buccal`,
        },
        { componentId: DEFAULT_PLATE_ID, surface: null },
      ],
    });
  };

  for (const quadrantIds of quadrantsOf(jaw)) {
    const side = sideOfToothId(quadrantIds[0]);
    const span = posteriorMostSpanOnSide(classification.spans, side);
    if (!span) continue;

    // "distal" faces the span, so this abutment stands mesial to it — and vice versa.
    const mesialAbutment = spanAbutmentOnSide(span, side, "distal");
    const distalAbutment = spanAbutmentOnSide(span, side, "mesial");
    claim(mesialAbutment || distalAbutment);
    if (mesialAbutment && span.fdis.length >= ACRYLIC_BOTH_ENDS_MIN_SPAN) claim(distalAbutment);
  }

  return clasps;
}

/**
 * Every clasp the arch calls for, one retentive assembly per tooth. Each abutment is
 * claimed once — a terminal abutment beats an isolated molar beats a plain circlet — and
 * a Class II arch additionally braces its unmodified quadrant with an embrasure pair.
 */
function planClasps(teeth, jaw, classification) {
  const claimed = new Set();
  const clasps = [];
  const claim = (entry) => {
    if (!entry || claimed.has(entry.fdi)) return;
    claimed.add(entry.fdi);
    clasps.push(entry);
  };

  for (const span of classification.spans) {
    for (const abutment of span.abutments) {
      const { fdi, facingSurface } = abutment;
      if (!teeth[fdi]?.isPresent) continue;
      if (span.isDistalExtension) claim(terminalAbutmentClasp(teeth, fdi, jaw));
      else if (isMolarToothId(fdi) && isIsolatedTooth(teeth, fdi, jaw)) claim(ringClasp(fdi, jaw));
      else if (facingSurface) claim(boundedAbutmentClasp(teeth, fdi, jaw, facingSurface));
    }
  }

  if (classification.classNumber === 2) {
    const extensionSides = new Set(
      classification.spans.filter((span) => span.isDistalExtension).flatMap((span) => span.sides)
    );
    for (const quadrantIds of quadrantsOf(jaw)) {
      if (extensionSides.has(sideOfToothId(quadrantIds[0]))) continue;
      for (const entry of embrasurePairFor(teeth, quadrantIds, claimed) || []) claim(entry);
    }
  }

  return clasps;
}

/**
 * Classify both arches, pick each one's connector, and plan its rest seats and clasps.
 * `meshId` lets the caller pass the design-mode mesh the user already picked.
 */
export function buildDesignProposal(teeth, { material = null, meshId = null } = {}) {
  const isAcrylic = material === FULL_ACRYLIC_MATERIAL;
  const proposal = {
    material,
    meshId: isAcrylic ? ACRYLIC_MESH_ID : meshId || ACRYLIC_MESH_ID,
    jaws: {},
  };
  // The mesh projection exists for the metal path's bar surfaces; acrylic places no bars.
  const meshedTeeth = isAcrylic ? teeth : withPlannedMesh(teeth, proposal.meshId);
  for (const jaw of Object.keys(TOOTH_ORDER)) {
    const classification = classifyArch(teeth, jaw);
    const connector = chooseMajorConnector(classification, teeth, { material });
    const clasps = !connector
      ? []
      : isAcrylic
        ? planAcrylicClasps(teeth, jaw, classification)
        : planClasps(meshedTeeth, jaw, classification);
    proposal.jaws[jaw] = {
      jaw,
      classification,
      connector,
      // An arch with no class gets no design at all, so it gets no rests either — and an
      // acrylic case is clasps only, with nothing rigid to rest through.
      rests: connector && !isAcrylic ? planRestSeats(teeth, classification, clasps) : [],
      clasps,
    };
  }
  return proposal;
}

/**
 * Place the proposal on `teeth`. The proposal REPLACES an arch's design rather than adding
 * to it: whatever was on the placed jaws is stripped first, so an existing connector or
 * clasp cannot draw over the proposed one. Presence and status survive — they are what the
 * proposal was derived from.
 *
 * Then mesh on the saddles and a plate on every present tooth, because a major connector
 * can only be placed on teeth that anchor it, and the connector switch and plating sync run
 * in the order the catalog's own pick uses (components.major.switchMajorConnectorInJaws
 * expects the plating to already be there; a lingual bar strips it again afterwards). Rests
 * and clasps land last — nothing else reads them, and a clasp's own proximal plate must
 * outlive the plating sync.
 *
 * Returns the two render flags the caller must mirror onto `state`.
 */
export function applyDesignProposal(teeth, proposal) {
  const flags = { archOverlayPalatalHoleActive: false, hideLowerPlateVisuals: false };
  if (!teeth || !proposal) return flags;

  // Only the jaws with something to place: an arch Kennedy gives no class keeps the design
  // it already has, since replacing it with nothing would just erase the designer's work.
  const placedJaws = Object.keys(proposal.jaws).filter(
    (jaw) => proposal.jaws[jaw]?.connector?.componentId
  );
  if (!placedJaws.length) return flags;

  clearPlacementsInJaws(teeth, placedJaws);

  // ensureMeshPlacementsOnMissingTeeth walks both arches, so hand it a view of only the
  // jaws being placed — the caller may have narrowed the proposal to one of them.
  ensureMeshPlacementsOnMissingTeeth(
    teethForJaws(teeth, placedJaws),
    proposal.meshId,
    COMPONENT_BY_ID
  );

  for (const jaw of placedJaws) {
    const plan = proposal.jaws[jaw];
    const componentId = plan.connector.componentId;

    ensurePlatePlacementsOnPresentTeethInJaws(teeth, DEFAULT_PLATE_ID, COMPONENT_BY_ID, [jaw]);
    switchMajorConnectorInJaws(teeth, componentId, COMPONENT_BY_ID, [jaw]);
    syncReciprocatingPlatesToMajorConnector(teeth, componentId, [jaw]);

    if (componentId === UPPER_AP_STRAP) flags.archOverlayPalatalHoleActive = true;
    if (componentId === LOWER_LINGUAL_BAR) flags.hideLowerPlateVisuals = true;

    for (const rest of plan.rests) {
      placeOnce(teeth[rest.fdi], REST_COMPONENT_ID, rest.surface);
    }
    for (const clasp of plan.clasps) {
      for (const placement of clasp.placements) {
        placeOnce(teeth[clasp.fdi], placement.componentId, placement.surface);
      }
    }
  }

  // syncReciprocatingPlatesToMajorConnector edits placements without touching
  // tooth.components, so rebuild it here the way the catalog's own pick does. Inlined
  // rather than imported from annotationTeethModel.js, which pulls in the DOM entry.
  forEachTooth((toothId) => {
    const tooth = teeth[toothId];
    if (!tooth) return;
    tooth.components = [
      ...new Set(
        (tooth.componentPlacements || [])
          .map((entry) => entry.componentId)
          .filter((id) => COMPONENT_BY_ID.has(id))
      ),
    ];
  });

  return flags;
}
