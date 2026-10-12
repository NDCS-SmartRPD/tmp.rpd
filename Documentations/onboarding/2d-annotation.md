# 2D Annotation — codebase & feature guide

This is a conceptual + architectural guide, not a line-by-line reference — read it once fully, then use
the section headers to come back to whichever part you're touching.

## What this feature actually is

Despite the name, "2D Annotation" is not a simple "draw on a photo" tool — it's the **RPD
framework design workspace**: the screen where a technician charts which teeth are present,
missing, or compromised, then places the metal/acrylic framework components (rests, clasps,
bars, mesh, plates, connectors) onto a 2D tooth diagram (an "odontogram"). It's the digital
equivalent of what a dental lab technician used to sketch by hand or design in the existing
**SmartRPD desktop Windows app** — and staying compatible with that desktop app's file formats
is the source of most of this code's complexity.

One page, `src/pages/2DAnnotation.html`, hosts this AND several adjacent tools you reach from
its footer/modals:

| Feature | What it is | Don't confuse it with |
|---|---|---|
| The main workspace | The tooth chart + component catalog described above | — |
| **Instruction Editor** | The *actual* freehand image-annotation tool — crop, sticker, text, pencil, on a captured screenshot | The page name; this is the literal "annotate an image" feature, nested inside Noticeboard |
| **Noticeboard** | Gallery of instruction screenshots + 3D view captures, synced with the desktop app | — |
| **Clinical Info** | A *second*, independent per-tooth chart for clinical condition (mobility, decay, crowns, etc.) | The main RPD design chart — different data, different backend endpoint |
| **Case Note** | Small per-case form (owner, due date, shade, work category, comment) | Mostly `localStorage`-only; see below |
| 3D preview panel | Live embedded Three.js viewer of the case's jaw STL files | — |
| Chat / Version History | Case comments and save-history side panels | Separate, simpler features |

It's reached by opening a case from the case list: `2DAnnotation.html?id=<encrypted-case-id>`
(see `createCase.js`/`caseManagement.js` for the navigation call).

## Before you touch this code

- **No build step for this feature.** `webpack.config.js`'s entry point is
  `src/viewer3d/index.js` (the 3D-viewer bundle) — it does not touch `src/js/2D/`.
  `2DAnnotation.html` loads `src/js/2D/2DAnnotation.js` directly as a browser ES module. Edit a
  file under `src/js/2D/`, hard-refresh, done — `npm run build` is irrelevant here.
- **There is no local backend or test data.** Every screen here talks to the live API
  (`https://live.api.smartrpdai.com/api/smartrpd`) against real case data. There's no seed/mock
  mode.
