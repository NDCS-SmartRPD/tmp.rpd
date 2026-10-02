import {
  cancelMeshInteractionDefer,
  COMPONENT_BY_ID,
  deferMeshInteraction,
  hasMissingTeethOnBothSidesForBar,
  getBarPlacementSurfaceForTooth,
  getBarSuggestibleToothIdSet,
  handleMeshToolDoubleClick,
  isBarComponent,
  isClaspComponent,
  isMeshComponent,
  isPlateComponentId,
  pruneInvalidMajorConnectorPlacementsInJaw,
  pruneInvalidBarPlacementsInJaw,
  isRestComponent,
} from "./components.js";
import { EMPTY_JAW_CALIBRATION, JAW_BACKGROUND_IMAGES, JAW_BACKGROUND_OFFSET_BY_JAW, JAW_BACKGROUND_SCALE_BY_JAW, JAW_CALIBRATION, TOOTH_ASSET_BASE, TOOTH_ORDER } from "./constants.js";
import {
  getHistoryStateSignature,
  state,
  svgEl,
  setMessage,
  recordHistoryIfChanged,
  registerRender,
  registerMeshAnnotationEnv,
  meshAnnotationEnv,
  showPresentToothRadialQuickPick,
  openRemoveComponentPicker,
} from "./2DAnnotation.js";
import { isComponentBlockedByMaterial, renderComponentCatalog } from "./annotationCatalog.js";
import {
  extendMajorConnectorsOntoTeeth,
  placeSelectedComponentOnTooth,
} from "./annotationPlacement.js";
import {
  getToothPlacement,
  toggleToothPresence,
  toggleToothStatus,
} from "./annotationTeethModel.js";
import {
  appendRetainerClaspSuggestionPoints,
  appendPalatalBarArchOverlay,
  appendPalatalPlateArchOverlay,
  appendPalatalHoleArchOverlay,
  appendPalatalStrapArchOverlay,
  appendPlacedComponentMarkers,
  appendPlateSuggestionPoints,
  appendRestSuggestionPoints,
  appendToothComponentVisuals,
  appendToothPlateComponentVisuals,
  applyToothStatusClass,
  createToothVisual,
  hasBarPlacementAtSurface,
  showBarSuggestions,
} from "./annotationVisuals.js";

// Safari/iOS drops CSS `filter:` colour chains on SVG <image>, so each tint is an SVG-native
// <filter> with the drop-shadow baked in — chaining url() + drop-shadow() is unreliable.
const SVG_TINT_FILTERS = {
  // Present vs missing reads purely by tint against the mid-grey arch: present near-black
  // with a crisp shadow, missing pale and faint (CSS opacity fades it further).
  "tint-tooth-base": { color: "#0d0d0d", shadow: true, shadowOpacity: 0.75 },
  // Tooth art is line art with a transparent interior, so a flat tint colours only strokes.
  // `fillBody` closes the outline into a silhouette; each status paints its own hue.
  "tint-tooth-abutment": {
    color: "#1565c0",
    fillBody: "#b9d7f5",
    shadow: true,
    shadowOpacity: 0.35,
  },
  "tint-tooth-compromised": {
    color: "#558b2f",
    fillBody: "#cbe3ae",
    shadow: true,
    shadowOpacity: 0.35,
  },
  "tint-tooth-missing": {
    color: "#bdbdbd",
    fillBody: "#dcdcdc",
    shadow: true,
    shadowOpacity: 0.18,
  },
  // Bar / rest-seat suggestions mark candidate abutments, so they paint in the abutment
  // palette; the CSS opacity is what separates "candidate" from a committed abutment.
  "tint-tooth-suggestible": {
    color: "#1565c0",
    fillBody: "#b9d7f5",
    shadow: true,
    shadowOpacity: 0.3,
  },
  "tint-mesh": { color: "#5b21b6" },
  "tint-rpd-gray": { color: "#8a8a8a" },
  // Denture flange pink (acrylic gum) — used for the acrylic-case major connector
  // (the acrylic base reads as a flange).
  "tint-flange": { color: "E8ADBF" },
  "tint-separated": { color: "#BB0D27" },
  "tint-rose": { color: "#c0285f" },
  "tint-rose-deep": { color: "#a31552" },
  "tint-bar-placed": { color: "#a4d075" },
  "tint-jaw-plate": { color: "#0288d1" },
};

