import { getPlateAssetReference } from "./components.plate.js";
import { getNeighborToothIds, isAutoMeshPlacementExcludedToothId, TOOTH_ORDER } from "./constants.js";

export const COMPONENT_ASSET_BASE = "../../assets/RPD_Component";

/** When no mesh is selected in the annotation UI, new mesh sites use this component id. */
export const MESH_PLACEMENT_FALLBACK_ID = "mesh-hole";

/** Reference FDI tooth per jaw so mesh draw scale is uniform across the arch (2D annotation). */
export const MESH_HOLE_UNIFORM_SCALE_REFERENCE_BY_JAW = Object.freeze({
  upper: "16",
  lower: "46",
});

// Return template tooth id used for uniform mesh-hole scaling by jaw.
export function meshHoleUniformScaleToothId(jaw) {
  return MESH_HOLE_UNIFORM_SCALE_REFERENCE_BY_JAW[jaw] || "16";
}

export const COMPONENT_IMAGE_SUFFIX_BY_ID = {
  "mesh-tori": "tori_mesh.svg",
  "mesh-stripe": "stripe_mesh.svg",
  "mesh-hole": "hole_mesh.svg",
  "mesh-cross": "cross_mesh.svg",
  "mesh-plate": "plate_mesh.svg",
  "mesh-flange": "flange.svg"
};

// Check whether a component belongs to mesh family.
export function isMeshComponent(componentOrId) {
  if (typeof componentOrId === "object" && componentOrId !== null) {
    if (componentOrId.tab === "mesh") return true;
    return String(componentOrId.id || "").startsWith("mesh-");
  }
  return String(componentOrId || "").startsWith("mesh-");
}

// Map FDI tooth id to mesh template tooth id.
export function getComponentTemplateToothId(toothId) {
  const numeric = Number(toothId);
  if (!Number.isFinite(numeric)) {
    return "11";
  }

  const unit = numeric % 10;
  const quadrant = Math.floor(numeric / 10);
  if (quadrant === 2) {
    return `1${unit}`;
  }
  if (quadrant === 3) {
    return `4${unit}`;
  }
  return `${quadrant}${unit}`;
}

/** Flange art with the buccal corner rounded on the end(s) where the flange run stops. */
const FLANGE_IMAGE_SUFFIX_BY_FREE_ENDS = Object.freeze({
  mesial: "flange_mesial.svg",
  distal: "flange_distal.svg",
  both: "flange_mesial_distal.svg",
});

function getFlangeImageSuffix(freeEnds) {
  if (freeEnds?.mesial && freeEnds?.distal) return FLANGE_IMAGE_SUFFIX_BY_FREE_ENDS.both;
  if (freeEnds?.mesial) return FLANGE_IMAGE_SUFFIX_BY_FREE_ENDS.mesial;
  if (freeEnds?.distal) return FLANGE_IMAGE_SUFFIX_BY_FREE_ENDS.distal;
  return COMPONENT_IMAGE_SUFFIX_BY_ID["mesh-flange"];
}

/** Whether the arch draws a mesh on this tooth record (meshes render on missing teeth only). */
function toothDrawsMesh(tooth) {
  return Boolean(
    tooth &&
      !tooth.isPresent &&
      Array.isArray(tooth.components) &&
      tooth.components.some((id) => isMeshComponent(id))
  );
}

/**
 * Ends of a flange run that this tooth closes: a side is free when the neighbour across
 * that embrasure draws no mesh, or there is no neighbour (the arch end).
 * @returns {{ mesial: boolean, distal: boolean }}
 */
export function getFlangeFreeEnds(teeth, toothId, jaw) {
  const neighborIds = getNeighborToothIds(toothId, jaw);
  return {
    mesial: !toothDrawsMesh(neighborIds.mesial ? teeth?.[neighborIds.mesial] : null),
    distal: !toothDrawsMesh(neighborIds.distal ? teeth?.[neighborIds.distal] : null),
  };
}

