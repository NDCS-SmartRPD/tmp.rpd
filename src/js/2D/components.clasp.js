import { isBarComponent } from "./components.bar.js";
import { getComponentTemplateToothId } from "./components.mesh.js";
import { getNeighborToothIds, TOOTH_ORDER } from "./constants.js";

export const CLASP_CIRC_SURFACE = Object.freeze({
  MESIAL_BUCCAL: "mesial_buccal",
  DISTAL_BUCCAL: "distal_buccal",
  MESIAL_LINGUAL: "mesial_lingual",
  DISTAL_LINGUAL: "distal_lingual",
});

const CLASP_CIRC_SURFACE_ORDER = [
  CLASP_CIRC_SURFACE.MESIAL_BUCCAL,
  CLASP_CIRC_SURFACE.DISTAL_BUCCAL,
  CLASP_CIRC_SURFACE.MESIAL_LINGUAL,
  CLASP_CIRC_SURFACE.DISTAL_LINGUAL,
];

const CLASP_ASSET_BASE = "../../assets/RPD_Component";

const CLASP_CIRC_SUGGESTION_RADIUS = 7;

/**
 * Per-template (Q1: 11-18, Q4: 41-48) clasp anchor quad in tooth-local space.
 * Deliberately separate from rest M/D/L suggestion points (own layout for clasp arms).
 */
const CLASP_QUAD_BY_TEMPLATE = Object.freeze({
 "11": {
  distal_buccal: { x: -17, y: -10 },
  mesial_buccal: { x: 17, y: -20 },
  distal_lingual: { x: -2, y: 15 },
  mesial_lingual: { x: 13, y: 13 },
},
"12": {
  distal_buccal: { x: -14, y: -3 },
  mesial_buccal: { x: 5, y: -16 },
  distal_lingual: { x: -4, y: 12 },
  mesial_lingual: { x: 10, y: 5 },
},
"13": {
  distal_buccal: { x: -16, y: 7 },
  mesial_buccal: { x: 3, y: -16 },
  distal_lingual: { x: 1, y: 15 },
  mesial_lingual: { x: 11, y: 4 },
},
"14": {
  distal_buccal: { x: -14, y: 10 },
  mesial_buccal: { x: -1, y: -15 },
  distal_lingual: { x: 5, y: 18 },
  mesial_lingual: { x: 15, y: -2 },
},
"15": {
  distal_buccal: { x: -14, y: 10 },
  mesial_buccal: { x: -5, y: -16 },
  distal_lingual: { x: 6, y: 16 },
  mesial_lingual: { x: 15, y: -6 },
},
"16": {
  distal_buccal: { x: -20, y: 18 },
  mesial_buccal: { x: -8, y: -25 },
  distal_lingual: { x: 10, y: 25 },
  mesial_lingual: { x: 20, y: -8 },
},
"17": {
  distal_buccal: { x: -17, y: 16 },
  mesial_buccal: { x: -10, y: -20 },
  distal_lingual: { x: 12, y: 18 },
  mesial_lingual: { x: 19, y: -8 },
},
"18": {
  distal_buccal: { x: -16, y: 16 },
  mesial_buccal: { x: -13, y: -20 },
  distal_lingual: { x: 13, y: 19 },
  mesial_lingual: { x: 17, y: -10 },
},
"41": {
  distal_buccal: { x: -11, y: 12 },
  mesial_buccal: { x: 7, y: 15 },
  distal_lingual: { x: -5, y: -9 },
  mesial_lingual: { x: 6, y: -8 },
},
"42": {
  distal_buccal: { x: -13, y: 10 },
  mesial_buccal: { x: 3, y: 15 },
  distal_lingual: { x: -3, y: -9 },
  mesial_lingual: { x: 8, y: -6 },
},
"43": {
  distal_buccal: { x: -16, y: 1 },
  mesial_buccal: { x: 4, y: 15 },
  distal_lingual: { x: 0, y: -12 },
  mesial_lingual: { x: 10, y: -5 },
},
"44": {
  distal_buccal: { x: -15, y: -7 },
  mesial_buccal: { x: 5, y: 16 },
  distal_lingual: { x: 0, y: -15 },
  mesial_lingual: { x: 17, y: 4 },
},
"45": {
  distal_buccal: { x: -15, y: -8 },
  mesial_buccal: { x: -2, y: 19 },
  distal_lingual: { x: 7, y: -16 },
  mesial_lingual: { x: 15, y: 10 },
},
"46": {
  distal_buccal: { x: -21, y: -16 },
  mesial_buccal: { x: -7, y: 28 },
  distal_lingual: { x: 8, y: -26 },
  mesial_lingual: { x: 22, y: 18 },
},
"47": {
  distal_buccal: { x: -18, y: -16 },
  mesial_buccal: { x: -8, y: 24 },
  distal_lingual: { x: 11, y: -23 },
  mesial_lingual: { x: 17, y: 18 },
},
"48": {
  distal_buccal: { x: -15, y: -20 },
  mesial_buccal: { x: -8, y: 20 },
  distal_lingual: { x: 9, y: -20 },
  mesial_lingual: { x: 16, y: 13 },
},
});

function mirrorQuad(row) {
  return {
    mesial_buccal: { x: -row.mesial_buccal.x, y: row.mesial_buccal.y },
    distal_buccal: { x: -row.distal_buccal.x, y: row.distal_buccal.y },
    mesial_lingual: { x: -row.mesial_lingual.x, y: row.mesial_lingual.y },
    distal_lingual: { x: -row.distal_lingual.x, y: row.distal_lingual.y },
  };
}

