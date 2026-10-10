import {
  ASSEMBLY_REST_SUGGESTION_IDS,
  augmentTeethForPalatalBarConnectorNeighbors,
  COMPONENT_BY_ID,
  getBarUserOffset,
  getReciprocatingClaspAssetReference,
  getRingClaspAssetReference,
  getRingClaspPlacementImageSize,
  getRingClaspPlacementOffset,
  getRetainerClaspAssetReference,
  getRetainerClaspPlacementImageSize,
  getRetainerClaspPlacementOffset,
  getRetainerClaspPlacementRenderScale,
  getRetainerClaspSuggestionPointsForTooth,
  getRetainerClaspSuggestionRadius,
  getCingulumAcSuggestionPointsForTooth,
  getComponentAssetReference,
  getFlangeFreeEnds,
  BAR_PLACEMENT_ANCHOR_SURFACE,
  getBarPlacementAssetReference,
  getBarPlacementImageSize,
  getBarPlacementOffset,
  getBarPlacementRenderScale,
  getMinorConnectorAssetReference,
  getMinorConnectorImageSize,
  getMinorConnectorMidOffset,
  getMinorConnectorOffset,
  getMinorConnectorRenderScale,
  getMinorConnectorSupportSides,
  getMajorConnectorPlacementImageSize,
  getMajorConnectorPlacementOffset,
  getMajorConnectorRenderScaleMultiplier,
  getMeshPlacementImageSize,
  getMeshPlacementOffset,
  getMeshPlacementRenderScale,
  getPlatePlacementImageSize,
  getPlatePlacementOffset,
  getPlatePlacementRenderScale,
  getRestPlacementAssetReference,
  getRestPlacementImageSize,
  getRestPlacementOffset,
  getRestPlacementRenderScale,
  getRestSuggestionPointsForTooth,
  getRestSuggestionRadius,
  getRestSuggestionSurfaces,
  hasPalatalBarPlacementOnUpperArch,
  hasPalatalPlatePlacementOnUpperArch,
  hasPalatalHolePlacementOnUpperArch,
  hasPalatalStrapPlacementOnUpperArch,
  PALATAL_STRAP_MAJOR_COMPONENT_ID,
  isPalatalStrapMajorComponent,
  PALATAL_STRAP_ARCH_POLYGON,
  isBarComponent,
  isBarPlacementSurface,
  isReciprocatingClaspComponent,
  isRingClaspComponent,
  isRetainerClaspComponent,
  isMajorConnectorComponent,
  isMajorConnectorToothExcluded,
  isMajorConnectorPlacementSeparated,
  isMeshComponent,
  isPalatalBarMajorComponent,
  isPalatalHoleMajorComponent,
  isPlateComponentId,
  isRestComponent,
  meshHoleUniformScaleToothId,
  PALATAL_BAR_ARCH_OVERLAY,
  getPalatalHoleArchOverlayLayers,
  getPalatalPlateArchOverlayFrame,
  shouldMajorConnectorIgnoreMeshPlateAnchor,
  isPalatalBarDistalRunEnd,
  getMajorConnectorAssetReference,
  getPalatalPlateOverlayIndexFromUpperPlacements,
   } from "./components.js";
import {
  ANTERIOR_REST_SURFACE_DIALOG_TEETH,
  COMPONENT_IMAGE_HEIGHT,
  COMPONENT_IMAGE_WIDTH,
  COMPONENT_SCALE_BY_JAW,
  COMPONENT_SCALE_BY_TOOTH,
  getNeighborToothIds,
  JAW_IMAGE_FLIP_X,
  PLATE_SUGGESTION_TRANSFORM_BY_JAW,
  PRESENCE_TOOTH_ASSET,
  TOOTH_ASSET_BASE,
  TOOTH_IMAGE_HALF_HEIGHT,
  TOOTH_IMAGE_HALF_WIDTH,
  TOOTH_IMAGE_HEIGHT,
  TOOTH_IMAGE_WIDTH,
  TOOTH_SCALE_OVERRIDE,
} from "./constants.js";
import {
  REST_CALIBRATION_COMPONENT_ID,
  state,
  positionAnteriorRestPanel,
  setMessage,
  svgEl,
  renderJaw,
  renderJaws,
} from "./2DAnnotation.js";
import {
  getContinuousClaspRestSurfaces,
  getGapFacingRestSurfaces,
  hasMeshedDistalSaddle,
  placeBackActionAssemblyOnTooth,
  hasMissingDistalNeighbour,
  placeAssemblyRpaOnTooth,
  placeAssemblyRpiOnTooth,
  placeEmbrasureCircumAssemblyOnTooth,
  placeHalfAndHalfAssemblyOnTooth,
  placeMultiCircumAssemblyOnTooth,
  placeSelectedComponentOnTooth,
  placeSimpleCircumAssemblyOnTooth,
  resolveMajorConnectorAnchorComponentId,
} from "./annotationPlacement.js";
import {
  ensureToothPlacementState,
  getToothAssetSpec,
  getToothPlacement,
  getToothScale,
  normalizeStatus,
  normalizeSurface,
  removePlacement,
} from "./annotationTeethModel.js";

// Apply status CSS classes for present/abutment/compromised/missing tooth visuals.
function applyToothStatusClass(group, tooth) {
  if (!tooth.isPresent) {
    group.classList.add("is-missing");
    return;
  }

  const status = normalizeStatus(tooth.status);
  if (status === "abutment" || status === "compromised") {
    group.classList.add(`status-${status}`);
    return;
  }
  group.classList.add("status-presence");
}

// For tooth rendering: draw placed major connectors and mesh visuals.
function appendToothComponentVisuals(group, tooth, toothId, jaw) {
  ensureToothPlacementState(tooth);

  const catalogEntries = Array.isArray(tooth.components)
    ? tooth.components
        .map((id) => ({ id, def: COMPONENT_BY_ID.get(id) }))
        .filter((x) => x.def)
    : [];

  // While the bar is on the arch it is the only major drawn on the upper teeth, anteriors
  // included: a leftover segment from the outgoing connector is not part of this design.
  const showPalatalBarSegment = jaw === "upper" && shouldShowPalatalBarArchOverlay();

  const majorIds = [];
  for (const { id, def } of catalogEntries) {
    if (!isMajorConnectorComponent(def)) {
      continue;
    }
    if (showPalatalBarSegment && !isPalatalBarMajorComponent(id)) {
      continue;
    }
    if (isMajorConnectorToothExcluded(id, toothId)) {
      continue;
    }
    if (!majorIds.includes(id)) {
      majorIds.push(id);
    }
  }

  // The arch draws placed connectors only. Selecting one in the catalog used to also
  // preview it on the teeth beside a run, which read as artwork already placed there.

  for (const majorId of majorIds) {
    // Lingual plate = band PLUS a per-tooth fill on each PRESENT tooth; the fill IS the
    // reciprocal. Gated on plate-prox, and the SINGLE source of the plate visual.
    if (
      majorId !== "major-lower-lingual-bar" &&
      tooth.isPresent &&
      tooth.components.includes("plate-prox") &&
      !tooth.components.some((id) => isReciprocatingClaspComponent(id))
    ) {
      // A palatal bar's last plate terminates the run but the art stops on a straight cut,
      // so round it to match the connector's own _distal cap beside it.
      const plate = createComponentVisual("plate-prox", toothId, jaw, {
        roundDistalEnd:
          isPalatalBarMajorComponent(majorId) && isPalatalBarDistalRunEnd(toothId, state.teeth),
      });
      if (plate) group.appendChild(plate);
    }
    const under = createMajorConnectorVisual(majorId, tooth, toothId, jaw);
    if (under) {
      group.appendChild(under);
    }
  }

  if (!tooth.components.length) {
    return;
  }

  if (!tooth.isPresent) {
    for (const { id, def } of catalogEntries) {
      if (!isMeshComponent(def)) {
        continue;
      }
      // A flange rounds its buccal corner on each end where the flange run stops.
      const options =
        id === "mesh-flange"
          ? { flangeFreeEnds: getFlangeFreeEnds(state.teeth, toothId, jaw) }
          : undefined;
      const visual = createComponentVisual(id, toothId, jaw, options);
      if (visual) {
        group.appendChild(visual);
      }
    }
    return;
  }
}