// Resolve mesh SVG asset path for a tooth; a flange picks its art from `flangeFreeEnds`.
export function getComponentAssetReference(componentId, toothId, flangeFreeEnds = null) {
  const templateToothId = getComponentTemplateToothId(toothId);
  const suffix =
    componentId === "mesh-flange"
      ? getFlangeImageSuffix(flangeFreeEnds)
      : COMPONENT_IMAGE_SUFFIX_BY_ID[componentId];
  const fileName = suffix ? `${templateToothId}-${suffix}` : null;
  if (fileName) {
    return `${COMPONENT_ASSET_BASE}/${templateToothId}/mesh/${fileName}`;
  }
  return getPlateAssetReference(componentId, toothId);
}

/** Fallback `<image>` size when a template tooth has no MESH_PLACEMENT_IMAGE_SIZE_BY_TOOTH row. */
const MESH_IMAGE_SIZE_BY_COMPONENT = Object.freeze({
  "mesh-hole": { width: 154, height: 246 },
  "mesh-tori": { width: 154, height: 246 },
  "mesh-stripe": { width: 154, height: 246 },
  "mesh-cross": { width: 154, height: 246 },
  "mesh-flange": { width: 154, height: 246 },
  "mesh-plate": { width: 154, height: 246 },
});

/**
 * Mesh SVG size by template tooth (Q2/Q3 via getComponentTemplateToothId). Define
 * `mesh-hole` per tooth; others reuse it, falling back to MESH_IMAGE_SIZE_BY_COMPONENT.
 */
const MESH_PLACEMENT_IMAGE_SIZE_BY_TOOTH = Object.freeze({
  "11": {
    "mesh-hole": { width: 155, height: 370 },
    "mesh-flange": { width: 155, height: 370 },
  },
  "12": {
    "mesh-hole": { width: 188, height: 350 },
    "mesh-flange": { width: 188, height: 350 },
  },
  "13": {
    "mesh-hole": { width: 215, height: 420 },
    "mesh-flange": { width: 215, height: 420 },
  },
  "14": {
    "mesh-hole": { width: 225, height: 420 },
    "mesh-flange": { width: 225, height: 420 },
  },
  "15": {
    "mesh-hole": { width: 225, height: 420 },
    "mesh-flange": { width: 225, height: 420 },
  },
  "16": {
    "mesh-hole": { width: 240, height: 420 },
    "mesh-flange": { width: 240, height: 420 },
  },
  "17": {
    "mesh-hole": { width: 235, height: 420 },
    "mesh-flange": { width: 235, height: 420 },
  },
  "18": {
    "mesh-hole": { width: 220, height: 420 },
    "mesh-flange": { width: 210, height: 420 },
  },
  "41": {
    "mesh-hole": { width: 105, height: 160 },
    "mesh-flange": { width: 205, height: 248 },
  },
  "42": {
    "mesh-hole": { width: 135, height: 285 },
    "mesh-flange": { width: 175, height: 285 },
  },
  "43": {
    "mesh-hole": { width: 175, height: 405 },
    "mesh-flange": { width: 260, height: 405 },
  },
  "44": {
    "mesh-hole": { width: 200, height: 420 },
    "mesh-flange": { width: 310, height: 420 },
  },
  "45": {
    "mesh-hole": { width: 185, height: 420 },
    "mesh-flange": { width: 300, height: 420 },
  },
  "46": {
    "mesh-hole": { width: 200, height: 420 },
    "mesh-flange": { width: 315, height: 420 },
  },
  "47": {
    "mesh-hole": { width: 190, height: 420 },
    "mesh-flange": { width: 300, height: 420 },
  },
  "48": {
    "mesh-hole": { width: 185, height: 420 },
    "mesh-flange": { width: 280, height: 420 },
  },
});

const MESH_RENDER_SCALE_BY_COMPONENT = Object.freeze({
  "mesh-tori": 1,
  "mesh-stripe": 1,
  "mesh-hole": 1,
  "mesh-cross": 1,
  "mesh-flange": 1,
  "mesh-plate": 1,
});

const MESH_RENDER_SCALE_BY_JAW = Object.freeze({
  upper: 1,
  lower: 0.72,
});

const MESH_COMPONENT_IDS = Object.freeze([
  "mesh-hole",
  "mesh-tori",
  "mesh-stripe",
  "mesh-cross",
  "mesh-flange",
  "mesh-plate",
]);

const MESH_TOOTH_IDS = Object.freeze([
  "11", "12", "13", "14", "15", "16", "17", "18",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "31", "32", "33", "34", "35", "36", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48",
]);

