/**
 * Jaw-struct text <-> JS codec (pure / DOM-free / Node-testable). One base64 record per
 * jaw of flat "Tooth N: <field>: <value>" lines; enums live in jawStructCodes.js.
 * Pipeline: decodeJawStructResponse() -> resolveJawStructDesign() -> jawStructApply.js.
 *
 * Enum traps (StructData.cs, validated against samples):
 *   - Tooth_Presence: present=0, missing=1 (NOT the reverse)
 *   - Retainer is composite (Retainer Type + Retainer Bar Category)
 *   - Mesh is stored as spans, applied across array indices start..end
 */
import {
  POSTERIOR_REST_TYPE,
  RETAINER_TYPE,
  RETAINER_BAR_CATEGORY,
  RECIPROCATING_TYPE,
  MESH_TYPE,
  MAJOR_CONNECTOR_TYPE,
  TOOTH_CONDITION,
  inverseOf,
} from "./jawStructCodes.js";
import { safeAtob } from "./dotnetBinaryFormatter.js";

const PRESENCE_FIELD = "Tooth Main.Tooth Index.Tooth Presence";
const CONDITION_FIELD = "Tooth Main.Tooth Index.Tooth Condition";
const MAJOR_INDEX_FIELD = "Tooth Main.Tooth Index.Major Index";
const MINOR_INDEX_FIELD = "Tooth Main.Tooth Index.Minor Index";
const POSTERIOR_REST_FIELD = "Tooth Main.Tooth Rest.Posterior Rest Type";
const RETAINER_TYPE_FIELD = "Tooth Main.Tooth Retainer.Retainer Type";
const RETAINER_BAR_CATEGORY_FIELD = "Tooth Main.Tooth Retainer.Retainer Bar Category";
const RETAINER_BAR_TYPE_FIELD = "Tooth Main.Tooth Retainer.Retainer Bar Type";
const RETAINER_CLASP_TYPE_FIELD = "Tooth Main.Tooth Retainer.Retainer Clasp Type";
const RETAINER_RING_TYPE_FIELD = "Tooth Main.Tooth Retainer.Retainer Ring Type";
const RECIPROCATING_FIELD = "Tooth Main.Tooth Reciprocating.Tooth Type";
const RECIPROCATING_PATTERN_FIELD = "Tooth Main.Tooth Reciprocating.Tooth Pattern Type";
const ANTERIOR_REST_FIELD = "Tooth Main.Tooth Rest.Anterior Rest";
const ANTERIOR_CINGULUM_FIELD = "Tooth Main.Tooth Rest.Anterior Cingulum Rest Type";
const ANTERIOR_INCISAL_FIELD = "Tooth Main.Tooth Rest.Anterior Incisal Rest Type";
const PR_CONFIG_FIELDS = [
  "Tooth Main.Tooth Rest.Pr Config 0",
  "Tooth Main.Tooth Rest.Pr Config 1",
  "Tooth Main.Tooth Rest.Pr Config 2",
];

// Maps the desktop's position/orientation fields to the renderer's surface vocabulary
// (null-surface markers are skipped). Pr Config index ("0" = present) -> rest surface.
const REST_POSITION_SURFACE = ["mesial", "distal", "lingual"];
// Retainer_Clasp_type / Retainer_Ring_type (0..3) -> clasp anchor surface.
const CLASP_ORIENT_SURFACE = ["mesial_buccal", "mesial_lingual", "distal_buccal", "distal_lingual"];

// "Implied plating": a plate/strap/horseshoe major stamps reciprocating=2 on EVERY present
// tooth (lingual bar(6) plates none). Decoded into real removable plate-prox.

const JAW_TYPE_KEY = "Jaw Type";
const MAJOR_CONNECTOR_KEY = "Major Connector Type";
// Denture-base material: 0 = metal, 2 = full acrylic. The acrylic flange has no Mesh_Type
// of its own (encodes as 0) and is rebuilt onto the missing saddle teeth on load.
const JAW_MATERIAL_KEY = "Jaw Material";

// Tooth_Presence enum: present=0, missing=1.
const PRESENCE_PRESENT = "0";

/** Tolerant base64 decode (mirrors safeAtob in clinicalInfo.js). */
/**
 * Parse one jaw's text body into { teeth: { idx: { fields } }, meshes, other },
 * where idx is the per-jaw array index (0..15), NOT the FDI id.
 */
