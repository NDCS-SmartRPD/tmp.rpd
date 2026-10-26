import { TOOTH_ORDER } from "./constants.js";
import { COMPONENT_ASSET_BASE, getComponentTemplateToothId, isMeshComponent } from "./components.mesh.js";

const BAR_TAB = "bars";

/** A CLASPS item that places and draws exactly as a Y bar. */
export const ROACH_CLASP_COMPONENT_ID = "roach-clasp";
const BAR_SURFACE_RE = /^bar_(d[12])_(mesial|distal)$/;
const BAR_SURFACE_SIDE_RE = /^bar_d[12]_(mesial|distal)$/;

/** Surface key used by bar anchor-point defaults. */
export const BAR_PLACEMENT_ANCHOR_SURFACE = "mesial_buccal";

/**
 * Dedicated bar anchor points (tooth-local), independent from clasp suggestion geometry.
 * Seeded from prior clasp mesial-buccal anchors for template teeth only.
 */
const BAR_ANCHOR_POINT_BY_TEMPLATE_TOOTH = Object.freeze({
  "11": { x: -17, y: -10 },
  "12": { x: -14, y: -3 },
  "13": { x: -16, y: 7 },
  "14": { x: -14, y: 10 },
  "15": { x: -14, y: 10 },
  "16": { x: -20, y: 18 },
  "17": { x: -17, y: 16 },
  "18": { x: -16, y: 16 },
  "41": { x: -11, y: 12 },
  "42": { x: -13, y: 10 },
  "43": { x: -16, y: 1 },
  "44": { x: -15, y: -7 },
  "45": { x: -15, y: -8 },
  "46": { x: -21, y: -16 },
  "47": { x: -18, y: -16 },
  "48": { x: -15, y: -20 },
});

// Get anchor point for bar placement on a tooth.
export function getBarPlacementAnchorPointForTooth(toothId) {
  const numeric = Number(toothId);
  if (!Number.isFinite(numeric)) return null;

  const unit = numeric % 10;
  const quadrant = Math.floor(numeric / 10);

  if (quadrant === 1 || quadrant === 4) {
    const p = BAR_ANCHOR_POINT_BY_TEMPLATE_TOOTH[String(toothId)];
    return p ? { x: p.x, y: p.y } : null;
  }

  if (quadrant === 2) {
    const base = BAR_ANCHOR_POINT_BY_TEMPLATE_TOOTH[`1${unit}`];
    return base ? { x: -base.x, y: base.y } : null;
  }

  if (quadrant === 3) {
    const base = BAR_ANCHOR_POINT_BY_TEMPLATE_TOOTH[`4${unit}`];
    return base ? { x: -base.x, y: base.y } : null;
  }

  return null;
}

/** Logical source box for bar SVG art. */
export const BAR_IMAGE_SIZE = Object.freeze({ width: 92, height: 92 });

/**
 * Main control for overall bar size (d1/d2 share the baseline). 1 = baseline;
 * 1.2 ≈ 20% larger. Final size = tier unit × this × per-tooth override.
 */
export const BAR_DEFAULT_RENDER_SCALE = 1.2;

/** d1: adjacent to reference tooth, d2: two away. Units preserve prior visible size. */
const BAR_TIER_DISPLAY_UNIT = Object.freeze({
  d1: (80 * 1) / BAR_IMAGE_SIZE.width,
  d2: (88 * 1) / BAR_IMAGE_SIZE.width,
});

function toothHasAnyMeshPlacement(tooth) {
  const placements = Array.isArray(tooth?.componentPlacements) ? tooth.componentPlacements : [];
  return placements.some((entry) => isMeshComponent(entry?.componentId));
}
/**
 * Optional per-tooth size fine-tuning. Keys: `mesial`/`distal`, and/or a full surface
 * string (`bar_d1_mesial`, …) for different d1 vs d2 scales.
 */