// For tooth rendering: draw placed plates in a dedicated pass above tooth bodies.
function appendToothPlateComponentVisuals(group, tooth, toothId, jaw) {
  ensureToothPlacementState(tooth);
  if (!tooth.isPresent) return;

  if (state.hideLowerPlateVisuals && jaw === "lower") {
    return;
  }

  const selected = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (
    state.designMode &&
    jaw === "lower" &&
    selected &&
    isMajorConnectorComponent(selected) &&
    selected.id === "major-lower-lingual-bar"
  ) {
    return;
  }

  const catalogEntries = Array.isArray(tooth.components)
    ? tooth.components
        .map((id) => ({ id, def: COMPONENT_BY_ID.get(id) }))
        .filter((x) => x.def)
    : [];

  // The connector pass fills plate-prox for every major but the lower lingual bar, so only
  // standalone plates render here — plus the teeth whose major that pass skips: under the
  // bar, any upper tooth without a bar segment of its own.
  const suppressedFromConnectorFill =
    jaw === "upper" &&
    shouldShowPalatalBarArchOverlay() &&
    !tooth.components.some((id) => isPalatalBarMajorComponent(id));
  const drawnByConnectorFill =
    !suppressedFromConnectorFill &&
    tooth.components.some(
      (id) => isMajorConnectorComponent(id) && id !== "major-lower-lingual-bar"
    );

  for (const { id } of catalogEntries) {
    if (!isPlateComponentId(id)) {
      continue;
    }
    if (id === "plate-prox" && drawnByConnectorFill) {
      continue;
    }
    const visual = createComponentVisual(id, toothId, jaw);
    if (visual) {
      group.appendChild(visual);
    }
  }
}

function getRestSurfacePointMap(toothId, jaw, componentId = null) {
  const { mirrored } = getToothAssetSpec(toothId);
  const points = getRestSuggestionPointsForTooth(
    toothId,
    jaw,
    mirrored,
    JAW_IMAGE_FLIP_X[jaw] ?? 1,
    componentId
  );

  const map = new Map(points.map((point) => [normalizeSurface(point.surface), point]));
  const cingulumAc = getCingulumAcSuggestionPointsForTooth(toothId);
  if (cingulumAc) {
    for (const p of cingulumAc) {
      const key = normalizeSurface(p.surface);
      if (key) map.set(key, { surface: p.surface, x: p.x, y: p.y });
    }
  }
  return map;
}

function getClaspSurfacePointMap(toothId, jaw) {
  const points = getRetainerClaspSuggestionPointsForTooth(toothId, jaw);
  return new Map(points.map((point) => [normalizeSurface(point.surface), point]));
}

function restMarkerAnchorSurface(placementSurface, toothId) {
  const s = normalizeSurface(placementSurface);
  if (!s) return null;
  // ac_both spans both sides; anchor it at the centered full-cingulum point.
  if (s === "lingual_both") return "lingual";
  if (isAnteriorRestSurfaceDialogTooth(toothId)) {
    if (s === "lingual_mesial" || s === "lingual_distal") return s;
    if (s === "lingual") return "lingual";
  }
  return s;
}

// getMinorConnectorSupportSides now lives in components.minor.js — it is pure tooth-record
// logic, and tests need it without booting this DOM-heavy module.

/** Neighbouring tooth records across each embrasure, for getMinorConnectorSupportSides. */
function getNeighborTeeth(toothId, jaw) {
  const ids = getNeighborToothIds(toothId, jaw);
  return {
    mesial: ids.mesial ? state.teeth[ids.mesial] || null : null,
    distal: ids.distal ? state.teeth[ids.distal] || null : null,
  };
}

/**
 * The neighbour across a SHARED embrasure, else null. A shared embrasure gets one `mid`
 * (full) connector, drawn once by the caller; a solo side draws its directional half.
 */
function getMinorConnectorSharedNeighborId(toothId, jaw, side) {
  const neighborId = getNeighborToothIds(toothId, jaw)[side];
  const neighbor = neighborId ? state.teeth[neighborId] : null;
  if (!neighbor) return null;
  // Side of the neighbour that faces back toward this tooth (mesial-to-mesial at the midline).
  const facingSide =
    getNeighborToothIds(neighborId, jaw).mesial === String(toothId) ? "mesial" : "distal";
  const neighborSides = getMinorConnectorSupportSides(neighbor, getNeighborTeeth(neighborId, jaw));
  return neighborSides[facingSide] ? String(neighborId) : null;
}

/** Build + append one minor-connector image for a tooth side ("mesial"/"distal") and variant. */
function appendMinorConnectorVisual(group, toothId, jaw, variant, side, mirrored) {
  const href = getMinorConnectorAssetReference(toothId, variant);
  const size = getMinorConnectorImageSize(toothId, variant);
  if (!href || !size) return;
  const offset = variant === "mid"
    ? getMinorConnectorMidOffset(toothId)
    : getMinorConnectorOffset(toothId, side);
  const scale = getMinorConnectorRenderScale(jaw);
  const width = size.width * scale;
  const height = size.height * scale;
  const minor = svgEl("g", {
    class: "minor-connector-placement",
    transform: `translate(${offset.x} ${offset.y}) scale(${mirrored ? -1 : 1} 1)`,
    "pointer-events": "none",
  });
  minor.appendChild(
    svgEl("image", {
      ...centeredImageAttrs(href, width, height),
      class: state.jawMaterial === 2 ? "minor-connector-image is-acrylic" : "minor-connector-image",
      "data-component-id": "minor-connector",
      "pointer-events": "none",
    })
  );
  group.appendChild(minor);
}

// Geometry for an <image> centred on its parent group's origin.
function centeredImageAttrs(href, width, height) {
  return {
    href,
    x: String(-width / 2),
    y: String(-height / 2),
    width: String(width),
    height: String(height),
    preserveAspectRatio: "xMidYMid meet",
  };
}