function buildRetainerClaspPointOverrides() {
  const out = {};
  for (let u = 1; u <= 8; u += 1) {
    const unit = String(u);
    const upper = CLASP_QUAD_BY_TEMPLATE[`1${unit}`];
    const lower = CLASP_QUAD_BY_TEMPLATE[`4${unit}`];
    if (upper) {
      out[`1${unit}`] = upper;
      out[`2${unit}`] = mirrorQuad(upper);
    }
    if (lower) {
      out[`4${unit}`] = lower;
      out[`3${unit}`] = mirrorQuad(lower);
    }
  }
  return Object.freeze(out);
}

/** FDI tooth id → four clasp suggestion anchors (independent of rest suggestion geometry). */
export const CLASP_CIRC_POINT_OVERRIDES = buildRetainerClaspPointOverrides();

/** Fallback `<image>` box when a template tooth has no retainer-clasp size row. */
const CLASP_CIRC_IMAGE_DEFAULT = Object.freeze({ width: 40, height: 40 });

/** Placed clasp SVG size by template tooth (11-18 / 41-48); 21-28 / 31-38 resolve
 *  via getComponentTemplateToothId. */
const CLASP_CIRC_PLACEMENT_IMAGE_SIZE_BY_TOOTH = Object.freeze({
  "11": {
    distal_buccal: { width: 155, height: 140 },
    mesial_buccal: { width: 155, height: 140 },
    distal_lingual: { width: 137, height: 130 },
    mesial_lingual: { width: 150, height: 140 },
  },

  "12": {
    distal_buccal: { width: 130, height: 130 },
    mesial_buccal: { width: 170, height: 150 },
    distal_lingual: { width: 85, height: 80 },
    mesial_lingual: { width: 122, height: 120 },
  },

  "13": {
    distal_buccal: { width: 145, height: 130 },
    mesial_buccal: { width: 170, height: 150 },
    distal_lingual: { width: 135, height: 100 },
    mesial_lingual: { width: 122, height: 125 },
  },

  "14": {
    distal_buccal: { width: 145, height: 140 },
    mesial_buccal: { width: 175, height: 165 },
    distal_lingual: { width: 155, height: 140 },
    mesial_lingual: { width: 135, height: 125 },
  },

  "15": {
    distal_buccal: { width: 145, height: 130 },
    mesial_buccal: { width: 170, height: 156 },
    distal_lingual: { width: 165, height: 145 },
    mesial_lingual: { width: 122, height: 125 },
  },

  "16": {
    distal_buccal: { width: 245, height: 170 },
    mesial_buccal: { width: 250, height: 185 },
    distal_lingual: { width: 165, height: 165 },
    mesial_lingual: { width: 162, height: 155 },
  },

  "17": {
    distal_buccal: { width: 240, height: 165 },
    mesial_buccal: { width: 200, height: 175 },
    distal_lingual: { width: 170, height: 170 },
    mesial_lingual: { width: 142, height: 150 },
  },

  "18": {
    distal_buccal: { width: 180, height: 145 },
    mesial_buccal: { width: 185, height: 175 },
    distal_lingual: { width: 165, height: 155 },
    mesial_lingual: { width: 150, height: 160 },
  },

  "41": {
    distal_buccal: { width: 100, height: 90 },
    mesial_buccal: { width: 95, height: 85 },
    distal_lingual: { width: 75, height: 70 },
    mesial_lingual: { width: 80, height: 75 },
  },

  "42": {
    distal_buccal: { width: 100, height: 90 },
    mesial_buccal: { width: 100, height: 90 },
    distal_lingual: { width: 95, height: 75 },
    mesial_lingual: { width: 82, height: 75 },
  },

  "43": {
    distal_buccal: { width: 105, height: 100 },
    mesial_buccal: { width: 100, height: 100 },
    distal_lingual: { width: 100, height: 85 },
    mesial_lingual: { width: 92, height: 85 },
  },

  "44": {
    distal_buccal: { width: 115, height: 100 },
    mesial_buccal: { width: 120, height: 120 },
    distal_lingual: { width: 130, height: 110 },
    mesial_lingual: { width: 100, height: 100 },
  },

  "45": {
    distal_buccal: { width: 105, height: 100 },
    mesial_buccal: { width: 130, height: 120 },
    distal_lingual: { width: 145, height: 117 },
    mesial_lingual: { width: 112, height: 105 },
  },

  "46": {
    distal_buccal: { width: 165, height: 140 },
    mesial_buccal: { width: 170, height: 155 },
    distal_lingual: { width: 152, height: 163 },
    mesial_lingual: { width: 145, height: 145 },
  },

  "47": {
    distal_buccal: { width: 135, height: 125 },
    mesial_buccal: { width: 170, height: 150 },
    distal_lingual: { width: 115, height: 137 },
    mesial_lingual: { width: 115, height: 115 },
  },

  "48": {
    distal_buccal: { width: 115, height: 110 },
    mesial_buccal: { width: 145, height: 145 },
    distal_lingual: { width: 115, height: 137 },
    mesial_lingual: { width: 102, height: 125 },
  },
});
/**
 * Nudges placed clasp art onto the suggestion anchor. `retainer-clasp` covers all four
 * surfaces; template teeth only, with Q2/Q3 mirroring x unless given an explicit row.
 */