export const BAR_RENDER_SCALE_BY_TOOTH_SURFACE = Object.freeze({
  "11": {
    bar_d1_distal: 1.2,
    bar_d1_mesial: 1.25,
    bar_d2_distal: 2,
    bar_d2_mesial: 1.9,
  },

  "12": {
    bar_d1_distal: 1.05,
    bar_d1_mesial: 1.25,
    bar_d2_distal: 1.95,
    bar_d2_mesial: 1.95,
  },

  "13": {
    bar_d1_distal: 1.25,
    bar_d1_mesial: 1.15,
    bar_d2_distal: 1.95,
    bar_d2_mesial: 1.95,
  },

  "14": {
    bar_d1_distal: 1.05,
    bar_d1_mesial: 1.05,
    bar_d2_distal: 1.5,
    bar_d2_mesial: 1.65,
  },

  "15": {
    bar_d1_distal: 1.15,
    bar_d1_mesial: 1.15,
    bar_d2_distal: 1.6,
    bar_d2_mesial: 1.95,
  },

  "16": {
    bar_d1_distal: 1.35,
    bar_d1_mesial: 1.35,
    bar_d2_distal: 1.8,
    bar_d2_mesial: 1.95,
  },

  "17": {
    bar_d1_distal: 1.35,
    bar_d1_mesial: 1.25,
    bar_d2_distal: 1.85,
    bar_d2_mesial: 0,
  },

  "18": {
    bar_d1_distal: 0.95,
    bar_d1_mesial: 0,
    bar_d2_distal: 1.75,
    bar_d2_mesial: 0,
  },

  "41": {
    bar_d1_distal: 0.75,
    bar_d1_mesial: 0.85,
    bar_d2_distal: 1.15,
    bar_d2_mesial: 1.05,
  },

  "42": {
    bar_d1_distal: 0.8,
    bar_d1_mesial: 0.95,
    bar_d2_distal: 1.10,
    bar_d2_mesial: 1.30,
  },

  "43": {
    bar_d1_distal: 0.85,
    bar_d1_mesial: 1.25,
    bar_d2_distal: 1.25,
    bar_d2_mesial: 1.45,
  },

  "44": {
    bar_d1_distal: 0.95,
    bar_d1_mesial: 1.25,
    bar_d2_distal: 1.05,
    bar_d2_mesial: 1.65,
  },

  "45": {
    bar_d1_distal: 1.05,
    bar_d1_mesial: 1.35,
    bar_d2_distal: 1.15,
    bar_d2_mesial: 1.80,
  },

  "46": {
    bar_d1_distal: 1.25,
    bar_d1_mesial: 1.45,
    bar_d2_distal: 1.55,
    bar_d2_mesial: 1.75,
  },

  "47": {
    bar_d1_distal: 1.2,
    bar_d1_mesial: 1.3,
    bar_d2_distal: 1.65,
    bar_d2_mesial: 0,
  },

  "48": {
    bar_d1_distal: 1.4,
    bar_d1_mesial: 0,
    bar_d2_distal: 1.74,
    bar_d2_mesial: 0,
  },
});

/**
 * Optional per-tooth placement tuning in tooth-local coords, e.g.
 * { "11": { mesial: { x, y, rotation } } }. Full surface keys also work.
 */
