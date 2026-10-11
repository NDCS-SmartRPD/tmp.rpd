import { getNeighborToothIds, isAutoMeshPlacementExcludedToothId, TOOTH_ORDER } from "./constants.js";
import { COMPONENT_ASSET_BASE, getComponentTemplateToothId, isMeshComponent } from "./components.mesh.js";
import { isReciprocatingClaspComponent } from "./components.clasp.js";
import {
  isMajorConnectorToothExcluded,
  PALATAL_BAR_MAJOR_COMPONENT_ID,
  PALATAL_STRAP_MAJOR_COMPONENT_ID,
} from "./components.major.js";

/** Major connectors that are BARS (band-only) — they plate no teeth. */
const BAR_MAJOR_CONNECTOR_IDS = Object.freeze(
  new Set(["major-lower-lingual-bar", "major-upper-palatal-bar"])
);

/** Default plate when entering design mode (both arches locked) if no plate is selected in the catalog. */
const DEFAULT_PLATE_ID_FOR_LOCK_DESIGN_MODE = "plate-prox";

/** Catalog id → filename tail `{template}-{tail}` under `plates/` (e.g. `11-plate.svg`). */
export const PLATE_IMAGE_SUFFIX_BY_ID = Object.freeze({
  "plate-prox": "plate.svg",
  "plate-crossmesh": "mesh.svg",
});

// Check whether a component id is a plate type.
export function isPlateComponentId(componentId) {
  return Object.prototype.hasOwnProperty.call(PLATE_IMAGE_SUFFIX_BY_ID, componentId);
}

const PLATE_PLACEMENT_IMAGE_SIZE_BY_TOOTH = Object.freeze({
  "11": { width: 300, height: 365 },
  "12": { width: 345, height: 330 },
  "13": { width: 245, height: 330 },
  "14": { width: 270, height: 290 },
  "15": { width: 252, height: 290 },
  "16": { width: 265, height: 330 },
  "17": { width: 265, height: 320 },
  "18": { width: 265, height: 310 },
  "41": { width: 205, height: 350 },
  "42": { width: 195, height: 350 },
  "43": { width: 155, height: 350 },
  "44": { width: 185, height: 350 },
  "45": { width: 185, height: 350 },
  "46": { width: 193, height: 350 },
  "47": { width: 180, height: 350 },
  "48": { width: 135, height: 350 },
});

/** Per–catalog-id scale factor (multiplied with jaw scale below). Tune for overall plate size. */
const PLATE_RENDER_SCALE_BY_COMPONENT = Object.freeze({
  "plate-prox": 1,
  "plate-crossmesh": 1,
});

const PLATE_RENDER_SCALE_BY_JAW = Object.freeze({
  upper: 1,
  lower: 1,
});

/**
 * Per-tooth plate scale and offset (tooth-local units, before scale), keyed by exact FDI.
 * Fitted on the rendered arch so neighbouring plates meet edge to edge and tuck just under
 * the major connector's outline. Both plate types share the art frame, so both use these.
 */
const PLATE_SCALE_BY_TOOTH = Object.freeze({
  "11": 1.020, "12": 0.964, "13": 0.884, "14": 0.829, "15": 0.884, "16": 0.908, "17": 0.900, "18": 0.842,
  "21": 1.020, "22": 0.966, "23": 0.891, "24": 0.820, "25": 0.884, "26": 0.906, "27": 0.891, "28": 0.842,
  "31": 0.698, "32": 0.690, "33": 0.853, "34": 0.770, "35": 0.731, "36": 0.629, "37": 0.645, "38": 0.702,
  "41": 0.693, "42": 0.687, "43": 0.851, "44": 0.764, "45": 0.747, "46": 0.625, "47": 0.643, "48": 0.678,
});

const PLATE_POSITION_OFFSET_BY_TOOTH = Object.freeze({
  "11": { x: -4.7, y: 8.4 },
  "12": { x: -0.6, y: 6.4 },
  "13": { x: 2.4, y: 1.5 },
  "14": { x: 4.6, y: 0.6 },
  "15": { x: 0.8, y: -1.3 },
  "16": { x: -1.6, y: 0.8 },
  "17": { x: 0.1, y: -0.1 },
  "18": { x: 1.9, y: 2.1 },

  "21": { x: 4.6, y: 8.2 },
  "22": { x: 1.5, y: 6.1 },
  "23": { x: -3.9, y: 1.6 },
  "24": { x: -4.8, y: 1.4 },
  "25": { x: -1.8, y: -1.1 },
  "26": { x: 2.5, y: 1.0 },
  "27": { x: 0.2, y: 0.0 },
  "28": { x: -2.0, y: 1.8 },

  "31": { x: 0.5, y: -22.3 },
  "32": { x: -5.7, y: -18.9 },
  "33": { x: -11.0, y: -15.9 },
  "34": { x: -22.2, y: -9.2 },
  "35": { x: -18.7, y: -6.5 },
  "36": { x: -23.5, y: -7.2 },
  "37": { x: -20.8, y: -8.6 },
  "38": { x: -28.3, y: -6.9 },

  "41": { x: -0.2, y: -22.4 },
  "42": { x: 6.1, y: -18.9 },
  "43": { x: 11.4, y: -16.0 },
  "44": { x: 22.8, y: -9.1 },
  "45": { x: 18.9, y: -6.5 },
  "46": { x: 23.4, y: -7.8 },
  "47": { x: 21.8, y: -8.6 },
  "48": { x: 30.0, y: -6.2 },
});