function appendPlacedComponentMarkers(group, tooth, toothId, jaw) {
  ensureToothPlacementState(tooth);
  const { mirrored } = getToothAssetSpec(toothId);
  if (!tooth.componentPlacements.length) return;
  if (!tooth.isPresent) {
    const hasBarPlacement = tooth.componentPlacements.some((placement) =>
      isBarComponent(placement.componentId) && isBarPlacementSurface(normalizeSurface(placement.surface))
    );
    // A meshed saddle carries its own minor connectors (see getMinorConnectorSupportSides);
    // the rest/clasp/bar passes below are component-filtered, so they stay no-ops here.
    const hasMeshPlacement = tooth.componentPlacements.some((placement) =>
      isMeshComponent(placement.componentId)
    );
    if (!hasBarPlacement && !hasMeshPlacement) return;
  }

  const radius = getRestSuggestionRadius() + 0.6;

  const canRemoveComponentId = (componentId) => {
    // In remove-mode, removal is only allowed via the remove list UI.
    if (state.removeComponentMode) return false;
    return Boolean(componentId && state.selectedComponentId === componentId);
  };

  // Removal handler shared by every placement marker. Bails WITHOUT trapping the click
  // when the component is protected, so the tooth's own handler still runs.
  const removeOnClick = (placement, surface, message) => (event) => {
    if (state.removeComponentMode) return;
    if (!canRemoveComponentId(placement.componentId)) return;
    event.stopPropagation();
    removePlacement(tooth, placement.componentId, surface);
    const label = COMPONENT_BY_ID.get(placement.componentId)?.label || placement.componentId;
    setMessage(message || `Removed ${label} (${surface}) from tooth ${toothId}.`, false);
    renderJaw(jaw);
  };

  // One minor connector per supported embrasure side. A shared embrasure gets a single `mid`
  // connector, owned by the higher-id tooth; a solo side draws its directional half.
  const minorConnectorSupportSides = getMinorConnectorSupportSides(
    tooth,
    getNeighborTeeth(toothId, jaw)
  );
  for (const side of ["mesial", "distal"]) {
    if (!minorConnectorSupportSides[side]) continue;
    const sharedNeighborId = getMinorConnectorSharedNeighborId(toothId, jaw, side);
    if (sharedNeighborId) {
      if (Number(toothId) > Number(sharedNeighborId)) {
        appendMinorConnectorVisual(group, toothId, jaw, "mid", null, mirrored);
      }
      continue;
    }
    appendMinorConnectorVisual(group, toothId, jaw, side, side, mirrored);
  }

  for (const placement of tooth.componentPlacements) {
    if (!isRestComponent(placement.componentId)) continue;

    const surface = normalizeSurface(placement.surface);
    if (!surface) continue;

    const pointMap = getRestSurfacePointMap(
      toothId,
      jaw,
      placement.componentId === "rest-onlay" ? null : placement.componentId
    );
    const anchorSurface = restMarkerAnchorSurface(placement.surface, toothId);
    const point = anchorSurface ? pointMap.get(anchorSurface) : null;
    if (!point) continue;

    const assetHref = getRestPlacementAssetReference(placement.componentId, toothId, surface);
    const imageSize = getRestPlacementImageSize(placement.componentId, toothId, surface);
    const restOffset = getRestPlacementOffset(placement.componentId, toothId, surface);
    const restScale = getRestPlacementRenderScale(placement.componentId, toothId, surface);

    if (assetHref && imageSize) {
      const width = imageSize.width * restScale;
      const height = imageSize.height * restScale;

      const imageGroup = svgEl("g", {
        transform: `translate(${point.x + (Number.isFinite(restOffset?.x) ? restOffset.x : 0)} ${point.y + (Number.isFinite(restOffset?.y) ? restOffset.y : 0)}) scale(${mirrored ? -1 : 1} 1)`
      });

      imageGroup.appendChild(
        svgEl("image", {
          ...centeredImageAttrs(assetHref, width, height),
          class: `rest-placement-image rest-placement-${surface}${
            placement.componentId === REST_CALIBRATION_COMPONENT_ID ? " is-placed-rest-seat" : ""
          }`,
          "data-surface": surface,
          "data-component-id": placement.componentId,
        })
      );

      imageGroup.addEventListener("click", removeOnClick(placement, surface));

      group.appendChild(imageGroup);
      continue;
    }

    const marker = svgEl("circle", {
        cx: String(point.x),
        cy: String(point.y),
        r: String(radius),
        class: `rest-placement-marker rest-placement-${surface}${
          placement.componentId === REST_CALIBRATION_COMPONENT_ID ? " is-placed-rest-seat" : ""
        }`,
        "data-surface": surface,
        "data-component-id": placement.componentId,
      });

    marker.addEventListener("click", removeOnClick(placement, surface));

    group.appendChild(marker);
  }

  const claspRadius = getRetainerClaspSuggestionRadius() + 0.6;
  for (const placement of tooth.componentPlacements) {
    const isRetainer = isRetainerClaspComponent(placement.componentId);
    const isReciprocating = isReciprocatingClaspComponent(placement.componentId);
    const isRing = isRingClaspComponent(placement.componentId);
    if (!isRetainer && !isReciprocating && !isRing) continue;

    const surface = normalizeSurface(placement.surface);
    if (!surface) continue;

    const claspPointMap = getClaspSurfacePointMap(toothId, jaw);
    const point = claspPointMap.get(surface);
    if (!point) continue;

    const claspOffset = isRing
      ? getRingClaspPlacementOffset(placement.componentId, toothId, surface)
      : getRetainerClaspPlacementOffset(placement.componentId, toothId, surface);
    const outerG = svgEl("g", {
      transform: `translate(${point.x + claspOffset.x} ${point.y + claspOffset.y}) scale(${mirrored ? -1 : 1} 1)`,
      class: `clasp-placement-root clasp-placement-${surface}`,
    });

    const assetHref = isReciprocating
      ? getReciprocatingClaspAssetReference(toothId, surface)
      : isRing
        ? getRingClaspAssetReference(toothId, surface)
      : getRetainerClaspAssetReference(toothId, surface);
    const imageSize = isRing
      ? getRingClaspPlacementImageSize(placement.componentId, toothId, surface)
      : getRetainerClaspPlacementImageSize(placement.componentId, toothId, surface);
    const claspScale = getRetainerClaspPlacementRenderScale(placement.componentId, toothId, surface);

    if (assetHref && imageSize) {
      const width = imageSize.width * claspScale;
      const height = imageSize.height * claspScale;

      outerG.appendChild(
        svgEl("image", {
          ...centeredImageAttrs(assetHref, width, height),
          class: `clasp-placement-image clasp-placement-${surface}`,
          "data-surface": surface,
          "data-component-id": placement.componentId,
        })
      );
    } else {
      outerG.appendChild(
        svgEl("circle", {
          cx: "0",
          cy: "0",
          r: String(claspRadius),
          class: `clasp-placement-marker clasp-placement-${surface}`,
          "data-surface": surface,
          "data-component-id": placement.componentId,
        })
      );
    }

    outerG.addEventListener(
      "click",
      removeOnClick(placement, surface, `Removed clasp (${surface}) from tooth ${toothId}.`)
    );

    group.appendChild(outerG);
  }

  for (const placement of tooth.componentPlacements) {
    if (!isBarComponent(placement.componentId)) continue;
    const barSurface = normalizeSurface(placement.surface);
    if (!barSurface || !isBarPlacementSurface(barSurface)) continue;

    const claspPointMap = getClaspSurfacePointMap(toothId, jaw);
    const anchor = normalizeSurface(BAR_PLACEMENT_ANCHOR_SURFACE);
    const point = anchor ? claspPointMap.get(anchor) : null;
    if (!point) continue;

    const off = getBarPlacementOffset(placement.componentId, toothId, barSurface);
    const href = getBarPlacementAssetReference(placement.componentId, toothId, barSurface);
    const imageSize = getBarPlacementImageSize(placement.componentId, toothId, barSurface);
    const scale = getBarPlacementRenderScale(placement.componentId, toothId, barSurface);
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;

    if (
      placement.barOffsetX == null &&
      placement.barOffsetY == null &&
      (Number.isFinite(Number(placement.barX)) || Number.isFinite(Number(placement.barY)))
    ) {
      placement.barOffsetX = Number.isFinite(Number(placement.barX)) ? Number(placement.barX) : 0;
      placement.barOffsetY = Number.isFinite(Number(placement.barY)) ? Number(placement.barY) : 0;
      delete placement.barX;
      delete placement.barY;
    }

    const uoff = getBarUserOffset(placement);
    const mirroredOffsetX = mirrored ? -off.x : off.x;
    const mirroredUserOffsetX = mirrored ? -uoff.x : uoff.x;

    const outerG = svgEl("g", {
      transform: `translate(${point.x + mirroredOffsetX + mirroredUserOffsetX} ${point.y + off.y + uoff.y}) rotate(${off.rotation}) scale(${mirrored ? -1 : 1} 1)`,
      class: `bar-placement-root bar-placement-${barSurface}`,
    });

    outerG.appendChild(
      svgEl("image", {
        ...centeredImageAttrs(href, width, height),
        class: `bar-placement-image bar-placement-${barSurface}`,
        "data-surface": barSurface,
        "data-component-id": placement.componentId,
      })
    );

    // ~Half the bar image, so the visible bar is clickable without its transparent bounds
    // blocking neighbours. Only intercepts while this exact bar is the active tool.
    const barIsActiveTool =
      !state.removeComponentMode &&
      state.selectedComponentId === placement.componentId;
    const hitRadius = Math.max(5, Math.min(width, height) * 0.32);
    const barHitTarget = svgEl("circle", {
      cx: "0",
      cy: "0",
      r: String(hitRadius.toFixed(1)),
      class: `bar-placement-hit-target bar-placement-${barSurface}`,
      "data-surface": barSurface,
      "data-component-id": placement.componentId,
      // Use inline style so this wins against the
      // `.bar-placement-hit-target { pointer-events: visible }` CSS rule.
      style: barIsActiveTool ? "" : "pointer-events: none;",
    });
    barHitTarget.addEventListener(
      "click",
      removeOnClick(placement, barSurface, `Removed bar from tooth ${toothId}.`)
    );
    outerG.appendChild(barHitTarget);

    group.appendChild(outerG);
  }

}

function isAnteriorRestSurfaceDialogTooth(toothId) {
  return ANTERIOR_REST_SURFACE_DIALOG_TEETH.has(String(toothId));
}

// A cingulum rest may be stored on any lingual sub-surface ("lingual", "lingual_mesial",
// "lingual_distal", "lingual_both"). All are the same logical rest for place/remove.
const CINGULUM_REST_SURFACES = new Set([
  "lingual",
  "lingual_mesial",
  "lingual_distal",
  "lingual_both",
]);

function isCingulumRestSurface(surface) {
  const s = normalizeSurface(surface);
  return Boolean(s && CINGULUM_REST_SURFACES.has(s));
}

// ASSEMBLY_REST_SUGGESTION_IDS is derived from the catalog in components.js, so a new
// assembly gets its suggestion dots without being registered anywhere by hand.

// RPI/RPA anchor their rest on the mesial and everything else on the distal saddle.
const RPX_ASSEMBLY_IDS = new Set(["assembly-rpi", "assembly-rpa"]);

// Back-action is Simple pinned to its mesial-rest form (id kept from its "Ring Support" days).
const BACK_ACTION_ID = "assembly-circ-ring-support";