function hexToRgbFractions(hex) {
  const h = hex.replace(/^#/, "");
  const expanded = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = parseInt(expanded, 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

// Dilate-then-erode radius (user units, ~1:1 with the tooth art's own pixels) that closes
// the widest interior gap in the tooth outlines without bloating the silhouette.
const TOOTH_BODY_FILL_RADIUS = 40;

function appendSvgTintFilters(defs) {
  for (const [id, spec] of Object.entries(SVG_TINT_FILTERS)) {
    const [r, g, b] = hexToRgbFractions(spec.color);
    const filterEl = svgEl("filter", {
      id,
      "color-interpolation-filters": "sRGB",
      x: "-20%",
      // The dilate pass must not clip against the filter region or the erode pass
      // shaves that much off the silhouette, so a filled body needs deeper padding.
      y: spec.fillBody ? "-60%" : "-20%",
      width: "140%",
      height: spec.fillBody ? "220%" : "140%",
    });
    filterEl.appendChild(
      svgEl("feColorMatrix", {
        type: "matrix",
        values:
          `0 0 0 0 ${r.toFixed(4)} ` +
          `0 0 0 0 ${g.toFixed(4)} ` +
          `0 0 0 0 ${b.toFixed(4)} ` +
          `0 0 0 1 0`,
        result: "tinted",
      })
    );
    let painted = "tinted";
    if (spec.fillBody) {
      // Thicken the strokes first: they are faint and not everywhere closed, and a raw
      // dilate leaks square kernel corners out through those gaps.
      filterEl.appendChild(
        svgEl("feGaussianBlur", { in: "SourceAlpha", stdDeviation: "2", result: "softLine" })
      );
      const boost = svgEl("feComponentTransfer", { in: "softLine", result: "solidLine" });
      boost.appendChild(svgEl("feFuncA", { type: "linear", slope: "8", intercept: "-0.4" }));
      filterEl.appendChild(boost);
      filterEl.appendChild(
        svgEl("feMorphology", {
          in: "solidLine",
          operator: "dilate",
          radius: String(TOOTH_BODY_FILL_RADIUS),
          result: "grown",
        })
      );
      filterEl.appendChild(
        svgEl("feMorphology", {
          in: "grown",
          operator: "erode",
          radius: String(TOOTH_BODY_FILL_RADIUS),
          result: "bodyAlpha",
        })
      );
      filterEl.appendChild(svgEl("feFlood", { "flood-color": spec.fillBody, result: "bodyColor" }));
      filterEl.appendChild(
        svgEl("feComposite", { in: "bodyColor", in2: "bodyAlpha", operator: "in", result: "body" })
      );
      const merge = svgEl("feMerge", { result: "painted" });
      merge.appendChild(svgEl("feMergeNode", { in: "body" }));
      merge.appendChild(svgEl("feMergeNode", { in: "tinted" }));
      filterEl.appendChild(merge);
      painted = "painted";
    }
    if (spec.shadow) {
      filterEl.appendChild(
        svgEl("feDropShadow", {
          in: painted,
          dx: "0",
          dy: "0",
          stdDeviation: "1",
          "flood-color": "#000000",
          "flood-opacity": String(spec.shadowOpacity ?? 0.6),
        })
      );
    }
    defs.appendChild(filterEl);
  }
}

function buildJawTintFilter(jaw) {
  const filterEl = svgEl("filter", {
    id: `jawTint-${jaw}`,
    "color-interpolation-filters": "sRGB",
  });
  filterEl.appendChild(
    svgEl("feColorMatrix", {
      type: "matrix",
      values:
        "0.085 0.286 0.029 0 0 " +
        "0.085 0.286 0.029 0 0 " +
        "0.085 0.286 0.029 0 0 " +
        "0 0 0 1 0",
    })
  );
  return filterEl;
}

// Every arch filter lives in ONE hidden <svg> on <body>: per-arch <defs> duplicated all 13
// tint ids and re-ran feMorphology for 32 teeth per tap (~1.4s in WebKit).
const ARCH_TINT_DEFS_HOST_ID = "annotationArchTintDefs";

function ensureArchTintDefs() {
  if (typeof document === "undefined" || document.getElementById(ARCH_TINT_DEFS_HOST_ID)) {
    return;
  }
  const host = svgEl("svg", {
    id: ARCH_TINT_DEFS_HOST_ID,
    width: "0",
    height: "0",
    "aria-hidden": "true",
  });
  host.style.position = "absolute";
  const defs = svgEl("defs", {});
  for (const jaw of Object.keys(JAW_BACKGROUND_IMAGES)) {
    defs.appendChild(buildJawTintFilter(jaw));
  }
  appendSvgTintFilters(defs);
  host.appendChild(defs);
  document.body.appendChild(host);
}

// A detached copy of every arch filter for callers serializing an arch <svg> alone. Without
// it the standalone SVG resolves `url(#tint-…)` against nothing and renders a blank jaw.
export function cloneArchTintDefs() {
  ensureArchTintDefs();
  const defs = document.getElementById(ARCH_TINT_DEFS_HOST_ID)?.querySelector("defs");
  return defs ? defs.cloneNode(true) : null;
}

// Render jaw background templates for upper/lower arch SVG. `parent` is the arch <svg>
// or the detached fragment renderJaw reconciles from, so append-only here.
function renderArchBackground(parent, jaw) {
  ensureArchTintDefs();
  const background = JAW_BACKGROUND_IMAGES[jaw];
  if (!background) return;

  const baseWidth = 620;
  const baseHeight = 380;
  const scale = JAW_BACKGROUND_SCALE_BY_JAW[jaw] ?? 1;
  const offset = JAW_BACKGROUND_OFFSET_BY_JAW[jaw] || { x: 0, y: 0 };
  const width = baseWidth * scale;
  const height = baseHeight * scale;
  const x = (baseWidth - width) / 2 + offset.x;
  const y = (baseHeight - height) / 2 + offset.y;

  const filterId = `jawTint-${jaw}`;

  parent.appendChild(
    svgEl("image", {
      href: `${TOOTH_ASSET_BASE}/${background.template}`,
      x: x.toFixed(2),
      y: y.toFixed(2),
      width: width.toFixed(2),
      height: height.toFixed(2),
      preserveAspectRatio: "xMidYMid meet",
      class: "jaw-template",
      filter: `url(#${filterId})`,
    })
  );

  if (background.details) {
    parent.appendChild(
      svgEl("image", {
        href: `${TOOTH_ASSET_BASE}/${background.details}`,
        x: x.toFixed(2),
        y: y.toFixed(2),
        width: width.toFixed(2),
        height: height.toFixed(2),
        preserveAspectRatio: "xMidYMid meet",
        class: "jaw-details",
        filter: `url(#${filterId})`,
      })
    );
  }
}

function getOppositeBarSurface(surface) {
  const s = String(surface || "").toLowerCase();
  if (s.endsWith("_mesial")) return s.replace(/_mesial$/, "_distal");
  if (s.endsWith("_distal")) return s.replace(/_distal$/, "_mesial");
  return null;
}

// Render both arches.
export function renderJaws() {
  renderJaw("upper");
  renderJaw("lower");
}

// Swap in only the changed children, so untouched nodes keep their cached filter results.
// A wholesale rebuild re-runs every tooth's feMorphology tint — ~1.5s per placement.

// Places a bar on one tooth, resolving its side and flipping an existing
// placement to the opposite surface when both sides are mesh-bearing.
function placeBarOnTooth(toothId, jaw, tooth, catalogPick, hadSuppressedHints) {
  const barSurface = getBarPlacementSurfaceForTooth(toothId, jaw, state.teeth);
  if (!barSurface) {
    setMessage("Could not resolve bar type for this tooth.", true);
    if (hadSuppressedHints) renderJaw(jaw);
    return;
  }
  const existing = (tooth.componentPlacements || []).find(
    (entry) => entry.componentId === catalogPick.id && String(entry.surface || "").startsWith("bar_")
  );
  const canSwitchSide = hasMissingTeethOnBothSidesForBar(toothId, jaw, state.teeth);
  if (existing && !canSwitchSide) {
    setMessage("Bar side switch requires mesh-bearing teeth on both sides of this anchor tooth.", true);
    renderJaw(jaw);
    return;
  }
  const surfaceToPlace = existing
    ? (canSwitchSide ? (getOppositeBarSurface(existing.surface) || barSurface) : String(existing.surface))
    : barSurface;
  placeSelectedComponentOnTooth(toothId, { surface: surfaceToPlace });
  renderJaw(jaw);
}

function reconcileArchChildren(parent, fragment) {
  const next = [...fragment.childNodes];
  const prev = [...parent.childNodes];
  for (let i = 0; i < Math.max(next.length, prev.length); i += 1) {
    const before = prev[i];
    const after = next[i];
    if (!after) {
      before.remove();
    } else if (!before) {
      parent.appendChild(after);
    } else if (!before.isEqualNode(after)) {
      parent.replaceChild(after, before);
    }
  }
}

// Render one jaw: teeth, overlays, and click handlers.
export function renderJaw(jaw) {
  const config = JAW_BACKGROUND_IMAGES[jaw];
  if (!config) return;
  const svg = document.getElementById(config.svgId);
  if (!svg) return;
  // Only write on a real change: setAttribute dirties the SVG root even for an identical
  // value, repainting the arch and re-running every tooth filter.
  if (svg.getAttribute("viewBox") !== config.viewBox) {
    svg.setAttribute("viewBox", config.viewBox);
  }
  // Built detached, then reconciled into `svg` at the end — see reconcileArchChildren.
  const arch = document.createDocumentFragment();

  renderArchBackground(arch, jaw);

  const ids = TOOTH_ORDER[jaw];
  pruneInvalidMajorConnectorPlacementsInJaw(state.teeth, COMPONENT_BY_ID, jaw);
  pruneInvalidBarPlacementsInJaw(state.teeth, jaw);
  // Suggestion dots sit in a layer above every tooth group: placed art is a large mostly
  // transparent <image>, so a later-drawn neighbour would swallow the previous tooth's dots.
  const suggestionLayer = svgEl("g", { class: "tooth-suggestion-layer" });
  ids.forEach((toothId) => {
    const placement = getToothPlacement(jaw, toothId);
    if (!placement) return;
    const calibration = JAW_CALIBRATION[jaw] || EMPTY_JAW_CALIBRATION;
    const point = {
      x: placement.x + calibration.x,
      y: placement.y + calibration.y,
    };
    const rotation = placement.rotation + calibration.rotation;
    state.teeth[toothId].center = [Math.round(point.x), Math.round(point.y)];

    const group = svgEl("g", { class: "tooth", "data-tooth-id": toothId, "data-jaw": jaw });
    if (state.locks[jaw]) group.classList.add("is-locked");
    const tooth = state.teeth[toothId];
    applyToothStatusClass(group, tooth);
    if (!state.designMode && state.rangeMissingMode && state.rangeMissingStartToothId === toothId) {
      group.classList.add("tooth-range-selected");
    }

    if (showBarSuggestions() && tooth.isPresent) {
      const barSel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
      if (
        barSel &&
        getBarSuggestibleToothIdSet(state.teeth, jaw).has(toothId) &&
        !hasBarPlacementAtSurface(tooth, barSel.id)
      ) {
        group.classList.add("tooth-bar-suggestible");
        group.classList.add(`tooth-bar-suggestible--${jaw}`);
      }
    }
    // An onlay rest shows no dots, so the teeth it can go on are marked for the
    // help walkthrough to count clicks on. No style of its own.
    if (
      state.designMode &&
      state.selectedComponentId === "rest-onlay" &&
      tooth.isPresent &&
      Number(toothId) % 10 >= 4 &&
      !(tooth.componentPlacements || []).some((entry) => entry.componentId === "rest-onlay")
    ) {
      group.classList.add("tooth-onlay-suggestible");
    }
    const toothTransform =
      `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${rotation.toFixed(2)})`;
    group.setAttribute("transform", toothTransform);

    // Same tooth-local frame as `group`, but parented to the top suggestion layer.
    const suggestionGroup = svgEl("g", {
      class: "tooth-suggestions",
      "data-tooth-id": toothId,
      "data-jaw": jaw,
      transform: toothTransform,
    });
    suggestionLayer.appendChild(suggestionGroup);

    group.appendChild(
      svgEl("circle", {
        cx: "0",
        cy: "0",
        r: "24",
        class: "tooth-hit-target",
      })
    );

    group.appendChild(createToothVisual(toothId, jaw));
    appendToothComponentVisuals(group, tooth, toothId, jaw);
    // Plates should render above tooth bitmap, but below placed clasps/markers.
    appendToothPlateComponentVisuals(group, tooth, toothId, jaw);
    appendPlateSuggestionPoints(group, tooth, toothId, jaw);
    appendPlacedComponentMarkers(group, tooth, toothId, jaw);
    appendRestSuggestionPoints(suggestionGroup, tooth, toothId, jaw);
    appendRetainerClaspSuggestionPoints(suggestionGroup, tooth, toothId, jaw);

    const toothClickKey = `mesh-tooth:${jaw}:${toothId}`;
    group.addEventListener("click", (event) => {
      // Read the tooth at CLICK time: a preserved node keeps its earlier listener, and
      // undo/redo or a server load replaces every state.teeth entry wholesale.
      const tooth = state.teeth[toothId];
      if (!tooth) return;
      if (!state.designMode && state.rangeMissingMode && event.detail > 1) {
        return;
      }
      if (!state.designMode) {
        onToothClick(jaw, toothId);
        return;
      }
      // Mobile keeps the eraser toggle, so a tap in remove mode opens the remove list.
      // Desktop uses right-click instead and hides the button via CSS.
      if (state.removeComponentMode) {
        event.stopPropagation();
        openRemoveComponentPicker(toothId, jaw, event);
        return;
      }
      const hadSuppressedHints = state.suppressArchPlacementSuggestions;
      state.suppressArchPlacementSuggestions = false;
      const catalogPick = COMPONENT_BY_ID.get(state.selectedComponentId || "");
      const suggestionModeActive = Boolean(
        state.designMode &&
          catalogPick &&
          (
            (isRestComponent(catalogPick) && catalogPick.id !== "rest-onlay") ||
            isClaspComponent(catalogPick) ||
            isPlateComponentId(catalogPick.id) ||
            catalogPick.tab === "assembly" ||
            (isBarComponent(catalogPick) && showBarSuggestions())
          )
      );
      if (catalogPick && isPlateComponentId(catalogPick.id)) {
        if (hadSuppressedHints) renderJaw(jaw);
        return;
      }

      // An empty-hand tap opens the picker — the only canvas entry point on touch, where
      // #editModePanel is hidden. Gated on `!catalogPick` so it can't disrupt a workflow.
      if (!catalogPick) {
        showPresentToothRadialQuickPick(toothId, event.clientX, event.clientY);
        if (hadSuppressedHints) renderJaw(jaw);
        return;
      }

      if (tooth.isPresent) {
        if (catalogPick?.id === "rest-onlay") {
          placeSelectedComponentOnTooth(toothId, null);
          renderJaw(jaw);
          return;
        }
        if (catalogPick && isBarComponent(catalogPick)) {
          const set = getBarSuggestibleToothIdSet(state.teeth, jaw);
          if (set.has(toothId)) {
            placeBarOnTooth(toothId, jaw, tooth, catalogPick, hadSuppressedHints);
            return;
          }
        }
        if (!catalogPick || !suggestionModeActive) {
          showPresentToothRadialQuickPick(toothId, event.clientX, event.clientY);
          if (hadSuppressedHints) renderJaw(jaw);
          return;
        }
      }
      if (catalogPick && isBarComponent(catalogPick)) {
        const set = getBarSuggestibleToothIdSet(state.teeth, jaw);
        if (!set.has(toothId)) {
          setMessage(
            "Choose a highlighted tooth within two positions of a mesh-bearing tooth on the arch.",
            true
          );
          if (hadSuppressedHints) renderJaw(jaw);
          return;
        }
        placeBarOnTooth(toothId, jaw, tooth, catalogPick, hadSuppressedHints);
        return;
      }
      if (catalogPick && isMeshComponent(catalogPick)) {
        if (hadSuppressedHints) renderJaw(jaw);
        deferMeshInteraction(toothClickKey, () => {
          placeSelectedComponentOnTooth(toothId, null);
          renderJaw(jaw);
        });
        return;
      }
      placeSelectedComponentOnTooth(toothId, null);
      renderJaw(jaw);
    });
    // Desktop right-click opens a tooth's remove list (left-click always adds). Skipped on
    // coarse pointers, which keep the eraser toggle instead.
    group.addEventListener("contextmenu", (event) => {
      const coarsePointer =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;
      if (coarsePointer || !state.designMode) return;
      event.preventDefault();
      event.stopPropagation();
      openRemoveComponentPicker(toothId, jaw, event);
    });
    group.addEventListener("dblclick", (event) => {
      if (!state.designMode && state.rangeMissingMode) {
        const historyBefore = getHistoryStateSignature();
        event.preventDefault();
        markToothMissing(toothId);
        state.rangeMissingStartToothId = null;
        renderJaw(jaw);
        setMessage(`Tooth ${toothId} marked missing. Range mode still active.`, false);
        recordHistoryIfChanged(historyBefore);
        return;
      }
      if (!state.designMode) {
        return;
      }
      if (state.removeComponentMode) {
        event.preventDefault();
        return;
      }
      const catalogPick = COMPONENT_BY_ID.get(state.selectedComponentId || "");
      if (!catalogPick || !isMeshComponent(catalogPick)) {
        return;
      }
      event.preventDefault();
      cancelMeshInteractionDefer(toothClickKey);
      handleMeshToolDoubleClick(meshAnnotationEnv(), jaw, toothId);
    });
    arch.appendChild(group);
  });

  if (jaw === "upper") {
    appendPalatalHoleArchOverlay(arch);
    appendPalatalBarArchOverlay(arch);
    appendPalatalPlateArchOverlay(arch);
    appendPalatalStrapArchOverlay(arch);
  }

  arch.appendChild(suggestionLayer);
  reconcileArchChildren(svg, arch);
}

// Handle tooth click in selected mode (status/range) and block in design mode.
export function onToothClick(jaw, toothId) {
  const historyBefore = getHistoryStateSignature();
  try {
  if (state.rangeMissingMode && !state.designMode) {
    handleRangeMissingToothClick(jaw, toothId);
    return;
  }

  if (state.designMode) {
    return;
  }

  const catalogPick = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (catalogPick && isBarComponent(catalogPick)) {
    setMessage(
      "Bars: click a highlighted tooth to place. Click a placed bar to remove it.",
      true
    );
    return;
  }

  if (state.locks[jaw]) {
    setMessage(`Cannot edit ${jaw}. Unlock it first.`, true);
    return;
  }

  const tooth = state.teeth[toothId];
  if (!tooth) return;

  if (state.activeStatus === "presence") {
    setMessage(toggleToothPresence(tooth, toothId), false);
    renderJaw(jaw);
    return;
  }

  if (state.activeStatus === "abutment" || state.activeStatus === "compromised") {
    setMessage(toggleToothStatus(tooth, toothId, state.activeStatus), false);
    renderJaw(jaw);
    return;
  }

  tooth.status = "presence";
  renderJaw(jaw);
  } finally {
    recordHistoryIfChanged(historyBefore);
  }
}

// Mark one tooth as missing and clear its components.
function markToothMissing(toothId) {
  const tooth = state.teeth[toothId];
  if (!tooth) return;
  tooth.isPresent = false;
  tooth.status = "missing";
  tooth.components = [];
  tooth.componentPlacements = [];
}

// Range-missing flow: first click sets start, second click applies missing span.
function handleRangeMissingToothClick(jaw, toothId) {
  const historyBefore = getHistoryStateSignature();
  const ids = TOOTH_ORDER[jaw] || [];
  const start = state.rangeMissingStartToothId;
  if (!start) {
    state.rangeMissingStartToothId = toothId;
    renderJaw(jaw);
    setMessage(`Range start set at tooth ${toothId}. Select end tooth.`, false);
    return;
  }
  if (!ids.includes(start) || !ids.includes(toothId)) {
    setMessage("Range selection must stay on the same arch.", true);
    state.rangeMissingStartToothId = toothId;
    return;
  }
  const startIndex = ids.indexOf(start);
  const endIndex = ids.indexOf(toothId);
  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);
  for (let i = lo; i <= hi; i += 1) {
    markToothMissing(ids[i]);
  }
  state.rangeMissingStartToothId = null;
  renderJaw(jaw);
  setMessage(`Teeth ${ids[lo]} to ${ids[hi]} marked missing. Range mode still active.`, false);
  recordHistoryIfChanged(historyBefore);
}

registerRender({ renderJaw, renderJaws, cloneArchTintDefs });

registerMeshAnnotationEnv(() => ({
  designMode: state.designMode,
  state,
  componentById: COMPONENT_BY_ID,
  notify: setMessage,
  redrawCatalog: renderComponentCatalog,
  redrawJaws: renderJaws,
  redrawJaw: renderJaw,
  placeSelectedOnTooth: placeSelectedComponentOnTooth,
  extendMajorConnectorsOntoTeeth,
  // The quick-pick sheet lists catalog items but cannot import the catalog (cycle), so the
  // material gate reaches it through here.
  isComponentBlockedByMaterial,
}));
