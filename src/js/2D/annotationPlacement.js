import {
  ACTION_UPON_FAILURE,
  ASSEMBLY_REST_SUGGESTION_IDS,
  COMPONENT_BY_ID,
  getBarPlacementSurfaceForTooth,
  extendMajorConnectorOntoTooth,
  getMajorConnectorAssetReference,
  getMajorConnectorSpanTeeth,
  majorConnectorRunsToMidline,
  hasPalatalHolePlacementOnUpperArch,
  isBarComponent,
  isReciprocatingClaspComponent,
  isRingClaspComponent,
  isRetainerClaspComponent,
  isClaspComponent,
  isMajorConnectorComponent,
  isMajorConnectorToothExcluded,
  isMeshComponent,
  isPalatalBarMajorComponent,
  isPalatalHoleMajorComponent,
  isPlateComponentId,
  isRestComponent,
  PALATAL_BAR_CONNECTOR_TOOTH_IDS,
} from "./components.js";
import { TOOTH_ORDER } from "./constants.js";
import { getHistoryStateSignature, recordHistoryIfChanged, state, setMessage } from "./2DAnnotation.js";
import {
  addPlacement,
  ensureToothPlacementState,
  hasPlacement,
  normalizeSurface,
  removePlacement,
  removePlacementsByComponentIds,
  syncToothComponentsFromPlacements,
} from "./annotationTeethModel.js";
import { ensureMajorCatalogPickForTooth, isComponentBlockedByMaterial } from "./annotationCatalog.js";
import { assessPlacementCriteria } from "./criteria.js";

// Check whether a tooth ID is anterior (unit 1-3).
function isAnteriorToothId(toothId) {
  const unit = Number(toothId) % 10;
  return Number.isFinite(unit) && unit >= 1 && unit <= 3;
}

// Default reciprocating element for a retentive placement: the proximal (reciprocating)
// plate. Surfaceless — it plates the whole tooth and encodes reciprocating=2.
const DEFAULT_RECIPROCATING_COMPONENT_ID = "plate-prox";

// A tooth's single reciprocating slot is a reciprocating clasp OR a proximal/mesh
// plate (see annotationTeethModel.RECIPROCATING_SLOT_IDS).
function toothHasReciprocatingElement(tooth) {
  return (tooth?.componentPlacements || []).some(
    (entry) =>
      isReciprocatingClaspComponent(entry.componentId) || isPlateComponentId(entry.componentId)
  );
}

// Clasps, bars and rests all need reciprocation, so placing one auto-adds the default
// plate — unless the tooth already carries a reciprocating element (or IS one).
function autoPlaceDefaultReciprocatingElement(tooth, selectedComponent) {
  const needsReciprocation =
    isClaspComponent(selectedComponent) ||
    isBarComponent(selectedComponent) ||
    isRestComponent(selectedComponent);
  if (!needsReciprocation || toothHasReciprocatingElement(tooth)) return;
  addPlacement(tooth, DEFAULT_RECIPROCATING_COMPONENT_ID, null);
}

/** The jaw a tooth belongs to, or null when the id is off the arch. */
function jawOfToothId(toothId) {
  const id = String(toothId);
  return TOOTH_ORDER.upper.includes(id) ? "upper" : TOOTH_ORDER.lower.includes(id) ? "lower" : null;
}

/**
 * A plate or mesh the dentist placed themselves lets the connector follow onto that tooth.
 * The reciprocation plate a clasp/bar/rest brings with it is excluded on purpose: it is a
 * side effect of the retentive element, not a decision to extend the connector.
 */
function extendMajorConnectorAfterDeliberatePlacement(toothId, selectedComponent) {
  if (!isPlateComponentId(selectedComponent.id) && !isMeshComponent(selectedComponent)) return;
  const jaw = jawOfToothId(toothId);
  if (!jaw) return;
  extendMajorConnectorOntoTooth(state.teeth, COMPONENT_BY_ID, jaw, toothId);
}

/** Bulk mesh placement writes straight to the teeth, so it asks for the follow-on itself —
 *  for the saddles it just filled only. */
export function extendMajorConnectorsOntoTeeth(toothIds) {
  for (const toothId of toothIds || []) {
    const jaw = jawOfToothId(toothId);
    if (!jaw) continue;
    extendMajorConnectorOntoTooth(state.teeth, COMPONENT_BY_ID, jaw, toothId);
  }
}