const SIMPLE_CIRCUM_POSTERIOR_TOOTH_IDS = new Set([
  "14", "15", "16", "17", "18",
  "24", "25", "26", "27", "28",
  "34", "35", "36", "37", "38",
  "44", "45", "46", "47", "48",
]);

const COMBINE_CLASPS_ID = "assembly-circ-embrasure";

function canPlaceEmbrasureAtSurface(toothId, jaw, surface) {
  return getGapFacingRestSurfaces(toothId, jaw).includes(normalizeSurface(surface));
}

const CONTINUOUS_CLASPS_ID = "assembly-circ-multi";

// Only a distal-extension abutment is offered RPI/RPA, and only on its mesial. RPI also
// needs the saddle meshed, or pruneInvalidBarPlacementsInJaw drops the I-bar next render.
function getRpxAssemblyAllowedRestSurfaces(componentId, toothId, jaw) {
  const eligible = componentId === "assembly-rpi"
    ? hasMeshedDistalSaddle(toothId, jaw)
    : hasMissingDistalNeighbour(toothId, jaw);
  return eligible ? ["mesial"] : [];
}


// Popup: mesial / distal / full (lingual) for anterior teeth 13–23 and 33–43; anchored near click.
function showAnteriorRestSurfaceDialog(toothId, anchor, onComplete) {
  const root = document.getElementById("anteriorRestSurfaceDialog");
  const panel = root?.querySelector(".anterior-rest-dialog-panel");
  const backdrop = root?.querySelector(".anterior-rest-dialog-backdrop");
  const surfaceBtns = root ? [...root.querySelectorAll("[data-rest-surface]")] : [];

  if (!root || !panel || !backdrop || surfaceBtns.length === 0) {
    onComplete(null);
    return;
  }

  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (!selectedComponent) {
    onComplete(null);
    return;
  }

  const allowed = state.restSeatCalibrationAcOnly
    ? new Set(["lingual_mesial", "lingual_distal"])
    : new Set(["lingual_mesial", "lingual_distal", "lingual"]);

  panel.setAttribute("aria-label", `Set cingulum rest, tooth ${toothId}`);

  for (const btn of surfaceBtns) {
    const s = normalizeSurface(btn.getAttribute("data-rest-surface"));
    const ok = Boolean(s && allowed.has(s));
    btn.classList.toggle("is-hidden", !ok);
    btn.disabled = !ok;
    btn.setAttribute("aria-hidden", ok ? "false" : "true");
  }

  let closed = false;
  const surfaceHandlers = [];

  const cleanup = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown);
    backdrop.removeEventListener("click", onBackdrop);
    for (const { btn, fn } of surfaceHandlers) {
      btn.removeEventListener("click", fn);
    }
    panel.style.left = "";
    panel.style.top = "";
    panel.style.visibility = "";
    root.classList.add("is-hidden");
    root.setAttribute("aria-hidden", "true");
  };

  const finish = (surface) => {
    cleanup();
    onComplete(surface);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") finish(null);
  };

  const onBackdrop = () => finish(null);

  for (const btn of surfaceBtns) {
    const s = normalizeSurface(btn.getAttribute("data-rest-surface"));
    if (!s || !allowed.has(s)) continue;
    const fn = () => finish(s);
    btn.addEventListener("click", fn);
    surfaceHandlers.push({ btn, fn });
  }

  document.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("click", onBackdrop);

  panel.style.visibility = "hidden";
  root.classList.remove("is-hidden");
  root.setAttribute("aria-hidden", "false");

  const firstFocus = surfaceBtns.find((b) => {
    const s = normalizeSurface(b.getAttribute("data-rest-surface"));
    return s && allowed.has(s);
  });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      positionAnteriorRestPanel(panel, anchor);
      panel.style.visibility = "visible";
      firstFocus?.focus();
    });
  });
}

function handleRestSuggestionPick(jaw, toothId, pointSurface, anchor) {
  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (selectedComponent?.id === "assembly-circ") {
    const surface = normalizeSurface(pointSurface);
    if (surface !== "mesial" && surface !== "distal") {
      setMessage("Simple Circum Assembly supports mesial or distal rest seat only.", true);
      return;
    }
    placeSimpleCircumAssemblyOnTooth(toothId, surface);
    renderJaw(jaw);
    return;
  }
  if (selectedComponent?.id === CONTINUOUS_CLASPS_ID) {
    const surface = normalizeSurface(pointSurface);
    if (surface !== "mesial" && surface !== "distal") {
      setMessage("Continuous Clasps supports mesial or distal rest-seat suggestion only.", true);
      return;
    }
    placeMultiCircumAssemblyOnTooth(toothId, jaw, surface);
    renderJaws();
    return;
  }
  if (selectedComponent?.id === "assembly-circ-half-n-half") {
    const surface = normalizeSurface(pointSurface);
    if (surface !== "mesial" && surface !== "distal") {
      setMessage("Half & Half supports mesial or distal rest-seat suggestion only.", true);
      return;
    }
    placeHalfAndHalfAssemblyOnTooth(toothId, surface);
    renderJaw(jaw);
    return;
  }
  if (selectedComponent?.id === BACK_ACTION_ID) {
    const surface = normalizeSurface(pointSurface);
    if (surface !== "mesial" && surface !== "distal") {
      setMessage("Back-action Clasps supports mesial or distal rest seat only.", true);
      return;
    }
    placeBackActionAssemblyOnTooth(toothId, surface);
    renderJaw(jaw);
    return;
  }
  if (selectedComponent?.id === COMBINE_CLASPS_ID) {
    const surface = normalizeSurface(pointSurface);
    if (surface !== "mesial" && surface !== "distal") {
      setMessage("Combine Clasps supports mesial or distal rest-seat suggestion only.", true);
      return;
    }
    placeEmbrasureCircumAssemblyOnTooth(toothId, jaw, surface);
    renderJaws();
    return;
  }
  if (RPX_ASSEMBLY_IDS.has(selectedComponent?.id)) {
    const surface = normalizeSurface(pointSurface);
    const label = selectedComponent.id === "assembly-rpi" ? "RPI" : "RPA";
    if (surface !== "mesial") {
      setMessage(`${label} places its rest on the mesial only.`, true);
      return;
    }
    if (selectedComponent.id === "assembly-rpi") {
      placeAssemblyRpiOnTooth(toothId, jaw, surface);
    } else {
      placeAssemblyRpaOnTooth(toothId, jaw, surface);
    }
    renderJaw(jaw);
    return;
  }

  const applySurface = (surface) => {
    const normalized = normalizeSurface(surface);
    if (!normalized) return;
    placeSelectedComponentOnTooth(toothId, { surface: normalized });
    renderJaw(jaw);
  };

  const clicked = normalizeSurface(pointSurface);
  const skipCingulumDialog =
    clicked === "mesial" ||
    clicked === "distal" ||
    state.restSeatCalibrationAcOnly;

  if (!isAnteriorRestSurfaceDialogTooth(toothId) || skipCingulumDialog) {
    applySurface(pointSurface);
    return;
  }

  // The dialog offers only some cingulum sub-surfaces, so any lingual click removes an
  // existing rest; the dialog opens only when none exists yet.
  const selectedTooth = state.teeth[String(toothId)];
  if (selectedComponent?.id === "rest-seat" && selectedTooth) {
    ensureToothPlacementState(selectedTooth);
    const existingCingulum = (selectedTooth.componentPlacements || []).filter(
      (entry) => entry.componentId === "rest-seat" && isCingulumRestSurface(entry.surface)
    );
    if (existingCingulum.length) {
      for (const entry of existingCingulum) {
        removePlacement(selectedTooth, entry.componentId, entry.surface);
      }
      setMessage(`Removed cingulum rest from tooth ${toothId}.`, false);
      renderJaw(jaw);
      return;
    }
  }

  showAnteriorRestSurfaceDialog(toothId, anchor, (chosen) => {
    if (chosen) applySurface(chosen);
  });
}

function shouldShowRestSuggestions() {
  if (state.suppressArchPlacementSuggestions) return false;
  if (!state.designMode) return false;
  if (ASSEMBLY_REST_SUGGESTION_IDS.has(state.selectedComponentId)) return true;
  return isRestComponent(state.selectedComponentId);
}

function shouldShowRetainerClaspSuggestions() {
  if (state.suppressArchPlacementSuggestions) return false;
  if (!state.designMode) return false;
  return (
    isRetainerClaspComponent(state.selectedComponentId) ||
    isReciprocatingClaspComponent(state.selectedComponentId) ||
    isRingClaspComponent(state.selectedComponentId)
  );
}