const CLASP_CIRC_POSITION_OFFSET_OVERRIDE_SEED_BY_TOOTH = Object.freeze({
"11": {
  distal_buccal: { x: 18, y: -14 },
  mesial_buccal: { x: -28, y: 3 },
  distal_lingual: { x: 5, y: 1 },
  mesial_lingual: { x: -3, y: 9.8 },
},
"12": {
  distal_buccal: { x: 9, y: -16 },
  mesial_buccal: { x: -17, y: 5 },
  distal_lingual: { x: 11, y: 6.7 },
  mesial_lingual: { x: 0.3, y: 15 },
},
"13": {
  distal_buccal: { x: 5, y: -16 },
  mesial_buccal: { x: -20, y: 9 },
  distal_lingual: { x: 6, y: -2 },
  mesial_lingual: { x: 5, y: 6 },
},
"14": {
  distal_buccal: { x: 1, y: -13 },
  mesial_buccal: { x: -16, y: 7.7 },
  distal_lingual: { x: 18, y: -8 },
  mesial_lingual: { x: -2, y: 15 },
},
"15": {
  distal_buccal: { x: 0, y: -15 },
  mesial_buccal: { x: -18, y: 10 },
  distal_lingual: { x: 18, y: -10 },
  mesial_lingual: { x: 0.5, y: 10 },
},
"16": {
  distal_buccal: { x: 3, y: -25 },
  mesial_buccal: { x: -18, y: 23 },
  distal_lingual: { x: 17, y: -21 },
  mesial_lingual: { x: -3, y: 16 },
},
"17": {
  distal_buccal: { x: -3, y: -16 },
  mesial_buccal: { x: -16, y: 18 },
  distal_lingual: { x: 13, y: -14 },
  mesial_lingual: { x: -2, y: 13 },
},
"18": {
  distal_buccal: { x: -6, y: -20 },
  mesial_buccal: { x: -9, y: 16 },
  distal_lingual: { x: 10, y: -21 },
  mesial_lingual: { x: 5, y: 10 },
},
"41": {
  distal_buccal: { x: 6, y: 7 },
  mesial_buccal: { x: -13, y: 4 },
  distal_lingual: { x: 8, y: 2 },
  mesial_lingual: { x: -10, y: 0 },
},
"42": {
  distal_buccal: { x: 8, y: 11.2 },
  mesial_buccal: { x: -13, y: 0 },
  distal_lingual: { x: 7, y: 10.5 },
  mesial_lingual: { x: -11, y: -3 },
},
"43": {
  distal_buccal: { x: 10, y: 15 },
  mesial_buccal: { x: -17, y: -6 },
  distal_lingual: { x: 6, y: 8.5 },
  mesial_lingual: { x: -10, y: -7.2 },
},
"44": {
  distal_buccal: { x: 9.5, y: 21 },
  mesial_buccal: { x: -23, y: -13 },
  distal_lingual: { x: 19, y: 11 },
  mesial_lingual: { x: -7, y: -19.6 },
},
"45": {
  distal_buccal: { x: 2, y: 18 },
  mesial_buccal: { x: -17.8, y: -21 },
  distal_lingual: { x: 13.5, y: 18 },
  mesial_lingual: { x: 1, y: -16.7 },
},
"46": {
  distal_buccal: { x: 3, y: 27 },
  mesial_buccal: { x: -21.2, y: -35.5 },
  distal_lingual: { x: 20, y: 29 },
  mesial_lingual: { x: -1.2, y: -32.5 },
},
"47": {
  distal_buccal: { x: -1, y: 25 },
  mesial_buccal: { x: -13, y: -24 },
  distal_lingual: { x: 12, y: 26 },
  mesial_lingual: { x: 1, y: -31 },
},
"48": {
  distal_buccal: { x: -2, y: 30 },
  mesial_buccal: { x: -12, y: -22 },
  distal_lingual: { x: 15, y: 21 },
  mesial_lingual: { x: 3.6, y: -24 },
},
});

const CLASP_CIRC_ALL_TOOTH_IDS = Object.freeze([...TOOTH_ORDER.upper, ...TOOTH_ORDER.lower]);

// Quadrant 1->2 and 4->3 are mirrored by negating x. `defaultKey` is the row's
// whole-tooth entry ("retainer-clasp" / "ring-clasp"), used as the surface fallback.
function mirrorClaspOffsetSeedRow(row, defaultKey) {
  const next = {};
  for (const key of [defaultKey, ...CLASP_CIRC_SURFACE_ORDER]) {
    const p = row[key];
    if (!p) continue;
    next[key] = {
      x: Number.isFinite(p.x) ? -p.x : 0,
      y: Number.isFinite(p.y) ? p.y : 0,
    };
  }
  return next;
}

function expandClaspOffsetSeed(seedByTooth, defaultKey) {
  const out = { ...seedByTooth };
  for (let u = 1; u <= 8; u += 1) {
    const s = String(u);
    if (out[`1${s}`] && out[`2${s}`] === undefined) {
      out[`2${s}`] = mirrorClaspOffsetSeedRow(out[`1${s}`], defaultKey);
    }
    if (out[`4${s}`] && out[`3${s}`] === undefined) {
      out[`3${s}`] = mirrorClaspOffsetSeedRow(out[`4${s}`], defaultKey);
    }
  }
  return out;
}