export function parseJawStructText(text) {
  const teeth = {};
  const meshes = [];
  const other = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line === "End of Jaw Struct") continue;
    if (line.startsWith("Start of Jaw Struct")) continue;

    const meshMatch = line.match(/^Tooth Mesh (\d+): (.+?): (.+)$/);
    if (meshMatch) {
      const idx = Number(meshMatch[1]);
      meshes[idx] = meshes[idx] || {};
      meshes[idx][meshMatch[2]] = meshMatch[3];
      continue;
    }

    const toothMatch = line.match(/^Tooth (\d+): (.+?): (.+)$/);
    if (toothMatch) {
      const idx = Number(toothMatch[1]);
      teeth[idx] = teeth[idx] || { fields: {} };
      teeth[idx].fields[toothMatch[2]] = toothMatch[3];
      continue;
    }

    const colon = line.indexOf(":");
    if (colon > 0) {
      other[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return { teeth, meshes, other };
}

/**
 * Decode the array returned by POST /jawstruct/l2/getall.
 * Returns { upper, lower, raw } where upper/lower are parsed jaws (or null).
 */
export function decodeJawStructResponse(records) {
  const out = { upper: null, lower: null, raw: {} };
  if (!Array.isArray(records)) return out;
  for (const record of records) {
    if (!record?.data) continue;
    const text = safeAtob(record.data);
    if (text == null) {
      console.warn("[jawStructCodec] base64 decode failed for", record.type);
      continue;
    }
    const parsed = parseJawStructText(text);
    out.raw[record.type || "unknown"] = parsed;
    if (record.type === "upper_jaw") out.upper = parsed;
    else if (record.type === "lower_jaw") out.lower = parsed;
  }
  return out;
}

/** The denture-base material a decoded design was saved with (either jaw carries it):
 *  0 = metal, 2 = full acrylic, or null when neither jaw has the field. */
export function decodedJawMaterial(decoded) {
  const value = Number(
    decoded?.upper?.other?.[JAW_MATERIAL_KEY] ?? decoded?.lower?.other?.[JAW_MATERIAL_KEY]
  );
  return Number.isFinite(value) ? value : null;
}

/** Derive FDI tooth id from a parsed tooth record. Returns string or null. */
function fdiFromTooth(tooth) {
  const major = Number(tooth?.fields?.[MAJOR_INDEX_FIELD]);
  const minor = Number(tooth?.fields?.[MINOR_INDEX_FIELD]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
  return `${major}${minor}`;
}

/**
 * Rest surfaces from Pr Config. The triple is one flag PER POSITION (mesial/distal/
 * lingual, 0 = present), not an enum, so a tooth can carry several. Defaults to mesial.
 */
function restSurfacesFromConfig(f) {
  const surfaces = REST_POSITION_SURFACE.filter((_, i) => f[PR_CONFIG_FIELDS[i]] === "0");
  return surfaces.length ? surfaces : ["mesial"];
}

/**
 * Pr Config triple (0 = present) for posterior rests — inverse of restSurfacesFromConfig.
 * Derived live on Save because the surface is web-owned, else surface edits are dropped.
 */
function prConfigFromSurfaces(surfaces) {
  const present = new Set();
  for (const surface of surfaces) {
    const idx = REST_POSITION_SURFACE.indexOf(String(surface ?? "").toLowerCase());
    if (idx >= 0) present.add(idx);
  }
  if (!present.size) present.add(0);
  return REST_POSITION_SURFACE.map((_, i) => (present.has(i) ? 0 : 1));
}

/** Clasp anchor surface from a Retainer Clasp/Ring Type field (default mesial_buccal). */
function claspSurfaceFromField(f, field) {
  return CLASP_ORIENT_SURFACE[Number(f[field])] || "mesial_buccal";
}

/**
 * Retainer Clasp/Ring Type (0..3) from a surface — inverse of claspSurfaceFromField
 * (unknown -> 0). Derived live, or a web-owned surface edit reopens as the loaded value.
 */
function claspFieldFromSurface(surface) {
  const idx = CLASP_ORIENT_SURFACE.indexOf(String(surface ?? "").toLowerCase());
  return idx < 0 ? 0 : idx;
}

// The reci clasp sits OPPOSITE the retentive one at the SAME corner; the desktop stores no
// orientation. Do NOT add a quadrant flip — the renderer mirrors Q2/Q3 and would cancel it.
function reciprocalClaspSurface(retainerSurface) {
  let s = String(retainerSurface);
  if (s.includes("buccal")) s = s.replace("buccal", "lingual");
  else if (s.includes("lingual")) s = s.replace("lingual", "buccal");
  return s;
}

// KNOWN LOSS: the format carries no reciprocal corner, so Back-action and Half & Half reopen
// arch-flipped. Do NOT smuggle it into patterntype — the DLL reads that as a shape.

/**
 * Anterior rest -> rest-seat surface, or null when none.
 * Anterior_Rest: 1=cingulum (lingual_mesial/lingual_distal), 2=incisal (mesial/distal).
 */
function anteriorRestSurface(f) {
  const ar = Number(f[ANTERIOR_REST_FIELD]);
  if (ar === 1) {
    // Anterior_Cingulum_Rest_Type: ac_full=0, ac_mesial=1, ac_distal=2, ac_both=3, keyed by
    // surface. ac_both art is lower-arch only; the upper falls back to ac_full.
    const ac = Number(f[ANTERIOR_CINGULUM_FIELD]);
    if (ac === 1) return "lingual_mesial";
    if (ac === 2) return "lingual_distal";
    if (ac === 3) return "lingual_both";
    return "lingual"; // 0 -> full cingulum coverage
  }
  if (ar === 2) {
    // Anterior_Incisal_Rest_Type: ai_mesial=0, ai_distal=1
    return Number(f[ANTERIOR_INCISAL_FIELD]) === 1 ? "distal" : "mesial";
  }
  return null;
}

/** Jaw side from the "Jaw Type" header (0=upper, 1=lower). Null if absent. */
function jawSideFromParsed(parsed) {
  const jt = parsed?.other?.[JAW_TYPE_KEY];
  if (jt === "0") return "upper";
  if (jt === "1") return "lower";
  return null;
}

// Maps the saved major-connector slot ranges to the FDIs they cover, unioning connectors
// 1 and 2. Returns undefined when neither is valid (from-scratch designs).
function majorSpanFdisFromParsed(other, idxToFdi) {
  if (!other || !idxToFdi) return undefined;
  const ranges = [
    [other["Major Connector 1 Start"], other["Major Connector 1 End"]],
    [other["Major Connector 2 Start"], other["Major Connector 2 End"]],
  ];
  const slots = new Set();
  let sawRange = false;
  for (const [s, e] of ranges) {
    const start = Number(s);
    const end = Number(e);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // [0,0] is the desktop's "no connector" sentinel, NOT a real span over slot 0 (the
    // 3rd molar) — treating it as real drew a spurious connector arm onto 18/38.
    if (start === 0 && end === 0) continue;
    sawRange = true;
    for (let i = Math.min(start, end); i <= Math.max(start, end); i += 1) {
      slots.add(String(i));
    }
  }
  if (!sawRange) return undefined;
  const fdis = [];
  for (const slot of slots) if (idxToFdi[slot]) fdis.push(idxToFdi[slot]);
  return fdis.length ? fdis : undefined;
}

/** Track unmapped codes so we can catalog what's missing from jawStructCodes.js. */
const _unmappedSeen = new Set();
function reportUnmapped(fieldPath, code) {
  const key = `${fieldPath}=${code}`;
  if (_unmappedSeen.has(key)) return;
  _unmappedSeen.add(key);
  console.warn(`[jawStructCodec] unmapped code for "${fieldPath}": ${code}`);
}

/**
 * Resolve a parsed jaw into a normalized, render-agnostic design consumed by
 * jawStructApply.js. Pure: no DOM, no annotation-state mutation.
 * @returns {{jawSide, teeth, mesh, major, rawByFdi}} rawByFdi is kept for round-trip.
 */
export function resolveJawStructDesign(parsed) {
  const design = {
    jawSide: jawSideFromParsed(parsed),
    teeth: {},
    mesh: [],
    major: null,
    rawByFdi: {},
    // Jaw-level loaded values (Minor Connector grid, Ball Connector flags, etc.)
    // the web doesn't model — preserved so Save can re-emit them.
    rawOther: parsed?.other || {},
  };
  if (!parsed?.teeth) return design;

  // array index (0..15) -> FDI, derived from the data itself (robust vs hardcoding).
  const idxToFdi = {};
  for (const [idx, tooth] of Object.entries(parsed.teeth)) {
    const fdi = fdiFromTooth(tooth);
    if (fdi) idxToFdi[idx] = fdi;
  }

  for (const tooth of Object.values(parsed.teeth)) {
    const fdi = fdiFromTooth(tooth);
    if (!fdi) continue;
    const f = tooth.fields || {};
    design.rawByFdi[fdi] = { ...f };

    const present = f[PRESENCE_FIELD] === PRESENCE_PRESENT;
    // Select Teeth status (abutment/compromised); null = plain presence.
    const condition = TOOTH_CONDITION.get(Number(f[CONDITION_FIELD])) ?? null;
    // placements: rests/clasps with their anchor surface; bars: shape ids whose
    // surface is computed from arch geometry at apply time.
    const entry = { present, condition, placements: [], bars: [] };
    design.teeth[fdi] = entry;
    if (!present) continue; // components live on present (abutment) teeth only

    // Posterior rest — surface from Pr Config (mesial/distal/lingual).
    const prCode = Number(f[POSTERIOR_REST_FIELD]);
    if (Number.isFinite(prCode) && prCode > 0) {
      const id = POSTERIOR_REST_TYPE.get(prCode);
      if (id === "rest-seat") {
        // One seat per flagged position — a double-rested tooth flags two.
        for (const surface of restSurfacesFromConfig(f)) {
          entry.placements.push({ componentId: id, surface });
        }
      } else if (id) {
        // rest-onlay (pr_full) covers the whole occlusal surface: always one.
        entry.placements.push({ componentId: id, surface: restSurfacesFromConfig(f)[0] });
      } else reportUnmapped(POSTERIOR_REST_FIELD, prCode);
    }

    // Anterior rest (cingulum/incisal) — rendered as rest-seat on a cingulum/incisal surface.
    const arSurface = anteriorRestSurface(f);
    if (arSurface) entry.placements.push({ componentId: "rest-seat", surface: arSurface });

    // Retainer (composite): clasp/ring carry an orientation surface; bar shape
    // comes from Retainer Bar Category.
    const retCode = Number(f[RETAINER_TYPE_FIELD]);
    if (Number.isFinite(retCode) && retCode > 0) {
      if (retCode === 3) {
        const barCode = Number(f[RETAINER_BAR_CATEGORY_FIELD]);
        const barId = RETAINER_BAR_CATEGORY.get(barCode);
        if (barId) entry.bars.push(barId);
        else reportUnmapped(RETAINER_BAR_CATEGORY_FIELD, barCode);
      } else {
        const id = RETAINER_TYPE.get(retCode);
        if (id === "ball-clasp") {
          // A tooth's ball clasp always sits at its mesial contact, so it carries no orientation.
          entry.placements.push({ componentId: id, surface: "mesial" });
        } else if (id === "adams-clasp") {
          // Wraps the whole tooth: no surface.
          entry.placements.push({ componentId: id, surface: null });
        } else if (id === "roach-clasp") {
          // Placed as a Y bar, so its surface comes from the arch like the bars'.
          entry.bars.push(id);
        } else if (id) {
          const orientField = retCode === 2 ? RETAINER_RING_TYPE_FIELD : RETAINER_CLASP_TYPE_FIELD;
          entry.placements.push({ componentId: id, surface: claspSurfaceFromField(f, orientField) });
        } else reportUnmapped(RETAINER_TYPE_FIELD, retCode);
      }
    }

    // Reciprocating.Tooth Type: 1=reciprocating-clasp, 2=plate-prox, 3=plate-crossmesh.
    // DATA-DRIVEN — each becomes a real erasable component, so implied plating is removable.
    const recipId = RECIPROCATING_TYPE.get(Number(f[RECIPROCATING_FIELD]));
    if (recipId) {
      // Derive from the retentive clasp (reciprocalClaspSurface); hardcoding mesial_lingual
      // made every loaded reci clasp read linguo-mesial. A plate keeps a null surface.
      let surface = null;
      if (recipId === "reciprocating-clasp") {
        const orientField =
          Number(f[RETAINER_TYPE_FIELD]) === 2 ? RETAINER_RING_TYPE_FIELD : RETAINER_CLASP_TYPE_FIELD;
        surface = reciprocalClaspSurface(claspSurfaceFromField(f, orientField));
      }
      entry.placements.push({ componentId: recipId, surface });
    }
  }

  // Mesh spans -> mesh component across array indices start..end (missing teeth).
  if (Array.isArray(parsed.meshes)) {
    for (const span of parsed.meshes) {
      if (!span) continue;
      const mt = Number(span["Mesh Type"]);
      const start = Number(span["Start Index"]);
      const end = Number(span["End Index"]);
      if (!Number.isFinite(mt) || mt === 0) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) continue;
      const meshId = MESH_TYPE.get(mt);
      if (!meshId) {
        reportUnmapped("Mesh Type", mt);
        continue;
      }
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const fdis = [];
      for (let i = lo; i <= hi; i += 1) {
        if (idxToFdi[i]) fdis.push(idxToFdi[i]);
      }
      if (fdis.length) design.mesh.push({ componentId: meshId, fdis });
    }
  }

  // The acrylic flange has no Mesh_Type of its own (encodes as 0), so on load it flanges
  // every missing saddle tooth 7-to-7 (no third molars) not already covered by a span.
  if (Number(parsed?.other?.[JAW_MATERIAL_KEY]) === 2) {
    const meshed = new Set(design.mesh.flatMap((m) => m.fdis));
    const flangeFdis = [];
    for (const [fdi, entry] of Object.entries(design.teeth)) {
      if (entry.present || meshed.has(fdi)) continue;
      if (Number(fdi) % 10 === 8) continue; // third molars sit outside the acrylic 7-to-7 span
      flangeFdis.push(fdi);
    }
    if (flangeFdis.length) design.mesh.push({ componentId: "mesh-flange", fdis: flangeFdis });
  }

  // Major connector (jaw-level).
  const mcCode = Number(parsed?.other?.[MAJOR_CONNECTOR_KEY]);
  if (Number.isFinite(mcCode) && mcCode > 0) {
    const id = MAJOR_CONNECTOR_TYPE.get(mcCode);
    if (id) design.major = id;
    else reportUnmapped(MAJOR_CONNECTOR_KEY, mcCode);
  }

  // Exact major coverage from the saved slot ranges (Major Connector 1/2 Start/End),
  // unioned to FDIs. Absent -> undefined, so from-scratch falls back to arch-fill.
  if (design.major) {
    design.majorSpanFdis = majorSpanFdisFromParsed(parsed?.other, idxToFdi);
  }

  return design;
}

// ---- Encode: web state -> complete jaw-struct text -----------------------
// HYBRID encoder emitting the full desktop field set: web-owned fields derive live from
// placements, the rest is preserved via `rawOr`. load->Save is byte-identical but the stamp.

// Array slot -> FDI, per StructData.cs get_array_index (major 1/3 reversed).
const UPPER_FDI_ORDER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_FDI_ORDER = [38, 37, 36, 35, 34, 33, 32, 31, 41, 42, 43, 44, 45, 46, 47, 48];

function componentList(rec) {
  return Array.isArray(rec?.components) ? rec.components : [];
}

// Contiguous same-type runs of mesh-bearing teeth -> mesh spans for the tail.
function buildMeshSpans(state, fdiOrder) {
  const spans = [];
  let cur = null;
  fdiOrder.forEach((fdi, idx) => {
    const meshId = componentList(state.teeth?.[fdi]).find((id) => String(id).startsWith("mesh-"));
    const mt = meshId ? inverseOf(MESH_TYPE).get(meshId) ?? 0 : 0;
    if (mt > 0 && cur && cur.meshType === mt && idx === cur.end + 1) {
      cur.end = idx;
    } else if (mt > 0) {
      cur = { meshType: mt, start: idx, end: idx };
      spans.push(cur);
    } else {
      cur = null;
    }
  });
  return spans.slice(0, 8);
}

function majorConnectorCode(state, fdiOrder) {
  for (const fdi of fdiOrder) {
    const majId = componentList(state.teeth?.[fdi]).find((id) => String(id).startsWith("major-"));
    if (majId) return inverseOf(MAJOR_CONNECTOR_TYPE).get(majId) ?? 0;
  }
  return 0;
}

// Connector-1/2 slot spans from the teeth carrying a major-*: contiguous runs become the
// two connectors so the loader reads back exactly the placed teeth. No major -> 0/0.
function majorConnectorSpans(state, fdiOrder) {
  const slots = [];
  fdiOrder.forEach((fdi, idx) => {
    if (componentList(state.teeth?.[fdi]).some((id) => String(id).startsWith("major-"))) {
      slots.push(idx);
    }
  });
  if (!slots.length) return { c1: [0, 0], c2: [0, 0] };
  const runs = [];
  for (const s of slots) {
    const last = runs[runs.length - 1];
    if (last && s === last[1] + 1) last[1] = s;
    else runs.push([s, s]);
  }
  if (runs.length === 1) return { c1: runs[0], c2: runs[0] };
  if (runs.length === 2) return { c1: runs[0], c2: runs[1] };
  // >2 runs: can't represent exactly in two connectors — use the overall span.
  const bound = [slots[0], slots[slots.length - 1]];
  return { c1: bound, c2: bound };
}

// The lower lingual plate-vs-bar SHAPE lives in the 16x16 Minor Connector grid, not the type:
// a PLATE routes Path D (6/7), a BAR Path G (12/13). Re-routed on switch; idempotent.
function normalizeLingualGridForType(tail, mcCode) {
  if (mcCode !== 6 && mcCode !== 7) return tail;
  const out = { ...tail };
  const key = (n, p) => `Minor Connector ${n} Path Index ${p}`;
  const active = (n, p) => String(out[key(n, p)]) === "0";
  const reroute = (n, fromD, fromM, toD, toM) => {
    if (active(n, fromD)) { out[key(n, fromD)] = 1; out[key(n, toD)] = 0; }
    if (active(n, fromM)) { out[key(n, fromM)] = 1; out[key(n, toM)] = 0; }
  };
  for (let n = 0; n < 16; n += 1) {
    if (mcCode === 7) reroute(n, 12, 13, 6, 7);   // Path G -> Path D (plate)
    else reroute(n, 6, 7, 12, 13);                 // Path D -> Path G (bar)
  }
  return out;
}

function encodeToothLines(arrayIdx, fdi, rec, hasMesh) {
  // Loaded per-tooth fields. The web can't model positions, Pr Config, bar side, clasp
  // orientation or the reciprocating flag, so those fall back; the rest derive live.
  const raw = rec?.rawJawStructFields || {};
  const rawOr = (field, fallback) => (field in raw ? raw[field] : fallback);

  const maj = Math.floor(fdi / 10);
  const min = fdi % 10;
  const toothType = min < 4 ? 1 : 0;       // Tooth_Type: anterior=1, posterior=0
  const present = rec?.isPresent ? 0 : 1;  // Tooth_Presence: present=0, missing=1
  const condition = inverseOf(TOOTH_CONDITION).get(rec?.status) ?? 0; // 0 = normal
  const comps = componentList(rec);
  const placements = Array.isArray(rec?.componentPlacements) ? rec.componentPlacements : [];

  // The web's single rest-seat splits into the desktop's Anterior Rest vs Posterior Rest
  // Type, chosen by placement surface + tooth type.
  let posteriorRest = 0;
  let anteriorRest = 0;
  let antCingulum = Number(rawOr(ANTERIOR_CINGULUM_FIELD, 0));
  let antIncisal = Number(rawOr(ANTERIOR_INCISAL_FIELD, 0));
  const restPlacements = placements.filter(
    (p) => p.componentId === "rest-seat" || p.componentId === "rest-onlay"
  );
  // The rest TYPE is the same for every seat on a tooth; only Pr Config below
  // distinguishes how many positions are seated.
  const restPl = restPlacements[0];
  if (restPl) {
    const s = String(restPl.surface || "");
    if (restPl.componentId === "rest-onlay") {
      posteriorRest = 1; // pr_full
    } else if (min < 4 && (s === "lingual" || s === "lingual_mesial" || s === "lingual_distal" || s === "lingual_both")) {
      anteriorRest = 1; // cingulum (full / mesial / distal / both — anterior teeth only)
      if (!(ANTERIOR_CINGULUM_FIELD in raw)) {
        antCingulum = s === "lingual_distal" ? 2 : s === "lingual_mesial" ? 1 : s === "lingual_both" ? 3 : 0; // "lingual" -> full
      }
    } else if (min < 4) {
      anteriorRest = 2; // incisal (mesial/distal on an anterior tooth)
      if (!(ANTERIOR_INCISAL_FIELD in raw)) antIncisal = s === "distal" ? 1 : 0;
    } else {
      posteriorRest = 2; // pr_non_full (posterior mesial/distal/lingual rest)
    }
  }

  // Pr Config rest-position flags: derived live for a posterior non-full rest (web-owned
  // surface), otherwise the loaded raw value, to keep round-trip fidelity.
  const prConfig =
    posteriorRest === 2 && restPl
      ? prConfigFromSurfaces(restPlacements.map((p) => p.surface))
      : [
          rawOr("Tooth Main.Tooth Rest.Pr Config 0", posteriorRest === 2 ? 0 : 1),
          rawOr("Tooth Main.Tooth Rest.Pr Config 1", 1),
          rawOr("Tooth Main.Tooth Rest.Pr Config 2", 1),
        ];

  // Retainer: type + bar shape (category) are web-owned (derived live). The bar
  // mesial/distal side, clasp/ring orientation come from the loaded data. The ball, Adams,
  // acrylic and Roach clasps are 4–7.
  let retainerType = 0;
  let barCategory = Number(rawOr(RETAINER_BAR_CATEGORY_FIELD, 0));
  const barId = comps.find((id) => String(id).startsWith("bar-"));
  if (comps.includes("retainer-clasp")) retainerType = 1;
  else if (comps.includes("ring-clasp")) retainerType = 2;
  else if (barId) {
    retainerType = 3;
    barCategory = inverseOf(RETAINER_BAR_CATEGORY).get(barId) ?? barCategory;
  } else if (comps.includes("ball-clasp")) retainerType = 4;
  else if (comps.includes("adams-clasp")) retainerType = 5;
  else if (comps.includes("acrylic-clasp")) retainerType = 6;
  else if (comps.includes("roach-clasp")) retainerType = 7;
  // Derived live from the RETENTIVE clasp's surface so edits persist (the reci's is derived
  // from it on decode). Falls back to loaded raw, or 0, only when nothing is placed.
  // The acrylic clasp is a circumferential retainer too, so it stores its side the same way.
  const retainerClaspPl = placements.find(
    (p) => p.componentId === "retainer-clasp" || p.componentId === "acrylic-clasp"
  );
  const ringClaspPl = placements.find((p) => p.componentId === "ring-clasp");
  const claspType = retainerClaspPl
    ? claspFieldFromSurface(retainerClaspPl.surface)
    : rawOr(RETAINER_CLASP_TYPE_FIELD, 0);
  const ringType = ringClaspPl
    ? claspFieldFromSurface(ringClaspPl.surface)
    : rawOr(RETAINER_RING_TYPE_FIELD, 0);

  // Bar side: loaded value wins; else derive from the placement surface.
  let barType = Number(rawOr(RETAINER_BAR_TYPE_FIELD, 0));
  if (!(RETAINER_BAR_TYPE_FIELD in raw) && barId) {
    const barPl = placements.find((p) => p.componentId === barId);
    barType = barPl && String(barPl.surface || "").includes("distal") ? 1 : 0;
  }

  // Derived PURELY from the placed component so removals persist: 1=reciprocating-clasp,
  // 2=plate-prox, 3=plate-crossmesh, 0=none. The connector switch keeps them in step.
  let reciprocatingType;
  if (comps.includes("reciprocating-clasp")) reciprocatingType = 1;
  else if (comps.includes("plate-crossmesh")) reciprocatingType = 3;
  else if (comps.includes("plate-prox")) reciprocatingType = 2;
  else reciprocatingType = 0;


  const fields = [
    ["Tooth Main.Tooth Index.Major Index", maj],
    ["Tooth Main.Tooth Index.Minor Index", min],
    ["Tooth Main.Tooth Index.Tooth Type", toothType],
    ["Tooth Main.Tooth Index.Tooth Presence", present],
    ["Tooth Main.Tooth Index.Tooth Condition", condition],
    ["Tooth Main.Tooth Index.Mesh Presence", hasMesh ? 0 : 1], // 0 = mesh present
    ["Tooth Main.Tooth Index.Array Index", arrayIdx],
    ["Tooth Main.Tooth Index.Tissue Stop Presence", rawOr("Tooth Main.Tooth Index.Tissue Stop Presence", 0)],
    ["Tooth Main.Tooth Index.Retention Pin Presence", rawOr("Tooth Main.Tooth Index.Retention Pin Presence", 0)],
    ["Tooth Main.Tooth Index.Tooth Position X", rawOr("Tooth Main.Tooth Index.Tooth Position X", 0)],
    ["Tooth Main.Tooth Index.Tooth Position Y", rawOr("Tooth Main.Tooth Index.Tooth Position Y", 0)],
    ["Tooth Main.Tooth Index.Tooth Position Z", rawOr("Tooth Main.Tooth Index.Tooth Position Z", 0)],
    ["Tooth Main.Tooth Rest.Tooth Type", toothType],
    ["Tooth Main.Tooth Rest.Anterior Rest", anteriorRest],
    ["Tooth Main.Tooth Rest.Anterior Cingulum Rest Type", antCingulum],
    ["Tooth Main.Tooth Rest.Anterior Incisal Rest Type", antIncisal],
    ["Tooth Main.Tooth Rest.Posterior Rest Type", posteriorRest],
    ["Tooth Main.Tooth Rest.Pr Config 0", prConfig[0]],
    ["Tooth Main.Tooth Rest.Pr Config 1", prConfig[1]],
    ["Tooth Main.Tooth Rest.Pr Config 2", prConfig[2]],
    ["Tooth Main.Tooth Retainer.Retainer Type", retainerType],
    ["Tooth Main.Tooth Retainer.Retainer Clasp Type", claspType],
    ["Tooth Main.Tooth Retainer.Retainer Ring Type", ringType],
    ["Tooth Main.Tooth Retainer.Retainer Bar Type", barType],
    ["Tooth Main.Tooth Retainer.Retainer Bar Category", barCategory],
    ["Tooth Main.Tooth Reciprocating.Tooth Type", reciprocatingType],
    // Pattern Type = crossmesh shape (0=circle, 1=square, 2=crisscross), read by the DLL when
    // Tooth Type is 3. NOT spare: preserve verbatim, and never omit the line (desyncs parse).
    [RECIPROCATING_PATTERN_FIELD, rawOr(RECIPROCATING_PATTERN_FIELD, 0)],
  ];
  return fields.map(([k, v]) => `Tooth ${arrayIdx}: ${k}: ${v}`);
}

/**
 * Encode `state` to a complete jaw-struct text file for one jaw.
 * jawSide: "upper" | "lower". See the block comment above for fidelity notes.
 */
export function encodeJawStructText(state, jawSide) {
  const isUpper = jawSide === "upper";
  const fdiOrder = isUpper ? UPPER_FDI_ORDER : LOWER_FDI_ORDER;

  const meshFdi = new Set();
  fdiOrder.forEach((fdi) => {
    if (componentList(state.teeth?.[fdi]).some((id) => String(id).startsWith("mesh-"))) meshFdi.add(fdi);
  });
  const meshSpans = buildMeshSpans(state, fdiOrder);
  const mcCode = majorConnectorCode(state, fdiOrder);

  const lines = [];
  lines.push("");
  lines.push(`Start of Jaw Struct yr.mth.day.hr.min.sec: ${stampNow()}`);
  lines.push(`Jaw Type: ${isUpper ? 0 : 1}`);
  // Denture base material: 0 = metal, 2 = full acrylic. Chosen once per case
  // (state.jawMaterial); defaults to 0/metal when unset. Applies to both jaws.
  const jawMaterial = Number.isFinite(state?.jawMaterial) ? state.jawMaterial : 0;
  lines.push(`Jaw Material: ${jawMaterial}`);

  // Header pattern types after Jaw Material. The native parser is positional, so omitting
  // these desyncs it and desktop loads blank. Preserve loaded values, default 0.
  const header = state?.jawStructTail?.[jawSide] || {};
  lines.push(`Palatal Pattern Type: ${header["Palatal Pattern Type"] ?? 0}`);
  lines.push(`Arch Ridge Pattern Type: ${header["Arch Ridge Pattern Type"] ?? 0}`);

  fdiOrder.forEach((fdi, arrayIdx) => {
    lines.push(...encodeToothLines(arrayIdx, fdi, state.teeth?.[fdi], meshFdi.has(fdi)));
  });

  lines.push(`Mesh Number: ${meshSpans.length}`);
  for (let i = 0; i < 8; i += 1) {
    const span = meshSpans[i];
    lines.push(`Tooth Mesh ${i}: Mesh Type: ${span ? span.meshType : 0}`);
    lines.push(`Tooth Mesh ${i}: Start Index: ${span ? span.start : -1}`);
    lines.push(`Tooth Mesh ${i}: End Index: ${span ? span.end : -1}`);
  }

  lines.push(`Major Connector Type: ${mcCode}`);
  // Major connector spans, COMPUTED from the teeth carrying it so web edits round-trip.
  // Contiguous runs -> connectors 1 and 2 (a single run duplicates); >2 runs -> [min,max].
  const span = majorConnectorSpans(state, fdiOrder);
  lines.push(`Major Connector 1 Start: ${span.c1[0]}`);
  lines.push(`Major Connector 1 End: ${span.c1[1]}`);
  lines.push(`Major Connector 2 Start: ${span.c2[0]}`);
  lines.push(`Major Connector 2 End: ${span.c2[1]}`);
  // The minor-connector grid and ball connectors aren't modeled: emit state.jawStructTail
  // or desktop defaults. Lower lingual bar/plate re-routes via normalizeLingualGridForType.
  const tail = normalizeLingualGridForType(state?.jawStructTail?.[jawSide] || {}, mcCode);
  for (let c = 0; c < 16; c += 1) {
    for (let p = 0; p < 16; p += 1) {
      const key = `Minor Connector ${c} Path Index ${p}`;
      lines.push(`${key}: ${key in tail ? tail[key] : 1}`);
    }
  }
  for (let b = 0; b < 17; b += 1) {
    const key = `Ball Connector ${b}`;
    lines.push(`${key}: ${key in tail ? tail[key] : 0}`);
  }

  lines.push("End of Jaw Struct");
  // Desktop terminates the file with a trailing CRLF after "End of Jaw Struct".
  // Without it a no-edit load->Save differs from the loaded file by one byte-run.
  return lines.join("\r\n") + "\r\n";
}

/** Base64-encode the text for transport. */
export function encodeJawStructBase64(state, jawSide) {
  const text = encodeJawStructText(state, jawSide);
  if (typeof btoa === "function") return btoa(text);
  return Buffer.from(text, "binary").toString("base64");
}

function stampNow() {
  const d = new Date();
  return [
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ].join(".");
}