// Apply follow-up cleanup rules after removing a placement.
export function applyRemovalSideEffectsForTooth(tooth, removedEntry) {
  if (!removedEntry) return;
  const { componentId } = removedEntry;
  if (isPlateComponentId(componentId)) {
    // The plate is a clasp's reciprocation, so it takes the clasp with it. The major
    // connector is its own component and is removed on its own — never cascaded from here.
    const remainingPlate = tooth.componentPlacements.some((e) => isPlateComponentId(e.componentId));
    if (!remainingPlate) {
      tooth.componentPlacements = tooth.componentPlacements.filter(
        (e) => !isClaspComponent(e.componentId)
      );
      syncToothComponentsFromPlacements(tooth);
    }
  }
  if (isPalatalHoleMajorComponent(componentId) && !hasPalatalHolePlacementOnUpperArch(state.teeth)) {
    state.archOverlayPalatalHoleActive = false;
  }
}

// Main placement engine for currently selected component on one tooth.
export function placeSelectedComponentOnTooth(toothId, placementContext = null) {
  const historyBefore = getHistoryStateSignature();
  try {
  toothId = String(toothId);
  if (state.designMode) {
    ensureMajorCatalogPickForTooth(toothId);
  }
  const tooth = state.teeth[toothId];
  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");

  if (!selectedComponent) {
    setMessage("Select a component from the catalog first.", true);
    return;
  }

  // Full acrylic can't carry mesh or the palatal A-P strap / palatal bar —
  // refuse the placement even if a stale selection slips through the catalog gate.
  if (isComponentBlockedByMaterial(selectedComponent.id)) {
    setMessage("This component isn't available for a full acrylic case.", true);
    return;
  }

  // Assemblies are macros placed from a rest-seat dot, not surfaces. Without this a tap on
  // the tooth body stores the assembly id itself as a bogus placement.
  if (ASSEMBLY_REST_SUGGESTION_IDS.has(selectedComponent.id)) {
    setMessage(
      `For ${selectedComponent.label}, click a rest suggestion point (mesial or distal).`,
      true
    );
    return;
  }

  ensureToothPlacementState(tooth);
  syncToothComponentsFromPlacements(tooth);

  if (isMajorConnectorComponent(selectedComponent)) {
    if (isMajorConnectorToothExcluded(selectedComponent.id, toothId)) {
      setMessage(`${selectedComponent.label} is not supported on tooth ${toothId}.`, true);
      return;
    }
    const jaw = TOOTH_ORDER.upper.includes(toothId)
      ? "upper"
      : TOOTH_ORDER.lower.includes(toothId)
        ? "lower"
        : null;
    if (!jaw) {
      setMessage("Unknown tooth.", true);
      return;
    }
    const palatalHoleUpper =
      isPalatalHoleMajorComponent(selectedComponent.id) &&
      jaw === "upper" &&
      TOOTH_ORDER.upper.includes(toothId);
    // The bar's own posterior segments skip the artwork check; an anterior one is placed
    // by hand like any other major, on the tooth's own 11-13/21-23 segment art.
    const palatalBarUpper =
      isPalatalBarMajorComponent(selectedComponent.id) &&
      jaw === "upper" &&
      PALATAL_BAR_CONNECTOR_TOOTH_IDS.has(String(toothId));
    if (
      !palatalHoleUpper &&
      !palatalBarUpper &&
      !getMajorConnectorAssetReference(toothId, jaw)
    ) {
      setMessage("No major connector artwork is available for this tooth in the 2D view.", true);
      return;
    }

    if (hasPlacement(tooth, selectedComponent.id, null)) {
      removePlacement(tooth, selectedComponent.id, null);
      if (isPalatalHoleMajorComponent(selectedComponent.id)) {
        state.archOverlayPalatalHoleActive = hasPalatalHolePlacementOnUpperArch(state.teeth);
      }
      setMessage(`Removed ${selectedComponent.label} from tooth ${toothId}.`, false);
      return;
    }

    if (!toothSupportsMajorConnectorOverlay(tooth, toothId, selectedComponent.id)) {
      setMessage(
        tooth.isPresent
          ? "Place a plate or reciprocating clasp on this tooth before adding this major connector (design mode)."
          : "Place a mesh on this missing tooth before adding this major connector (design mode).",
        true
      );
      return;
    }

    if (isPalatalHoleMajorComponent(selectedComponent.id) && palatalHoleUpper) {
      const majorIdsOnTooth = (tooth.componentPlacements || [])
        .map((e) => e.componentId)
        .filter((cid) => isMajorConnectorComponent(cid));
      if (majorIdsOnTooth.length > 0) {
        removePlacementsByComponentIds(tooth, majorIdsOnTooth);
      }
      addPlacement(tooth, selectedComponent.id, null);
      state.archOverlayPalatalHoleActive = true;
      setMessage(`Placed ${selectedComponent.label} on tooth ${toothId}.`, false);
      return;
    }

    if (isPalatalBarMajorComponent(selectedComponent.id) && palatalBarUpper) {
      const majorIdsOnTooth = (tooth.componentPlacements || [])
        .map((e) => e.componentId)
        .filter((cid) => isMajorConnectorComponent(cid));
      if (majorIdsOnTooth.length > 0) {
        removePlacementsByComponentIds(tooth, majorIdsOnTooth);
      }
      addPlacement(tooth, selectedComponent.id, null);
      setMessage(`Placed ${selectedComponent.label} on tooth ${toothId}.`, false);
      return;
    }

    const majorCriteria = assessPlacementCriteria(tooth, selectedComponent, COMPONENT_BY_ID);
    if (majorCriteria.pass) {
      addPlacement(tooth, selectedComponent.id, null);
      setMessage(`Placed ${selectedComponent.label} on tooth ${toothId}.`, false);
      return;
    }

    const { failureData: majorFailure } = majorCriteria;
    if (majorFailure.actionUponFailure === ACTION_UPON_FAILURE.PREVENT_PLACEMENT) {
      setMessage(majorFailure.reason, true);
      return;
    }

    if (majorFailure.actionUponFailure === ACTION_UPON_FAILURE.REMOVE_THEN_PLACE) {
      removePlacementsByComponentIds(tooth, majorFailure.conflictingComponents || []);
      addPlacement(tooth, selectedComponent.id, null);
      setMessage(`Replaced prior major and placed ${selectedComponent.label} on tooth ${toothId}.`, false);
    }
    return;
  }

  const requiresSurface =
    isRestComponent(selectedComponent) ||
    isRetainerClaspComponent(selectedComponent) ||
    isReciprocatingClaspComponent(selectedComponent) ||
    isRingClaspComponent(selectedComponent) ||
    isBarComponent(selectedComponent);
  const surface = normalizeSurface(placementContext?.surface);
  const targetSurface = requiresSurface ? surface : null;

  if (requiresSurface && !targetSurface) {
    if (selectedComponent.id === "rest-onlay") {
      if (isAnteriorToothId(toothId)) {
        setMessage("Onlay rest is only allowed on posterior teeth.", true);
        return;
      }
      placeSelectedComponentOnTooth(toothId, { surface: "mesial" });
      return;
    }
    if (
      isRetainerClaspComponent(selectedComponent) ||
      isReciprocatingClaspComponent(selectedComponent) ||
      isRingClaspComponent(selectedComponent)
    ) {
      setMessage(
        `For ${selectedComponent.label}, click a clasp suggestion point (mesial or distal, buccal or lingual).`,
        true
      );
      return;
    }
    if (isBarComponent(selectedComponent)) {
      setMessage(`For ${selectedComponent.label}, click a highlighted tooth near a mesh-bearing tooth.`, true);
      return;
    }
    setMessage(
      `For ${selectedComponent.label}, click a rest suggestion point (mesial, distal, or lingual).`,
      true
    );
    return;
  }

  if (selectedComponent.id === "rest-onlay" && isAnteriorToothId(toothId)) {
    setMessage("Onlay rest is only allowed on posterior teeth.", true);
    return;
  }

  if (hasPlacement(tooth, selectedComponent.id, targetSurface)) {
    removePlacement(tooth, selectedComponent.id, targetSurface);
    if (isPlateComponentId(selectedComponent.id)) {
      // Same rule as applyRemovalSideEffectsForTooth: the clasp follows its reciprocation
      // off the tooth, the major connector segment stays until it is removed itself.
      const remainingPlate = tooth.componentPlacements.some((e) => isPlateComponentId(e.componentId));
      if (!remainingPlate) {
        tooth.componentPlacements = tooth.componentPlacements.filter(
          (e) => !isClaspComponent(e.componentId)
        );
        syncToothComponentsFromPlacements(tooth);
      }
    }
    setMessage(
      `Removed ${selectedComponent.label}${targetSurface ? ` (${targetSurface})` : ""} from tooth ${toothId}.`,
      false
    );
    return;
  }

  // Bar constraint: keep exactly one placement per selected bar on a tooth.
  // If user switches side (mesial/distal), replace previous surface with new one.
  if (isBarComponent(selectedComponent) && targetSurface) {
    const existingSameBarDifferentSurface = (tooth.componentPlacements || []).find((entry) => {
      if (entry.componentId !== selectedComponent.id) return false;
      const s = normalizeSurface(entry.surface);
      return Boolean(s && s !== targetSurface);
    });
    if (existingSameBarDifferentSurface) {
      removePlacement(tooth, existingSameBarDifferentSurface.componentId, existingSameBarDifferentSurface.surface);
    }
  }

  // Clasp-circ constraint: max one clasp per tooth.
  // Any existing retainer-clasp on this tooth is replaced by the new placement.
  if (
    (
      isRetainerClaspComponent(selectedComponent) ||
      isReciprocatingClaspComponent(selectedComponent) ||
      isRingClaspComponent(selectedComponent)
    ) &&
    targetSurface
  ) {
    const existingClasp = (tooth.componentPlacements || []).find((entry) => {
      const sameClaspType = isRetainerClaspComponent(selectedComponent)
        ? isRetainerClaspComponent(entry.componentId)
        : isReciprocatingClaspComponent(selectedComponent)
          ? isReciprocatingClaspComponent(entry.componentId)
          : isRingClaspComponent(entry.componentId);
      if (!sameClaspType) return false;
      const s = normalizeSurface(entry.surface);
      return Boolean(s && s !== targetSurface);
    });
    if (existingClasp) {
      removePlacement(tooth, existingClasp.componentId, existingClasp.surface);
    }
  }

  const criteriaResult = assessPlacementCriteria(tooth, selectedComponent, COMPONENT_BY_ID);
  if (criteriaResult.pass) {
    addPlacement(tooth, selectedComponent.id, targetSurface);
    autoPlaceDefaultReciprocatingElement(tooth, selectedComponent);
    extendMajorConnectorAfterDeliberatePlacement(toothId, selectedComponent);
    setMessage(
      `Placed ${selectedComponent.label}${targetSurface ? ` (${targetSurface})` : ""} on tooth ${toothId}.`,
      false
    );
    return;
  }

  const { failureData } = criteriaResult;
  if (failureData.actionUponFailure === ACTION_UPON_FAILURE.PREVENT_PLACEMENT) {
    setMessage(failureData.reason, true);
    return;
  }

  if (failureData.actionUponFailure === ACTION_UPON_FAILURE.REMOVE_THEN_PLACE) {
    removePlacementsByComponentIds(tooth, failureData.conflictingComponents || []);
    addPlacement(tooth, selectedComponent.id, targetSurface);
    autoPlaceDefaultReciprocatingElement(tooth, selectedComponent);
    extendMajorConnectorAfterDeliberatePlacement(toothId, selectedComponent);
    setMessage(
      `Replaced conflict and placed ${selectedComponent.label}${targetSurface ? ` (${targetSurface})` : ""} on tooth ${toothId}.`,
      false
    );
  }
  } finally {
    recordHistoryIfChanged(historyBefore);
  }
}