function buildClaspPositionOffsetByTooth(seedByTooth, defaultKey) {
  const expanded = expandClaspOffsetSeed(seedByTooth, defaultKey);
  const result = {};
  for (const toothId of CLASP_CIRC_ALL_TOOTH_IDS) {
    const seedRow = expanded[toothId] || {};
    const dflt = seedRow[defaultKey];
    const fb = {
      x: Number.isFinite(dflt?.x) ? dflt.x : 0,
      y: Number.isFinite(dflt?.y) ? dflt.y : 0,
    };
    const surfaces = {};
    for (const sur of CLASP_CIRC_SURFACE_ORDER) {
      const spec = seedRow[sur];
      surfaces[sur] = {
        x: Number.isFinite(spec?.x) ? spec.x : fb.x,
        y: Number.isFinite(spec?.y) ? spec.y : fb.y,
      };
    }
    result[toothId] = surfaces;
  }
  return Object.freeze(result);
}

const CLASP_CIRC_POSITION_OFFSET_BY_TOOTH = buildClaspPositionOffsetByTooth(
  CLASP_CIRC_POSITION_OFFSET_OVERRIDE_SEED_BY_TOOTH,
  "retainer-clasp"
);

const CLASP_CIRC_RENDER_SCALE = 0.48;

const CLASP_COMPONENT_IDS = new Set(["retainer-clasp", "reciprocating-clasp", "ring-clasp"]);

/** True for catalog clasp types (circumferential, bar, ring). */
export function isClaspComponent(componentOrId) {
  const id =
    typeof componentOrId === "object" && componentOrId !== null
      ? String(componentOrId.id || "")
      : String(componentOrId || "");
  return CLASP_COMPONENT_IDS.has(id);
}

export function isRetainerClaspComponent(componentOrId) {
  if (typeof componentOrId === "object" && componentOrId !== null) {
    return String(componentOrId.id || "") === "retainer-clasp";
  }
  return String(componentOrId || "") === "retainer-clasp";
}

export function isReciprocatingClaspComponent(componentOrId) {
  if (typeof componentOrId === "object" && componentOrId !== null) {
    return String(componentOrId.id || "") === "reciprocating-clasp";
  }
  return String(componentOrId || "") === "reciprocating-clasp";
}

export function isRingClaspComponent(componentOrId) {
  if (typeof componentOrId === "object" && componentOrId !== null) {
    return String(componentOrId.id || "") === "ring-clasp";
  }
  return String(componentOrId || "") === "ring-clasp";
}

export function getRetainerClaspSuggestionRadius() {
  return CLASP_CIRC_SUGGESTION_RADIUS;
}

/**
 * @param {string} toothId FDI
 * @param {string} jaw "upper" | "lower" (reserved; coordinates are per FDI row)
 */
export function getRetainerClaspSuggestionPointsForTooth(toothId, _jaw) {
  const row = CLASP_CIRC_POINT_OVERRIDES[String(toothId)];
  if (!row) return [];

  return CLASP_CIRC_SURFACE_ORDER.map((surface) => ({
    surface,
    x: row[surface].x,
    y: row[surface].y,
  }));
}

export function getRetainerClaspAssetReference(toothId, surface) {
  const normalized = normalizeClaspSurface(surface);
  if (!normalized) return null;
  const templateToothId = getComponentTemplateToothId(toothId);
  return `${CLASP_ASSET_BASE}/${templateToothId}/clasps/${templateToothId}-rc_${normalized}.svg`;
}

export function getReciprocatingClaspAssetReference(toothId, surface) {
  const normalized = normalizeClaspSurface(surface);
  if (!normalized) return null;
  const templateToothId = getComponentTemplateToothId(toothId);
  return `${CLASP_ASSET_BASE}/${templateToothId}/clasps/${templateToothId}-rpc_${normalized}.svg`;
}

export function getRingClaspAssetReference(toothId, surface) {
  const normalized = normalizeClaspSurface(surface);
  if (!normalized) return null;
  const templateToothId = getComponentTemplateToothId(toothId);
  return `${CLASP_ASSET_BASE}/${templateToothId}/clasps/${templateToothId}-rr_${normalized}.svg`;
}