// Get render scale for plate placement.
export function getPlatePlacementRenderScale(componentId, toothId, jaw) {
  if (!isPlateComponentId(componentId)) {
    return 1;
  }
  const componentScale = PLATE_RENDER_SCALE_BY_COMPONENT[componentId] || 1;
  const jawScale = PLATE_RENDER_SCALE_BY_JAW[jaw] || 1;
  const toothScale = PLATE_SCALE_BY_TOOTH[String(toothId ?? "")] ?? 1;
  return componentScale * jawScale * (Number.isFinite(toothScale) ? toothScale : 1);
}

// Get per-tooth offset for plate placement.
export function getPlatePlacementOffset(componentId, toothId) {
  if (!isPlateComponentId(componentId)) {
    return { x: 0, y: 0 };
  }
  const row = PLATE_POSITION_OFFSET_BY_TOOTH[String(toothId ?? "")] ?? { x: 0, y: 0 };
  return {
    x: Number.isFinite(row.x) ? row.x : 0,
    y: Number.isFinite(row.y) ? row.y : 0,
  };
}

/**
 * The last plate of a run is cut straight instead of wrapping its molar; the connector's own
 * cap ends the run. An 8 ends in line with the tooth's distal surface. A lower 7 (when the 8
 * carries nothing) ends square to the connector where its straight edge meets the rounded
 * _distal cap. Each row is the cut line, as y fractions of the image half-height at its left
 * and right edges; the side holding the image centre stays.
 */
const PLATE_DISTAL_TRIM_BY_TOOTH = Object.freeze({
  "18": { left: 0.406, right: 0.585 },
  "28": { left: 0.411, right: 0.589 },
  "37": { left: -0.485, right: -0.674 },
  "38": { left: -0.432, right: -0.422 },
  "47": { left: -0.485, right: -0.674 },
  "48": { left: -0.463, right: -0.456 },
});

/** Whether a plate on `toothId` ends its run: no plate or mesh is drawn on the distal neighbour. */
function plateEndsRunDistally(toothId, jaw, teeth) {
  const distalId = getNeighborToothIds(toothId, jaw).distal;
  const distal = distalId ? teeth?.[distalId] : null;
  if (!distal || !Array.isArray(distal.components)) {
    return true;
  }
  return !distal.components.some((id) =>
    distal.isPresent ? isPlateComponentId(id) : isMeshComponent(id)
  );
}

// Upper 7s keep their whole plate even when it ends the run: no straight or rounded cut.
const PLATE_UNCUT_RUN_END_TEETH = Object.freeze(new Set(["17", "27"]));

export function isPlateUncutAtRunEnd(toothId) {
  return PLATE_UNCUT_RUN_END_TEETH.has(String(toothId ?? ""));
}

// Get the distal cut line for a plate that ends its run on a molar, or null.
export function getPlateDistalTrim(componentId, toothId, jaw, teeth) {
  if (!isPlateComponentId(componentId)) {
    return null;
  }
  const trim = PLATE_DISTAL_TRIM_BY_TOOTH[String(toothId ?? "")];
  return trim && plateEndsRunDistally(String(toothId), jaw, teeth) ? trim : null;
}

// Get plate image size for a tooth.
export function getPlatePlacementImageSize(componentId, toothId) {
  if (!isPlateComponentId(componentId)) {
    return null;
  }
  const templateToothId = getComponentTemplateToothId(toothId);
  return PLATE_PLACEMENT_IMAGE_SIZE_BY_TOOTH[templateToothId] ?? null;
}

// Resolve plate SVG asset reference.
export function getPlateAssetReference(componentId, toothId) {
  const suffix = PLATE_IMAGE_SUFFIX_BY_ID[componentId];
  if (!suffix) {
    return null;
  }
  const templateToothId = getComponentTemplateToothId(toothId);
  return `${COMPONENT_ASSET_BASE}/${templateToothId}/plates/${templateToothId}-${suffix}`;
}

function syncToothComponentsFromCatalog(tooth, componentById) {
  const placements = Array.isArray(tooth.componentPlacements) ? tooth.componentPlacements : [];
  tooth.components = [
    ...new Set(placements.map((e) => e.componentId).filter((id) => componentById.has(id))),
  ];
}