/**
 * Default mesh translation in tooth-local units (before scale). Seed the override
 * table with `mesh-hole` per tooth; other mesh ids copy it unless given their own.
 */
const MESH_POSITION_OFFSET_BY_COMPONENT = Object.freeze({
  "mesh-hole": { x: 0, y: 0 },
  "mesh-tori": { x: 0, y: 0 },
  "mesh-stripe": { x: 0, y: 0 },
  "mesh-cross": { x: 0, y: 0 },
  "mesh-flange": { x: 0, y: 0 },
  "mesh-plate": { x: 0, y: 0 },
});

const MESH_POSITION_OFFSET_OVERRIDE_SEED_BY_TOOTH = Object.freeze({
  "11": {
    "mesh-hole": { x: -4.7, y: 7 },
    "mesh-flange": { x: -4.7, y: 10 },
  },
  "12": {
    "mesh-hole": { x: -0.5, y: 5 },
    "mesh-flange": { x: -0.5, y: 8 },
  },
  "13": {
    "mesh-hole": { x: 2.3, y: 0.5 },
    "mesh-flange": { x: 2.3, y: 3.5 },
  },
  "14": {
    "mesh-hole": { x: 4.0, y: 0.2 },
    "mesh-flange": { x: 6, y: 3.2 },
  },
  "15": {
    "mesh-hole": { x: 0.5, y: -1.2 },
    "mesh-flange": { x: 3.5, y: -0.2 },
  },
  "16": {
    "mesh-hole": { x: -2, y: 1 },
    "mesh-flange": { x: 1, y: 1 },
  },
  "17": {
    "mesh-hole": { x: 0, y: 0 },
    "mesh-flange": { x: 4, y: -2 },
  },
  "18": {
    "mesh-hole": { x: 1.5, y: 2 },
    "mesh-flange": { x: 6.5, y: -3 },
  },
  "21": {
    "mesh-hole": { x: 4.7, y: 7 },
    "mesh-flange": { x: 4.7, y: 10 },
  },
  "22": {
    "mesh-hole": { x: 1.5, y: 5 },
    "mesh-flange": { x: 1.5, y: 8 },
  },
  "23": {
    "mesh-hole": { x: -4.3, y: 0.5 },
    "mesh-flange": { x: -4.3, y: 3.5 },
  },
  "24": {
    "mesh-hole": { x: -4, y: 0.2 },
    "mesh-flange": { x: -6, y: 3.2 },
  },
  "25": {
    "mesh-hole": { x: -1.5, y: -1.2 },
    "mesh-flange": { x: -3.5, y: -0.2 },
  },
  "26": {
    "mesh-hole": { x: 3, y: 1 },
    "mesh-flange": { x: 0, y: 1 },
  },
  "27": {
    "mesh-hole": { x: 1, y: 0 },
    "mesh-flange": { x: -3, y: -2 },
  },
  "28": {
    "mesh-hole": { x: -1.5, y: 2 },
    "mesh-flange": { x: -6.5, y: -3 },
  },
  "31": {
    "mesh-hole": { x: 0, y: -21 },
    "mesh-flange": { x: 3, y: -8 },
  },
  "32": {
    "mesh-hole": { x: -5.6, y: -17 },
    "mesh-flange": { x: 1.4, y: -4 },
  },
  "33": {
    "mesh-hole": { x: -12.6, y: -14.5 },
    "mesh-flange": { x: -0.6, y: -3.5 },
  },
  "34": {
    "mesh-hole": { x: -22.5, y: -8.5 },
    "mesh-flange": { x: -6, y: 1.5 },
  },
  "35": {
    "mesh-hole": { x: -19, y: -5.7 },
    "mesh-flange": { x: -1, y: 1.3 },
  },
  "36": {
    "mesh-hole": { x: -18.5, y: -6.5 },
    "mesh-flange": { x: 0.5, y: -0.5 },
  },
  "37": {
    "mesh-hole": { x: -17, y: -7 },
    "mesh-flange": { x: 0, y: 0 },
  },
  "38": {
    "mesh-hole": { x: -20.5, y: -5.8 },
    "mesh-flange": { x: -7.5, y: 2.8 },
  },
  "41": {
    "mesh-hole": { x: 0, y: -21 },
    "mesh-flange": { x: -3, y: -8 },
  },
  "42": {
    "mesh-hole": { x: 5.6, y: -17 },
    "mesh-flange": { x: -1.4, y: -4 },
  },
  "43": {
    "mesh-hole": { x: 12.6, y: -14.5 },
    "mesh-flange": { x: -0.6, y: -3.5 },
  },
  "44": {
    "mesh-hole": { x: 22.5, y: -8.5 },
    "mesh-flange": { x: 6, y: 1.5 },
  },
  "45": {
    "mesh-hole": { x: 19, y: -5.7 },
    "mesh-flange": { x: 1, y: 1.3 },
  },
  "46": {
    "mesh-hole": { x: 17.5, y: -6.5 },
    "mesh-flange": { x: -0.5, y: -0.5 },
  },
  "47": {
    "mesh-hole": { x: 17, y: -7 },
    "mesh-flange": { x: 0, y: 0 },
  },
  "48": {
    "mesh-hole": { x: 20.5, y: -5.8 },
    "mesh-flange": { x: 7.5, y: 2.8 },
  },
});