const RING_CLASP_IMAGE_SIZE_OVERRIDE_BY_TOOTH = Object.freeze({
  "11": {
    distal_buccal: { width: 175, height: 180 },
    mesial_buccal: { width: 170, height: 170 },
    distal_lingual: { width: 180, height: 170 },
    mesial_lingual: { width: 170, height: 160 },
  },

  "12": {
    distal_buccal: { width: 165, height: 145 },
    mesial_buccal: { width: 170, height: 155 },
    distal_lingual: { width: 165, height: 150 },
    mesial_lingual: { width: 150, height: 145 },
  },

  "13": {
    distal_buccal: { width: 165, height: 145 },
    mesial_buccal: { width: 173, height: 152 },
    distal_lingual: { width: 170, height: 155 },
    mesial_lingual: { width: 210, height: 210 },
  },

  "14": {
    distal_buccal: { width: 175, height: 165 },
    mesial_buccal: { width: 180, height: 170 },
    distal_lingual: { width: 175, height: 170 },
    mesial_lingual: { width: 170, height: 160 },
  },

  "15": {
    distal_buccal: { width: 170, height: 160 },
    mesial_buccal: { width: 170, height: 175 },
    distal_lingual: { width: 170, height: 160 },
    mesial_lingual: { width: 172, height: 165 },
  },

  "16": {
    distal_buccal: { width: 245, height: 200 },
    mesial_buccal: { width: 250, height: 195 },
    distal_lingual: { width: 195, height: 195 },
    mesial_lingual: { width: 200, height: 205 },
  },

  "17": {
    distal_buccal: { width: 240, height: 165 },
    mesial_buccal: { width: 200, height: 175 },
    distal_lingual: { width: 185, height: 175 },
    mesial_lingual: { width: 185, height: 175 },
  },

  "18": {
    distal_buccal: { width: 180, height: 170 },
    mesial_buccal: { width: 185, height: 175 },
    distal_lingual: { width: 195, height: 165 },
    mesial_lingual: { width: 190, height: 180 },
  },

  "41": {
    distal_buccal: { width: 110, height: 95 },
    mesial_buccal: { width: 115, height: 110 },
    distal_lingual: { width: 110, height: 105 },
    mesial_lingual: { width: 105, height: 100 },
  },

  "42": {
    distal_buccal: { width: 105, height: 90 },
    mesial_buccal: { width: 110, height: 100 },
    distal_lingual: { width: 105, height: 100 },
    mesial_lingual: { width: 105, height: 100 },
  },

  "43": {
    distal_buccal: { width: 110, height: 105 },
    mesial_buccal: { width: 120, height: 100 },
    distal_lingual: { width: 110, height: 105 },
    mesial_lingual: { width: 115, height: 105 },
  },

  "44": {
    distal_buccal: { width: 155, height: 130 },
    mesial_buccal: { width: 135, height: 125 },
    distal_lingual: { width: 130, height: 130 },
    mesial_lingual: { width: 135, height: 130 },
  },

  "45": {
    distal_buccal: { width: 150, height: 135 },
    mesial_buccal: { width: 135, height: 130 },
    distal_lingual: { width: 140, height: 135 },
    mesial_lingual: { width: 155, height: 140 },
  },

  "46": {
    distal_buccal: { width: 205, height: 190 },
    mesial_buccal: { width: 185, height: 190 },
    distal_lingual: { width: 185, height: 190 },
    mesial_lingual: { width: 215, height: 195 },
  },

  "47": {
    distal_buccal: { width: 205, height: 170 },
    mesial_buccal: { width: 180, height: 160 },
    distal_lingual: { width: 175, height: 160 },
    mesial_lingual: { width: 185, height: 170 },
  },

  "48": {
    distal_buccal: { width: 175, height: 150 },
    mesial_buccal: { width: 160, height: 165 },
    distal_lingual: { width: 160, height: 170 },
    mesial_lingual: { width: 175, height: 155 },
  },
});

const RING_CLASP_POSITION_OFFSET_OVERRIDE_BY_TOOTH = Object.freeze({
  "11": {
  distal_buccal: { x: 17, y: 3 },
  mesial_buccal: { x: -18, y: 10 },
  distal_lingual: { x: 0, y: -18 },
  mesial_lingual: { x: -11, y: -19 },
},

"12": {
  distal_buccal: { x: 8, y: -3 },
  mesial_buccal: { x: -8, y: 7 },
  distal_lingual: { x: 0, y: -13.7 },
  mesial_lingual: { x: -11, y: -7 },
},

"13": {
  distal_buccal: { x: 6, y: -9 },
  mesial_buccal: { x: -8, y: 9 },
  distal_lingual: { x: -4, y: -13 },
  mesial_lingual: { x: -12, y: -4 },
},

"14": {
  distal_buccal: { x: 9, y: -9 },
  mesial_buccal: { x: 1, y: 9.7 },
  distal_lingual: { x: -3, y: -12 },
  mesial_lingual: { x: -11, y: 3 },
},

"15": {
  distal_buccal: { x: 11, y: -12 },
  mesial_buccal: { x: 3, y: 13 },
  distal_lingual: { x: -4, y: -13 },
  mesial_lingual: { x: -11.5, y: 4 },
},

"16": {
  distal_buccal: { x: 17, y: -18 },
  mesial_buccal: { x: 8, y: 23 },
  distal_lingual: { x: -10, y: -24 },
  mesial_lingual: { x: -19.5, y: 7 },
},

"17": {
  distal_buccal: { x: 14, y: -16 },
  mesial_buccal: { x: 9, y: 19 },
  distal_lingual: { x: -10, y: -16 },
  mesial_lingual: { x: -15, y: 8 },
},

"18": {
  distal_buccal: { x: 13, y: -17 },
  mesial_buccal: { x: 12, y: 16 },
  distal_lingual: { x: -12, y: -20 },
  mesial_lingual: { x: -18, y: 10 },
},

"41": {
  distal_buccal: { x: 9, y: -1 },
  mesial_buccal: { x: -11, y: -3 },
  distal_lingual: { x: 2, y: 15 },
  mesial_lingual: { x: -8.5, y: 15 },
},

"42": {
  distal_buccal: { x: 8, y: 0 },
  mesial_buccal: { x: -7, y: -4 },
  distal_lingual: { x: -1.5, y: 16 },
  mesial_lingual: { x: -13, y: 14 },
},

"43": {
  distal_buccal: { x: 10.5, y: 4.8 },
  mesial_buccal: { x: -9, y: -9 },
  distal_lingual: { x: -5.5, y: 16.5 },
  mesial_lingual: { x: -15.5, y: 11 },
},

"44": {
  distal_buccal: { x: 13.5, y: 6 },
  mesial_buccal: { x: -5, y: -15 },
  distal_lingual: { x: 0, y: 14 },
  mesial_lingual: { x: -16, y: -4.6 },
},

"45": {
  distal_buccal: { x: 11, y: 9 },
  mesial_buccal: { x: 0.2, y: -21 },
  distal_lingual: { x: -6, y: 17 },
  mesial_lingual: { x: -11.5, y: -9.7 },
},

"46": {
  distal_buccal: { x: 16, y: 15 },
  mesial_buccal: { x: 2.8, y: -30.5 },
  distal_lingual: { x: -6.5, y: 26 },
  mesial_lingual: { x: -15.5, y: -18.5 },
},

"47": {
  distal_buccal: { x: 13, y: 15 },
  mesial_buccal: { x: 6, y: -25 },
  distal_lingual: { x: -9.5, y: 25 },
  mesial_lingual: { x: -13.5, y: -19 },
},

"48": {
  distal_buccal: { x: 12, y: 20 },
  mesial_buccal: { x: 7, y: -21 },
  distal_lingual: { x: -6, y: 19.5 },
  mesial_lingual: { x: -10.7, y: -13 },
},
})