/** Default plate id for auto-placement when locking both arches (design mode). */
export function getDefaultPlateIdForDesignMode(componentById) {
  if (componentById.has(DEFAULT_PLATE_ID_FOR_LOCK_DESIGN_MODE)) {
    return DEFAULT_PLATE_ID_FOR_LOCK_DESIGN_MODE;
  }
  for (const id of Object.keys(PLATE_IMAGE_SUFFIX_BY_ID)) {
    if (componentById.has(id)) {
      return id;
    }
  }
  return null;
}

/** Add the default plate to every present tooth in `jawKeys` that has no plate yet.
 *  Pass `Object.keys(TOOTH_ORDER)` for full-arch. */
export function ensurePlatePlacementsOnPresentTeethInJaws(
  teeth,
  plateComponentId,
  componentById,
  jawKeys
) {
  if (
    !plateComponentId ||
    !componentById.has(plateComponentId) ||
    !isPlateComponentId(plateComponentId) ||
    !teeth ||
    typeof teeth !== "object" ||
    !Array.isArray(jawKeys)
  ) {
    return;
  }
  for (const jaw of jawKeys) {
    const ids = TOOTH_ORDER[jaw];
    if (!Array.isArray(ids)) {
      continue;
    }
    for (const toothId of ids) {
      if (isAutoMeshPlacementExcludedToothId(toothId)) {
        continue;
      }
      const tooth = teeth[toothId];
      if (!tooth || !tooth.isPresent) {
        continue;
      }
      if (!Array.isArray(tooth.componentPlacements)) {
        tooth.componentPlacements = [];
      }
      const hasPlate = tooth.componentPlacements.some((e) => isPlateComponentId(e.componentId));
      if (hasPlate) {
        continue;
      }
      tooth.componentPlacements.push({ componentId: plateComponentId, surface: null });
      syncToothComponentsFromCatalog(tooth, componentById);
    }
  }
}

/** Both arches locked: add `plateComponentId` to every present tooth without a plate.
 *  Mirrors ensureMeshPlacementsOnMissingTeeth for the plate tab. */
export function ensurePlatePlacementsOnPresentTeeth(teeth, plateComponentId, componentById) {
  ensurePlatePlacementsOnPresentTeethInJaws(teeth, plateComponentId, componentById, Object.keys(TOOTH_ORDER));
}

/**
 * Keeps each tooth's `plate-prox` (Reciprocating.Tooth Type = 2) in step after a connector
 * switch, which is what makes plating data-driven and removable:
 *  - PLATE / strap / horseshoe give every covered present tooth an erasable `plate-prox`.
 *  - Palatal Strap keeps manually placed anterior proximal plates even though the strap
 *    itself does not carry anterior connector segments.
 *  - the LOWER lingual BAR CLEARS them all, or it re-encodes Type = 2 and "comes back as
 *    a plate" on reopen.
 *  - the UPPER PALATAL BAR neither adds nor removes any — its plates are user-managed.
 * A reciprocating clasp keeps its slot (clasp XOR plate).
 */
export function syncReciprocatingPlatesToMajorConnector(teeth, majorComponentId, jawKeys) {
  if (!teeth || typeof teeth !== "object" || !Array.isArray(jawKeys)) {
    return;
  }
  // The upper palatal bar leaves plate components untouched (user-managed), so a switch to it
  // never strips an anterior — or any — plate. Other majors fall through to the sync below.
  if (String(majorComponentId) === PALATAL_BAR_MAJOR_COMPONENT_ID) {
    return;
  }
  // For a bar, `covered` below is forced false (the `!isBar` term), so every tooth
  // with a plate falls into the removal branch — clearing the plating a bar can't carry.
  const isBar = BAR_MAJOR_CONNECTOR_IDS.has(String(majorComponentId));
  for (const jaw of jawKeys) {
    const ids = TOOTH_ORDER[jaw];
    if (!Array.isArray(ids)) {
      continue;
    }
    for (const toothId of ids) {
      const tooth = teeth[toothId];
      if (!tooth || !Array.isArray(tooth.componentPlacements)) {
        continue;
      }
      const hasPlate = tooth.componentPlacements.some((e) => e.componentId === "plate-prox");
      const covered =
        !isBar &&
        tooth.isPresent &&
        tooth.componentPlacements.some((e) => e.componentId === majorComponentId) &&
        !tooth.componentPlacements.some((e) => isReciprocatingClaspComponent(e.componentId));
      const preserveExcludedStrapPlate =
        String(majorComponentId) === PALATAL_STRAP_MAJOR_COMPONENT_ID &&
        isMajorConnectorToothExcluded(majorComponentId, toothId);
      if (covered && !hasPlate) {
        tooth.componentPlacements.push({
          componentId: "plate-prox",
          surface: null,
          source: "major-connector",
        });
      } else if (!covered && hasPlate && !preserveExcludedStrapPlate) {
        tooth.componentPlacements = tooth.componentPlacements.filter(
          (e) => e.componentId !== "plate-prox"
        );
      }
    }
  }
}