function buildMeshPositionOffsetByTooth(seedByTooth) {
  const result = {};

  for (const toothId of MESH_TOOTH_IDS) {
    const byComponent = {};
    const holeOverride = seedByTooth[toothId]?.["mesh-hole"];

    for (const componentId of MESH_COMPONENT_IDS) {
      const baseOffset = MESH_POSITION_OFFSET_BY_COMPONENT[componentId] || { x: 0, y: 0 };
      const explicit = seedByTooth[toothId]?.[componentId];
      const useHoleFallback =
        componentId !== "mesh-hole" &&
        holeOverride &&
        (!explicit || (!Number.isFinite(explicit.x) && !Number.isFinite(explicit.y)));
      const override = useHoleFallback ? holeOverride : explicit || {};
      byComponent[componentId] = {
        x: Number.isFinite(override.x) ? override.x : baseOffset.x,
        y: Number.isFinite(override.y) ? override.y : baseOffset.y,
      };
    }

    result[toothId] = byComponent;
  }

  return Object.freeze(result);
}

const MESH_POSITION_OFFSET_BY_TOOTH = buildMeshPositionOffsetByTooth(
  MESH_POSITION_OFFSET_OVERRIDE_SEED_BY_TOOTH
);

function getMeshOverrideValue(overrideMap, toothId, componentId) {
  const exactToothId = String(toothId ?? "");
  const templateToothId = getComponentTemplateToothId(toothId);

  const exactOverride = overrideMap?.[exactToothId]?.[componentId];
  if (exactOverride !== undefined) {
    return exactOverride;
  }

  return overrideMap?.[templateToothId]?.[componentId];
}

// Get render scale multiplier for mesh placement.
export function getMeshPlacementRenderScale(componentId, _toothId, jaw) {
  const componentScale = MESH_RENDER_SCALE_BY_COMPONENT[componentId] || 1;
  const jawScale = MESH_RENDER_SCALE_BY_JAW[jaw] || 1;
  return componentScale * jawScale;
}

// Get per-tooth XY offset for mesh placement.
export function getMeshPlacementOffset(componentId, toothId) {
  const base = MESH_POSITION_OFFSET_BY_COMPONENT[componentId] || { x: 0, y: 0 };
  const override = getMeshOverrideValue(MESH_POSITION_OFFSET_BY_TOOTH, toothId, componentId) || {};

  const x = Number.isFinite(override.x) ? override.x : base.x;
  const y = Number.isFinite(override.y) ? override.y : base.y;
  return { x, y };
}

// Get per-tooth image size for mesh placement.
export function getMeshPlacementImageSize(componentId, toothId) {
  const templateToothId = getComponentTemplateToothId(toothId);
  const row = MESH_PLACEMENT_IMAGE_SIZE_BY_TOOTH[templateToothId];
  const specific = row?.[componentId];
  if (specific && Number.isFinite(specific.width) && Number.isFinite(specific.height)) {
    return { width: specific.width, height: specific.height };
  }
  const hole = row?.["mesh-hole"];
  if (hole && Number.isFinite(hole.width) && Number.isFinite(hole.height)) {
    return { width: hole.width, height: hole.height };
  }
  const base = MESH_IMAGE_SIZE_BY_COMPONENT[componentId] || null;
  if (base && Number.isFinite(base.width) && Number.isFinite(base.height)) {
    return { width: base.width, height: base.height };
  }
  return null;
}