export const BAR_PLACEMENT_OFFSET_BY_TOOTH_SURFACE = Object.freeze({
  "11": {
    bar_d1_distal: { x: 10, y: -12, rotation: 4 },
    bar_d1_mesial: { x: -45, y: -3, rotation: -22 },
    bar_d2_distal: { x: 28, y: -5, rotation: -5 },
    bar_d2_mesial: { x: -60, y: 15, rotation: -3 },
  },

  "21": {
    bar_d1_distal: { x: 10, y: -12, rotation: -4 },
    bar_d1_mesial: { x: -45, y: -3, rotation: 22 },
    bar_d2_distal: { x: 28, y: -5, rotation: 5 },
    bar_d2_mesial: { x: -60, y: 15, rotation: 3 },
  },

  "12": {
    bar_d1_distal: { x: 1, y: -26, rotation: 15 },
    bar_d1_mesial: { x: -30, y: -5, rotation: -21 },
    bar_d2_distal: { x: 21, y: -25, rotation: 3 },
    bar_d2_mesial: { x: -55, y: 20, rotation: -1 },
  },

  "22": {
    bar_d1_distal: { x: 1, y: -26, rotation: -15 },
    bar_d1_mesial: { x: -30, y: -5, rotation: 21 },
    bar_d2_distal: { x: 21, y: -25, rotation: -3 },
    bar_d2_mesial: { x: -55, y: 20, rotation: 1 },
  },

  "13": {
    bar_d1_distal: { x: -15, y: -17, rotation: 19 },
    bar_d1_mesial: { x: -39, y: 16, rotation: -24 },
    bar_d2_distal: { x: 7, y: -30, rotation: 4 },
    bar_d2_mesial: { x: -50, y: 35, rotation: -2 },
  },

  "23": {
    bar_d1_distal: { x: -15, y: -17, rotation: -20 },
    bar_d1_mesial: { x: -38, y: 16, rotation: 24 },
    bar_d2_distal: { x: 7, y: -30, rotation: -4 },
    bar_d2_mesial: { x: -48, y: 35, rotation: 2 },
  },

  "14": {
    bar_d1_distal: { x: -10, y: -25, rotation: 8 },
    bar_d1_mesial: { x: -30, y: 12, rotation: -5 },
    bar_d2_distal: { x: 5, y: -40, rotation: 6 },
    bar_d2_mesial: { x: -40, y: 36, rotation: -3 },
  },

  "24": {
    bar_d1_distal: { x: -10, y: -25, rotation: -8 },
    bar_d1_mesial: { x: -30, y: 12, rotation: 5 },
    bar_d2_distal: { x: 5, y: -40, rotation: -6 },
    bar_d2_mesial: { x: -40, y: 36, rotation: 3 },
  },

  "15": {
    bar_d1_distal: { x: -19, y: -12, rotation: 8 },
    bar_d1_mesial: { x: -33, y: 14, rotation: -5 },
    bar_d2_distal: { x: -10, y: -30, rotation: 2 },
    bar_d2_mesial: { x: -43, y: 73, rotation: -6 },
  },

  "25": {
    bar_d1_distal: { x: -19, y: -12, rotation: -8 },
    bar_d1_mesial: { x: -32, y: 14, rotation: 5 },
    bar_d2_distal: { x: -8, y: -30, rotation: -2 },
    bar_d2_mesial: { x: -43, y: 73, rotation: 6 },
  },

  "16": {
    bar_d1_distal: { x: -20, y: -5, rotation: 1 },
    bar_d1_mesial: { x: -29, y: 40, rotation: -3 },
    bar_d2_distal: { x: -7, y: -30, rotation: -1 },
    bar_d2_mesial: { x: -36, y: 85, rotation: -1 },
  },

  "26": {
    bar_d1_distal: { x: -22, y: -5, rotation: -1 },
    bar_d1_mesial: { x: -30, y: 40, rotation: 3 },
    bar_d2_distal: { x: -7, y: -30, rotation: 1 },
    bar_d2_mesial: { x: -36, y: 85, rotation: 1 },
  },

  "17": {
    bar_d1_distal: { x: -20, y: -4, rotation: 4 },
    bar_d1_mesial: { x: -26, y: 40, rotation: -8 },
    bar_d2_distal: { x: 1, y: -60, rotation: -1 },
  },

  "27": {
    bar_d1_distal: { x: -23, y: -4, rotation: -4 },
    bar_d1_mesial: { x: -26, y: 40, rotation: 8 },
    bar_d2_distal: { x: 1, y: -60, rotation: 1 },
  },

  "18": {
    bar_d1_distal: { x: -13, y: -5, rotation: 15 },
    bar_d2_distal: { x: -10, y: -50, rotation: 11 },
  },

  "28": {
    bar_d1_distal: { x: -13, y: -5, rotation: -15 },
    bar_d2_distal: { x: -10, y: -50, rotation: -11 },
  },

  "41": {
    bar_d1_distal: { x: 2, y: 7, rotation: -17 },
    bar_d1_mesial: { x: -25, y: 6, rotation: 13 },
    bar_d2_distal: { x: 22, y: 3, rotation: 9 },
    bar_d2_mesial: { x: -37, y: -2, rotation: 8 },
  },

  "31": {
    bar_d1_distal: { x: 2, y: 7, rotation: 17 },
    bar_d1_mesial: { x: -25, y: 6, rotation: -13 },
    bar_d2_distal: { x: 22, y: 3, rotation: -9 },
    bar_d2_mesial: { x: -37, y: -2, rotation: -8 },
  },

  "42": {
    bar_d1_distal: { x: -2, y: 16, rotation: -20 },
    bar_d1_mesial: { x: -27, y: 7, rotation: 14 },
    bar_d2_distal: { x: 23, y: 20, rotation: -3 },
    bar_d2_mesial: { x: -41, y: -4, rotation: 13 },
  },

  "32": {
    bar_d1_distal: { x: -2, y: 16, rotation: 20 },
    bar_d1_mesial: { x: -27, y: 7, rotation: -14 },
    bar_d2_distal: { x: 23, y: 20, rotation: 3 },
    bar_d2_mesial: { x: -41, y: -4, rotation: -13 },
  },

  "43": {
    bar_d1_distal: { x: -5, y: 17, rotation: -33 },
    bar_d1_mesial: { x: -36, y: 0, rotation: 19 },
    bar_d2_distal: { x: 19, y: 23, rotation: -11 },
    bar_d2_mesial: { x: -53, y: -30, rotation: -2 },
  },

  "33": {
    bar_d1_distal: { x: -5, y: 17, rotation: 33 },
    bar_d1_mesial: { x: -36, y: 0, rotation: -19 },
    bar_d2_distal: { x: 19, y: 23, rotation: 11 },
    bar_d2_mesial: { x: -53, y: -30, rotation: 2 },
  },

  "44": {
    bar_d1_distal: { x: -14, y: 15, rotation: -30 },
    bar_d1_mesial: { x: -40, y: -10, rotation: 9 },
    bar_d2_distal: { x: 7, y: 30, rotation: -6 },
    bar_d2_mesial: { x: -50, y: -58, rotation: 17 },
  },

  "34": {
    bar_d1_distal: { x: -14, y: 15, rotation: 30 },
    bar_d1_mesial: { x: -40, y: -10, rotation: -9 },
    bar_d2_distal: { x: 7, y: 30, rotation: 6 },
    bar_d2_mesial: { x: -50, y: -58, rotation: -17 },
  },

  "45": {
    bar_d1_distal: { x: -13, y: 15, rotation: -15 },
    bar_d1_mesial: { x: -33, y: -15, rotation: 3 },
    bar_d2_distal: { x: 5, y: 38, rotation: -7 },
    bar_d2_mesial: { x: -43, y: -70, rotation: -1 },
  },

  "35": {
    bar_d1_distal: { x: -13, y: 15, rotation: 15 },
    bar_d1_mesial: { x: -33, y: -15, rotation: -3 },
    bar_d2_distal: { x: 5, y: 38, rotation: 8 },
    bar_d2_mesial: { x: -43, y: -70, rotation: 1 },
  },

  "46": {
    bar_d1_distal: { x: -19, y: 10, rotation: -11 },
    bar_d1_mesial: { x: -28, y: -30, rotation: 4 },
    bar_d2_distal: { x: -5, y: 35, rotation: -5 },
    bar_d2_mesial: { x: -40, y: -75, rotation: 1 },
  },

  "36": {
    bar_d1_distal: { x: -19, y: 10, rotation: 12 },
    bar_d1_mesial: { x: -28, y: -30, rotation: -4 },
    bar_d2_distal: { x: -5, y: 35, rotation: 5 },
    bar_d2_mesial: { x: -40, y: -75, rotation: -1 },
  },

  "47": {
    bar_d1_distal: { x: -22, y: 4, rotation: -2 },
    bar_d1_mesial: { x: -28, y: -36, rotation: 1 },
    bar_d2_distal: { x: -9, y: 40, rotation: -5 },
  },

  "37": {
    bar_d1_distal: { x: -22, y: 4, rotation: 2 },
    bar_d1_mesial: { x: -28, y: -36, rotation: -1 },
    bar_d2_distal: { x: -9, y: 40, rotation: 5 },
  },

  "48": {
    bar_d1_distal: { x: -15, y: -2, rotation: -1 },
    bar_d2_distal: { x: -8, y: 40, rotation: -3 },
  },

  "38": {
    bar_d1_distal: { x: -15, y: -2, rotation: 1 },
    bar_d2_distal: { x: -8, y: 40, rotation: 3 },
  },
});

