/**
 * 2D arch annotation entry point; also hosts shared 2D state and UI helpers.
 * Feature modules load via dynamic import in init() to dodge circular-import TDZ.
 */

import { lol } from "../shared/crypt.js";
import { toggleChat } from "../shared/chat.js";
import { returnToCaseList as goToCaseList } from "../shared/caseLinks.js";
import { SVG_NS } from "./constants.js";
import {
  COMPONENT_BY_ID,
  COMPONENT_CATALOG,
  COMPONENT_TABS,
  getDefaultMeshIdForDesignMode,
  isClaspComponent,
  isMeshComponent,
  isPlateComponentId,
  meshSelectionContextFromState,
} from "./components.js";
import {
  fetchJawStruct as apiFetchJawStruct,
  generateDentureDesignSelect,
  saveJawStructFromState,
} from "./jawStructApi.js";
import { decodeJawStructResponse, resolveJawStructDesign } from "./jawStructCodec.js";
import { applyJawStructDesign } from "./jawStructApply.js";
import { applyDesignProposal, buildDesignProposal } from "./JawDesignProposal.js";
import { classifyArch } from "./JawDesign.js";
import { logApi } from "../shared/apiLog.js";
import { toast, flashToast } from "../shared/toast.js";
import { VIEWER_UUID } from "../shared/config.js";
import { API_BASE, MACHINE_ID, getLoggedInUser } from "../shared/api.js";

/** Autosave on every edit (history hook). Off by default: Save button is the
 *  trigger, avoids a POST per placement. POST /jawstruct/l2 verified. */
const ENABLE_JAW_STRUCT_AUTOSAVE = false;

/** Calibrated tooth-image scale (SVG tooth-local units). */
export const TOOTH_SCALE_BASE = 0.24;

export const DEFAULT_COMPONENT_ID =
  COMPONENT_BY_ID.has("mesh-hole") ? "mesh-hole" : COMPONENT_CATALOG[0]?.id || null;

export const REST_CALIBRATION_COMPONENT_ID = "rest-seat";

// Runtime annotation state.
export const state = {
  encryptedCaseId: "",
  caseIntID: null,
  caseName: "",
  caseOwner: "",
  activeStatus: "presence",
  locks: { upper: false, lower: false },
  /** Both arches locked — component catalog placement mode. */
  designMode: false,
  teeth: {},
  components: [],
  selectedTab: "mesh",
  selectedComponentId: DEFAULT_COMPONENT_ID,
  archOverlayPalatalHoleActive: false,
  restSeatCalibrationAcOnly: false,
  removeComponentMode: false,
  hideLowerPlateVisuals: false,
  suppressArchPlacementSuggestions: false,
  rangeMissingMode: false,
  rangeMissingStartToothId: null,
  /**
   * Case-wide denture base, encoded as each jaw's "Jaw Material": 0 = metal,
   * 2 = full acrylic, null = unchosen (encodes 0). Prompted on locking an empty design.
   */
  jawMaterial: null,
  /** Per-jaw Kennedy classification, recomputed each time the dialog opens.
   *  Session-only — derived from tooth presence, so nothing to persist. */
  kennedy: { upper: null, lower: null },
};

/** Transient UI refs — mutated by other modules (avoids import-reassignment issues). */
export const ui = {
  /** @type {HTMLElement | null} */
  presentToothRadialHost: null,
  removeComponentDialogCleanup: null,
  hasInitialized: false,
};

const HISTORY_MAX = 120;
const history = {
  past: [],
  future: [],
  restoring: false,
};

function cloneStateForHistory() {
  return {
    activeStatus: state.activeStatus,
    locks: { upper: Boolean(state.locks?.upper), lower: Boolean(state.locks?.lower) },
    designMode: Boolean(state.designMode),
    teeth: JSON.parse(JSON.stringify(state.teeth || {})),
    jawStructTail: state.jawStructTail
      ? JSON.parse(JSON.stringify(state.jawStructTail))
      : undefined,
    components: [...(state.components || [])],
    selectedTab: state.selectedTab,
    selectedComponentId: state.selectedComponentId,
    archOverlayPalatalHoleActive: Boolean(state.archOverlayPalatalHoleActive),
    restSeatCalibrationAcOnly: Boolean(state.restSeatCalibrationAcOnly),
    removeComponentMode: Boolean(state.removeComponentMode),
    hideLowerPlateVisuals: Boolean(state.hideLowerPlateVisuals),
    suppressArchPlacementSuggestions: Boolean(state.suppressArchPlacementSuggestions),
    rangeMissingMode: Boolean(state.rangeMissingMode),
    rangeMissingStartToothId: state.rangeMissingStartToothId,
    jawMaterial: state.jawMaterial ?? null,
  };
}

function applyHistorySnapshot(snapshot) {
  state.activeStatus = snapshot.activeStatus;
  state.locks = { upper: Boolean(snapshot.locks?.upper), lower: Boolean(snapshot.locks?.lower) };
  state.designMode = Boolean(snapshot.designMode);
  state.teeth = JSON.parse(JSON.stringify(snapshot.teeth || {}));
  if (snapshot.jawStructTail) {
    state.jawStructTail = JSON.parse(JSON.stringify(snapshot.jawStructTail));
  }
  state.components = [...(snapshot.components || [])];
  state.selectedTab = snapshot.selectedTab;
  state.selectedComponentId = snapshot.selectedComponentId;
  state.archOverlayPalatalHoleActive = Boolean(snapshot.archOverlayPalatalHoleActive);
  state.restSeatCalibrationAcOnly = Boolean(snapshot.restSeatCalibrationAcOnly);
  state.removeComponentMode = Boolean(snapshot.removeComponentMode);
  state.hideLowerPlateVisuals = Boolean(snapshot.hideLowerPlateVisuals);
  state.suppressArchPlacementSuggestions = Boolean(snapshot.suppressArchPlacementSuggestions);
  state.rangeMissingMode = Boolean(snapshot.rangeMissingMode);
  state.rangeMissingStartToothId = snapshot.rangeMissingStartToothId ?? null;
  state.jawMaterial = snapshot.jawMaterial ?? null;
}

export function getHistoryStateSignature() {
  return JSON.stringify(cloneStateForHistory());
}

const _autosaveHooks = [];
export function registerAutosaveHook(fn) {
  if (typeof fn === "function" && !_autosaveHooks.includes(fn)) {
    _autosaveHooks.push(fn);
  }
}
function runAutosaveHooks() {
  for (const fn of _autosaveHooks) {
    try { fn(); } catch (err) { console.warn("autosave hook failed:", err); }
  }
}

function pushHistorySnapshot(snapshot) {
  const nextSig = JSON.stringify(snapshot);
  const last = history.past[history.past.length - 1];
  if (last && JSON.stringify(last) === nextSig) {
    return false;
  }
  history.past.push(snapshot);
  if (history.past.length > HISTORY_MAX) {
    history.past.splice(0, history.past.length - HISTORY_MAX);
  }
  history.future = [];
  return true;
}

export function recordHistoryCheckpoint() {
  if (history.restoring) return false;
  const changed = pushHistorySnapshot(cloneStateForHistory());
  updateUndoRedoButtons();
  return changed;
}

export function recordHistoryIfChanged(beforeSignature) {
  if (history.restoring) return false;
  const afterSnapshot = cloneStateForHistory();
  const afterSignature = JSON.stringify(afterSnapshot);
  if (beforeSignature === afterSignature) {
    return false;
  }
  const changed = pushHistorySnapshot(afterSnapshot);
  updateUndoRedoButtons();
  if (changed) runAutosaveHooks();
  return changed;
}