export function placeSimpleCircumAssemblyOnTooth(toothId, restSurface) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return false;
  }

  ensureToothPlacementState(tooth);
  const normalizedRestSurface = normalizeSurface(restSurface);
  if (normalizedRestSurface !== "mesial" && normalizedRestSurface !== "distal") {
    setMessage("Simple Circum Assembly supports mesial or distal rest seat only.", true);
    return false;
  }

  const mapped = normalizedRestSurface === "mesial"
    ? {
      rest: "mesial",
      retainer: "distal_buccal",
      reciprocating: "distal_lingual",
    }
    : {
      rest: "distal",
      retainer: "mesial_buccal",
      reciprocating: "mesial_lingual",
    };

  tooth.componentPlacements = (tooth.componentPlacements || []).filter((entry) => {
    const cid = entry.componentId;
    return !(
      cid === "rest-seat" ||
      isRetainerClaspComponent(cid) ||
      isReciprocatingClaspComponent(cid)
    );
  });
  clearReciprocatingPlateMeshOnTooth(tooth);

  addPlacement(tooth, "rest-seat", mapped.rest);
  addPlacement(tooth, "retainer-clasp", mapped.retainer);
  addPlacement(tooth, "reciprocating-clasp", mapped.reciprocating);
  syncToothComponentsFromPlacements(tooth);

  setMessage(
    `Placed Simple Circum Assembly on tooth ${id} (${mapped.rest} rest, ${mapped.retainer} retainer, ${mapped.reciprocating} reciprocating).`,
    false
  );
  return true;
}