function shouldShowPlateSuggestions() {
  if (state.suppressArchPlacementSuggestions) return false;
  if (!state.designMode) return false;
  const selected = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  return Boolean(selected && isPlateComponentId(selected.id));
}

function hasSelectedPlatePlacement(tooth) {
  ensureToothPlacementState(tooth);
  const selected = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (!selected || !isPlateComponentId(selected.id)) return false;
  return tooth.componentPlacements.some((entry) => entry.componentId === selected.id);
}

function handlePlateSuggestionPick(jaw, toothId) {
  placeSelectedComponentOnTooth(toothId, null);
  renderJaw(jaw);
}

function appendPlateSuggestionPoints(group, tooth, toothId, jaw) {
  if (!shouldShowPlateSuggestions()) return;
  if (!tooth.isPresent) return;
  const selected = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (!selected || !isPlateComponentId(selected.id)) return;

  const suggestion = createComponentVisual(selected.id, toothId, jaw);
  if (!suggestion) return;
  const transformCfg = PLATE_SUGGESTION_TRANSFORM_BY_JAW[jaw] || {};
  const suggestionScale = Number(transformCfg.scale) || 0.35;
  const suggestionOffset = transformCfg.offset || { x: 0, y: 0 };
  const sx = Number(suggestionOffset.x) || 0;
  const sy = Number(suggestionOffset.y) || 0;

  const wrapper = svgEl("g", {
    class: hasSelectedPlatePlacement(tooth)
      ? "plate-suggestion-visual is-selected"
      : "plate-suggestion-visual",
    transform: `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${suggestionScale.toFixed(3)} ${suggestionScale.toFixed(3)})`,
    "data-tooth-id": toothId,
  });
  wrapper.appendChild(suggestion);

  // Tightly-bounded hit target centered on the tooth so clicks never bleed
  // into the visually overlapping plate image of an adjacent tooth.
  const hitTarget = svgEl("circle", {
    cx: "0",
    cy: "0",
    r: "20",
    class: "plate-suggestion-hit-target",
    "data-tooth-id": toothId,
  });
  hitTarget.addEventListener("click", (event) => {
    event.stopPropagation();
    handlePlateSuggestionPick(jaw, toothId);
  });
  wrapper.appendChild(hitTarget);

  group.appendChild(wrapper);
}

// Draw clickable rest guidance points when a rest component is selected.
function appendRestSuggestionPoints(group, tooth, toothId, jaw) {
  if (!shouldShowRestSuggestions()) return;
  if (!tooth.isPresent) return;

  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (!selectedComponent) return;
  const isAssembly = ASSEMBLY_REST_SUGGESTION_IDS.has(selectedComponent.id);
  if (!isAssembly && !isRestComponent(selectedComponent)) return;
  // Combine Clasps brackets a gap anywhere on the arch, so it is exempt from the
  // posterior-only gate — with 23 missing, abutment 22 is anterior.
  if (
    isAssembly &&
    selectedComponent.id !== COMBINE_CLASPS_ID &&
    !SIMPLE_CIRCUM_POSTERIOR_TOOTH_IDS.has(String(toothId))
  ) return;

  ensureToothPlacementState(tooth);

  let points;
  if (
    state.restSeatCalibrationAcOnly &&
    selectedComponent.id === REST_CALIBRATION_COMPONENT_ID &&
    isAnteriorRestSurfaceDialogTooth(toothId)
  ) {
    points = getCingulumAcSuggestionPointsForTooth(toothId) ?? [];
  } else {
    const allowedSurfaces =
      RPX_ASSEMBLY_IDS.has(selectedComponent.id)
        ? new Set(["mesial"])
        : isAssembly
          ? new Set(["mesial", "distal"])
          : new Set(getRestSuggestionSurfaces(selectedComponent.id, toothId));
    points = [...getRestSurfacePointMap(toothId, jaw, selectedComponent.id).values()].filter((point) =>
      allowedSurfaces.has(normalizeSurface(point.surface))
    );
    if (selectedComponent.id === COMBINE_CLASPS_ID) {
      points = points.filter((point) => canPlaceEmbrasureAtSurface(toothId, jaw, normalizeSurface(point.surface)));
    }
    if (selectedComponent.id === CONTINUOUS_CLASPS_ID) {
      const gapFacing = new Set(getContinuousClaspRestSurfaces(toothId, jaw));
      points = points.filter((point) => gapFacing.has(normalizeSurface(point.surface)));
    }
    if (RPX_ASSEMBLY_IDS.has(selectedComponent.id)) {
      const allowedByDistalSaddle = new Set(
        getRpxAssemblyAllowedRestSurfaces(selectedComponent.id, toothId, jaw)
      );
      points = points.filter((point) => allowedByDistalSaddle.has(normalizeSurface(point.surface)));
    }
  }
  const radius = getRestSuggestionRadius();
  const { mirrored } = getToothAssetSpec(toothId);

  for (const pointData of points) {
    const surface = normalizeSurface(pointData.surface);
    if (!surface) continue;
    const restVisualComponentId = isAssembly ? "rest-seat" : selectedComponent.id;
    const assetHref = getRestPlacementAssetReference(restVisualComponentId, toothId, surface);
    const imageSize = getRestPlacementImageSize(restVisualComponentId, toothId, surface);
    const restScale = getRestPlacementRenderScale(restVisualComponentId, toothId, surface);

    if (assetHref && imageSize) {
      const width = imageSize.width * restScale;
      const height = imageSize.height * restScale;
      const imageGroup = svgEl("g", {
        transform: `translate(${pointData.x} ${pointData.y}) scale(${mirrored ? -1 : 1} 1)`,
        class: `rest-suggestion-group rest-suggestion-${surface}`,
      });

      imageGroup.appendChild(
        svgEl("image", {
          ...centeredImageAttrs(assetHref, width, height),
          class: `rest-suggestion-image rest-suggestion-${surface}`,
          "data-surface": surface,
        })
      );

      imageGroup.addEventListener("click", (event) => {
        event.stopPropagation();
        handleRestSuggestionPick(jaw, toothId, pointData.surface, {
          clientX: event.clientX,
          clientY: event.clientY
        });
      });

      group.appendChild(imageGroup);
      continue;
    }

    const className = ["rest-suggestion-point", `rest-suggestion-${pointData.surface}`].join(" ");

    const point = svgEl("circle", {
      cx: String(pointData.x),
      cy: String(pointData.y),
      r: String(radius),
      class: className,
      "data-surface": pointData.surface
    });
    point.addEventListener("click", (event) => {
      event.stopPropagation();
      handleRestSuggestionPick(jaw, toothId, pointData.surface, {
        clientX: event.clientX,
        clientY: event.clientY
      });
    });
    group.appendChild(point);
  }
}

function handleRetainerClaspSuggestionPick(jaw, toothId, surface) {
  const normalized = normalizeSurface(surface);
  if (!normalized) return;
  placeSelectedComponentOnTooth(toothId, { surface: normalized });
  renderJaw(jaw);
}

// Clickable circumferential clasp anchors (separate geometry from rest suggestions).
function appendRetainerClaspSuggestionPoints(group, tooth, toothId, jaw) {
  if (!shouldShowRetainerClaspSuggestions()) return;
  if (!tooth.isPresent) return;

  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  const isRetainer = isRetainerClaspComponent(selectedComponent);
  const isReciprocating = isReciprocatingClaspComponent(selectedComponent);
  const isRing = isRingClaspComponent(selectedComponent);
  if (!selectedComponent || (!isRetainer && !isReciprocating && !isRing)) return;

  ensureToothPlacementState(tooth);

  if (isReciprocating && hasClaspTypePlacement(tooth, isReciprocatingClaspComponent)) {
    return;
  }

  let points = getRetainerClaspSuggestionPointsForTooth(toothId, jaw);
  if (isReciprocating) {
    // The reciprocating arm sits OPPOSITE the retentive component, so only that side's two
    // points are offered. With no retentive clasp or bar yet, all four are.
    const reciSide = getReciprocatingArchSide(tooth);
    if (reciSide) {
      points = points.filter((p) => normalizeSurface(p.surface).includes(reciSide));
    }
  }
  const radius = getRetainerClaspSuggestionRadius();

  for (const pointData of points) {
    const surface = normalizeSurface(pointData.surface);
    if (!surface) continue;
    if (hasRetainerClaspPlacementAtSurface(tooth, surface)) continue;

    const className = [
      "clasp-suggestion-point",
      isReciprocating ? "rpc-suggestion-point" : "",
      `clasp-suggestion-${surface}`,
    ].filter(Boolean).join(" ");

    const cx = pointData.x;
    const cy = pointData.y;
    // Direction from tooth-local origin (tooth center) outward to the suggestion point.
    const angleDeg = (Math.atan2(cy, cx) * 180) / Math.PI;

    const wrapper = svgEl("g", {
      class: `clasp-suggestion-group clasp-suggestion-group-${surface}`,
    });

    const point = svgEl("circle", {
      cx: String(cx),
      cy: String(cy),
      r: String(radius),
      class: className,
      "data-surface": surface,
    });

    // Tiny chevron pointing outward (default points along +X, rotated to face away from center).
    const tip = (radius * 0.55).toFixed(2);
    const back = (-radius * 0.2).toFixed(2);
    const half = (radius * 0.4).toFixed(2);
    const arrow = svgEl("polyline", {
      points: `${back},${-half} ${tip},0 ${back},${half}`,
      class: "clasp-suggestion-arrow",
      transform: `translate(${cx} ${cy}) rotate(${angleDeg.toFixed(2)})`,
    });

    wrapper.appendChild(point);
    wrapper.appendChild(arrow);
    wrapper.addEventListener("click", (event) => {
      event.stopPropagation();
      handleRetainerClaspSuggestionPick(jaw, toothId, surface);
    });
    group.appendChild(wrapper);
  }
}