async function refreshUiAfterHistoryRestore() {
  closePresentToothRadialQuickPick();
  try {
    const [catalog, locks] = await Promise.all([
      import("./annotationCatalog.js"),
      import("./annotationLocks.js"),
    ]);
    catalog.renderComponentCatalog();
    locks.updateEditModeUI();
  } catch {}
  renderJaws();
}

function updateUndoRedoButtons() {
  const undoDisabled = history.past.length < 2;
  const redoDisabled = history.future.length === 0;
  ["undoWorkflowBtn", "footerUndoBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = undoDisabled;
  });
  ["redoWorkflowBtn", "footerRedoBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = redoDisabled;
  });
}

export async function undoWorkflow() {
  if (history.past.length < 2) {
    setMessage("Nothing to undo.", true);
    return;
  }
  const current = history.past.pop();
  history.future.push(current);
  const target = history.past[history.past.length - 1];
  history.restoring = true;
  try {
    applyHistorySnapshot(target);
  } finally {
    history.restoring = false;
  }
  await refreshUiAfterHistoryRestore();
  updateUndoRedoButtons();
  setMessage("Undo applied.", false);
}

export async function redoWorkflow() {
  if (history.future.length === 0) {
    setMessage("Nothing to redo.", true);
    return;
  }
  const target = history.future.pop();
  history.past.push(target);
  history.restoring = true;
  try {
    applyHistorySnapshot(target);
  } finally {
    history.restoring = false;
  }
  await refreshUiAfterHistoryRestore();
  updateUndoRedoButtons();
  setMessage("Redo applied.", false);
}

function bindHistoryControls() {
  const undoBtn = document.getElementById("undoWorkflowBtn");
  const redoBtn = document.getElementById("redoWorkflowBtn");
  if (undoBtn) undoBtn.addEventListener("click", () => undoWorkflow());
  if (redoBtn) redoBtn.addEventListener("click", () => redoWorkflow());
  const footerUndo = document.getElementById("footerUndoBtn");
  const footerRedo = document.getElementById("footerRedoBtn");
  if (footerUndo) footerUndo.addEventListener("click", () => undoWorkflow());
  if (footerRedo) footerRedo.addEventListener("click", () => redoWorkflow());
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    const key = String(event.key || "").toLowerCase();
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && key === "z") {
      event.preventDefault();
      undoWorkflow();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && (key === "y" || (event.shiftKey && key === "z"))) {
      event.preventDefault();
      redoWorkflow();
    }
  });
}

export function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

export function setMessage(message, isError) {
  const el = document.getElementById("saveMessage");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
}

export function downloadJson(fileName, data) {
  downloadBlob(fileName, JSON.stringify(data, null, 2), "application/json");
}

export function downloadText(fileName, text) {
  downloadBlob(fileName, text, "text/plain;charset=utf-8");
}

