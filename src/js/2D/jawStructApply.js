/**
 * Applies a resolved jaw-struct design onto the 2D state, reusing the real placement
 * primitives so loaded designs behave like hand-placed ones. Separate from the codec so
 * that stays DOM-free.
 *
 * Order matters: 1. presence + reset, 2. mesh spans, 3. rests/clasps then bars (bar
 * surface is geometry-derived from the mesh teeth), 4. major connector.
 */
import {
  COMPONENT_BY_ID,
  getBarPlacementSurfaceForTooth,
  ensureMajorConnectorPlacementsOnSupportedTeethInJaws,
  majorConnectorRunsToMidline,
  placeMajorConnectorOnExactTeeth,
} from "./components.js";
import { addPlacement, hasPlacement } from "./annotationTeethModel.js";

function placeOnce(rec, componentId, surface,tip) {
  if (!hasPlacement(rec, componentId, surface)) addPlacement(rec, componentId, surface,tip);
}

export function applyJawStructDesign(design, state) {
  if (!design || !state?.teeth) return;
  const { jawSide } = design;

  // Stash loaded jaw-level data (minor-connector grid, ball connectors) so Save
  // can re-emit it — the web can't regenerate the 16x16 grid, only preserve it.
  if (jawSide) {
    state.jawStructTail = state.jawStructTail || {};
    state.jawStructTail[jawSide] = design.rawOther || {};
  }

  // 1. Presence + reset. Missing teeth keep no components; present teeth start
  //    clean and get their placements rebuilt below.
  for (const [fdi, t] of Object.entries(design.teeth)) {
    const rec = state.teeth[fdi];
    if (!rec) continue;
    if (design.rawByFdi[fdi]) rec.rawJawStructFields = design.rawByFdi[fdi];
    if (t.present) {
      rec.isPresent = true;
      // The backend is authoritative on load, so Tooth Condition overwrites outright —
      // a stale local "abutment" would otherwise survive a desktop edit clearing it.
      rec.status = t.condition || "presence";
    } else {
      rec.isPresent = false;
      rec.status = "missing";
    }
    rec.components = [];
    rec.componentPlacements = [];
  }

  // 2. Mesh spans land on the (missing) saddle teeth.
  for (const span of design.mesh) {
    for (const fdi of span.fdis) {
      const rec = state.teeth[fdi];
      if (rec) placeOnce(rec, span.componentId, null);
    }
  }

  // 3. Rests/clasps (surface from the data), then bars (surface from arch geometry).
  //    Surfaces are REQUIRED — the renderer skips null-surface markers.
  for (const [fdi, t] of Object.entries(design.teeth)) {
    const rec = state.teeth[fdi];
    if (!rec || !t.present) continue;
    for (const p of t.placements) placeOnce(rec, p.componentId, p.surface);
    for (const barId of t.bars) {
      const jaw = rec.jaw || jawSide;
      // const surface = getBarPlacementSurfaceForTooth(fdi, jaw, state.teeth);
      const surface =
        getBarPlacementSurfaceForTooth(fdi, jaw, state.teeth, t.barSide) ||
        getBarPlacementSurfaceForTooth(fdi, jaw, state.teeth);
      if (!surface) {
        console.warn(`[jawStructApply] no bar surface for ${fdi} (${barId}) — skipped`);
        continue;
      }
      placeOnce(rec, barId, surface, t.barTip);
    }
  }

  // 4. Major connector: an explicit design.majorSpanFdis places on EXACTLY those teeth,
  //    since re-deriving a midline-reaching span could over-cover.
  if (design.major && jawSide) {
    if (
      majorConnectorRunsToMidline(design.major) &&
      Array.isArray(design.majorSpanFdis) &&
      design.majorSpanFdis.length
    ) {
      placeMajorConnectorOnExactTeeth(
        state.teeth,
        design.major,
        COMPONENT_BY_ID,
        jawSide,
        design.majorSpanFdis
      );
    } else {
      ensureMajorConnectorPlacementsOnSupportedTeethInJaws(
        state.teeth,
        design.major,
        COMPONENT_BY_ID,
        [jawSide]
      );
    }
  }

  // Diagnostic: what the resolver produced + what actually landed on this jaw's
  // teeth (after any render-time pruning the next renderJaw will re-apply).
  const fdis = Object.keys(design.teeth);
  const placed = { rest: 0, clasp: 0, bar: 0, mesh: 0, plate: 0, major: 0 };
  const majorFdis = [];
  for (const fdi of fdis) {
    for (const pl of state.teeth[fdi]?.componentPlacements || []) {
      const id = String(pl.componentId);
      if (id.startsWith("rest-")) placed.rest += 1;
      else if (id.startsWith("bar-")) placed.bar += 1;
      else if (id.startsWith("mesh-")) placed.mesh += 1;
      else if (id.startsWith("plate-")) placed.plate += 1;
      else if (id.startsWith("major-")) { placed.major += 1; majorFdis.push(fdi); }
      else if (id.includes("clasp")) placed.clasp += 1;
    }
  }
  console.log(`[jawStructApply] ${jawSide}: resolved`, {
    present: Object.values(design.teeth).filter((t) => t.present).length,
    placements: Object.values(design.teeth).reduce((n, t) => n + t.placements.length, 0),
    bars: Object.values(design.teeth).reduce((n, t) => n + t.bars.length, 0),
    meshSpans: design.mesh.length,
    major: design.major || null,
  }, "-> placed on teeth", placed, `| major placedOn=[${majorFdis.join(",")}]`);
}