const BAR_SHAPE_LETTER = Object.freeze({
  "bar-i": "I",
  "bar-s": "S",
  "bar-t": "T",
  "bar-u": "U",
  "bar-y": "Y",
  [ROACH_CLASP_COMPONENT_ID]: "Y",
});

/** Validate a bar surface token: bar_d1_mesial | bar_d1_distal | bar_d2_mesial | bar_d2_distal. */
export function isBarPlacementSurface(surface) {
  const s = typeof surface === "string" ? surface.toLowerCase() : "";
  return BAR_SURFACE_SIDE_RE.test(s);
}

// Check whether a component belongs to bar family (the Roach clasp included).
export function isBarComponent(componentOrId) {
  if (typeof componentOrId === "object" && componentOrId !== null) {
    const id = String(componentOrId.id || "");
    return componentOrId.tab === BAR_TAB || id.startsWith("bar-") || id === ROACH_CLASP_COMPONENT_ID;
  }
  const id = String(componentOrId || "");
  return id.startsWith("bar-") || id === ROACH_CLASP_COMPONENT_ID;
}

/** Teeth eligible for bar suggestions: present teeth within ±1/±2 of any mesh-bearing tooth. */
export function getBarSuggestibleToothIdSet(teethById, jaw) {
  const order = TOOTH_ORDER[jaw];
  const out = new Set();

  for (let i = 0; i < order.length; i += 1) {
    const meshTooth = teethById[order[i]];
    if (!meshTooth || !toothHasAnyMeshPlacement(meshTooth)) continue;

    for (const delta of [-2, -1, 1, 2]) {
      const j = i + delta;
      if (j < 0 || j >= order.length) continue;
      const candidateId = order[j];
      if (teethById[candidateId]?.isPresent) {
        out.add(candidateId);
      }
    }
  }

  return out;
}