function downloadBlob(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function svgEl(tagName, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

/** Position a floating panel near an anchor point (clamped to viewport). */
export function positionAnteriorRestPanel(panel, anchor) {
  const margin = 8;
  const gap = 14;
  if (!panel) return;
  if (!anchor || !Number.isFinite(anchor.clientX) || !Number.isFinite(anchor.clientY)) {
    const w = panel.getBoundingClientRect().width || 200;
    const h = panel.getBoundingClientRect().height || 80;
    panel.style.left = `${Math.round(window.innerWidth / 2 - w / 2)}px`;
    panel.style.top = `${Math.round(window.innerHeight / 2 - h / 2)}px`;
    return;
  }
  const rect = panel.getBoundingClientRect();
  let left = anchor.clientX - rect.width / 2;
  let top = anchor.clientY - rect.height - gap;
  if (top < margin) {
    top = anchor.clientY + gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

// Render bridge (registerRender + mesh env) so render module can register implementations.
let renderJawImpl = () => {};
let renderJawsImpl = () => {};
let cloneArchTintDefsImpl = () => null;

export function registerRender(fns) {
  renderJawImpl = fns.renderJaw;
  renderJawsImpl = fns.renderJaws;
  if (fns.cloneArchTintDefs) cloneArchTintDefsImpl = fns.cloneArchTintDefs;
}

// Tint filters live in a shared <svg> outside the arch, so a standalone serialized arch
// resolves every `filter: url(#…)` to nothing and renders untinted. Paste this copy back.
export function cloneArchTintDefs() {
  return cloneArchTintDefsImpl();
}

export function renderJaw(jaw) {
  return renderJawImpl(jaw);
}

export function renderJaws() {
  updateJawMaterialBadge();
  return renderJawsImpl();
}

// Shows the denture-base material in the corner badge, hidden while null. Called from
// renderJaws so it stays fresh across placement, load, undo/redo and the prompt.
const JAW_MATERIAL_LABELS = { 0: "Metal", 2: "Full Acrylic" };
export function updateJawMaterialBadge() {
  const badge = document.getElementById("jawMaterialBadge");
  if (!badge) return;
  const label = JAW_MATERIAL_LABELS[state.jawMaterial];
  badge.classList.toggle("is-hidden", !label);
  if (label) badge.textContent = `Material : ${label}`;
}

let meshAnnotationEnvImpl = () => ({});

export function registerMeshAnnotationEnv(fn) {
  meshAnnotationEnvImpl = fn;
}

export function meshAnnotationEnv() {
  return meshAnnotationEnvImpl();
}

// Present-tooth quick pick (square 2x2 layout).
const QUICK_PICK_SIZE = 104;

function onPresentToothRadialKeydown(ev) {
  if (ev.key === "Escape") {
    closePresentToothRadialQuickPick();
  }
}

export function closePresentToothRadialQuickPick() {
  const host = ui.presentToothRadialHost;
  if (!host) {
    return;
  }
  host.remove();
  ui.presentToothRadialHost = null;
  document.removeEventListener("keydown", onPresentToothRadialKeydown);
}

function firstCatalogIdForTab(tabId) {
  const row = COMPONENT_CATALOG.find((e) => e.tab === tabId);
  return row?.id || null;
}

async function applyQuickPickSelection(tabId, componentId, options = {}) {
  const historyBefore = getHistoryStateSignature();
  try {
    const id = componentId && COMPONENT_BY_ID.has(componentId) ? componentId : firstCatalogIdForTab(tabId);
    if (!id || !COMPONENT_BY_ID.has(id)) {
      setMessage(`No component found for tab "${tabId}".`, true);
      return;
    }
    state.selectedTab = tabId;
    state.suppressArchPlacementSuggestions = false;

    const placeOnToothId = options?.placeOnToothId ? String(options.placeOnToothId) : null;

    // RECIP MESH/PLATE quick-picks place plate-crossmesh/plate-prox on the tapped
    // tooth directly — one-tooth, unlike the catalog's auto-place-on-arch flow.
    if (placeOnToothId && (id === "plate-crossmesh" || id === "plate-prox")) {
      state.selectedComponentId = id;
      const tooth = state.teeth[placeOnToothId];
      if (tooth) {
        const teethModel = await import("./annotationTeethModel.js");
        teethModel.ensureToothPlacementState(tooth);
        tooth.componentPlacements = (tooth.componentPlacements || []).filter(
          (entry) =>
            entry.componentId !== "reciprocating-clasp" &&
            entry.componentId !== "plate-prox" &&
            entry.componentId !== "plate-crossmesh"
        );
        teethModel.addPlacement(tooth, id, null);
        teethModel.syncToothComponentsFromPlacements(tooth);
        const label = COMPONENT_BY_ID.get(id)?.label || id;
        setMessage(`Placed ${label} on tooth ${placeOnToothId}.`, false);
        import("./annotationCatalog.js")
          .then(({ renderComponentCatalog }) => renderComponentCatalog())
          .catch(() => {});
        renderJaws();
        return;
      }
    }

    // Everything else defers to the catalog's click handler so each type is treated
    // properly. Selecting alone isn't enough — the preview vanishes on the next click.
    const { handleDesignComponentSelect } = await import("./annotationCatalog.js");
    handleDesignComponentSelect(id);
  } catch (error) {
    console.error("applyQuickPickSelection failed", error);
    setMessage("Could not apply quick pick selection.", true);
    renderJaws();
  } finally {
    recordHistoryIfChanged(historyBefore);
  }
}

/**
 * Present-tooth quick picker (Rest / Bar / Recip / Clasp). Touch gets a centred sheet;
 * mouse gets the radial wheel, whose tiny labels are unusable with a finger.
 */
export function showPresentToothRadialQuickPick(toothId, clientX, clientY) {
  closePresentToothRadialQuickPick();

  // Desktop radial: 4 hand-curated quick-picks + a RECIP submenu, anchored at the click.
  const radialMain = [
    { label: "REST", tab: "rests", componentId: "rest-seat", pos: "top-left" },
    { label: "BAR", tab: "bars", componentId: "bar-i", pos: "top-right" },
    { label: "RECIP", menu: "recip", pos: "bottom-left" },
    { label: "CLASP", tab: "clasps", componentId: "retainer-clasp", pos: "bottom-right" },
  ];
  const radialRecip = [
    {
      label: "RECIP CLASP",
      tab: "clasps",
      componentId: "reciprocating-clasp",
      pos: "top-left",
    },
    { label: "RECIP PLATE", tab: "plate", componentId: "plate-prox", pos: "top-right" },
    { label: "RECIP MESH", tab: "plate", componentId: "plate-crossmesh", pos: "bottom-left" },
    { label: "BACK", menu: "main", pos: "bottom-right", icon: "../../back.png" },
  ];

  // Mobile sheet: every COMPONENT_TABS category except the CASE NOTE form, drilling
  // category -> items -> commit. Replaces the #componentTabs strip, hidden on touch.
  const sheetCategories = COMPONENT_TABS
    .filter((tab) => tab.kind !== "form")
    .map((tab) => ({
      label: tab.label,
      tabId: tab.id,
      icon: COMPONENT_BY_ID.get(firstCatalogIdForTab(tab.id))?.icon || null,
    }));

  // `(pointer: coarse)` = touch/stylus primary input; mouse keeps the radial wheel.
  const useMobileSheet =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  // Commit a pick: select it (place directly for the plate-on-tooth variants), then close.
  const commit = async (action) => {
    const placeOnToothId =
      action.componentId === "plate-crossmesh" || action.componentId === "plate-prox"
        ? toothId
        : null;
    await applyQuickPickSelection(action.tab, action.componentId, { placeOnToothId });
    closePresentToothRadialQuickPick();
  };

  // Desktop radial submenu nav (RECIP → items → BACK); the mobile sheet navigates itself.
  const runActionOrNavigate = async (action, renderMenu) => {
    if (action.menu === "recip") return renderMenu("recip");
    if (action.menu === "main") return renderMenu("main");
    await commit(action);
  };

  const backdrop = document.createElement("div");
  backdrop.className = useMobileSheet
    ? "tooth-quickpick-backdrop"
    : "tooth-radial-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const panel = useMobileSheet
    ? buildToothQuickPickSheet(toothId, sheetCategories, commit)
    : buildToothRadialPanel(toothId, radialMain, radialRecip, runActionOrNavigate);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  ui.presentToothRadialHost = backdrop;

  if (!useMobileSheet) {
    // Anchor the wheel at the click point; the mobile sheet is centered via CSS.
    const left = Math.max(
      8,
      Math.min(clientX - QUICK_PICK_SIZE / 2, window.innerWidth - QUICK_PICK_SIZE - 8)
    );
    const top = Math.max(
      8,
      Math.min(clientY - QUICK_PICK_SIZE / 2, window.innerHeight - QUICK_PICK_SIZE - 8)
    );
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closePresentToothRadialQuickPick();
    }
  });
  document.addEventListener("keydown", onPresentToothRadialKeydown);
}

function buildToothRadialPanel(toothId, mainActions, recipActions, runActionOrNavigate) {
  const panel = document.createElement("div");
  panel.className = "tooth-radial-panel";
  const center = document.createElement("div");
  center.className = "tooth-radial-tooth-id";
  center.textContent = String(toothId);
  panel.appendChild(center);

  const renderMenu = (menu) => {
    panel.querySelectorAll(".tooth-radial-option").forEach((node) => node.remove());
    const actions = menu === "recip" ? recipActions : mainActions;
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `tooth-radial-option ${action.pos}`;
      button.setAttribute("aria-label", action.label);
      button.setAttribute("data-tooltip", action.label);
      const iconPath =
        action.icon || (action.componentId ? COMPONENT_BY_ID.get(action.componentId)?.icon : null);
      if (iconPath) {
        const icon = document.createElement("img");
        icon.className = "tooth-radial-option-icon";
        if (action.menu === "main") icon.classList.add("tooth-radial-option-icon-back");
        icon.src = iconPath;
        icon.alt = action.label;
        button.appendChild(icon);
      } else {
        button.textContent = action.label;
      }
      button.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await runActionOrNavigate(action, renderMenu);
      });
      panel.appendChild(button);
    }
  };
  renderMenu("main");
  return panel;
}

function buildToothQuickPickSheet(toothId, categories, commit) {
  const sheet = document.createElement("div");
  sheet.className = "tooth-quickpick-sheet";

  // Header: [back] [title] [close]. Back shows only when drilled into a category.
  const header = document.createElement("div");
  header.className = "tooth-quickpick-header";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "tooth-quickpick-back is-hidden";
  backBtn.setAttribute("aria-label", "Back to categories");
  backBtn.innerHTML = "&larr;";

  const heading = document.createElement("span");
  heading.className = "tooth-quickpick-id";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tooth-quickpick-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closePresentToothRadialQuickPick();
  });

  header.appendChild(backBtn);
  header.appendChild(heading);
  header.appendChild(closeBtn);
  sheet.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "tooth-quickpick-grid";
  sheet.appendChild(grid);

  // Build one tile (icon + label). Caller supplies onClick so the shape works for
  // categories and items. `iconAsMask` renders via CSS mask to tint mesh SVGs.
  const buildTile = (label, iconPath, onClick, options = {}) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tooth-quickpick-tile";
    if (options.tileClass) tile.classList.add(options.tileClass);
    tile.setAttribute("aria-label", label);
    if (iconPath) {
      if (options.iconAsMask) {
        const maskEl = document.createElement("span");
        maskEl.className = "tooth-quickpick-tile-icon tooth-quickpick-tile-icon--mask";
        const maskUrl = `url("${iconPath}")`;
        maskEl.style.setProperty("--tile-icon-mask", maskUrl);
        // iOS Safari: set the mask URL directly (unreliable via var() in -webkit-mask-image).
        maskEl.style.webkitMaskImage = maskUrl;
        maskEl.style.maskImage = maskUrl;
        tile.appendChild(maskEl);
      } else {
        const img = document.createElement("img");
        img.className = "tooth-quickpick-tile-icon";
        img.src = iconPath;
        img.alt = "";
        tile.appendChild(img);
      }
    }
    const text = document.createElement("span");
    text.className = "tooth-quickpick-tile-label";
    text.textContent = label;
    tile.appendChild(text);
    tile.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await onClick();
    });
    return tile;
  };

  const renderCategories = () => {
    heading.textContent = `Tooth ${toothId}`;
    backBtn.classList.add("is-hidden");
    grid.classList.remove("is-items-view");
    grid.innerHTML = "";
    for (const cat of categories) {
      // Mesh icon is black/transparent PNG — mask it to pick up the violet mesh tint.
      const opts =
        cat.tabId === "mesh"
          ? { iconAsMask: true, tileClass: "tooth-quickpick-tile--mesh" }
          : undefined;
      grid.appendChild(buildTile(cat.label, cat.icon, () => renderItems(cat), opts));
    }
  };

  const renderItems = (cat) => {
    heading.textContent = cat.label;
    backBtn.classList.remove("is-hidden");
    grid.classList.add("is-items-view");
    grid.innerHTML = "";
    const items = COMPONENT_CATALOG.filter(
      (entry) => entry.tab === cat.tabId && entry.hidden !== true
    );
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "tooth-quickpick-empty";
      empty.textContent = "No components in this category.";
      grid.appendChild(empty);
      return;
    }
    for (const item of items) {
      // Mesh icons are white silhouettes recoloured by CSS mask — except Mesh Flange, whose
      // PNG is full-colour artwork that a mask collapses to a violet square.
      const tintMesh = isMeshComponent(item.id) && item.id !== "mesh-flange";
      grid.appendChild(
        buildTile(
          item.label,
          item.icon,
          () => commit({ tab: item.tab, componentId: item.id, label: item.label }),
          tintMesh ? { iconAsMask: true, tileClass: "tooth-quickpick-tile--mesh" } : undefined
        )
      );
    }
  };

  backBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    renderCategories();
  });

  renderCategories();
  return sheet;
}