const RING_CLASP_POSITION_OFFSET_BY_TOOTH = buildClaspPositionOffsetByTooth(
  RING_CLASP_POSITION_OFFSET_OVERRIDE_BY_TOOTH,
  "ring-clasp"
);

export function getRingClaspPlacementImageSize(componentId, toothId, surface) {
  const norm = normalizeClaspSurface(surface);
  if (!norm) {
    return getRetainerClaspPlacementImageSize(componentId, toothId, surface);
  }
  const exactToothId = String(toothId ?? "");
  const templateToothId = getComponentTemplateToothId(toothId);
  const row =
    RING_CLASP_IMAGE_SIZE_OVERRIDE_BY_TOOTH[exactToothId] ??
    RING_CLASP_IMAGE_SIZE_OVERRIDE_BY_TOOTH[templateToothId];
  const box = row?.[norm];
  if (box && Number.isFinite(box.width) && Number.isFinite(box.height)) {
    return { width: box.width, height: box.height };
  }
  return getRetainerClaspPlacementImageSize(componentId, toothId, surface);
}

export function getRingClaspPlacementOffset(componentId, toothId, surface) {
  const base = getRetainerClaspPlacementOffset(componentId, toothId, surface);
  const norm = normalizeClaspSurface(surface);
  if (!norm) return base;
  const exactToothId = String(toothId ?? "");
  const templateToothId = getComponentTemplateToothId(toothId);
  const row =
    RING_CLASP_POSITION_OFFSET_BY_TOOTH[exactToothId] ??
    RING_CLASP_POSITION_OFFSET_BY_TOOTH[templateToothId];
  const ov = row?.[norm];
  if (!ov) return base;
  return {
    x: Number.isFinite(ov.x) ? ov.x : base.x,
    y: Number.isFinite(ov.y) ? ov.y : base.y,
  };
}

export function getRetainerClaspPlacementImageSize(_componentId, toothId, surface) {
  const norm = normalizeClaspSurface(surface);
  const templateToothId = getComponentTemplateToothId(toothId);
  const row = CLASP_CIRC_PLACEMENT_IMAGE_SIZE_BY_TOOTH[templateToothId];
  if (!row) {
    return CLASP_CIRC_IMAGE_DEFAULT;
  }
  if (norm) {
    const per = row[norm];
    if (per && Number.isFinite(per.width) && Number.isFinite(per.height)) {
      return { width: per.width, height: per.height };
    }
  }
  const box = row["retainer-clasp"];
  if (box && Number.isFinite(box.width) && Number.isFinite(box.height)) {
    return { width: box.width, height: box.height };
  }
  return CLASP_CIRC_IMAGE_DEFAULT;
}

export function getRetainerClaspPlacementOffset(_componentId, toothId, surface) {
  const norm = normalizeClaspSurface(surface);
  if (!norm) return { x: 0, y: 0 };
  const exactToothId = String(toothId ?? "");
  const templateToothId = getComponentTemplateToothId(toothId);
  const row =
    CLASP_CIRC_POSITION_OFFSET_BY_TOOTH[exactToothId] ??
    CLASP_CIRC_POSITION_OFFSET_BY_TOOTH[templateToothId];
  const o = row?.[norm] ?? { x: 0, y: 0 };
  return {
    x: Number.isFinite(o.x) ? o.x : 0,
    y: Number.isFinite(o.y) ? o.y : 0,
  };
}

export function getRetainerClaspPlacementRenderScale(_componentId, _toothId, _surface) {
  return CLASP_CIRC_RENDER_SCALE;
}

function normalizeClaspSurface(surface) {
  if (typeof surface !== "string") return null;
  const s = surface.toLowerCase();
  if (CLASP_CIRC_SURFACE_ORDER.includes(s)) return s;
  return null;
}

// ── Ball clasp ───────────────────────────────────────────────────────────────
// Sits in the embrasure between two teeth, not on one tooth's surface, so it stays out of
// CLASP_COMPONENT_IDS: it brings no reciprocation. It saves as Retainer Type 4 on the tooth
// behind its contact, so it shares that tooth's one retainer slot with a clasp, ring or bar.