/**
 * Back-action Clasps: the clasp goes OPPOSITE the rest, the reciprocal stays on the rest's
 * own corner. Simple Circum instead arch-flips the retainer at the SAME corner.
 */
export function placeBackActionAssemblyOnTooth(toothId, restSurface) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return false;
  }

  const rest = normalizeSurface(restSurface);
  if (rest !== "mesial" && rest !== "distal") {
    setMessage("Back-action Clasps supports mesial or distal rest seat only.", true);
    return false;
  }

  if (!tooth.isPresent) {
    setMessage("Back-action Clasps requires a present abutment tooth.", true);
    return false;
  }

  const clasp = `${oppositeRestSurface(rest)}_buccal`;
  const reciprocating = `${rest}_lingual`;

  ensureToothPlacementState(tooth);
  clearRestAndCircumClaspsOnTooth(tooth);
  clearReciprocatingPlateMeshOnTooth(tooth);

  addPlacement(tooth, "rest-seat", rest);
  addPlacement(tooth, "retainer-clasp", clasp);
  addPlacement(tooth, "reciprocating-clasp", reciprocating);
  syncToothComponentsFromPlacements(tooth);

  setMessage(
    `Placed Back-action Clasps on tooth ${id} (${rest} rest, ${clasp} clasp, ${reciprocating} reciprocating).`,
    false
  );
  return true;
}