export function closeRemoveComponentDialog() {
  if (typeof ui.removeComponentDialogCleanup === "function") {
    ui.removeComponentDialogCleanup();
    ui.removeComponentDialogCleanup = null;
  }
}

// A tooth carries at most one clasp of each type (annotationPlacement enforces it), so the
// corner tells the user nothing they need to pick the right row — unlike a rest seat, which
// can legitimately sit on both sides of the same tooth.
function formatPlacementSurfaceForRemoveUi(componentId, surface) {
  if (!surface || isClaspComponent(componentId)) return "";
  return String(surface).replace(/_/g, " ");
}

export async function openRemoveComponentPicker(toothId, jaw, anchorEvent) {
  closeRemoveComponentDialog();
  closePresentToothRadialQuickPick();

  const root = document.getElementById("removeComponentDialog");
  const panel = root?.querySelector(".remove-component-dialog-panel");
  const backdrop = root?.querySelector(".remove-component-dialog-backdrop");
  const listEl = document.getElementById("removeComponentList");
  const titleEl = document.getElementById("removeComponentDialogTitle");
  const hintEl = document.getElementById("removeComponentDialogHint");
  const cancelBtn = document.getElementById("removeComponentDialogCancel");

  const tooth = state.teeth[toothId];
  if (!root || !panel || !backdrop || !listEl || !titleEl || !hintEl || !cancelBtn || !tooth) {
    setMessage("Could not open remove list for this tooth.", true);
    return;
  }

  const teethModel = await import("./annotationTeethModel.js");
  teethModel.ensureToothPlacementState(tooth);
  // Source of truth is `componentPlacements`; also include legacy `components`-only
  // entries so the user can still remove them.
  const placements = (tooth.componentPlacements || []).map((entry, idx) => ({
    ...entry,
    _index: idx,
  }));
  const legacy = Array.isArray(tooth.components) ? tooth.components : [];
  for (const componentId of legacy) {
    if (!placements.some((p) => p.componentId === componentId)) {
      placements.push({ componentId, surface: null, _index: null });
    }
  }

  const visiblePlacements =
    state.hideLowerPlateVisuals && jaw === "lower"
      ? placements.filter((entry) => !isPlateComponentId(entry.componentId))
      : placements;

  titleEl.textContent = `Remove component — Tooth ${toothId}`;
  listEl.innerHTML = "";

  if (visiblePlacements.length === 0) {
    hintEl.textContent = "This tooth has no components to remove.";
    hintEl.classList.remove("is-hidden");
  } else {
    hintEl.textContent = "";
    hintEl.classList.add("is-hidden");
  }

  const itemHandlers = [];

  const cleanup = () => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.removeEventListener("click", onBackdrop);
    cancelBtn.removeEventListener("click", onCancel);
    for (const h of itemHandlers) {
      h.btn.removeEventListener("click", h.fn);
    }
    panel.style.left = "";
    panel.style.top = "";
    panel.style.visibility = "";
    root.classList.add("is-hidden");
    root.setAttribute("aria-hidden", "true");
    ui.removeComponentDialogCleanup = null;
  };

  const finish = () => cleanup();

  const onKeyDown = (e) => {
    if (e.key === "Escape") finish();
  };
  const onBackdrop = () => finish();
  const onCancel = () => finish();

  visiblePlacements.forEach((entry) => {
    const def = COMPONENT_BY_ID.get(entry.componentId);
    const label = def?.label || entry.componentId;
    const surf = formatPlacementSurfaceForRemoveUi(entry.componentId, entry.surface);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-component-item-btn";
    btn.textContent = surf ? `${label} (${surf})` : label;
    const fn = async () => {
      const historyBefore = getHistoryStateSignature();
      const t = state.teeth[toothId];
      if (!t) {
        finish();
        return;
      }
      teethModel.ensureToothPlacementState(t);
      const placement = await import("./annotationPlacement.js");
      if (placement.shouldBlockMajorConnectorRemoval(toothId, entry, state.teeth)) {
        setMessage("Cannot remove this major connector part because it is connected on both sides.", true);
        return;
      }
      let removed = null;
      if (Number.isInteger(entry._index) && entry._index >= 0) {
        removed = teethModel.removePlacementAtIndex(t, entry._index);
      } else {
        const idx = (t.componentPlacements || []).findIndex(
          (p) => p.componentId === entry.componentId && p.surface === entry.surface
        );
        if (idx >= 0) {
          removed = teethModel.removePlacementAtIndex(t, idx);
        }
      }
      placement.applyRemovalSideEffectsForTooth(t, removed);
      const defR = removed ? COMPONENT_BY_ID.get(removed.componentId) : null;
      const name = defR?.label || removed?.componentId || "item";
      setMessage(`Removed ${name} from tooth ${toothId}.`, false);
      finish();
      renderJaws();
      recordHistoryIfChanged(historyBefore);
    };
    btn.addEventListener("click", fn);
    itemHandlers.push({ btn, fn });
    listEl.appendChild(btn);
  });

  document.addEventListener("keydown", onKeyDown);
  backdrop.addEventListener("click", onBackdrop);
  cancelBtn.addEventListener("click", onCancel);

  ui.removeComponentDialogCleanup = cleanup;

  panel.style.visibility = "hidden";
  root.classList.remove("is-hidden");
  root.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      positionAnteriorRestPanel(panel, anchorEvent);
      panel.style.visibility = "";
      cancelBtn.focus();
    });
  });
}