function hasClaspTypePlacement(tooth, classifier) {
  ensureToothPlacementState(tooth);
  return tooth.componentPlacements.some((entry) => classifier(entry.componentId));
}

function getPlacedClaspSurface(tooth, classifier) {
  ensureToothPlacementState(tooth);
  const found = tooth.componentPlacements.find((entry) => classifier(entry.componentId));
  return normalizeSurface(found?.surface);
}

// The arch-side for a reciprocating clasp: opposite the retentive clasp/ring, or lingual
// under a bar (bars approach buccally). null when there is nothing to reciprocate.
function getReciprocatingArchSide(tooth) {
  ensureToothPlacementState(tooth);
  if (tooth.componentPlacements.some((entry) => isBarComponent(entry.componentId))) {
    return "lingual";
  }
  const retentiveSurface =
    getPlacedClaspSurface(tooth, isRetainerClaspComponent) ||
    getPlacedClaspSurface(tooth, isRingClaspComponent);
  if (retentiveSurface?.includes("buccal")) return "lingual";
  if (retentiveSurface?.includes("lingual")) return "buccal";
  return null;
}

function hasRetainerClaspPlacementAtSurface(tooth, surface) {
  ensureToothPlacementState(tooth);
  const targetSurface = normalizeSurface(surface);
  if (!targetSurface) return false;

  const selectedComponent = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  const matchReciprocating = isReciprocatingClaspComponent(selectedComponent);
  const matchRing = isRingClaspComponent(selectedComponent);

  return tooth.componentPlacements.some((entry) => {
    const sameSurface = normalizeSurface(entry.surface) === targetSurface;
    if (!sameSurface) return false;
    return matchReciprocating
      ? isReciprocatingClaspComponent(entry.componentId)
      : matchRing
        ? isRingClaspComponent(entry.componentId)
        : isRetainerClaspComponent(entry.componentId);
  });
}

function showBarSuggestions() {
  if (!state.designMode) return false;
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  return Boolean(sel && isBarComponent(sel));
}

function hasBarPlacementAtSurface(tooth, componentId) {
  ensureToothPlacementState(tooth);
  return tooth.componentPlacements.some(
    (entry) => entry.componentId === componentId && isBarPlacementSurface(entry.surface)
  );
}

// Palatal hole / palatal bar arch overlays: show from saved placements whenever the catalog
// is not actively selecting a *different* major type (so plate/clasp/mesh tabs do not hide them).
function shouldShowPalatalHoleArchOverlay() {
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (hasPalatalHolePlacementOnUpperArch(state.teeth)) {
    return true;
  }
  if (state.archOverlayPalatalHoleActive) {
    return true;
  }
  return Boolean(state.designMode && sel && isPalatalHoleMajorComponent(sel));
}

function shouldShowPalatalBarArchOverlay() {
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (hasPalatalBarPlacementOnUpperArch(state.teeth)) {
    return true;
  }
  return Boolean(state.designMode && sel && isPalatalBarMajorComponent(sel));
}

function shouldShowPalatalPlateArchOverlay() {
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (hasPalatalPlatePlacementOnUpperArch(state.teeth)) {
    return true;
  }
  return Boolean(state.designMode && sel && sel.id === "major-upper-palatal-plate");
}

// Arch-wide palatal hole artwork (AP_Strap01/02); not drawn per tooth.
function appendPalatalHoleArchOverlay(svg) {
  if (!svg || !shouldShowPalatalHoleArchOverlay()) {
    return;
  }
  const g = svgEl("g", { class: "palatal-hole-arch-overlay" });
  // Anterior strap + the posterior strap on each side, sized to that side's
  // terminal molar (AP-Strap_6/7/8); a side ending before the molars gets none.
  for (const layer of getPalatalHoleArchOverlayLayers(state.teeth)) {
    const href = `../../assets/RPD_Component/MajorConnector/${layer.file}`;
    const attrs = {
      href,
      x: String(layer.x),
      y: String(layer.y),
      width: String(layer.width),
      height: String(layer.height),
      preserveAspectRatio: "xMidYMid meet",
      class: "palatal-hole-arch-image",
      "pointer-events": "none",
    };
    // The Q2 (image-right) strap reuses the Q1 asset, flipped horizontally in
    // place (mirror about the image's own centre x = layer.x + width/2).
    if (layer.mirror) {
      attrs.transform = `translate(${2 * layer.x + layer.width} 0) scale(-1 1)`;
    }
    g.appendChild(svgEl("image", attrs));
  }
  svg.appendChild(g);
}

// Arch-wide palatal bar (P_Bar.svg); the per-tooth segments follow the plating.
function appendPalatalBarArchOverlay(svg) {
  if (!svg || !shouldShowPalatalBarArchOverlay()) {
    return;
  }
  const layer = PALATAL_BAR_ARCH_OVERLAY;
  const g = svgEl("g", { class: "palatal-bar-arch-overlay" });
  const href = `../../assets/RPD_Component/MajorConnector/${layer.file}`;
  g.appendChild(
    svgEl("image", {
      href,
      x: String(layer.x),
      y: String(layer.y),
      width: String(layer.width),
      height: String(layer.height),
      preserveAspectRatio: "xMidYMid meet",
      class: "palatal-bar-arch-image",
      "pointer-events": "none",
    })
  );
  svg.appendChild(g);
}

function appendPalatalPlateArchOverlay(svg) {
  if (!svg || !shouldShowPalatalPlateArchOverlay()) {
    return;
  }

  const idx = getPalatalPlateOverlayIndexFromUpperPlacements(state.teeth);
  if (!Number.isFinite(idx)) {
    return;
  }

  const frame = getPalatalPlateArchOverlayFrame(idx);
  const g = svgEl("g", { class: "palatal-plate-arch-overlay" });
  const href = `../../assets/RPD_Component/MajorConnector/Plalatal%20Plate/Plate_${idx}.svg`;
  g.appendChild(
    svgEl("image", {
      href,
      x: String(frame.x),
      y: String(frame.y),
      width: String(frame.width),
      height: String(frame.height),
      preserveAspectRatio: "xMidYMid meet",
      class: state.jawMaterial === 2 ? "palatal-plate-arch-image is-acrylic" : "palatal-plate-arch-image",
      "pointer-events": "none",
    })
  );
  svg.appendChild(g);
}

// Compose one tooth image with jaw-specific scaling and mirroring.
function createToothVisual(toothId, jaw) {
  const placement = getToothPlacement(jaw, toothId) || {};
  const jawFlipX = JAW_IMAGE_FLIP_X[jaw] ?? 1;
  const flipX = (placement.scaleX ?? 1) * jawFlipX;
  const flipY = placement.scaleY ?? 1;

  const { mirrored, sourceToothId } = getToothAssetSpec(toothId);
  const scaleBoost = TOOTH_SCALE_OVERRIDE[toothId] || 1;
  const base = getToothScale(toothId, jaw) * 0.24 * scaleBoost;

  const scaleX = (mirrored ? -base : base) * flipX;
  const scaleY = base * flipY;

  const visual = svgEl("g", {
    class: "tooth-visual",
    transform: `scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)})`
  });

  visual.appendChild(
    svgEl("image", {
      href: sourceToothId ? `${TOOTH_ASSET_BASE}/${sourceToothId}.svg` : PRESENCE_TOOTH_ASSET,
      x: String(-TOOTH_IMAGE_HALF_WIDTH),
      y: String(-TOOTH_IMAGE_HALF_HEIGHT),
      width: String(TOOTH_IMAGE_WIDTH),
      height: String(TOOTH_IMAGE_HEIGHT),
      preserveAspectRatio: "xMidYMid meet",
      class: "tooth-image"
    })
  );

  return visual;
}