/**
 * Resolve a bar surface from a nearby mesh tooth: bars base from the DISTAL saddle, falling
 * back to mesial only when none is within two positions. The side LABEL is keyed to
 * BAR_PLACEMENT_OFFSET_BY_TOOTH_SURFACE tuning, NOT anatomy — never invert it.
 */
export function getBarPlacementSurfaceForTooth(toothId, jaw, teethById) {
  const order = TOOTH_ORDER[jaw];
  const toothIndex = order.indexOf(String(toothId));
  if (toothIndex < 0 || !teethById[toothId]?.isPresent) return null;

  const rightHemisphereStartIndex = order.length / 2;
  const mesialDirection = toothIndex < rightHemisphereStartIndex ? 1 : -1;

  // Prefer a distal-side mesh within two positions, nearer first, falling back to mesial
  // only when none is in range. Terminal molars keep their "distal" label and tuning.
  let bestIndex = null;
  let bestDistance = null;
  let bestIsDistal = false;

  for (let i = 0; i < order.length; i += 1) {
    if (!toothHasAnyMeshPlacement(teethById[order[i]])) continue;
    const distance = Math.abs(toothIndex - i);
    if (distance !== 1 && distance !== 2) continue;
    const isDistal = (i > toothIndex ? 1 : -1) !== mesialDirection;
    const better =
      bestIndex === null ||
      (isDistal && !bestIsDistal) ||
      (isDistal === bestIsDistal && distance < bestDistance);
    if (better) {
      bestIndex = i;
      bestDistance = distance;
      bestIsDistal = isDistal;
    }
  }

  if (bestIndex === null) return null;

  const meshDirection = bestIndex > toothIndex ? 1 : -1;
  const side = meshDirection === mesialDirection ? "distal" : "mesial";
  const tier = bestDistance === 1 ? "d1" : "d2";

  return `bar_${tier}_${side}`;
}

// True when this anchor tooth has mesh-bearing teeth on both mesial and distal sides (distance 1/2).
export function hasMissingTeethOnBothSidesForBar(toothId, jaw, teethById) {
  const order = TOOTH_ORDER[jaw];
  const toothIndex = order.indexOf(String(toothId));
  if (toothIndex < 0) return false;

  let hasLeftMesh = false;
  let hasRightMesh = false;
  for (let i = 0; i < order.length; i += 1) {
    if (!toothHasAnyMeshPlacement(teethById[order[i]])) continue;
    const distance = Math.abs(toothIndex - i);
    if (distance !== 1 && distance !== 2) continue;
    if (i < toothIndex) hasLeftMesh = true;
    if (i > toothIndex) hasRightMesh = true;
    if (hasLeftMesh && hasRightMesh) return true;
  }
  return false;
}

// Whether a bar placement is still backed by a mesh tooth at the surface's implied
// distance and direction. Note "distal" means mesh in the MESIAL direction.
function isBarPlacementBackedByMesh(toothId, jaw, surface, teethById) {
  const match = BAR_SURFACE_RE.exec(String(surface || "").toLowerCase());
  if (!match) return false;
  const [, tier, side] = match;
  const distance = tier === "d1" ? 1 : 2;

  const order = TOOTH_ORDER[jaw];
  if (!Array.isArray(order)) return false;
  const toothIndex = order.indexOf(String(toothId));
  if (toothIndex < 0) return false;

  const rightHemisphereStartIndex = order.length / 2;
  const mesialDirection = toothIndex < rightHemisphereStartIndex ? 1 : -1;
  const meshDirection = side === "distal" ? mesialDirection : -mesialDirection;
  const meshIndex = toothIndex + meshDirection * distance;
  if (meshIndex < 0 || meshIndex >= order.length) return false;
  const meshTooth = teethById[order[meshIndex]];
  return Boolean(meshTooth) && toothHasAnyMeshPlacement(meshTooth);
}