function ensureToothComponentPlacementsForMesh(tooth) {
  if (Array.isArray(tooth.componentPlacements)) {
    return;
  }
  const fallback = Array.isArray(tooth.components) ? tooth.components : [];
  tooth.componentPlacements = fallback.map((componentId) => ({
    componentId,
    surface: null,
  }));
}

function syncToothComponentsFromPlacementsMap(tooth, componentById) {
  const placements = Array.isArray(tooth.componentPlacements) ? tooth.componentPlacements : [];
  tooth.components = [
    ...new Set(placements.map((entry) => entry.componentId).filter((id) => componentById.has(id))),
  ];
}

/**
 * Mesh id for new sites when the catalog pick isn't a mesh (design list or MESH_PLACEMENT_FALLBACK_ID).
 * @param {{ selectedComponentId: string | null | undefined, components: string[] }} ctx
 * @param {Map<string, object>} componentById
 */
export function getDefaultMeshIdForDesignMode(ctx, componentById) {
  const catalogPick = componentById.get(ctx.selectedComponentId || "");
  if (catalogPick && isMeshComponent(catalogPick)) {
    return ctx.selectedComponentId;
  }
  const fromList = ctx.components.find((id) => isMeshComponent(id));
  if (fromList && componentById.has(fromList)) {
    return fromList;
  }
  return MESH_PLACEMENT_FALLBACK_ID;
}

/**
 * Replace mesh component ids on one tooth; updates `tooth.components` if changed.
 * @returns {{ changed: boolean, hadMesh: boolean }}
 */
export function replaceMeshPlacementsOnToothWithMeshId(tooth, newMeshId, componentById) {
  ensureToothComponentPlacementsForMesh(tooth);
  const hadMesh = tooth.componentPlacements.some((e) => isMeshComponent(e.componentId));
  let changed = false;
  tooth.componentPlacements = tooth.componentPlacements.map((entry) => {
    if (!isMeshComponent(entry.componentId)) {
      return entry;
    }
    if (entry.componentId === newMeshId) {
      return entry;
    }
    changed = true;
    return { ...entry, componentId: newMeshId };
  });
  if (changed) {
    syncToothComponentsFromPlacementsMap(tooth, componentById);
  }
  return { changed, hadMesh };
}

/** Set every tooth's mesh placement to `meshComponentId` where a mesh exists. */
export function migrateAllMeshPlacementsToMeshId(teeth, meshComponentId, componentById) {
  if (!isMeshComponent(meshComponentId) || !componentById.has(meshComponentId)) {
    return;
  }
  for (const jaw of Object.keys(TOOTH_ORDER)) {
    for (const toothId of TOOTH_ORDER[jaw]) {
      const tooth = teeth[toothId];
      if (!tooth) {
        continue;
      }
      replaceMeshPlacementsOnToothWithMeshId(tooth, meshComponentId, componentById);
    }
  }
}

/** Add default mesh to missing teeth that have none yet (entering design mode). */
export function ensureMeshPlacementsOnMissingTeeth(teeth, meshId, componentById) {
  if (!componentById.has(meshId) || !isMeshComponent(meshId)) {
    return;
  }
  for (const jaw of Object.keys(TOOTH_ORDER)) {
    for (const toothId of TOOTH_ORDER[jaw]) {
      if (isAutoMeshPlacementExcludedToothId(toothId)) {
        continue;
      }
      const tooth = teeth[toothId];
      if (!tooth || tooth.isPresent) {
        continue;
      }
      ensureToothComponentPlacementsForMesh(tooth);
      const hasMesh = tooth.componentPlacements.some((e) => isMeshComponent(e.componentId));
      if (hasMesh) {
        continue;
      }
      tooth.componentPlacements.push({ componentId: meshId, surface: null });
      syncToothComponentsFromPlacementsMap(tooth, componentById);
    }
  }
}

/** Defer mesh single-click briefly so a double-click (catalog "apply all" or tooth
 *  swap) can cancel it. 200ms balances responsiveness vs double-click leakage. */
export const MESH_CLICK_DEFER_MS = 200;

const meshInteractionDeferTimers = new Map();

