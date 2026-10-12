import {
  COMPONENT_BY_ID,
  isBallClaspComponent,
  isBallClaspRetainerRival,
  isMeshComponent,
} from "./components.js";
import { forEachTooth, STATUS_VALUES, TOOTH_POSITION_MAP, TOOTH_SCALE_BY_UNIT } from "./constants.js";
import { state } from "./2DAnnotation.js";
import { normalizeSurface } from "./toothUtils.js";
export { normalizeSurface } from "./toothUtils.js";

// Mesh placements only make sense on missing teeth; clear them when a tooth
// flips to present so the removable-list UI matches the visual.
function clearMeshPlacementsIfPresent(tooth) {
  if (!tooth || !tooth.isPresent) return;
  if (!Array.isArray(tooth.componentPlacements)) return;
  tooth.componentPlacements = tooth.componentPlacements.filter(
    (entry) => !isMeshComponent(entry?.componentId)
  );
  if (Array.isArray(tooth.components)) {
    tooth.components = tooth.components.filter((id) => !isMeshComponent(id));
  }
}

// Initialize default tooth records for both arches.
export function initializeTeethState() {
  forEachTooth((toothId, jaw) => {
    state.teeth[toothId] = {
      tooth_id: toothId,
      jaw,
      status: "presence",
      isPresent: true,
      components: [],
      componentPlacements: [],
      center: [0, 0],
    };
  });
}

// Reset one tooth to default state (present with no components).
export function resetToothRecord(toothId, status) {
  const tooth = state.teeth[toothId];
  if (!tooth) return;
  tooth.status = status ?? "presence";
  tooth.components = [];
  tooth.componentPlacements = [];
  tooth.isPresent = true;
}

// Toggle one tooth between present and missing.
export function toggleToothPresence(tooth, toothId) {
  tooth.isPresent = !tooth.isPresent;
  if (!tooth.isPresent) {
    tooth.status = "missing";
    tooth.components = [];
    tooth.componentPlacements = [];
  } else {
    tooth.status = "presence";
    clearMeshPlacementsIfPresent(tooth);
  }
  return `Tooth ${toothId} is now ${tooth.isPresent ? "present" : "missing"}.`;
}

// Toggle clinical tooth status (presence/abutment/compromised).
export function toggleToothStatus(tooth, toothId, status) {
  if (!tooth.isPresent) {
    tooth.isPresent = true;
  }
  tooth.status = tooth.status === status ? "presence" : status;
  clearMeshPlacementsIfPresent(tooth);
  return `Tooth ${toothId} set to ${tooth.status}.`;
}

// Ensure modern placement array exists (migrate from legacy components list).
export function ensureToothPlacementState(tooth) {
  if (Array.isArray(tooth.componentPlacements)) return;

  const fallback = Array.isArray(tooth.components) ? tooth.components : [];
  tooth.componentPlacements = fallback.map((componentId) => ({
    componentId,
    surface: null,
  }));
}

// Rebuild tooth.components from placement entries.
export function syncToothComponentsFromPlacements(tooth) {
  const placements = Array.isArray(tooth.componentPlacements) ? tooth.componentPlacements : [];
  tooth.components = [
    ...new Set(
      placements
        .map((entry) => entry.componentId)
        .filter((componentId) => COMPONENT_BY_ID.has(componentId))
    ),
  ];
}

// Check whether a specific component placement already exists on tooth.
export function hasPlacement(tooth, componentId, surface) {
  const targetSurface = normalizeSurface(surface);
  return tooth.componentPlacements.some(
    (entry) =>
      entry.componentId === componentId && normalizeSurface(entry.surface) === targetSurface
  );
}

// Reciprocating.Tooth Type is ONE slot: a reciprocating clasp OR a plate, never both.
// Enforced at this choke point so assemblies calling addPlacement directly are covered.
const RECIPROCATING_SLOT_IDS = new Set(["reciprocating-clasp", "plate-prox", "plate-crossmesh"]);

// Add one component placement on tooth.
export function addPlacement(tooth, componentId, surface) {
  if (!Array.isArray(tooth.componentPlacements)) tooth.componentPlacements = [];
  // Placing a reciprocating element drops any other reciprocating element first.
  if (RECIPROCATING_SLOT_IDS.has(componentId)) {
    tooth.componentPlacements = tooth.componentPlacements.filter(
      (entry) => !RECIPROCATING_SLOT_IDS.has(entry.componentId)
    );
  }
  // Retainer Type is one slot too: a ball clasp and a clasp, ring or bar drop each other.
  if (isBallClaspComponent(componentId) || isBallClaspRetainerRival(componentId)) {
    const rival = isBallClaspComponent(componentId) ? isBallClaspRetainerRival : isBallClaspComponent;
    tooth.componentPlacements = tooth.componentPlacements.filter((entry) => !rival(entry.componentId));
  }
  tooth.componentPlacements.push({
    componentId,
    surface: normalizeSurface(surface),
  });
  syncToothComponentsFromPlacements(tooth);
}

// Remove one exact component placement from tooth.
export function removePlacement(tooth, componentId, surface) {
  const targetSurface = normalizeSurface(surface);
  tooth.componentPlacements = tooth.componentPlacements.filter(
    (entry) =>
      !(
        entry.componentId === componentId && normalizeSurface(entry.surface) === targetSurface
      )
  );
  syncToothComponentsFromPlacements(tooth);
}

// Remove all placements whose component IDs are in the remove list.
export function removePlacementsByComponentIds(tooth, componentIds) {
  const removeSet = new Set(componentIds || []);
  tooth.componentPlacements = tooth.componentPlacements.filter(
    (entry) => !removeSet.has(entry.componentId)
  );
  syncToothComponentsFromPlacements(tooth);
}

// Remove placement by array index (used by remove dialog).
export function removePlacementAtIndex(tooth, index) {
  ensureToothPlacementState(tooth);
  const pl = tooth.componentPlacements;
  if (!Array.isArray(pl) || index < 0 || index >= pl.length) {
    return null;
  }
  const [removed] = pl.splice(index, 1);
  syncToothComponentsFromPlacements(tooth);
  return removed;
}

// Normalize status string to accepted values.
export function normalizeStatus(value) {
  return STATUS_VALUES.includes(value) ? value : null;
}

export function statusJsonForToothRecord(record) {
  if (!record.isPresent) {
    return "missing";
  }
  const st = normalizeStatus(record.status);
  if (st === "missing") {
    return "presence";
  }
  return st || "presence";
}

export function getToothPlacement(jaw, toothId) {
  return TOOTH_POSITION_MAP[jaw]?.[toothId] || null;
}

export function getToothScale(toothId, jaw) {
  const unit = Number(toothId.slice(1));
  let scale = TOOTH_SCALE_BY_UNIT[unit] || 1;
  if (jaw === "lower" && unit <= 2) scale *= 0.92;
  if (jaw === "lower" && unit >= 6) scale *= 0.96;
  return scale;
}

export function getToothAssetSpec(toothId) {
  const numeric = Number(toothId);
  if (!Number.isFinite(numeric)) {
    return { sourceToothId: "11", mirrored: false };
  }

  const unit = numeric % 10;
  const quadrant = Math.floor(numeric / 10);
  if (quadrant === 2) {
    return { sourceToothId: `1${unit}`, mirrored: true };
  }
  if (quadrant === 3) {
    return { sourceToothId: `4${unit}`, mirrored: true };
  }
  return { sourceToothId: toothId, mirrored: false };
}