export const BALL_CLASP_COMPONENT_ID = "ball-clasp";

/** A tooth's ball clasp is always at its mesial contact; 11's and 41's are the midlines. */
const BALL_CLASP_SURFACE = "mesial";

const BALL_CLASP_ASSET_BASE = "../../assets/RPD_Component/acrylic_clasps";

/** Art px -> arch units: sizes the ball and wire against the teeth as in the reference design. */
const BALL_CLASP_RENDER_SCALE = 0.42;

/**
 * The exported art, drawn for the screen-left side of each jaw (upper right, lower right):
 * `ball` is the ball centre and `end` the wire tip, in the art's own px. The screen-right
 * side (upper left, lower left) draws the same art mirrored.
 */
const BALL_CLASP_ART = Object.freeze({
  U_1M: { file: "Ball_U_1M.svg", width: 28, height: 111, ball: { x: 13.5, y: 13.5 }, end: { x: 18.5, y: 104.5 } },
  U_1D_2M: { file: "Ball_U_1D_2M.svg", width: 47, height: 95, ball: { x: 14.5, y: 14.5 }, end: { x: 45.5, y: 88.5 } },
  U_2D_3M: { file: "Ball_U_2D_3M.svg", width: 74, height: 90, ball: { x: 15.5, y: 15.5 }, end: { x: 70.5, y: 80.5 } },
  U_3D_4M: { file: "Ball_U_3D_4M.svg", width: 103, height: 79, ball: { x: 17.3, y: 25.1 }, end: { x: 96.6, y: 55.6 } },
  U_4D_5M: { file: "Ball_U_4D_5M.svg", width: 101, height: 53, ball: { x: 14.5, y: 15.5 }, end: { x: 96.5, y: 40.5 } },
  U_5D_6M: { file: "Ball_U_5D_6M.svg", width: 103, height: 47, ball: { x: 15.5, y: 15.5 }, end: { x: 98.5, y: 34.5 } },
  U_6D_7M: { file: "Ball_U_6D_7M.svg", width: 103, height: 47, ball: { x: 15.5, y: 15.5 }, end: { x: 98.5, y: 34.5 } },
  U_7D_8M: { file: "Ball_U_7D_8M.svg", width: 107, height: 55, ball: { x: 16.5, y: 21.6 }, end: { x: 100.7, y: 34.7 } },
  L_1M: { file: "Ball_L_1M.svg", width: 28, height: 81, ball: { x: 13.5, y: 67.5 }, end: { x: 18.5, y: 6.5 } },
  L_1D_2M: { file: "Ball_L_1D_2M.svg", width: 45, height: 84, ball: { x: 16.4, y: 66.9 }, end: { x: 40.0, y: 13.7 } },
  L_2D_3M: { file: "Ball_L_2D_3M.svg", width: 53, height: 79, ball: { x: 14.5, y: 63.5 }, end: { x: 38.5, y: 4.5 } },
  L_3D_4M: { file: "Ball_L_3D_4M.svg", width: 83, height: 75, ball: { x: 15.2, y: 57.2 }, end: { x: 74.8, y: 8.2 } },
  L_4D_5M: { file: "Ball_L_4D_5M.svg", width: 104, height: 58, ball: { x: 17.9, y: 40.8 }, end: { x: 89.6, y: 3.8 } },
  L_5D_6M: { file: "Ball_L_5D_6M.svg", width: 101, height: 43, ball: { x: 12.5, y: 29.5 }, end: { x: 93.5, y: 2.5 } },
  L_6D_7M: { file: "Ball_L_6D_7M.svg", width: 102, height: 45, ball: { x: 14.5, y: 29.5 }, end: { x: 98.5, y: 11.5 } },
  L_7D_8M: { file: "Ball_L_7D_8M.svg", width: 102, height: 45, ball: { x: 14.5, y: 29.5 }, end: { x: 98.5, y: 11.5 } },
});

/**
 * Each contact, keyed by the tooth behind it, which owns that contact's ball clasp — one
 * contact per tooth, matching the single Retainer Type slot. `ball` is where the ball centre
 * sits in the owner's tooth-local frame, fitted per contact on the rendered arch so the wire
 * runs through the contact and the ball sits in the buccal embrasure; neither arch is an
 * exact mirror of itself.
 */
