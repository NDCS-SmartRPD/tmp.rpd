/**
 * Integer code <-> componentId maps for the jaw-struct text format, from the Unity enums in
 * StructData.cs and validated against the 03_jawstruct samples. 0-based; "inferred" rows
 * follow enum order with no confirming sample.
 *
 * Not all one-field-to-one-component: Retainer is composite, Mesh is spans, Major is
 * jaw-level. All resolved by jawStructCodec.resolveJawStructDesign.
 */

// Posterior_Rest_Type { no_pr=0, pr_full=1, pr_non_full=2 }
export const POSTERIOR_REST_TYPE = new Map([
  [1, "rest-onlay"], // inferred (no sample instance)
  [2, "rest-seat"],  // confirmed: lower 37/45, upper 17/15/27 abutments
]);

// Retainer_Type { no_retainer=0, clasp_retainer=1, ring_retainer=2, bar_retainer=3 }
// 3 (bar) resolves to a bar-* shape via RETAINER_BAR_CATEGORY — handled in the codec.
// 4–7 are web additions, not yet in the desktop enum: the ball clasp at the tooth's mesial
// contact, the Adams clasp, the (pink) acrylic clasp, and the Roach clasp placed as a Y bar.
export const RETAINER_TYPE = new Map([
  [1, "retainer-clasp"], // confirmed: upper 17/23/27, lower 37
  [2, "ring-clasp"],     // inferred (no sample instance)
  [4, "ball-clasp"],
  [5, "adams-clasp"],
  [6, "acrylic-clasp"],
  [7, "roach-clasp"],
]);

// Retainer_Bar_Category { rb_I=0, rb_S=1, rb_U=2, rb_Y=3, rb_T=4, rb_R=5 } is bar SHAPE.
// "Retainer Bar Type" (rb_mesial=0/rb_distal=1) is LOCATION and stays unmapped.
export const RETAINER_BAR_CATEGORY = new Map([
  [0, "bar-i"], // confirmed: lower 45 (distal I-bar)
  [1, "bar-s"], // inferred
  [2, "bar-u"], // inferred
  [3, "bar-y"], // inferred
  [4, "bar-t"], // inferred
  // 5 (rb_R) has no web catalog id (RPI is commented out in components.js) -> unmapped
]);

// Mesh_Type { no_mesh=0, hole_mesh=1, tori_mesh=2, strip_mesh=3, cross_mesh=4, plate_mesh=5 }
export const MESH_TYPE = new Map([
  [1, "mesh-hole"],   // confirmed: upper span 24-26, lower span 46-47
  [2, "mesh-tori"],   // inferred
  [3, "mesh-stripe"], // inferred
  [4, "mesh-cross"],  // inferred
  [5, "mesh-plate"],  // plate_mesh (renders {tooth}-plate_mesh.svg)
  // NOTE: mesh-flange is a web-only visual variant with no desktop Mesh_Type code,
  // so it does not persist through the L2 jawstruct (encodes as no_mesh / 0).
]);

// Reciprocating_Type { no_reciprocating=0, clasp=1, plate=2, crossmesh=3 }. Applied only to
// teeth also carrying a retainer, which neutralises the desktop's "2 on every tooth".
export const RECIPROCATING_TYPE = new Map([
  [1, "reciprocating-clasp"],
  [2, "plate-prox"],       // reciprocating_plate -> proximal plate
  [3, "plate-crossmesh"],  // reciprocating_crossmesh -> mesh plate
]);

// Tooth_Condition { normal=0, abutment=1, compromised=2 }. The desktop leaves clasped
// abutments at 0, so a desktop-authored case loads as plain presence.
export const TOOTH_CONDITION = new Map([
  [1, "abutment"],
  [2, "compromised"],
]);

// Major_Connector_Type { none=0, palatal_strap=1, horseshoe=2, hole=3, palatal_bar=4,
// palatal_full_plate=5, lingual_bar=6, lingual_plate=7, lingual_kennedy=8, cingulum_bar=9 }
export const MAJOR_CONNECTOR_TYPE = new Map([
  [1, "major-upper-palatal-strap"],
  [2, "major-upper-horseshoe"],      // confirmed (upper sample)
  [3, "major-upper-palatal-hole"],
  [4, "major-upper-palatal-bar"],
  [5, "major-upper-palatal-plate"],
  [6, "major-lower-lingual-bar"],
  [7, "major-lower-lingual-plate"],  // confirmed (lower sample)
  [8, "major-lower-lingual-kennedy"],
  // 9 (mc_cingulum_bar) -> major-lower-cingulum-bar is commented out in components.js -> unmapped
]);

/** Build a reverse Map<componentId, int> on first use. */
const _inverseCache = new WeakMap();
export function inverseOf(map) {
  let inv = _inverseCache.get(map);
  if (inv) return inv;
  inv = new Map();
  for (const [code, id] of map) {
    if (id != null) inv.set(id, code);
  }
  _inverseCache.set(map, inv);
  return inv;
}