export function getEmbrasureNeighborToothId(toothId, jaw, clickedSurface) {
  const order = TOOTH_ORDER[jaw] || [];
  const idx = order.indexOf(String(toothId));
  if (idx < 0) return null;
  const quadrant = Number(String(toothId).charAt(0));
  const mesialStep = quadrant === 1 || quadrant === 3 ? 1 : -1;
  const distalStep = -mesialStep;
  const step = clickedSurface === "mesial" ? mesialStep : clickedSurface === "distal" ? distalStep : 0;
  if (!step) return null;
  const neighbor = order[idx + step];
  return neighbor ? String(neighbor) : null;
}

function clearRestAndCircumClaspsOnTooth(tooth) {
  tooth.componentPlacements = (tooth.componentPlacements || []).filter((entry) => {
    const cid = entry.componentId;
    return !(cid === "rest-seat" || isRetainerClaspComponent(cid) || isReciprocatingClaspComponent(cid));
  });
}

function clearReciprocatingPlateMeshOnTooth(tooth) {
  tooth.componentPlacements = (tooth.componentPlacements || []).filter((entry) => {
    const cid = entry.componentId;
    return !(isPlateComponentId(cid) || isMeshComponent(cid));
  });
}

function placeCircumBundle(tooth, mode) {
  if (mode === "mesial") {
    addPlacement(tooth, "rest-seat", "mesial");
    addPlacement(tooth, "retainer-clasp", "distal_buccal");
    addPlacement(tooth, "reciprocating-clasp", "distal_lingual");
    return;
  }
  addPlacement(tooth, "rest-seat", "distal");
  addPlacement(tooth, "retainer-clasp", "mesial_buccal");
  addPlacement(tooth, "reciprocating-clasp", "mesial_lingual");
}

// Which mesial/distal surfaces face an adjacent missing tooth. Combine Clasps brackets the
// gap, so its rest seats sit exactly here — with 23 missing, 22 distal and 24 mesial.
export function getGapFacingRestSurfaces(toothId, jaw) {
  const tooth = state.teeth[String(toothId)];
  if (!tooth || !tooth.isPresent) return [];
  const surfaces = [];
  for (const side of ["mesial", "distal"]) {
    const neighbourId = getEmbrasureNeighborToothId(toothId, jaw, side);
    const neighbour = neighbourId ? state.teeth[neighbourId] : null;
    if (neighbour && !neighbour.isPresent) surfaces.push(side);
  }
  return surfaces;
}

// The abutment across the whole gap that `side` opens onto (23+24 missing -> 22 pairs 25).
// Null when the gap runs off the arch, i.e. a free-end saddle.
function getAbutmentAcrossGap(toothId, jaw, side) {
  const id = String(toothId);
  const order = TOOTH_ORDER[jaw] || [];
  const idx = order.indexOf(id);
  if (idx < 0) return null;
  const quadrant = Number(id.charAt(0));
  const mesialStep = quadrant === 1 || quadrant === 3 ? 1 : -1;
  const step = side === "mesial" ? mesialStep : -mesialStep;

  let i = idx + step;
  const isMissingAt = (n) => Boolean(order[n] && state.teeth[order[n]] && !state.teeth[order[n]].isPresent);
  if (!isMissingAt(i)) return null;
  while (isMissingAt(i)) i += step;

  const acrossId = order[i];
  const across = acrossId ? state.teeth[acrossId] : null;
  return across && across.isPresent ? String(acrossId) : null;
}

const oppositeRestSurface = (surface) => (surface === "mesial" ? "distal" : "mesial");

/**
 * Combine Clasps bundles by tier, `side` pointing at the gap for both: the abutment carries
 * both arms gap-facing, the outward tooth on the corner away from its abutment.
 */