/** A plated canine carries the bar run on past 14/24, so that end is not capped. */
function toothCarriesPalatalBarSegment(tooth) {
  return Boolean(
    tooth?.componentPlacements?.some((e) => isPalatalBarMajorComponent(e.componentId))
  );
}

// Major connector: explicit catalog placement. Scale follows the *tooth* (not mesh/plate render scale).
function createMajorConnectorVisual(majorComponentId, tooth, toothId, jaw) {
  const def = COMPONENT_BY_ID.get(majorComponentId);
  if (!def || !isMajorConnectorComponent(def)) {
    return null;
  }
  const teethForConnector =
    isPalatalBarMajorComponent(majorComponentId) && shouldShowPalatalBarArchOverlay()
      ? augmentTeethForPalatalBarConnectorNeighbors(state.teeth)
      : state.teeth;
  const connectorHref = getMajorConnectorAssetReference(toothId, jaw, teethForConnector, {
    palatalBarDistalEnd:
      isPalatalBarMajorComponent(majorComponentId) &&
      isPalatalBarDistalRunEnd(toothId, state.teeth),
    // The palatal bar's posterior span terminates at 14/24, so cap those with the mesial
    // end art — unless the canine beside it was given a bar segment and carries the run on.
    palatalBarFirstPremolarMesial:
      isPalatalBarMajorComponent(majorComponentId) &&
      (toothId === "14" || toothId === "24") &&
      !toothCarriesPalatalBarSegment(state.teeth?.[toothId === "14" ? "13" : "23"]),
  });
  if (!connectorHref) return null;

  const placement = getToothPlacement(jaw, toothId) || {};
  const jawFlipX = JAW_IMAGE_FLIP_X[jaw] ?? 1;
  const flipX = (placement.scaleX ?? 1) * jawFlipX;
  const flipY = placement.scaleY ?? 1;

  const { mirrored } = getToothAssetSpec(toothId);
  const scaleBoost = TOOTH_SCALE_OVERRIDE[toothId] || 1;
  const base = getToothScale(toothId, jaw) * 0.24 * scaleBoost;

  const scaleX = (mirrored ? -base : base) * flipX;
  const scaleY = base * flipY;

  const anchorId = resolveMajorConnectorAnchorComponentId(tooth);
  let off = { x: 0, y: 0 };
  if (!shouldMajorConnectorIgnoreMeshPlateAnchor() && anchorId) {
    const anchorDef = COMPONENT_BY_ID.get(anchorId);
    if (anchorDef && isMeshComponent(anchorDef)) {
      off = getMeshPlacementOffset(anchorId, toothId);
    } else if (isPlateComponentId(anchorId)) {
      off = getPlatePlacementOffset(anchorId, toothId);
    }
  }
  const extra = getMajorConnectorPlacementOffset(toothId);
  const ox = (Number.isFinite(off.x) ? off.x : 0) + (Number.isFinite(extra.x) ? extra.x : 0);
  const oy = (Number.isFinite(off.y) ? off.y : 0) + (Number.isFinite(extra.y) ? extra.y : 0);

  const connectorSize = getMajorConnectorPlacementImageSize(toothId);
  const imgW = connectorSize?.width ?? COMPONENT_IMAGE_WIDTH;
  const imgH = connectorSize?.height ?? COMPONENT_IMAGE_HEIGHT;
  const halfW = imgW / 2;
  const halfH = imgH / 2;

  const connMul = getMajorConnectorRenderScaleMultiplier(toothId, jaw);
  const scaleXConn = scaleX * connMul;
  const scaleYConn = scaleY * connMul;

  const visual = svgEl("g", {
    class: `component-visual major-connector-visual component-ref-${majorComponentId}`,
    transform: `translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${scaleXConn.toFixed(3)} ${scaleYConn.toFixed(3)})`,
  });
  const isSeparated = isMajorConnectorPlacementSeparated(toothId, state.teeth, jaw);
  // A stray single-tooth connector cap whose neighbours carry none is meaningless — a major
  // is a continuous span — so the locked preview hides it. Design mode still tints it.
  if (isSeparated && !state.designMode) {
    return null;
  }
  const isAcrylic = state.jawMaterial === 2;
  const imageClass = isSeparated
    ? "component-image major-connector-image is-separated"
    : isAcrylic
      ? "component-image major-connector-image is-acrylic"
      : "component-image major-connector-image";
  visual.appendChild(
    svgEl("image", {
      href: connectorHref,
      x: String(-halfW),
      y: String(-halfH),
      width: String(imgW),
      height: String(imgH),
      preserveAspectRatio: "xMidYMid meet",
      class: imageClass,
    })
  );
  return visual;
}

// Rounded cap for a plate ending a connector run: a circle clipping the art's upper-right
// corner, since box-edge rounding would miss it. Fractions of the half-extents.
const DISTAL_CAP_CENTRE_X_RATIO = 0.30;
const DISTAL_CAP_CENTRE_Y_RATIO = -0.19;
const DISTAL_CAP_RADIUS_RATIO = 0.69;

function buildDistalCapClipPath(clipId, halfW, halfH) {
  const clip = svgEl("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
  clip.appendChild(
    svgEl("circle", {
      cx: (halfW * DISTAL_CAP_CENTRE_X_RATIO).toFixed(2),
      cy: (halfH * DISTAL_CAP_CENTRE_Y_RATIO).toFixed(2),
      r: (halfH * DISTAL_CAP_RADIUS_RATIO).toFixed(2),
    })
  );
  return clip;
}

// Compose one component image overlay aligned with a given tooth transform.
function createComponentVisual(componentId, toothId, jaw, options) {
  const assetHref = getComponentAssetReference(componentId, toothId, options?.flangeFreeEnds);
  if (!assetHref) {
    return null;
  }

  const placement = getToothPlacement(jaw, toothId) || {};
  const jawFlipX = JAW_IMAGE_FLIP_X[jaw] ?? 1;
  const flipX = (placement.scaleX ?? 1) * jawFlipX;
  const flipY = placement.scaleY ?? 1;

  const { mirrored } = getToothAssetSpec(toothId);
  const isMesh = isMeshComponent(componentId);
  const isPlate = isPlateComponentId(componentId);
  const scaleToothId = isMesh ? meshHoleUniformScaleToothId(jaw) : toothId;
  const scaleBoost = TOOTH_SCALE_OVERRIDE[scaleToothId] || 1;
  const toothScale = COMPONENT_SCALE_BY_TOOTH[scaleToothId] ?? 1;
  const jawScaleMul = isMesh
    ? getMeshPlacementRenderScale(componentId, toothId, jaw)
    : isPlate
      ? getPlatePlacementRenderScale(componentId, toothId, jaw)
      : COMPONENT_SCALE_BY_JAW[jaw] ?? 1;
  const base = getToothScale(scaleToothId, jaw) * 0.24 * scaleBoost * jawScaleMul * toothScale;

  const scaleX = (mirrored ? -base : base) * flipX;
  const scaleY = base * flipY;

  const meshOffset = isMesh ? getMeshPlacementOffset(componentId, toothId) : { x: 0, y: 0 };
  const plateOffset = isPlate ? getPlatePlacementOffset(componentId, toothId) : { x: 0, y: 0 };
  const off = isMesh ? meshOffset : plateOffset;
  const ox = Number.isFinite(off.x) ? off.x : 0;
  const oy = Number.isFinite(off.y) ? off.y : 0;

  const meshSize = isMesh ? getMeshPlacementImageSize(componentId, toothId) : null;
  const plateSize = isPlateComponentId(componentId)
    ? getPlatePlacementImageSize(componentId, toothId)
    : null;
  const imgW = meshSize?.width ?? plateSize?.width ?? COMPONENT_IMAGE_WIDTH;
  const imgH = meshSize?.height ?? plateSize?.height ?? COMPONENT_IMAGE_HEIGHT;
  const halfW = imgW / 2;
  const halfH = imgH / 2;

  const visual = svgEl("g", {
    class: `component-visual component-${componentId}`,
    transform: `translate(${ox.toFixed(2)} ${oy.toFixed(2)}) scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)})`
  });

  const imageClass = isMesh
    ? componentId === "mesh-flange"
      ? "component-image mesh-image mesh-image-native"
      : "component-image mesh-image"
    : isPlate
      ? state.jawMaterial === 2
        ? "component-image plate-image is-acrylic"
        : "component-image plate-image"
      : "component-image";

  const image = svgEl("image", {
    href: assetHref,
    x: String(-halfW),
    y: String(-halfH),
    width: String(imgW),
    height: String(imgH),
    preserveAspectRatio: "xMidYMid meet",
    class: imageClass,
  });

  if (options?.roundDistalEnd) {
    const clipId = `distal-cap-${jaw}-${toothId}-${componentId}`;
    visual.appendChild(buildDistalCapClipPath(clipId, halfW, halfH));
    image.setAttribute("clip-path", `url(#${clipId})`);
  }

  visual.appendChild(image);

  return visual;
}

function shouldShowPalatalStrapArchOverlay() {
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (hasPalatalStrapPlacementOnUpperArch(state.teeth)) {
    return true;
  }
  return Boolean(state.designMode && sel && isPalatalStrapMajorComponent(sel));
}

function roundedPolygonPath(pts, r) {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
    const d2x = next.x - curr.x, d2y = next.y - curr.y;
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    const cr = Math.min(r, l1 / 2, l2 / 2);
    const p1x = curr.x - cr * d1x / l1, p1y = curr.y - cr * d1y / l1;
    const p2x = curr.x + cr * d2x / l2, p2y = curr.y + cr * d2y / l2;
    d += i === 0 ? `M ${p1x},${p1y}` : ` L ${p1x},${p1y}`;
    d += ` Q ${curr.x},${curr.y} ${p2x},${p2y}`;
  }
  return d + " Z";
}