const BALL_CLASP_BY_OWNER = Object.freeze({
  "11": { art: "U_1M", ball: { x: 29.6, y: -29.7 } },
  "12": { art: "U_1D_2M", ball: { x: 13.2, y: -30.2 } },
  "13": { art: "U_2D_3M", ball: { x: 3.7, y: -31.1 } },
  "14": { art: "U_3D_4M", ball: { x: -8.8, y: -31.8 } },
  "15": { art: "U_4D_5M", ball: { x: -14.4, y: -31.2 } },
  "16": { art: "U_5D_6M", ball: { x: -18.7, y: -38.6 } },
  "17": { art: "U_6D_7M", ball: { x: -20.8, y: -34.8 } },
  "18": { art: "U_7D_8M", ball: { x: -22.3, y: -32.0 } },
  "22": { art: "U_1D_2M", ball: { x: -11.7, y: -30.2 } },
  "23": { art: "U_2D_3M", ball: { x: -4.4, y: -31.2 } },
  "24": { art: "U_3D_4M", ball: { x: 11.1, y: -31.0 } },
  "25": { art: "U_4D_5M", ball: { x: 14.6, y: -31.8 } },
  "26": { art: "U_5D_6M", ball: { x: 20.4, y: -38.4 } },
  "27": { art: "U_6D_7M", ball: { x: 21.7, y: -35.4 } },
  "28": { art: "U_7D_8M", ball: { x: 22.7, y: -32.3 } },
  "41": { art: "L_1M", ball: { x: 15.2, y: 19.4 } },
  "42": { art: "L_1D_2M", ball: { x: 10.7, y: 22.2 } },
  "43": { art: "L_2D_3M", ball: { x: 10.1, y: 23.6 } },
  "44": { art: "L_3D_4M", ball: { x: 3.9, y: 29.6 } },
  "45": { art: "L_4D_5M", ball: { x: -5.0, y: 31.4 } },
  "46": { art: "L_5D_6M", ball: { x: -5.9, y: 41.6 } },
  "47": { art: "L_6D_7M", ball: { x: -12.2, y: 36.7 } },
  "48": { art: "L_7D_8M", ball: { x: -13.6, y: 34.6 } },
  "32": { art: "L_1D_2M", ball: { x: -9.9, y: 21.9 } },
  "33": { art: "L_2D_3M", ball: { x: -9.4, y: 23.2 } },
  "34": { art: "L_3D_4M", ball: { x: -3.5, y: 29.1 } },
  "35": { art: "L_4D_5M", ball: { x: 5.2, y: 30.9 } },
  "36": { art: "L_5D_6M", ball: { x: 5.9, y: 41.5 } },
  "37": { art: "L_6D_7M", ball: { x: 12.3, y: 36.3 } },
  "38": { art: "L_7D_8M", ball: { x: 13.7, y: 34.3 } },
});

/** The owner's ball clasp spot, or null when `surface` is not its contact. */
function ballClaspSpot(toothId, surface) {
  return surface === BALL_CLASP_SURFACE ? BALL_CLASP_BY_OWNER[String(toothId)] || null : null;
}

export function isBallClaspComponent(componentOrId) {
  const id =
    typeof componentOrId === "object" && componentOrId !== null
      ? String(componentOrId.id || "")
      : String(componentOrId || "");
  return id === BALL_CLASP_COMPONENT_ID;
}

/** A clasp, ring or bar: the retentive elements a ball clasp shares Retainer Type with. */
export function isBallClaspRetainerRival(componentOrId) {
  return (
    isRetainerClaspComponent(componentOrId) ||
    isRingClaspComponent(componentOrId) ||
    isBarComponent(componentOrId)
  );
}

/** The surface a tooth holds a ball clasp on — none for 21 and 31 (the midlines are 11's and 41's). */
export function getBallClaspSurfacesForTooth(toothId) {
  return BALL_CLASP_BY_OWNER[String(toothId)] ? [BALL_CLASP_SURFACE] : [];
}

/** The tooth across the contact a ball clasp on `toothId` / `surface` sits in. */
export function getBallClaspPartnerToothId(toothId, surface) {
  if (!ballClaspSpot(toothId, surface)) return null;
  const id = String(toothId);
  const jaw = TOOTH_ORDER.upper.includes(id) ? "upper" : "lower";
  return getNeighborToothIds(id, jaw)[surface] || null;
}

/** A ball clasp engages the contact between two teeth, so both must be present. */
export function canPlaceBallClasp(teethById, toothId, surface) {
  const partnerId = getBallClaspPartnerToothId(toothId, surface);
  return Boolean(
    partnerId && teethById?.[String(toothId)]?.isPresent && teethById?.[partnerId]?.isPresent
  );
}

/**
 * One ball clasp's art in its owner's tooth-local frame: translate to (x, y), flip when
 * `mirrored`, then draw `image`. `wireEnd` is relative to the ball, for a hit line along it.
 */
export function getBallClaspVisual(toothId, surface) {
  const spot = ballClaspSpot(toothId, surface);
  const art = spot ? BALL_CLASP_ART[spot.art] : null;
  if (!art) return null;
  const s = BALL_CLASP_RENDER_SCALE;
  return {
    href: `${BALL_CLASP_ASSET_BASE}/${art.file}`,
    x: spot.ball.x,
    y: spot.ball.y,
    // upper left (2x) and lower left (3x) are the screen-right side
    mirrored: /^[23]/.test(String(toothId)),
    image: { x: -art.ball.x * s, y: -art.ball.y * s, width: art.width * s, height: art.height * s },
    wireEnd: { x: (art.end.x - art.ball.x) * s, y: (art.end.y - art.ball.y) * s },
  };
}

/** Drops ball clasps whose embrasure lost a tooth: presence is edited with the jaw unlocked. */
export function pruneInvalidBallClaspPlacementsInJaw(teethById, jaw) {
  for (const toothId of TOOTH_ORDER[jaw] || []) {
    const tooth = teethById?.[toothId];
    if (!tooth || !Array.isArray(tooth.componentPlacements)) continue;
    const next = tooth.componentPlacements.filter(
      (entry) =>
        !isBallClaspComponent(entry?.componentId) || canPlaceBallClasp(teethById, toothId, entry.surface)
    );
    if (next.length === tooth.componentPlacements.length) continue;
    tooth.componentPlacements = next;
    if (!next.some((entry) => isBallClaspComponent(entry.componentId)) && Array.isArray(tooth.components)) {
      tooth.components = tooth.components.filter((id) => !isBallClaspComponent(id));
    }
  }
}