- **A lot of this code exists purely for desktop-file-format compatibility**, not because the
  web app "wants" the format that way. When something looks unnecessarily convoluted (byte-level
  encoders, "preserve this raw field we can't regenerate"), that's almost always why — see
  [The jawstruct L2 format](#the-jawstruct-l2-format) below.
- **The tests are the best spec of the trickiest behavior.** `__tests__/jawStruct.test.mjs`
  (round-trip + bar/plate switch) and `__tests__/placementRules.test.mjs` encode real, hard-won
  rules as executable examples — reading them is often faster than reading the prose comments.
- Console logs are prefixed by module for a reason: `[jawStructApi]`, `[jawStructApply]`,
  `[2D-post]`, `[annotationCatalog]`, etc. Filter the DevTools console by these when debugging.

## Core domain concepts

- **FDI tooth numbering.** Teeth are IDed as two digits: quadrant (1=upper-right, 2=upper-left,
  3=lower-left, 4=lower-right) + position 1–8 from the front midline (1=central incisor →
  8=third molar/"wisdom tooth"). `constants.js`'s `TOOTH_ORDER` lists both arches in this order.
- **Tooth state.** Each tooth is a record in `state.teeth[fdi]` (defined/mutated in
  `annotationTeethModel.js`): `isPresent` (boolean) + `status` (`presence` / `abutment` /
  `compromised` / `missing`) + `componentPlacements` (the list of framework pieces on it).
- **The component catalog** (`components.js`, `COMPONENT_CATALOG`) is the domain vocabulary —
  every placeable piece, grouped into tabs: **Mesh** (missing-tooth saddle fill: tori/stripe/
  hole/flange/cross/plate), **Assembly** (pre-built multi-piece *recipes* — see below),
  **Rests** (rest-seat/onlay), **Clasps** (retainer/reciprocating/ring), **Bars** (I/S/U/Y/T
  shape), **Plate** (proximal/mesh reciprocating plates), **Major Connector** (the arch-spanning
  piece: palatal strap/plate/hole/horseshoe/bar for upper, lingual bar/plate/kennedy for lower).
- **Assembly vs. individual placement — two paths to a similar result.** The **Assembly** tab
  (`assembly-ibar`, `assembly-tbar`, `assembly-circ*`) places a *bundle* — bar + reciprocating
  clasp + rest-seat together — via dedicated functions in `annotationPlacement.js`
  (`placeAssemblyIBarOnTooth`, etc.). The plain **Bars**/**Clasps**/**Rests** tabs place one
  component at a time via the generic `placeSelectedComponentOnTooth`. Don't be surprised to
  find two different code paths that both end up placing a bar — they're intentionally separate.
- **Placements have a surface.** A `componentPlacement` is `{componentId, surface}` — surface is
  a string like `mesial_buccal`, `distal_lingual`, `lingual` (`"occlusal"` is normalized to
  `"lingual"` — see `toothUtils.js`). Surfaces drive both the visual position (asset + offset
  lookup tables in each `components.*.js`) and the encoded desktop field on save.
- **Placement rules are declarative.** Each catalog entry carries `requiresPresence` /
  `requiresMissing`, `conflictsWith: [...]`, and `actionUponFailure`
  (`PreventPlacement` or `RemoveThenPlace`). `criteria.js`'s `assessPlacementCriteria` is the one
  function that evaluates these before a placement is allowed.
- **The "reciprocating slot" is a single-slot concept.** `reciprocating-clasp`, `plate-prox`,
  and `plate-crossmesh` are mutually exclusive on one tooth (a tooth reciprocates with a clasp OR
  a plate, never both) — enforced at the lowest level, `addPlacement()` in
  `annotationTeethModel.js`, so every placement path (including the multi-piece assemblies)
  respects it automatically.
- **Placing a bar auto-adds its reciprocating clasp** (a bar is a buccal retentive element and
  clinically needs reciprocation) — done in `placeSelectedComponentOnTooth`
  (`annotationPlacement.js`), gated on the tooth not already having a reciprocating element.

## Codebase map

29 files under `src/js/2D/` (~21k lines). Grouped by what they do:

**Orchestration**
| File | Size | Purpose |
|---|---|---|
| `2DAnnotation.js` | 53KB | Entry point. Owns `state`, undo/redo history, tooth click-popup, remove-component dialog, save/load orchestration, panel layout, sidebar/footer wiring. Read this *last* — it's the glue. |

**Canvas core** (tooth state, validation, rendering)
| File | Size | Purpose |
|---|---|---|
| `constants.js` | 5KB | FDI tooth order, pixel positions/scale/calibration for the SVG chart. No dependencies — good first read. |
| `criteria.js` | 5KB | `assessPlacementCriteria` — the placement validation gate. |
| `toothUtils.js` | 0.2KB | One function: surface-name normalization. |
| `annotationTeethModel.js` | 6.5KB | The tooth data model: init/toggle/add-placement/remove-placement. |
| `annotationCatalog.js` | 28KB | Renders the component-catalog side panel; also hosts the Case Note form UI. |
| `annotationPlacement.js` | 25KB | The placement engine — one function per component family, plus the assembly recipes and auto-reciprocation rule. |
| `annotationRender.js` | 19KB | Draws both arches; owns the tooth click/right-click/double-click DOM listeners. |
| `annotationVisuals.js` | 66KB | Pure SVG-fragment builders (icons, markers, overlays) — no events, no fetch. Only used by `annotationRender.js`. |
| `annotationLocks.js` | 42KB | Lock/design-mode toggle, save-to-localStorage, JPEG/PNG export + thumbnail upload, bridges to the 3D preview. |

**RPD component types** (geometry + per-family helpers, funneled through one barrel)
| File | Size | Purpose |
|---|---|---|
| `components.js` | 17KB | The **barrel**: owns `COMPONENT_CATALOG`/`COMPONENT_TABS`, and re-exports everything below. Nothing outside this cluster imports the files below directly. |
| `components.major.js` | 45KB | Major connectors — the biggest and most self-contained (only depends on `constants.js`). |
| `components.clasp.js` | 32KB | Retainer/reciprocating/ring clasps, plus the ball clasp: it sits in the embrasure between two teeth (upper and lower), stored as the mesial of the tooth behind the contact (11's and 41's mesials are the midlines), with per-jaw art and fitted positions. It saves as Retainer Type 4 (a web addition to the desktop enum), so it shares that tooth's one retainer slot with a clasp, ring or bar. |
| `components.bar.js` | 20KB | I/S/U/Y/T bars — geometry is coupled to per-tooth tuning tables (see gotcha below). |
| `components.mesh.js` | 18KB | Mesh types + the shared asset-path root most other component files import. |
| `components.rest.js` | 16KB | Rest-seats/onlays, cingulum rests. |
| `components.plate.js` | 12KB | Proximal/mesh plates + the sync rule that keeps them consistent with the major connector. |
| `components.minor.js` | 13KB | Minor connectors — geometry and which embrasures get one (a ball clasp's contact gets one shared connector); not an independently placeable catalog item. |

**Save/load pipeline** (the jaw-struct wire format — see dedicated section below)
| File | Size | Purpose |
|---|---|---|
| `jawStructCodec.js` | 33KB | Pure, DOM-free codec: decode/resolve (load) and encode (save). |
| `jawStructCodes.js` | 4KB | Int-enum ↔ web-componentId lookup tables mirroring the desktop's C# enums. |
| `jawStructApply.js` | 5KB | Replays a decoded design onto live `state` using the real placement primitives. |
| `jawStructApi.js` | 4KB | HTTP layer: `POST /jawstruct/l2/getall` (load) and `POST /jawstruct/l2` (save). |
| `dotnetBinaryFormatter.js` | 6KB | Byte-level .NET BinaryFormatter encoder, used by `noticeboard.js` only. |

**Adjacent modal features** (embedded in the same page)
| File | Size | Purpose |
|---|---|---|
| `noticeboard.js` | 63KB | Instruction/screenshot gallery + printable case-report generator. Most API-heavy file here. Exports the pure `mergeInstructions()` (local+server dedupe) for its unit test. |
| `instructionEditor.js` | 83KB | The actual canvas image-annotation modal (crop/sticker/text/pencil). Self-contained, one export. |
| `clinicalInfo.js` | 24KB | The separate clinical-condition tooth chart. |
| `caseNote.js` | 6KB | Data-only (no UI) helpers for the Case Note fields; the form itself lives in `annotationCatalog.js`. |

**3D preview**
| File | Size | Purpose |
|---|---|---|
| `preview3D.js` | 126KB | The largest file by far. Only 3 exports (`loadInteractiveJawPreview`, `capture3DPreviewDataUrl`, `teardown3DPreview`); wired in via `annotationLocks.js` and `noticeboard.js`, not directly by `2DAnnotation.js`. |

## Architecture patterns worth understanding before you get confused

1. **`components.js` is a deliberate barrel.** The 7 `components.<type>.js` files are never
   imported by name from outside this cluster — everything goes through `components.js`'s
   re-exports. If you're adding a new component type, follow that pattern.
2. **`2DAnnotation.js` splits its imports into static + dynamic on purpose.** It statically
   imports only `constants.js`, `components.js`, and the `jawStruct*.js` trio. Everything else
   (`annotationRender.js`, `annotationCatalog.js`, `annotationPlacement.js`, `annotationLocks.js`,
   `noticeboard.js`, `clinicalInfo.js`) is loaded via `await import(...)` from inside its own
   functions (mainly `init()`). Reason: those modules import `state`/`setMessage`/etc. *back*
   from `2DAnnotation.js`, so a static/eager import would form a circular dependency and hit a
   temporal-dead-zone crash. `2DAnnotation.js` is both the static-import root and the
   dynamic-import dispatcher — there's no separate router module.
3. **`registerRender`/`registerMeshAnnotationEnv` are bridge functions**, not real
   implementations. `2DAnnotation.js` exports `renderJaw`/`renderJaws` as proxies that do nothing
   until `annotationRender.js` calls `registerRender({renderJaw, renderJaws})` during init and
   fills them in. If `renderJaw()` seems to silently no-op, check that init actually ran.

## Data flow

**Placing a component** (e.g., clicking a tooth with a clasp selected):
1. Click lands on the tooth's DOM listener, bound in `annotationRender.js`'s `renderJaw()`.
2. → `placeSelectedComponentOnTooth()` (`annotationPlacement.js`) looks up the component in
   `COMPONENT_BY_ID`, validates via `assessPlacementCriteria()` (`criteria.js`), then calls
   `addPlacement(tooth, componentId, surface)` (`annotationTeethModel.js`), which mutates
   `state.teeth[fdi].componentPlacements` — the single source of truth.
3. → the handler calls `renderJaw(jaw)` (proxied back into the real `annotationRender.js`
   implementation), which redraws using `annotationVisuals.js`'s SVG builders, reading straight
   from `componentPlacements`.
4. → `recordHistoryIfChanged()` (`2DAnnotation.js`) turns the change into one undo step.

**Saving**: Save button → `saveAnnotation()` (`annotationLocks.js`) writes a `localStorage`
snapshot, then calls `postJawStructToServer()` (`2DAnnotation.js`) → `saveJawStructFromState()`
(`jawStructApi.js`) → `encodeJawStructBase64()` per jaw (`jawStructCodec.js`, using
`jawStructCodes.js`'s enum maps) → two parallel `POST /jawstruct/l2` calls (one per jaw, upsert
on case+type).

**Loading**: `2DAnnotation.js`'s `init()` → `fetchJawStruct()`
(`POST /jawstruct/l2/getall`, `jawStructApi.js`) → `decodeJawStructResponse()` +
`resolveJawStructDesign()` (`jawStructCodec.js`) → `applyJawStructDesign()`
(`jawStructApply.js`, replays onto `state.teeth` via the same `addPlacement`/`hasPlacement`
primitives so a loaded design behaves like a hand-placed one) → `renderJaws()`.

## The jawstruct L2 format

This is the single most complex, most bug-prone part of the feature, because it's a
compatibility layer with a **desktop Windows app's file format** (originally a Unity/.NET
`StructData.cs` model), not something this team designed freely.

- **Pipeline**: `parseJawStructText` → `decodeJawStructResponse` → `resolveJawStructDesign`
  (all in `jawStructCodec.js`, deliberately DOM-free/pure so they're unit-testable) produce a
  normalized `design` object; `jawStructApply.js` replays it onto live UI state.
- **The encoder is not a passthrough.** `encodeJawStructText` is a *hybrid*: fields the web
  model genuinely owns (presence, placements, derived surfaces) are generated fresh from live
  state; fields the web has no concept of (a 16×16 minor-connector routing grid, raw tooth
  position coordinates) are preserved verbatim from what was loaded, because the web can't
  regenerate them. A from-scratch design (nothing loaded) still encodes a complete, valid file
  using sane defaults.
- **Round-trip fidelity is tested, not assumed** — `__tests__/jawStruct.test.mjs` loads
  a real fixture, runs it through the full decode→resolve→apply→encode pipeline, and asserts the
  output is byte-identical to the original (modulo the re-stamped timestamp). If you change
  anything in this pipeline, run this test.
- **A few hard-won rules, so you don't relearn them the expensive way:**
  - Presence is a inverted-looking field: in the raw format, `0` = present, `1` = missing.
  - The bar surface label (`mesial`/`distal`) returned by `getBarPlacementSurfaceForTooth`
    (`components.bar.js`) is not just "which side" — it's matched 1:1 to a per-tooth visual
    tuning table. Flipping the general rule to fix one tooth's rendering breaks other teeth
    (this happened once — see the file's own comments). Fix the specific tooth's tuning entry
    instead.
  - `plate-prox` is intentionally a real, removable *component* (not something implied by the
    major connector type) so it shows up in the remove-component list and persists correctly —
    an earlier "hardcode which connectors imply plating" approach was tried and reverted.
  - A reciprocating clasp's surface is *derived* from the retentive component's surface
    (arch-side flipped, same mesial/distal) — the desktop format has no field for it on its own.

## The .NET BinaryFormatter angle (Noticeboard + Clinical Info)

Two features — Noticeboard and Clinical Info — persist data as **byte-for-byte .NET
BinaryFormatter blobs**, because the desktop app reads these database columns directly and
expects that exact serialization, not JSON. Worth knowing: this is implemented **twice,
independently, and not shared**:
- `dotnetBinaryFormatter.js` — a general jagged-`byte[][]` encoder, used only by `noticeboard.js`
  (screenshot filenames + PNG bytes).
- `clinicalInfo.js` — hand-rolls its own, simpler, single-`String`-envelope variant for its own
  `data` column, with its own header/footer byte constants.

If you're fixing a "desktop can't read what the web wrote" bug in one of these features, don't
assume a fix in one encoder applies to the other.

## Adjacent sub-features, quick reference

- **Noticeboard** (`noticeboard.js`) — instruction screenshots + 3D view captures, shown to the
  desktop app's own "2D Design"/"3D Design" tabs. Sync rules here are unusually fragile (desktop
  classifies a slide as 2D vs. 3D purely by filename prefix, and has historically needed *exact*
  filename conventions to load web-saved content at all) — if you touch this file, test an actual
  round trip with the desktop app if you can, not just that the POST succeeds.
- **Instruction Editor** (`instructionEditor.js`) — the real freehand-annotation canvas (crop,
  sticker, text, pencil). Fully self-contained: no network calls, returns a Promise the caller
  (`noticeboard.js`) awaits and then persists.
- **Clinical Info** (`clinicalInfo.js`) — a second, independent odontogram for clinical
  condition (mobility, RCT, restorations, crowns, implants, etc.), `POST /clinicalinfo`. Don't
  confuse its per-tooth data with the main RPD design chart's `state.teeth`.
- **Case Note** (`caseNote.js` for data, `annotationCatalog.js` for the form UI) — mostly
  `localStorage`-only; the one field that round-trips to the backend is "Date Required", which
  is actually the case's `due_date` (same value shown as "Due" in the case list).
- **3D preview** (`preview3D.js`) — a live, interactive Three.js viewer of the case's upper/lower
  jaw STL files, embedded in the left panel and resizable via a splitter. Huge file, tiny public
  surface (3 exports) — treat it as a black box unless you're specifically working on 3D
  rendering.

## Suggested reading order

1. `constants.js` → `components.js` (skim `COMPONENT_CATALOG`) — learn the vocabulary.
2. `annotationTeethModel.js` → `criteria.js` — the state shape and validation rule.
3. `annotationPlacement.js` — how a placement actually happens (including the assembly recipes
   and auto-reciprocation).
4. `annotationRender.js` + skim `annotationVisuals.js` — how state becomes pixels.
5. `jawStructCodes.js` → `jawStructCodec.js` → `jawStructApply.js` → `jawStructApi.js` — the
   save/load pipeline, in dependency order.
6. `2DAnnotation.js` — now that you know what it's wiring together, the orchestrator makes sense.
7. Whichever adjacent modal you actually need to touch (`noticeboard.js`, `clinicalInfo.js`,
   `instructionEditor.js`, `preview3D.js`, `caseNote.js`).

Alongside the code, skim `__tests__/jawStruct.test.mjs`, `__tests__/placementRules.test.mjs`,
and `__tests__/assemblies.test.mjs` — they're concrete, runnable examples of the rules
described above.

See also [Documentations/setup/](../setup/README.md) for environment/deployment setup, and the
existing `Documentations/Maintenance and Operational Runbook.docx` for release/incident process.