// Editable attachment map for palatal strap control points.
// Values are OFFSETS from each associated tooth center.
const PALATAL_STRAP_ATTACHED_POINTS = Object.freeze([
  { toothId: "11", dx: 8, dy: 34 },
  { toothId: "12", dx: 26, dy: 26 },
  { toothId: "13", dx: 38, dy: 18 },
  { toothId: "14", dx: 45, dy: 10 },
  { toothId: "15", dx: 37, dy: 35 },
  { toothId: "16", dx: 35, dy: 45 },
  { toothId: "17", dx: 40, dy: 45 },
  { toothId: "18", dx: 42, dy: 40 },
  { toothId: "28", dx: -42, dy: 40 },
  { toothId: "27", dx: -40, dy: 45 },
  { toothId: "26", dx: -35, dy: 45 },
  { toothId: "25", dx: -37, dy: 35 },
  { toothId: "24", dx: -45, dy: 10 },
  { toothId: "23", dx: -38, dy: 18 },
  { toothId: "22", dx: -26, dy: 26 },
  { toothId: "21", dx: -8, dy: 34 },
]);

const PALATAL_STRAP_CENTER_POINTS = Object.freeze({
  top: { dx: 0, dy: -70 },
  bottom: { dx: 0, dy: -50 },
});

const PALATAL_STRAP_FIXED_CENTER_Y_GAP = 70;

function getPalatalStrapPointsFromAttachments() {
  const pointByToothId = new Map();
  const cfgByToothId = new Map();
  for (const cfg of PALATAL_STRAP_ATTACHED_POINTS) {
    cfgByToothId.set(cfg.toothId, cfg);
    const center = state.teeth[cfg.toothId]?.center;
    if (!Array.isArray(center)) {
      return PALATAL_STRAP_ARCH_POLYGON;
    }
    pointByToothId.set(cfg.toothId, {
      x: (Number(center[0]) || 0) + cfg.dx,
      y: (Number(center[1]) || 0) + cfg.dy,
    });
  }

  const hasStrapOnTooth = (toothId) => {
    const placements = state.teeth[toothId]?.componentPlacements;
    return Array.isArray(placements)
      && placements.some((entry) => entry.componentId === PALATAL_STRAP_MAJOR_COMPONENT_ID);
  };
  const resolveAttachedPoint = (toothId, fallbackIds) => {
    const slotCfg = cfgByToothId.get(toothId);
    if (!slotCfg) return pointByToothId.get(toothId);
    if (hasStrapOnTooth(toothId)) {
      return pointByToothId.get(toothId);
    }
    for (const id of fallbackIds) {
      if (hasStrapOnTooth(id)) {
        const center = state.teeth[id]?.center;
        if (!Array.isArray(center)) {
          break;
        }
        return {
          x: (Number(center[0]) || 0) + slotCfg.dx,
          y: (Number(center[1]) || 0) + slotCfg.dy,
        };
      }
    }
    return pointByToothId.get(toothId);
  };

  const p14 = resolveAttachedPoint("14", ["15", "16", "17"]);
  const p15 = resolveAttachedPoint("15", ["16", "14", "17"]);
  const p16 = resolveAttachedPoint("16", ["15", "17", "14"]);
  const p17 = resolveAttachedPoint("17", ["16", "18", "15", "14"]);
  const p18 = hasStrapOnTooth("18") ? resolveAttachedPoint("18", ["17", "16", "15", "14"]) : null;
  const p28 = hasStrapOnTooth("28") ? resolveAttachedPoint("28", ["27", "26", "25", "24"]) : null;
  const p27 = resolveAttachedPoint("27", ["26", "28", "25", "24"]);
  const p26 = resolveAttachedPoint("26", ["25", "27", "24"]);
  const p25 = resolveAttachedPoint("25", ["26", "24", "27"]);
  const p24 = resolveAttachedPoint("24", ["25", "26", "27"]);

  if (!p14 || !p15 || !p16 || !p17 || !p27 || !p26 || !p25 || !p24) {
    return PALATAL_STRAP_ARCH_POLYGON;
  }

  const pointForTooth = {
    "14": p14,
    "15": p15,
    "16": p16,
    "17": p17,
    "18": p18,
    "24": p24,
    "25": p25,
    "26": p26,
    "27": p27,
    "28": p28,
  };
  const pickActivePoint = (ids, fallbackPoint) => {
    for (const id of ids) {
      if (hasStrapOnTooth(id)) {
        const pt = pointForTooth[id];
        if (pt) return pt;
      }
    }
    return fallbackPoint;
  };
  const leftDeepPoint = pickActivePoint(["18", "17", "16", "15", "14"], p17);
  const rightDeepPoint = pickActivePoint(["28", "27", "26", "25", "24"], p27);
  const topMidX = (p16.x + p26.x) / 2;
  const topMidY = (p16.y + p26.y) / 2;
  const bottomMidX = (leftDeepPoint.x + rightDeepPoint.x) / 2;

  const centerTop = {
    x: topMidX + PALATAL_STRAP_CENTER_POINTS.top.dx,
    y: topMidY + PALATAL_STRAP_CENTER_POINTS.top.dy,
  };
  const centerBottom = {
    x: bottomMidX + PALATAL_STRAP_CENTER_POINTS.bottom.dx,
    y: centerTop.y + PALATAL_STRAP_FIXED_CENTER_Y_GAP,
  };
  const points = [];
  points.push(p14, p15, p16, p17);
  if (p18) points.push(p18);
  points.push(centerBottom);
  if (p28) points.push(p28);
  points.push(p27, p26, p25, p24);
  points.push(centerTop);
  return points;
}

function appendPalatalStrapArchOverlay(svg) {
  if (!svg || !shouldShowPalatalStrapArchOverlay()) {
    return;
  }
  const strapPoints = getPalatalStrapPointsFromAttachments();
  const g = svgEl("g", { class: "palatal-strap-arch-overlay" });
  g.appendChild(
    svgEl("path", {
      d: roundedPolygonPath(strapPoints, 22),
      class: "palatal-strap-arch-shape",
      fill: "rgba(175,175,175,0.75)",
      stroke: "rgba(120,120,120,0.5)",
      "stroke-width": "1",
      "pointer-events": "none",
    })
  );
  svg.appendChild(g);
}

export {
  applyToothStatusClass,
  appendPlacedComponentMarkers,
  appendRetainerClaspSuggestionPoints,
  appendPalatalBarArchOverlay,
  appendPalatalPlateArchOverlay,
  appendPalatalHoleArchOverlay,
  appendPalatalStrapArchOverlay,
  appendPlateSuggestionPoints,
  appendRestSuggestionPoints,
  appendToothComponentVisuals,
  appendToothPlateComponentVisuals,
  createToothVisual,
  hasBarPlacementAtSurface,
  showBarSuggestions,
};