function placeCombineClaspAbutmentBundle(tooth, side) {
  addPlacement(tooth, "rest-seat", "mesial");
  addPlacement(tooth, "rest-seat", "distal");
  addPlacement(tooth, "retainer-clasp", `${side}_buccal`);
  addPlacement(tooth, "reciprocating-clasp", `${side}_lingual`);
}

function placeCombineClaspOutwardBundle(tooth, side) {
  addPlacement(tooth, "rest-seat", side);
  addPlacement(tooth, "retainer-clasp", `${oppositeRestSurface(side)}_buccal`);
  addPlacement(tooth, "reciprocating-clasp", `${oppositeRestSurface(side)}_lingual`);
}

/**
 * The {toothId, side, tier} records a Combine Clasps click builds: tier "abutment" brackets
 * the gap (15 missing -> 14 distal, 16 mesial), tier "outward" is the next tooth beyond.
 */
function collectCombineClaspTargets(toothId, jaw, clickedSurface) {
  const abutments = [{ toothId: String(toothId), side: clickedSurface, tier: "abutment" }];

  const partnerId = getAbutmentAcrossGap(toothId, jaw, clickedSurface);
  if (partnerId) {
    abutments.push({ toothId: partnerId, side: oppositeRestSurface(clickedSurface), tier: "abutment" });
  }

  const targets = [...abutments];
  const claimed = new Set(abutments.map((t) => t.toothId));
  for (const abutment of abutments) {
    const outwardSide = oppositeRestSurface(abutment.side);
    const nextId = getEmbrasureNeighborToothId(abutment.toothId, jaw, outwardSide);
    const next = nextId ? state.teeth[nextId] : null;
    if (!next || !next.isPresent || claimed.has(nextId)) continue;
    claimed.add(nextId);
    targets.push({ toothId: nextId, side: abutment.side, tier: "outward" });
  }
  return targets;
}

export function placeEmbrasureCircumAssemblyOnTooth(toothId, jaw, restSurface) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return false;
  }

  const clicked = normalizeSurface(restSurface);
  if (!getGapFacingRestSurfaces(id, jaw).includes(clicked)) {
    setMessage("Combine Clasps needs a rest seat facing a missing tooth.", true);
    return false;
  }

  const targets = collectCombineClaspTargets(id, jaw, clicked);

  // Clear every target first: an outward neighbour may already carry components from
  // an earlier click, and clearing as we go would wipe a bundle just placed.
  for (const target of targets) {
    const rec = state.teeth[target.toothId];
    ensureToothPlacementState(rec);
    clearRestAndCircumClaspsOnTooth(rec);
    clearReciprocatingPlateMeshOnTooth(rec);
  }
  for (const target of targets) {
    const rec = state.teeth[target.toothId];
    if (target.tier === "abutment") placeCombineClaspAbutmentBundle(rec, target.side);
    else placeCombineClaspOutwardBundle(rec, target.side);
    syncToothComponentsFromPlacements(rec);
  }

  const summary = targets.map((t) => `${t.toothId} (${t.side})`).join(", ");
  setMessage(`Placed Combine Clasps on ${summary}.`, false);
  return true;
}

/**
 * The tooth a Continuous Clasps click splints to: the neighbour AWAY from the gap, so a
 * distal (gap-facing) rest pairs mesially. Null unless that neighbour exists and is present.
 */
function getContinuousClaspPartnerId(toothId, jaw, restSurface) {
  const partnerId = getEmbrasureNeighborToothId(toothId, jaw, oppositeRestSurface(restSurface));
  const partner = partnerId ? state.teeth[partnerId] : null;
  return partner && partner.isPresent ? String(partnerId) : null;
}

/**
 * Continuous Clasps splints an abutment to the next tooth away from the gap, so its rest
 * suggestions sit on gap-facing surfaces that have a present tooth to splint back to.
 */
export function getContinuousClaspRestSurfaces(toothId, jaw) {
  return getGapFacingRestSurfaces(toothId, jaw).filter((side) =>
    Boolean(getContinuousClaspPartnerId(toothId, jaw, side))
  );
}