// Cancel deferred single-click mesh action.
export function cancelMeshInteractionDefer(key) {
  const t = meshInteractionDeferTimers.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    meshInteractionDeferTimers.delete(key);
  }
}

// Defer single-click action so dblclick can override behavior.
export function deferMeshInteraction(key, fn, ms = MESH_CLICK_DEFER_MS) {
  cancelMeshInteractionDefer(key);
  meshInteractionDeferTimers.set(
    key,
    setTimeout(() => {
      meshInteractionDeferTimers.delete(key);
      fn();
    }, ms)
  );
}

/** @param {{ selectedComponentId?: string | null, components: string[] }} state */
export function meshSelectionContextFromState(state) {
  return { selectedComponentId: state.selectedComponentId, components: state.components };
}

/**
 * @typedef {object} MeshAnnotationEnv
 * @property {boolean} designMode
 * @property {{ teeth: object, selectedComponentId?: string | null, components: string[] }} state
 * @property {Map<string, object>} componentById
 * @property {(msg: string, isError?: boolean) => void} notify
 * @property {() => void} redrawCatalog
 * @property {() => void} redrawJaws
 * @property {(jaw: string) => void} redrawJaw
 * @property {(toothId: string, placementContext: null) => void} placeSelectedOnTooth
 * @property {(toothIds: string[]) => void} [extendMajorConnectorsOntoTeeth]
 */

/** Every tooth currently carrying a mesh, in arch order. */
function toothIdsWithMesh(teeth) {
  const ids = [];
  for (const jaw of Object.keys(TOOTH_ORDER)) {
    for (const toothId of TOOTH_ORDER[jaw]) {
      const placements = teeth?.[toothId]?.componentPlacements;
      if (Array.isArray(placements) && placements.some((e) => isMeshComponent(e.componentId))) {
        ids.push(toothId);
      }
    }
  }
  return ids;
}

/** Double-click mesh catalog icon: set every mesh site to this type. */
export function handleMeshCatalogDoubleClickApplyAll(env, componentId) {
  if (!env.designMode) {
    env.notify("Lock both arches to use the component catalog.", true);
    return;
  }
  const def = env.componentById.get(componentId);
  if (!def || !isMeshComponent(componentId)) {
    return;
  }
  // Re-type any existing mesh sites to this mesh, then fill every missing tooth
  // that has no mesh yet (18/28/38/48 are excluded by ensureMesh…MissingTeeth).
  const meshedBefore = toothIdsWithMesh(env.state.teeth);
  migrateAllMeshPlacementsToMeshId(env.state.teeth, componentId, env.componentById);
  ensureMeshPlacementsOnMissingTeeth(env.state.teeth, componentId, env.componentById);
  // Bulk mesh writes straight to the teeth, so it has to ask for the connector follow-on the
  // placement engine does on its own — for the saddles this fill added, and no others.
  env.extendMajorConnectorsOntoTeeth?.(
    toothIdsWithMesh(env.state.teeth).filter((toothId) => !meshedBefore.includes(toothId))
  );
  env.state.selectedComponentId = componentId;
  env.state.components = env.state.components.filter((id) => !isMeshComponent(id));
  if (!env.state.components.includes(componentId)) {
    env.state.components.push(componentId);
  }
  env.redrawCatalog();
  env.redrawJaws();
  env.notify(`Placed ${def.label} on all missing teeth.`, false);
}

/** Double-click tooth in design mode with mesh tool: swap mesh, or place if none. */
export function handleMeshToolDoubleClick(env, jaw, toothId) {
  const selected = env.componentById.get(env.state.selectedComponentId || "");
  if (!selected || !isMeshComponent(selected)) {
    env.notify("Select a mesh type in the catalog, then double-click a tooth.", true);
    return;
  }
  const tooth = env.state.teeth[toothId];
  if (!tooth) {
    return;
  }
  const { changed, hadMesh } = replaceMeshPlacementsOnToothWithMeshId(tooth, selected.id, env.componentById);
  if (!hadMesh) {
    env.placeSelectedOnTooth(toothId, null);
    env.redrawJaw(jaw);
    return;
  }
  if (changed) {
    env.notify(`Mesh on tooth ${toothId} set to ${selected.label}.`, false);
  } else {
    env.notify(`Tooth ${toothId} already has ${selected.label}.`, false);
  }
  env.redrawJaw(jaw);
}