function initializeCaseIds() {
  const params = new URLSearchParams(window.location.search);
  state.encryptedCaseId = params.get("id") || "";
  let parsedCaseId = null;
  if (state.encryptedCaseId) {
    try {
      const decrypted = Number(lol(state.encryptedCaseId));
      if (Number.isFinite(decrypted)) parsedCaseId = decrypted;
    } catch {
      parsedCaseId = null;
    }
  }
  state.caseIntID = parsedCaseId;
  const label = document.getElementById("caseLabel");
  if (label) label.textContent = `Case: ${state.caseIntID ?? "Unknown"}`;
}

// Shared memoized POST /case/get/:id, started early to overlap module downloads. `force`
// re-reads, and is REQUIRED before any full-row PUT /case/:id.
export function fetchCaseDetail({ force = false } = {}) {
  if (!force && state.__caseDetailPromise) return state.__caseDetailPromise;
  if (!state.caseIntID) return Promise.resolve(null);
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser?.uuid) return Promise.resolve(null);
  state.__caseDetailPromise = fetch(
    `${API_BASE}/case/get/${state.caseIntID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          machine_id: MACHINE_ID,
          uuid: loggedInUser.uuid,
          caseIntID: state.caseIntID,
        },
      ]),
    }
  )
    .then(async (response) => {
      logApi(response, "POST /case/get/:id");
      if (!response.ok) return null;
      return response.json();
    })
    .catch((err) => {
      console.warn("Failed to fetch case detail:", err);
      return null;
    });
  return state.__caseDetailPromise;
}

async function fetchCaseOwner() {
  const detail = await fetchCaseDetail();
  if (!detail) return;
  if (detail.username) state.caseOwner = detail.username;
  if (detail.case_id) {
    state.caseName = detail.case_id;
    const label = document.getElementById("caseLabel");
    const caseIntId = detail.id ?? state.caseIntID;
    if (label) {
      label.textContent =
        caseIntId != null
          ? `${caseIntId} : ${detail.case_id}`
          : `Case: ${detail.case_id}`;
    }
  }
}

// Fetch the case's L2 jaw struct and apply it to state. Codec in jawStructCodec.js,
// HTTP in jawStructApi.js. window.__jawStruct kept for console inspection.
async function fetchJawStruct(recordsPromise = null) {
  if (!state.caseIntID) return;
  const loggedInUser = getLoggedInUser();

  // Prefer the request started early in init(); fall back to firing it here.
  let records = null;
  if (recordsPromise) {
    records = await recordsPromise;
  } else if (loggedInUser?.uuid) {
    try {
      records = await apiFetchJawStruct(state.caseIntID, loggedInUser.uuid);
    } catch (err) {
      console.warn("Failed to fetch jawstruct:", err);
    }
  }

  if (Array.isArray(records) && records.length) {
    const decoded = decodeJawStructResponse(records);
    window.__jawStruct = decoded.raw;
    // A design exists on the server — preserve its saved denture-base material
    // (default metal/0 if the field is absent) so a re-save doesn't lose it.
    const savedMaterial = Number(
      decoded.upper?.other?.["Jaw Material"] ??
        decoded.lower?.other?.["Jaw Material"]
    );
    state.jawMaterial = Number.isFinite(savedMaterial) ? savedMaterial : 0;
    // Apply each jaw independently so one failing doesn't skip the other.
    try {
      if (decoded.upper) applyJawStructDesign(resolveJawStructDesign(decoded.upper), state);
    } catch (err) {
      console.error("[jawStructApply] upper apply failed:", err);
    }
    try {
      if (decoded.lower) applyJawStructDesign(resolveJawStructDesign(decoded.lower), state);
    } catch (err) {
      console.error("[jawStructApply] lower apply failed:", err);
    }
    setMessage("Loaded 2D design from server.", false);
  } else {
    // The backend is authoritative. A localStorage-only design lacks the raw desktop
    // fields, so Save would emit defaults — reset to a clean arch instead.
    await resetJawStructDesignToBaseline();
    // Fresh case with no prior design — leave the material unset so locking the
    // empty arch prompts for it (annotationLocks.maybePromptJawMaterial).
    state.jawMaterial = null;
    setMessage("No server 2D design for this case — starting from a clean arch.", false);
  }

  renderJaws();
  // This load is the working baseline — re-seed undo history so it isn't undoable.
  history.past = [cloneStateForHistory()];
  history.future = [];
  updateUndoRedoButtons();
}

// Reset to a clean baseline (all teeth present, no components/raw fields/tail).
// Used when the backend has no design, so stale localStorage can't drive a Save.
async function resetJawStructDesignToBaseline() {
  const teethModel = await import("./annotationTeethModel.js");
  teethModel.initializeTeethState();
  state.jawStructTail = {};
}

// Posts both jaws to POST /jawstruct/l2, returning { upper, lower } or { ok:false, reason }
// when there's no case or login. Used by Save and the off-by-default autosave hook.
export async function postJawStructToServer() {
  if (!state.caseIntID) {
    console.warn("[2D-post] skipped — no caseIntID");
    return { ok: false, reason: "no-case" };
  }
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser?.uuid) {
    console.warn("[2D-post] skipped — not logged in");
    return { ok: false, reason: "no-auth" };
  }
  console.log(`[2D-post] posting 2D structure for case ${state.caseIntID} (upper + lower)…`);
  const res = await saveJawStructFromState(state.caseIntID, loggedInUser.uuid, state);
  console.log("[2D-post] post result:", {
    upper: res?.upper?.ok ? `ok (${res.upper.status})` : `FAILED (${res?.upper?.status})`,
    lower: res?.lower?.ok ? `ok (${res.lower.status})` : `FAILED (${res?.lower?.status})`,
  });
  return res;
}

// Autosave hook — off by default (see ENABLE_JAW_STRUCT_AUTOSAVE up top).
async function saveJawStructAutosave() {
  if (!ENABLE_JAW_STRUCT_AUTOSAVE) return;
  try {
    await postJawStructToServer();
  } catch (err) {
    console.warn("Failed to save jawstruct:", err);
  }
}
registerAutosaveHook(saveJawStructAutosave);

// ---- Kennedy design proposal ----------------------------------------------
// Classifies each arch from the jaw struct as it stands (design on open plus any presence
// edits since), picks the major connector its Kennedy class calls for, and previews the
// placed result. Nothing lands on the arch until the user confirms.

// Restore point for the preview: the proposal is applied for real to render the thumbnails,
// then rolled back so the arch behind the dialog is untouched until Place Design.
function snapshotDesignState() {
  return {
    teeth: JSON.parse(JSON.stringify(state.teeth)),
    archOverlayPalatalHoleActive: state.archOverlayPalatalHoleActive,
    hideLowerPlateVisuals: state.hideLowerPlateVisuals,
  };
}

function restoreDesignState(snapshot) {
  state.teeth = snapshot.teeth;
  state.archOverlayPalatalHoleActive = snapshot.archOverlayPalatalHoleActive;
  state.hideLowerPlateVisuals = snapshot.hideLowerPlateVisuals;
}

// Apply the proposal to the live arch. Deterministic from tooth presence + material, so
// the preview pass and the confirmed pass produce the same design. Each render flag is
// adopted only when its own jaw was in the proposal — a lower-only apply must not clear
// an overlay the upper arch is still using.
function applyKennedyProposal(proposal) {
  const flags = applyDesignProposal(state.teeth, proposal);
  if (proposal.jaws.upper) state.archOverlayPalatalHoleActive = flags.archOverlayPalatalHoleActive;
  if (proposal.jaws.lower) state.hideLowerPlateVisuals = flags.hideLowerPlateVisuals;
}

function buildCurrentProposal() {
  return buildDesignProposal(state.teeth, {
    material: state.jawMaterial,
    meshId: getDefaultMeshIdForDesignMode(meshSelectionContextFromState(state), COMPONENT_BY_ID),
  });
}

// A preview per jaw, each with its own checkbox. An arch Kennedy gives no class has
// nothing to place, so its row is disabled rather than merely unchecked.
function renderKennedyProposalPanel(panel, proposal, thumbnails) {
  for (const row of panel.querySelectorAll(".kennedy-class-row")) {
    const jaw = row.dataset.jaw;
    const { classification, connector } = proposal.jaws[jaw];
    state.kennedy[jaw] = classification;

    row.classList.toggle("is-unclassified", !connector);
    const checkbox = row.querySelector(".kennedy-jaw-checkbox");
    checkbox.disabled = !connector;
    checkbox.checked = Boolean(connector);

    const img = row.querySelector(".kennedy-preview-img");
    const src = connector ? thumbnails?.[jaw] : null;
    if (src) img.setAttribute("src", src);
    else img.removeAttribute("src");
  }
}

// Render the proposal, photograph both arches, then roll the arch back — the dialog shows
// what the design WOULD look like while the live arch stays as the user left it.
async function captureProposalThumbnails(proposal) {
  const snapshot = snapshotDesignState();
  try {
    applyKennedyProposal(proposal);
    renderJaws();
    const locks = await import("./annotationLocks.js");
    return await locks.captureArchThumbnails();
  } catch (err) {
    console.warn("[kennedyProposal] preview capture failed", err);
    return null;
  } finally {
    restoreDesignState(snapshot);
    renderJaws();
  }
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || null;
}

function normalizeDllProposalRecords(body) {
  const wrappers = [body, body?.data, body?.result, body?.payload].filter(Boolean);
  for (const wrapper of wrappers) {
    const direct = firstArray(wrapper.records, wrapper.jaw_records, wrapper.jawRecords);
    if (direct?.length) return direct;

    const options = firstArray(wrapper.options, wrapper.design_options, wrapper.designOptions);
    if (!options?.length) continue;
    const option = options.find((item) => firstArray(item?.records, item?.jaw_records, item?.jawRecords)?.length) || options[0];
    const optionRecords = firstArray(option?.records, option?.jaw_records, option?.jawRecords);
    if (optionRecords?.length) return optionRecords;
  }
  return [];
}

async function refreshDesignUiAfterJawStructApply() {
  try {
    const [catalog, locks] = await Promise.all([
      import("./annotationCatalog.js"),
      import("./annotationLocks.js"),
    ]);
    catalog.renderComponentCatalog();
    locks.updateEditModeUI();
  } catch (_) {}
}

function jawsWithDllProposalTargets() {
  return ["upper", "lower"].filter((jaw) =>
    Boolean(classifyArch(state.teeth, jaw)?.classNumber)
  );
}

async function tryLoadDllProposedDesign() {
  if (!state.caseIntID) {
    throw new Error("No case is selected.");
  }
  const loggedInUser = getLoggedInUser();
  if (!loggedInUser?.uuid) {
    throw new Error("No logged-in user UUID is available.");
  }

  const material = Number.isFinite(Number(state.jawMaterial)) ? Number(state.jawMaterial) : 0;
  const jaws = jawsWithDllProposalTargets();
  if (!jaws.length) {
    throw new Error("No partial-edentulous jaw selected for proposed design.");
  }
  const historyBefore = getHistoryStateSignature();
  const response = await generateDentureDesignSelect(state.caseIntID, loggedInUser.uuid, state, {
    jawMaterial: material,
    designOption: 1,
    jaws,
  });
  if (!response?.ok) {
    throw new Error(`DLL request failed with status ${response?.status || 0}`);
  }

  const records = normalizeDllProposalRecords(response.body);
  if (!records.length) {
    const returnCode = response.body?.return_code ?? response.body?.returnCode;
    throw new Error(
      returnCode == null
        ? "DLL response did not include jaw-struct records."
        : `DLL response did not include jaw-struct records (return_code=${returnCode}).`
    );
  }

  const decoded = decodeJawStructResponse(records);
  let applied = false;
  const savedMaterial = Number(
    decoded.upper?.other?.["Jaw Material"] ??
      decoded.lower?.other?.["Jaw Material"] ??
      material
  );
  state.jawMaterial = Number.isFinite(savedMaterial) ? savedMaterial : material;

  try {
    if (decoded.upper) {
      applyJawStructDesign(resolveJawStructDesign(decoded.upper), state);
      applied = true;
    }
  } catch (err) {
    console.error("[proposedDesign] upper DLL design apply failed:", err);
  }
  try {
    if (decoded.lower) {
      applyJawStructDesign(resolveJawStructDesign(decoded.lower), state);
      applied = true;
    }
  } catch (err) {
    console.error("[proposedDesign] lower DLL design apply failed:", err);
  }

  if (!applied) {
    throw new Error("DLL response could not be applied to either jaw.");
  }

  await refreshDesignUiAfterJawStructApply();
  renderJaws();
  recordHistoryIfChanged(historyBefore);
  setMessage("Loaded the proposed design from the DLL.", false);
  toast.success("Proposed design loaded");
  return true;
}

// Wire the "Load Proposed Design" button to the DLL first, then the fallback modal.
function bindKennedyProposalDialog() {
  const btn = document.getElementById("loadProposalBtn");
  const modal = document.getElementById("loadTemplateJawModal");
  const backdrop = modal?.querySelector(".load-template-backdrop");
  const panel = document.getElementById("kennedyClassPanel");
  const cancelBtn = document.getElementById("loadTemplateCancelBtn");
  const applyBtn = document.getElementById("kennedyApplyBtn");

  if (!btn) return;
  // Modal markup missing — keep the button honest rather than silently dead.
  if (!modal || !panel || !cancelBtn || !applyBtn) {
    btn.addEventListener("click", () =>
      setMessage("The design proposal is unavailable on this page.", true)
    );
    return;
  }

  /** The proposal currently on screen, re-applied on confirm for the checked jaws only. */
  let pendingProposal = null;

  /** The jaws the user left ticked, narrowed to the ones that have something to place. */
  const selectedJaws = () =>
    [...panel.querySelectorAll(".kennedy-jaw-checkbox")]
      .filter((box) => box.checked && !box.disabled)
      .map((box) => box.dataset.jaw);

  const syncApplyButton = () => {
    applyBtn.disabled = selectedJaws().length === 0;
  };

  const closeModal = () => {
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    pendingProposal = null;
  };

  const openModal = async () => {
    setMessage("Generating proposed design...", false);
    try {
      if (await tryLoadDllProposedDesign()) return;
    } catch (err) {
      console.warn("[proposedDesign] DLL unavailable; showing fallback proposal", err);
      setMessage("DLL proposed design unavailable; showing fallback proposal.", false);
    }

    // Rebuilt on every open so it tracks presence edits made since the last one.
    pendingProposal = buildCurrentProposal();
    const placeable = Object.values(pendingProposal.jaws).some((plan) => plan.connector);

    const thumbnails = placeable ? await captureProposalThumbnails(pendingProposal) : null;
    renderKennedyProposalPanel(panel, pendingProposal, thumbnails);
    syncApplyButton();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
  };

  const applyProposal = async () => {
    const jaws = selectedJaws();
    if (!pendingProposal || !jaws.length) return;
    const historyBefore = getHistoryStateSignature();

    // Narrow the proposal to the ticked arches; the other one is left untouched, mesh
    // and all, since applyDesignProposal only ever walks the jaws it is handed.
    applyKennedyProposal({
      ...pendingProposal,
      jaws: Object.fromEntries(jaws.map((jaw) => [jaw, pendingProposal.jaws[jaw]])),
    });

    // A new connector changes what the catalog offers and what the edit UI shows.
    try {
      const [catalog, locks] = await Promise.all([
        import("./annotationCatalog.js"),
        import("./annotationLocks.js"),
      ]);
      catalog.renderComponentCatalog();
      locks.updateEditModeUI();
    } catch (_) {}
    renderJaws();

    const placed = jaws
      .map((jaw) => `${titleCase(jaw)}: ${pendingProposal.jaws[jaw].connector.label}`)
      .join(", ");
    closeModal();
    setMessage(`Placed the proposed design (${placed}).`, false);
    toast.success("Design placed");
    recordHistoryIfChanged(historyBefore);
  };

  panel.addEventListener("change", (event) => {
    if (event.target.classList.contains("kennedy-jaw-checkbox")) syncApplyButton();
  });

  btn.addEventListener("click", () => {
    openModal().catch((err) => {
      console.error("[kennedyProposal] could not build the proposal", err);
      setMessage("Could not build a design proposal for this case.", true);
    });
  });
  applyBtn.addEventListener("click", () => {
    applyBtn.disabled = true;
    applyProposal()
      .catch((err) => {
        console.error("[kennedyProposal] apply failed", err);
        setMessage("Could not place the proposed design.", true);
      })
      .finally(() => {
        applyBtn.disabled = false;
      });
  });
  cancelBtn.addEventListener("click", closeModal);
  backdrop?.addEventListener("click", closeModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("is-hidden")) closeModal();
  });
}

function bindPreviewPanelToggle() {
  const shell = document.querySelector(".annotation-shell");
  const btn = document.getElementById("preview3dMaximizeBtn");
  if (!shell || !btn) return;

  const maxIcon = document.getElementById("preview3dMaximizeIcon");
  const restoreIcon = document.getElementById("preview3dRestoreIcon");

  const applyMode = (mode) => {
    shell.classList.remove("preview-maximized");
    if (mode === "max") {
      shell.classList.add("preview-maximized");
      btn.setAttribute("aria-label", "Restore split view");
      if (maxIcon) maxIcon.style.display = "none";
      if (restoreIcon) restoreIcon.style.display = "";
    } else {
      btn.setAttribute("aria-label", "Maximize 3D panel");
      if (maxIcon) maxIcon.style.display = "";
      if (restoreIcon) restoreIcon.style.display = "none";
    }
    shell._previewMode = mode;
    window.dispatchEvent(new CustomEvent("preview-panel-mode", { detail: { mode } }));
    window.dispatchEvent(new Event("resize"));
  };

  // Every load starts split — the mode is deliberately NOT remembered, since the
  // maximize is mostly driven by survey aiming, not by a standing preference.
  applyMode("split");

  btn.addEventListener("click", () => {
    applyMode(shell._previewMode === "max" ? "split" : "max");
  });
}

function bindPanelSplitter() {
  const shell = document.querySelector(".annotation-shell");
  const splitter = document.getElementById("panelSplitter");
  if (!shell || !splitter) return;

  const STORAGE_KEY = "previewPanelWidthPct";
  const MIN_PCT = 25;
  const MAX_PCT = 80;

  const applyWidth = (pct) => {
    const clamped = Math.max(MIN_PCT, Math.min(MAX_PCT, pct));
    shell.style.setProperty("--preview-width", `${clamped}%`);
    return clamped;
  };

  try {
    const stored = parseFloat(localStorage.getItem(STORAGE_KEY) || "");
    if (Number.isFinite(stored)) applyWidth(stored);
  } catch {
    // ignore storage failures
  }

  let dragging = false;

  const onMove = (clientX) => {
    const rect = shell.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(shell).paddingLeft) || 0;
    const usable = rect.width - padding * 2;
    if (usable <= 0) return;
    const offset = clientX - rect.left - padding;
    const pct = (offset / usable) * 100;
    applyWidth(pct);
    window.dispatchEvent(new Event("resize"));
  };

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("is-dragging");
    document.body.classList.remove("is-panel-resizing");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    try {
      const current = shell.style.getPropertyValue("--preview-width").trim();
      const pct = parseFloat(current);
      if (Number.isFinite(pct)) localStorage.setItem(STORAGE_KEY, String(pct));
    } catch {
      // ignore
    }
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    event.preventDefault();
    onMove(event.clientX);
  };

  const onPointerUp = () => stop();

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (shell.classList.contains("preview-maximized")) return;
    dragging = true;
    splitter.classList.add("is-dragging");
    document.body.classList.add("is-panel-resizing");
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    event.preventDefault();
  });

  splitter.addEventListener("keydown", (event) => {
    if (shell.classList.contains("preview-maximized")) return;
    const step = event.shiftKey ? 5 : 2;
    const current = parseFloat(
      shell.style.getPropertyValue("--preview-width") || "38"
    );
    if (event.key === "ArrowLeft") {
      applyWidth(current - step);
      try { localStorage.setItem(STORAGE_KEY, String(current - step)); } catch {}
      window.dispatchEvent(new Event("resize"));
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      applyWidth(current + step);
      try { localStorage.setItem(STORAGE_KEY, String(current + step)); } catch {}
      window.dispatchEvent(new Event("resize"));
      event.preventDefault();
    }
  });

  splitter.addEventListener("dblclick", () => {
    if (shell.classList.contains("preview-maximized")) return;
    applyWidth(38);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    window.dispatchEvent(new Event("resize"));
  });
}

function bindBackNavigationDialog(locks) {
  const modal = document.getElementById("backConfirmModal");
  const cancelBtn = document.getElementById("backConfirmCancel");
  const backBtn = document.getElementById("backConfirmBack");
  const saveBackBtn = document.getElementById("backConfirmSaveBack");
  if (!modal || !cancelBtn || !backBtn || !saveBackBtn || !locks) return;

  // Topbar Back link is gone; the sidebar Return item triggers this confirm dialog.
  const sidebarReturnBtn = document.getElementById("sidebarReturnBtn");
  const backLink = document.getElementById("backToCaseListBtn");
  const targetHref = backLink?.getAttribute("href") || "case_list.html";

  const closeModal = () => {
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
  };

  const returnToCaseList = () => goToCaseList(targetHref);

  const openModal = () => {
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    cancelBtn.focus();
  };

  if (backLink) {
    backLink.addEventListener("click", (event) => {
      event.preventDefault();
      openModal();
    });
  }
  if (sidebarReturnBtn) {
    sidebarReturnBtn.addEventListener("click", () => {
      // Close the sidebar first so the modal isn't competing with it.
      document.getElementById("appSidebar")?.querySelector("[data-sidebar-close]")?.click();
      openModal();
    });
  }

  cancelBtn.addEventListener("click", closeModal);
  backBtn.addEventListener("click", () => {
    returnToCaseList();
  });
  // Save locally + post to backend + upload the jaw thumbnail. Returns { saved,
  // posted }; thumbnail failures only log. Shared by the modal and sidebar Save.
  const saveCurrent = async () => {
    let saved = true;
    try {
      localStorage.setItem(locks.getStorageKey(), JSON.stringify(locks.buildPayload()));
    } catch {
      saved = false;
    }
    // Post the 2D design to the backend — same as the main Save button.
    let posted = false;
    try {
      const res = await postJawStructToServer();
      posted = !!(res?.upper?.ok && res?.lower?.ok);
    } catch (err) {
      console.warn("[save] jawstruct post failed", err);
    }
    try {
      setMessage("Uploading thumbnail…", false);
      const ok = await locks.uploadJawPngThumbnail();
      if (!ok) setMessage("Thumbnail upload failed (see console).", true);
    } catch (err) {
      console.warn("[save] thumbnail upload failed", err);
    }
    return { saved, posted };
  };
  window.__ann2dSaveCurrent = saveCurrent;

  saveBackBtn.addEventListener("click", async () => {
    saveBackBtn.disabled = true;
    const { saved, posted } = await saveCurrent();
    // flashToast survives the navigation below and shows on the next page.
    if (posted) flashToast("Saved successfully", "success");
    else if (saved) flashToast("Saved locally; server save failed — see console.", "warning");
    else flashToast("Could not save. Going back anyway.", "warning");
    returnToCaseList();
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("is-hidden")) {
      closeModal();
    }
  });
}

function start() {
  if (ui.hasInitialized) return;
  // This module graph is also imported by the case list (bulk-download report),
  // where the annotation DOM is absent — so auto-init must no-op there. Gate on root.
  if (!document.querySelector(".annotation-shell")) return;
  ui.hasInitialized = true;
  initAnnFooter();
  init();
}

async function initSidebar() {
  const { setupAppSidebar } = await import("../shared/appSidebar.js");
  const handle = setupAppSidebar({ indexHref: "../../index.html" });

  // Sidebar Save: run the save pipeline (no nav). Prefer window.__ann2dSaveCurrent
  // (wired by bindBackNavigationDialog); else click the main Save button.
  document.getElementById("sidebarSaveBtn")?.addEventListener("click", async () => {
    handle.close();
    const saveFn = window.__ann2dSaveCurrent;
    if (typeof saveFn === "function") {
      const { saved, posted } = await saveFn();
      if (posted) toast.success("Saved successfully");
      else if (!saved) toast.error("Save failed locally.");
      else toast.warning("Saved locally; server save failed — see console.");
    } else {
      document.getElementById("saveAnnotationBtn")?.click();
    }
  });

  document.getElementById("sidebarVersionHistoryBtn")?.addEventListener("click", async () => {
    handle.close();
    const { openVersionHistory } = await import("../pages/versionHistory.js");
    openVersionHistory();
  });
}

function initAnnFooter() {
  document.body.classList.add("has-ann-footer");

  const footerUser = getLoggedInUser();
  const userEl = document.getElementById("footerUserName");
  if (userEl) userEl.textContent = footerUser?.username || "—";


  // Screen capture lives at the lower-left of the 3D preview panel.
  document.getElementById("preview3dCaptureBtn")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("request-3d-capture"));
  });

  // Footer chat: URL already has ?id=, so chat.js resolves the case — just toggle.
  document.getElementById("footerChatBtn")?.addEventListener("click", () => {
    toggleChat();
  });

  // Case Note: mobile reaches the form from the footer (bottom sheet). Reuse
  // annotationCatalog's createCaseNoteForm for the identical form.
  const caseNoteSheet = document.getElementById("caseNoteSheet");
  document.getElementById("footerCaseNoteBtn")?.addEventListener("click", async () => {
    const body = document.getElementById("caseNoteSheetBody");
    if (!caseNoteSheet || !body) return;
    const { createCaseNoteForm } = await import("./annotationCatalog.js");
    body.innerHTML = "";
    body.appendChild(createCaseNoteForm());
    caseNoteSheet.classList.remove("is-hidden");
  });
  caseNoteSheet?.querySelectorAll("[data-cn-close]").forEach((el) =>
    el.addEventListener("click", () => caseNoteSheet.classList.add("is-hidden"))
  );

  document.getElementById("footerDownloadJawProfileBtn")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("request-download-jaw-profile"));
  });

  // Load Proposed Design: call the DLL first, then fall back to the local proposal modal.
  bindKennedyProposalDialog();

  initSidebar();

  // Mirror #caseLabel into the footer's case-name slot. Its text updates async
  // (fetchCaseOwner), so observe it rather than patch every write site.
  const caseLabel = document.getElementById("caseLabel");
  const footerCaseName = document.getElementById("footerCaseName");
  if (caseLabel && footerCaseName) {
    const sync = () => {
      const txt = caseLabel.textContent || "";
      footerCaseName.textContent = txt.replace(/^Case:\s*/i, "").trim() || "—";
    };
    sync();
    new MutationObserver(sync).observe(caseLabel, { childList: true, characterData: true, subtree: true });
  }
}

function init() {
  initializeCaseIds();
  bindPreviewPanelToggle();
  bindPanelSplitter();

  // Start the network work before the feature modules download, so requests overlap the
  // imports instead of waterfalling. Only the START is hoisted; apply/render still wait.
  fetchCaseDetail(); // shared /case/get — also reused by preview3D
  const loggedInUser = getLoggedInUser();
  // Guests still need the design or the arch renders empty, so fall back to VIEWER_UUID.
  // Save stays gated on loggedInUser.uuid, keeping them read-only.
  const designUuid = loggedInUser?.uuid || VIEWER_UUID;
  const jawStructRecordsPromise =
    state.caseIntID && designUuid
      ? apiFetchJawStruct(state.caseIntID, designUuid).catch((err) => {
          console.warn("Failed to fetch jawstruct:", err);
          return null;
        })
      : Promise.resolve(null);

  // Load render module early so render bridge + mesh env are registered.
  const renderLoad = import("./annotationRender.js");

  Promise.all([
    renderLoad,
    import("./annotationTeethModel.js"),
    import("./annotationLocks.js"),
    import("./annotationCatalog.js"),
    import("./noticeboard.js"),
    import("./clinicalInfo.js"),
    import("./previewTabs.js"),
  ])
    .then(([, teethModel, locks, catalog, noticeboard, clinicalInfo, previewTabs]) => {
      teethModel.initializeTeethState();
      locks.restoreAnnotationFromStorage();
      // Always enter the 2D editor in select (unlocked) mode, even if a locked
      // design-mode state was persisted from a previous session.
      state.locks.upper = false;
      state.locks.lower = false;
      state.designMode = false;
      bindHistoryControls();
      locks.bindStatusPicker();
      locks.bindJawControls();
      locks.bindArchWhitespaceDismiss();
      locks.bindRemoveComponentModeBtn();
      locks.bindActionButtons();
      catalog.initComponentCatalog();
      fetchCaseOwner().then(() => {
        if (state.caseOwner && state.selectedTab === "case-note") {
          catalog.renderComponentCatalog();
        }
      });
      // Authoritative load: replaces local state and re-baselines history, or resets to a
      // clean arch. Fire-and-forget so first paint isn't blocked.
      fetchJawStruct(jawStructRecordsPromise);
      locks.loadPreviewImage();
      locks.syncDesignModeWithLocks(false);
      renderJaws();
      locks.updateEditModeUI();
      bindBackNavigationDialog(locks);
      previewTabs.initPreviewTabs();
      noticeboard.initNoticeboard();
      // Deep-link: ?view=noticeboard (from the 3D viewer's Annotate button) opens
      // the noticeboard directly instead of just the editor.
      if (new URLSearchParams(window.location.search).get("view") === "noticeboard") {
        noticeboard.openNoticeboard();
      }
      clinicalInfo.initClinicalInfo();
      history.past = [cloneStateForHistory()];
      history.future = [];
      updateUndoRedoButtons();
    })
    .catch((err) => {
      console.error("2D annotation init failed", err);
      setMessage("Loaded jaw view with limited tools. Check console for init error.", true);
    });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