export function placeMultiCircumAssemblyOnTooth(toothId, jaw, restSurface) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return false;
  }

  const clicked = normalizeSurface(restSurface);
  if (!getGapFacingRestSurfaces(id, jaw).includes(clicked)) {
    setMessage("Continuous Clasps needs a rest seat facing a missing tooth.", true);
    return false;
  }

  const neighborToothId = getContinuousClaspPartnerId(id, jaw, clicked);
  if (!neighborToothId) {
    setMessage("No adjacent tooth beyond the abutment to splint Continuous Clasps to.", true);
    return false;
  }

  const neighborTooth = state.teeth[neighborToothId];
  ensureToothPlacementState(tooth);
  ensureToothPlacementState(neighborTooth);

  clearRestAndCircumClaspsOnTooth(tooth);
  clearRestAndCircumClaspsOnTooth(neighborTooth);
  clearReciprocatingPlateMeshOnTooth(tooth);
  clearReciprocatingPlateMeshOnTooth(neighborTooth);

  // Rests at the two outer ends of the splinted pair; both clasps meet in the shared
  // embrasure between them.
  placeCircumBundle(tooth, clicked);
  placeCircumBundle(neighborTooth, oppositeRestSurface(clicked));

  syncToothComponentsFromPlacements(tooth);
  syncToothComponentsFromPlacements(neighborTooth);

  setMessage(
    `Placed Continuous Clasps on teeth ${id} (${clicked} rest) and ${neighborToothId}.`,
    false
  );
  return true;
}

export function placeHalfAndHalfAssemblyOnTooth(toothId, restSurface) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return false;
  }

  const clicked = normalizeSurface(restSurface);
  if (clicked !== "mesial" && clicked !== "distal") {
    setMessage("Half & Half supports mesial or distal rest-seat suggestion only.", true);
    return false;
  }

  ensureToothPlacementState(tooth);
  clearRestAndCircumClaspsOnTooth(tooth);
  clearReciprocatingPlateMeshOnTooth(tooth);

  // Half & Half is double-rested: the retentive and reciprocal arms arise from
  // opposite directions, so each gets its own rest seat.
  addPlacement(tooth, "rest-seat", "mesial");
  addPlacement(tooth, "rest-seat", "distal");

  // Retentive arm buccal, reciprocal arm lingual, at opposite mesial/distal corners.
  if (clicked === "mesial") {
    addPlacement(tooth, "retainer-clasp", "distal_buccal");
    addPlacement(tooth, "reciprocating-clasp", "mesial_lingual");
  } else {
    addPlacement(tooth, "retainer-clasp", "mesial_buccal");
    addPlacement(tooth, "reciprocating-clasp", "distal_lingual");
  }

  syncToothComponentsFromPlacements(tooth);
  setMessage(`Placed Half & Half on tooth ${id} (mesial + distal rests).`, false);
  return true;
}

// The immediately-distal neighbour (away from the midline), or null at the arch end.
function getDistalNeighbourId(toothId, jaw) {
  const id = String(toothId);
  const order = TOOTH_ORDER[jaw] || [];
  const idx = order.indexOf(id);
  if (idx < 0) return null;
  const quadrant = Number(id.charAt(0));
  const mesialStep = quadrant === 1 || quadrant === 3 ? 1 : -1;
  return order[idx - mesialStep] || null;
}

// A distal-extension abutment (distal neighbour missing) — the only case RPI/RPA is defined
// for: rest mesial, retentive element and proximal plate facing the saddle distally.
export function hasMissingDistalNeighbour(toothId, jaw) {
  const distalId = getDistalNeighbourId(toothId, jaw);
  return Boolean(distalId && state.teeth[distalId] && !state.teeth[distalId].isPresent);
}

// An I-bar bases from the saddle, represented here as a mesh placement — without one
// pruneInvalidBarPlacementsInJaw drops the bar next render. Same rule as the BARS tab.
export function hasMeshedDistalSaddle(toothId, jaw) {
  const distalId = getDistalNeighbourId(toothId, jaw);
  const distalTooth = distalId ? state.teeth[distalId] : null;
  if (!distalTooth || distalTooth.isPresent) return false;
  return (distalTooth.componentPlacements || []).some((entry) => isMeshComponent(entry.componentId));
}

function getRpxAssemblyContext(toothId, jaw, restSurface, label) {
  const id = String(toothId);
  const tooth = state.teeth[id];
  if (!tooth) {
    setMessage("Unknown tooth.", true);
    return null;
  }

  if (normalizeSurface(restSurface) !== "mesial") {
    setMessage(`${label} places its rest on the mesial only.`, true);
    return null;
  }

  if (!tooth.isPresent) {
    setMessage(`${label} requires a present abutment tooth.`, true);
    return null;
  }

  if (!hasMissingDistalNeighbour(id, jaw)) {
    setMessage(`${label} needs a distal-extension abutment (the distal neighbour must be missing).`, true);
    return null;
  }

  ensureToothPlacementState(tooth);
  return { id, tooth };
}