// Drop bar placements whose anchor tooth no longer has a mesh-bearing neighbor at
// the bar's exact distance + direction (catches wrong-direction mesh too). Mutates in place.
export function pruneInvalidBarPlacementsInJaw(teethById, jaw) {
  if (!teethById || typeof teethById !== "object") return;
  if (!Array.isArray(TOOTH_ORDER?.[jaw])) return;

  for (const toothId of TOOTH_ORDER[jaw]) {
    const tooth = teethById[toothId];
    if (!tooth || !Array.isArray(tooth.componentPlacements)) continue;
    const original = tooth.componentPlacements;
    const next = original.filter((entry) => {
      if (!entry || !isBarComponent(entry.componentId)) return true;
      if (!isBarPlacementSurface(entry.surface)) return true;
      return isBarPlacementBackedByMesh(toothId, jaw, entry.surface, teethById);
    });
    if (next.length !== original.length) {
      tooth.componentPlacements = next;
    }
  }
}

// Resolve bar asset path for component/tooth/surface.
export function getBarPlacementAssetReference(componentId, toothId, surface) {
  const templateToothId = getComponentTemplateToothId(toothId);
  const letter = BAR_SHAPE_LETTER[String(componentId || "").toLowerCase()] || "I";
  const match = BAR_SURFACE_RE.exec(String(surface || "").toLowerCase());

  if (!match) {
    return `${COMPONENT_ASSET_BASE}/${templateToothId}/bars/${templateToothId}_${letter}-bar_mesial.svg`;
  }

  const [, tier, side] = match;
  const modelName = tier === "d1" ? `${letter}-bar` : `${letter}-long-bar`;
  return `${COMPONENT_ASSET_BASE}/${templateToothId}/bars/${templateToothId}_${modelName}_${side}.svg`;
}

// Return image size for bar assets.
export function getBarPlacementImageSize() {
  return { width: BAR_IMAGE_SIZE.width, height: BAR_IMAGE_SIZE.height };
}

function getBarSurfaceSide(surface) {
  const match = BAR_SURFACE_SIDE_RE.exec(String(surface || "").toLowerCase());
  return match ? match[1] : null;
}

function getBarToothConfig(configByTooth, toothId) {
  const exactToothId = String(toothId ?? "");
  const templateToothId = getComponentTemplateToothId(toothId);
  return configByTooth[exactToothId] ?? configByTooth[templateToothId] ?? null;
}

// Return render scale for bar placement.
export function getBarPlacementRenderScale(_componentId, toothId, surface) {
  const normalizedSurface = String(surface || "").toLowerCase();
  const tier = normalizedSurface.startsWith("bar_d2_") ? "d2" : "d1";
  const tierScale = BAR_TIER_DISPLAY_UNIT[tier] ?? BAR_TIER_DISPLAY_UNIT.d1;

  const side = getBarSurfaceSide(surface);
  const byTooth = getBarToothConfig(BAR_RENDER_SCALE_BY_TOOTH_SURFACE, toothId);
  let perToothScale = Number(byTooth?.[normalizedSurface]);
  if (!Number.isFinite(perToothScale) && side) {
    perToothScale = Number(byTooth?.[side]);
  }
  const toothScale = Number.isFinite(perToothScale) ? perToothScale : 1;

  return tierScale * BAR_DEFAULT_RENDER_SCALE * toothScale;
}

// Return placement offset for bar placement.
export function getBarPlacementOffset(_componentId, toothId, surface) {
  const normalizedSurface = String(surface || "").toLowerCase();
  const side = getBarSurfaceSide(surface);
  const byTooth = getBarToothConfig(BAR_PLACEMENT_OFFSET_BY_TOOTH_SURFACE, toothId);
  let point = byTooth?.[normalizedSurface];
  if (!point && side) {
    point = byTooth?.[side];
  }
  const x = Number(point?.x);
  const y = Number(point?.y);
  const rotation = Number(point?.rotation);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    rotation: Number.isFinite(rotation) ? rotation : 0,
  };
}

// Return persisted user drag offset for a placed bar.
export function getBarUserOffset(placement) {
  const x = Number(placement?.barOffsetX);
  const y = Number(placement?.barOffsetY);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}