// Derived from the real mesh layout, never hardcoded: the `bar_d?_{mesial|distal}` label is
// keyed to offset/scale tuning, NOT the anatomical side of the saddle.
function getRpiBarSurface(toothId, jaw) {
  const surface = getBarPlacementSurfaceForTooth(toothId, jaw, state.teeth);
  return surface && surface.startsWith("bar_d1_") ? surface : null;
}

// Shared RPI/RPA placement: mesial rest + proximal plate + one distal retentive element.
// `config.resolveRetentiveElement` returns what to place, or null if it can't.
function placeRpxAssemblyOnTooth(toothId, jaw, restSurface, config) {
  const context = getRpxAssemblyContext(toothId, jaw, restSurface, config.label);
  if (!context) return false;
  const { id, tooth } = context;

  const retentive = config.resolveRetentiveElement(id, jaw);
  if (!retentive) {
    setMessage(config.retentiveFailureReason, true);
    return false;
  }

  tooth.componentPlacements = (tooth.componentPlacements || []).filter((entry) => {
    const cid = entry.componentId;
    return !(
      cid === "rest-seat" ||
      isRetainerClaspComponent(cid) ||
      isReciprocatingClaspComponent(cid) ||
      isBarComponent(cid) ||
      isPlateComponentId(cid) ||
      isMeshComponent(cid)
    );
  });

  addPlacement(tooth, "rest-seat", "mesial");
  addPlacement(tooth, retentive.componentId, retentive.surface);
  // Last: plate-prox owns the reciprocating slot, so it clears any stray
  // reciprocating clasp the retentive element may have brought with it.
  addPlacement(tooth, "plate-prox", null);

  syncToothComponentsFromPlacements(tooth);
  setMessage(`Placed ${config.label} on tooth ${id} (mesial rest, lingual plate, ${config.retentiveLabel}).`, false);
  return true;
}

export function placeAssemblyRpiOnTooth(toothId, jaw, restSurface) {
  return placeRpxAssemblyOnTooth(toothId, jaw, restSurface, {
    label: "RPI",
    retentiveLabel: "I-bar off the distal saddle",
    retentiveFailureReason:
      "RPI needs a saddle to base the I-bar from — place a mesh on the missing distal tooth first.",
    resolveRetentiveElement: (id, jawKey) => {
      const surface = getRpiBarSurface(id, jawKey);
      return surface ? { componentId: "bar-i", surface } : null;
    },
  });
}

export function placeAssemblyRpaOnTooth(toothId, jaw, restSurface) {
  return placeRpxAssemblyOnTooth(toothId, jaw, restSurface, {
    label: "RPA",
    // The Akers arm originates at the mesial rest and faces it, so unlike Simple
    // Circum (mesial rest -> distal_buccal retainer) the clasp stays on the mesial.
    retentiveLabel: "mesial buccal clasp",
    retentiveFailureReason: "RPA could not resolve a clasp position for this tooth.",
    resolveRetentiveElement: () => ({ componentId: "retainer-clasp", surface: "mesial_buccal" }),
  });
}

export function resolveMajorConnectorAnchorComponentId(tooth) {
  ensureToothPlacementState(tooth);
  for (const { componentId } of tooth.componentPlacements) {
    const def = COMPONENT_BY_ID.get(componentId);
    if (!def) continue;
    if (tooth.isPresent && isPlateComponentId(componentId)) return componentId;
    if (tooth.isPresent && isReciprocatingClaspComponent(componentId)) return componentId;
    if (!tooth.isPresent && isMeshComponent(def)) return componentId;
  }
  return null;
}

export function toothSupportsMajorConnectorOverlay(tooth, toothId, majorComponentId, teeth = state.teeth) {
  if (resolveMajorConnectorAnchorComponentId(tooth) !== null) return true;
  // Past here the tooth anchors nothing, so it can only be carried by a run that reaches it.
  const id = String(toothId);
  const jaw = TOOTH_ORDER.upper.includes(id) ? "upper" : TOOTH_ORDER.lower.includes(id) ? "lower" : null;
  if (!jaw) return false;
  // A posterior-only major is placed per anchored tooth and carries nobody, so an
  // unanchored tooth is never its own — matching the catalog's "click mesh or plate".
  if (!majorConnectorRunsToMidline(majorComponentId)) return false;
  // A midline-reaching major carries only the bare teeth the span walk puts between its
  // start and the midline. Looser rules ghost a clickable stub on the terminal molars.
  return getMajorConnectorSpanTeeth(teeth, majorComponentId, COMPONENT_BY_ID, jaw, {
    includeExistingPlacements: true,
  }).includes(id);
}
