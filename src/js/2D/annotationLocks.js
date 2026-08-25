import {
  COMPONENT_BY_ID,
  isBarComponent,
  isBarPlacementSurface,
} from "./components.js";
import { forEachTooth, TOOTH_ORDER } from "./constants.js";
import {
  state,
  DEFAULT_COMPONENT_ID,
  getHistoryStateSignature,
  recordHistoryIfChanged,
  registerAutosaveHook,
  postJawStructToServer,
  titleCase,
  setMessage,
  closePresentToothRadialQuickPick,
  cloneArchTintDefs,
  renderJaw,
  renderJaws,
  updateJawMaterialBadge,
} from "./2DAnnotation.js";
import { renderComponentCatalog } from "./annotationCatalog.js";
import {
  ensureToothPlacementState,
  normalizeSurface,
  statusJsonForToothRecord,
  syncToothComponentsFromPlacements,
} from "./annotationTeethModel.js";
import { loadInteractiveJawPreview, teardown3DPreview } from "./preview3D.js";
import { logApi } from "../shared/apiLog.js";
import { toast } from "../shared/toast.js";
import { API_BASE, MACHINE_ID } from "../shared/api.js";

// Bind tooth status picker buttons (presence/abutment/compromised).
export function bindStatusPicker() {
  const buttons = document.querySelectorAll(".status-btn");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.designMode) {
        setMessage("Unlock either arch to edit tooth status.", true);
        return;
      }
      state.activeStatus = button.dataset.status;
      buttons.forEach((btn) => btn.classList.toggle("is-active", btn === button));
      setMessage(`Active status: ${titleCase(state.activeStatus)}.`, false);
    });
  });
}

// Bind lock toggle + multi-tooth removal mode button.
export function bindJawControls() {
  const toggle = document.getElementById("jawLockToggleBtn");
  if (toggle) toggle.addEventListener("click", toggleBothJawsLock);
  const rangeBtn = document.getElementById("teethRangeMissingBtn");
  if (rangeBtn) {
    rangeBtn.addEventListener("click", toggleRangeMissingMode);
  }
  bindRangeMissingShiftHotkey();
  bindRangeMissingHintTooltip();
  refreshLockButtons();
  refreshRangeMissingButton();
}

// Desktop learning tooltip: the Remove-multiple-teeth button is hidden at ≥1201px,
// so teach the Shift-range shortcut via a hint on tooth hover.
const RANGE_HINT_TEXT =
  "Tip: Hold Shift, select one tooth, then click another tooth to remove the entire range.";

function bindRangeMissingHintTooltip() {
  const tooltip = document.createElement("div");
  tooltip.className = "jaw-range-hint-tooltip";
  tooltip.textContent = RANGE_HINT_TEXT;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("aria-hidden", "true");
  document.body.appendChild(tooltip);

  let visible = false;
  let currentTooth = null;

  const canShow = () =>
    window.innerWidth > 1200 && !state.designMode && !state.rangeMissingMode;

  const positionTooltip = (clientX, clientY) => {
    const margin = 12;
    const offsetX = 14;
    const offsetY = 18;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + offsetX;
    let top = clientY + offsetY;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, clientX - rect.width - offsetX);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, clientY - rect.height - offsetY);
    }
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  };

  const showTooltip = (clientX, clientY) => {
    if (visible) {
      positionTooltip(clientX, clientY);
      return;
    }
    if (!canShow()) return;
    visible = true;
    tooltip.classList.add("is-visible");
    tooltip.setAttribute("aria-hidden", "false");
    positionTooltip(clientX, clientY);
  };

  const hideTooltip = () => {
    if (!visible) return;
    visible = false;
    tooltip.classList.remove("is-visible");
    tooltip.setAttribute("aria-hidden", "true");
    currentTooth = null;
  };

  const onMouseMove = (event) => {
    const target = event.target;
    const toothEl = target && target.closest ? target.closest(".tooth") : null;
    if (!toothEl) {
      if (visible) hideTooltip();
      return;
    }
    if (toothEl !== currentTooth) {
      currentTooth = toothEl;
      showTooltip(event.clientX, event.clientY);
    } else if (visible) {
      positionTooltip(event.clientX, event.clientY);
    }
  };

  document.addEventListener("mousemove", onMouseMove, true);
  window.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
}

// Hold Shift to temporarily enter "Remove multiple teeth" mode; release to exit.
function bindRangeMissingShiftHotkey() {
  let shiftHeldActivated = false;

  const isTypingTarget = (target) =>
    target instanceof HTMLElement &&
    (target.matches("input, textarea, select") ||
      target.isContentEditable);

  const onKeyDown = (event) => {
    if (event.key !== "Shift" || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    if (state.designMode) return;
    if (state.rangeMissingMode) return;
    shiftHeldActivated = true;
    toggleRangeMissingMode();
  };

  const onKeyUp = (event) => {
    if (event.key !== "Shift") return;
    if (!shiftHeldActivated) return;
    shiftHeldActivated = false;
    if (state.rangeMissingMode) toggleRangeMissingMode();
  };

  const onBlur = () => {
    if (!shiftHeldActivated) return;
    shiftHeldActivated = false;
    if (state.rangeMissingMode) toggleRangeMissingMode();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
}

// Update visual active state for multi-tooth removal button.
function refreshRangeMissingButton() {
  const btn = document.getElementById("teethRangeMissingBtn");
  if (!btn) return;
  const active = Boolean(state.rangeMissingMode);
  btn.classList.toggle("is-active", active);
  btn.setAttribute("aria-pressed", active ? "true" : "false");
}

// Toggle multi-tooth removal mode used in selected mode.
function toggleRangeMissingMode() {
  const historyBefore = getHistoryStateSignature();
  if (state.designMode) {
    setMessage("Switch to selected mode to mark teeth missing by range.", true);
    return;
  }
  state.rangeMissingMode = !state.rangeMissingMode;
  state.rangeMissingStartToothId = null;
  refreshRangeMissingButton();
  if (state.rangeMissingMode) {
    setMessage("Remove multiple teeth: click first tooth, then second tooth to mark the span missing.", false);
    return;
  }
  setMessage("Remove multiple teeth off.", false);
  recordHistoryIfChanged(historyBefore);
}

// Bind clear/reset/save action buttons.
function silentSaveToStorage() {
  const key = getStorageKey();
  const payload = buildPayload();
  const serialized = JSON.stringify(payload);
  try {
    localStorage.setItem(key, serialized);
  } catch (err) {
    if (err?.name !== "QuotaExceededError") {
      console.warn("[2DAnnotation] autosave failed for", key, err);
      return;
    }
    // Free space by dropping autosaves for other cases, then retry once.
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("dentalAnnotation_") && k !== key) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
    try {
      localStorage.setItem(key, serialized);
    } catch (retryErr) {
      console.warn("[2DAnnotation] autosave dropped (over quota even after cleanup)", key, retryErr?.name || retryErr);
    }
  }
}

export function bindActionButtons() {
  const clearTop = document.getElementById("clearTopBtn");
  const clearBottom = document.getElementById("clearBottomBtn");
  const reset = document.getElementById("drawFromScratchBtn");
  const save = document.getElementById("saveAnnotationBtn");
  const saveJpeg = document.getElementById("saveJpegBtn");
  if (clearTop) clearTop.addEventListener("click", () => clearJawTeethBaseline("upper"));
  if (clearBottom) clearBottom.addEventListener("click", () => clearJawTeethBaseline("lower"));
  const clearUpperComponents = document.getElementById("clearUpperComponentsBtn");
  const clearLowerComponents = document.getElementById("clearLowerComponentsBtn");
  if (clearUpperComponents) clearUpperComponents.addEventListener("click", () => clearJawComponents("upper"));
  if (clearLowerComponents) clearLowerComponents.addEventListener("click", () => clearJawComponents("lower"));
  if (reset) reset.addEventListener("click", drawFromScratch);
  if (save) save.addEventListener("click", saveAnnotation);
  if (saveJpeg) saveJpeg.addEventListener("click", saveAsJpeg);

  registerAutosaveHook(silentSaveToStorage);
  // Seed localStorage immediately so the key exists even if the user reloads
  // before making any change.
  silentSaveToStorage();
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") silentSaveToStorage();
  });
  window.addEventListener("pagehide", silentSaveToStorage);
}

function toggleBothJawsLock() {
  const historyBefore = getHistoryStateSignature();
  const bothLocked = state.locks.upper && state.locks.lower;
  const enteringDesignMode = !bothLocked;
  state.locks.upper = !bothLocked;
  state.locks.lower = !bothLocked;
  refreshLockButtons();
  syncDesignModeWithLocks(true);
  recordHistoryIfChanged(historyBefore);
  // On the first lock of a brand-new, empty case, ask which denture-base material
  // to use before the user starts placing components.
  if (enteringDesignMode) maybePromptJawMaterial();
}

// True if any tooth on either arch already carries a placed component.
function hasAnyComponentPlacement() {
  return Object.values(state.teeth || {}).some(
    (tooth) => Array.isArray(tooth?.componentPlacements) && tooth.componentPlacements.length > 0
  );
}

// Once-per-page-load guard so re-locking an empty case doesn't re-ask. Module scope
// resets on navigation, so it is effectively per-case.
let jawMaterialPromptResolved = false;

// Asked only when locking a design with NO components on either jaw and no material picked
// this session. Writes state.jawMaterial (0 = metal, 2 = full acrylic) for the encoder.
export function maybePromptJawMaterial() {
  if (jawMaterialPromptResolved) return;
  if (hasAnyComponentPlacement()) return;
  openJawMaterialDialog();
}

function openJawMaterialDialog() {
  if (document.getElementById("jawMaterialGate")) return;

  const gate = document.createElement("div");
  gate.id = "jawMaterialGate";
  gate.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:transparent;";
  gate.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="Choose denture base material" style="width:min(90vw,360px);background:#fff;border-radius:12px;padding:16px 16px 14px;box-shadow:0 16px 44px rgba(0,0,0,.3);text-align:center;font-family:system-ui,-apple-system,sans-serif;">
      <h2 style="margin:0 0 6px;font-size:15px;font-weight:700;color:#0f172a;">Choose material</h2>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.45;color:#475569;">Select the denture base material for this case.</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button type="button" data-material="0" style="width:100%;padding:9px 14px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;background:#3BAE95;color:#fff;">Metal</button>
        <button type="button" data-material="2" style="width:100%;padding:9px 14px;border-radius:9px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155;">Full Acrylic</button>
      </div>
    </div>`;
  document.body.appendChild(gate);

  const historyBefore = getHistoryStateSignature();
  const choose = (value, label) => {
    state.jawMaterial = value;
    jawMaterialPromptResolved = true;
    document.removeEventListener("keydown", onKey);
    gate.remove();
    // Reflect the pick in the corner badge over the jaws.
    updateJawMaterialBadge();
    // Full acrylic disables mesh/bars + the palatal A-P strap & bar connectors;
    // re-render so the catalog moves off any now-blocked tab/component.
    renderComponentCatalog();
    recordHistoryIfChanged(historyBefore);
    setMessage(`Material set to ${label}.`, false);
  };
  const onKey = (e) => {
    // Escape keeps the default (metal) so the prompt can't trap the user.
    if (e.key === "Escape") choose(0, "Metal");
  };

  gate.querySelectorAll("[data-material]").forEach((btn) => {
    btn.addEventListener("click", () =>
      choose(Number(btn.dataset.material), btn.textContent.trim())
    );
  });
  // Backdrop click defaults to metal (0), matching the historical default.
  gate.addEventListener("click", (e) => {
    if (e.target === gate) choose(0, "Metal");
  });
  document.addEventListener("keydown", onKey);
  gate.querySelector("[data-material='0']")?.focus();
}

function refreshLockButtons() {
  const btn = document.getElementById("jawLockToggleBtn");
  if (!btn) return;

  const bothLocked = state.locks.upper && state.locks.lower;
  const icon = btn.querySelector(".lock-icon");
  const text = btn.querySelector(".lock-text");

  if (icon) {
    icon.src = bothLocked ? "../../assets/lock.png" : "../../assets/unlock.png";
  }

  if (text) {
    text.textContent = bothLocked ? "Select mode" : "Design mode";
  }

  btn.classList.toggle("is-locked", bothLocked);
  btn.setAttribute(
    "aria-label",
    bothLocked
      ? "Design mode — click to switch to selected mode"
      : "Selected mode — click to switch to design mode"
  );
  btn.setAttribute(
    "data-tooltip",
    bothLocked
      ? "Unlock for selected mode"
      : "Lock for design mode"
  );
}

function clearJawTeethBaseline(jaw) {
  const historyBefore = getHistoryStateSignature();
  for (const toothId of TOOTH_ORDER[jaw]) {
    const tooth = state.teeth[toothId];
    if (!tooth) continue;
    tooth.isPresent = false;
    tooth.status = "missing";
    tooth.components = [];
    tooth.componentPlacements = [];
  }
  if (jaw === "upper") {
    state.archOverlayPalatalHoleActive = false;
  }
  renderJaw(jaw);
  setMessage(`${titleCase(jaw)} arch: all teeth marked missing.`, false);
  recordHistoryIfChanged(historyBefore);
}

// Removes every placed component from one jaw, leaving tooth presence/status alone
// (unlike clearJawTeethBaseline). Drops the palatal-plate overlay too — it's a component.
function clearJawComponents(jaw) {
  const historyBefore = getHistoryStateSignature();
  for (const toothId of TOOTH_ORDER[jaw]) {
    const tooth = state.teeth[toothId];
    if (!tooth) continue;
    tooth.components = [];
    tooth.componentPlacements = [];
  }
  if (jaw === "upper") {
    state.archOverlayPalatalHoleActive = false;
  }
  renderJaw(jaw);
  setMessage(`${titleCase(jaw)} arch: all components removed.`, false);
  recordHistoryIfChanged(historyBefore);
}

function drawFromScratch() {
  const historyBefore = getHistoryStateSignature();
  // Clear components from BOTH jaws, keeping presence, locks and design mode, then
  // re-open the material prompt so the fresh design gets a denture base.
  for (const jaw of Object.keys(TOOTH_ORDER)) {
    for (const toothId of TOOTH_ORDER[jaw]) {
      const tooth = state.teeth[toothId];
      if (!tooth) continue;
      tooth.components = [];
      tooth.componentPlacements = [];
    }
  }
  state.archOverlayPalatalHoleActive = false;
  state.components = [];
  state.selectedComponentId = DEFAULT_COMPONENT_ID;
  state.removeComponentMode = false;
  const rmBtn = document.getElementById("removeComponentModeBtn");
  if (rmBtn) rmBtn.classList.remove("is-active");
  // Reset the material so the prompt reappears (and clear its once-per-session guard).
  state.jawMaterial = null;
  jawMaterialPromptResolved = false;
  updateJawMaterialBadge();
  renderComponentCatalog();
  updateEditModeUI();
  renderJaws();
  setMessage("Components cleared from both arches.", false);
  recordHistoryIfChanged(historyBefore);
  openJawMaterialDialog();
}

export function updateEditModeUI() {
  const panel = document.getElementById("editModePanel");
  const active = state.designMode;
  if (panel) {
    panel.classList.toggle("is-hidden", !active);
  }

  const selectPanel = document.getElementById("selectTeethPanel");
  if (selectPanel) {
    selectPanel.classList.toggle("is-hidden", active);
  }

  // Clear upper/lower teeth only act on tooth presence (a select-mode action),
  // so hide them in design mode where tooth selection is disabled.
  const clearTop = document.getElementById("clearTopBtn");
  const clearBottom = document.getElementById("clearBottomBtn");
  if (clearTop) clearTop.classList.toggle("is-hidden", active);
  if (clearBottom) clearBottom.classList.toggle("is-hidden", active);

  // The component-clear counterparts are the inverse: design-mode only.
  const clearUpperComponents = document.getElementById("clearUpperComponentsBtn");
  const clearLowerComponents = document.getElementById("clearLowerComponentsBtn");
  if (clearUpperComponents) clearUpperComponents.classList.toggle("is-hidden", !active);
  if (clearLowerComponents) clearLowerComponents.classList.toggle("is-hidden", !active);

  // Draw from Scratch / Load Proposed Design are design-mode actions — hide them
  // in tooth-selection mode.
  const drawScratch = document.getElementById("drawFromScratchBtn");
  const loadTemplate = document.getElementById("loadProposalBtn");
  if (drawScratch) drawScratch.classList.toggle("is-hidden", !active);
  if (loadTemplate) loadTemplate.classList.toggle("is-hidden", !active);

  const eraser = document.getElementById("removeComponentModeBtn");
  const rangeBtn = document.getElementById("teethRangeMissingBtn");

  if (rangeBtn) {
    rangeBtn.classList.toggle("is-hidden", active);
    rangeBtn.disabled = active;
    if (active) {
      rangeBtn.classList.remove("is-active");
      rangeBtn.setAttribute("aria-pressed", "false");
    }
  }

  if (eraser) {
    eraser.classList.toggle("is-hidden", !active);
    eraser.disabled = !active;
    eraser.setAttribute("aria-pressed", state.removeComponentMode ? "true" : "false");
    if (!active) {
      eraser.classList.remove("is-active");
    }
  }
}

export function syncDesignModeWithLocks(notify) {
  const next = state.locks.upper && state.locks.lower;
  const prev = state.designMode;
  if (!next) {
    closePresentToothRadialQuickPick();
    state.removeComponentMode = false;
    refreshRangeMissingButton();
    // Auto-exit the bars tab/component on unlock — bar suggestions only render in
    // design mode, so staying parked on a bar component is confusing.
    const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
    if (sel && isBarComponent(sel)) {
      state.selectedComponentId = DEFAULT_COMPONENT_ID;
    }
    if (state.selectedTab === "bars") {
      state.selectedTab = "mesh";
    }
    state.suppressArchPlacementSuggestions = false;
  }
  if (next) {
    state.rangeMissingMode = false;
    state.rangeMissingStartToothId = null;
    refreshRangeMissingButton();
  }
  state.designMode = next;

  if (next && !prev) {
    // Nothing is auto-placed on lock; the user adds mesh, plate and the major connector.
    // This only marks missing teeth so the arch renders correctly in design mode.
    forEachTooth((toothId) => {
      const t = state.teeth[toothId];
      if (t && !t.isPresent) {
        t.status = "missing";
      }
    });
  }

  updateEditModeUI();
  renderComponentCatalog();
  renderJaws();

  if (state.designMode && state.activeStatus !== "presence") {
    state.activeStatus = "presence";
    document.querySelectorAll(".status-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.status === "presence");
    });
  }

  if (notify && prev !== next) {
    if (next) {
      setMessage("Both arches are locked. Entered design mode; tooth selection is disabled.", false);
      // Design-mode interaction hint — anchored to the lock/unlock icon, ~5s.
      // Touch (mobile/tablet) has no right-click; removal is via the eraser button.
      const coarsePointer =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(pointer: coarse)").matches;
      showLockDesignTip(
        coarsePointer
          ? "Remove the component using the eraser icon."
          : "Left-click on the tooth to add a component, and right-click to remove it."
      );
    } else {
      setMessage("Exited design mode. Unlock state allows tooth editing again.", false);
    }
  }
}

// Design-mode hint anchored under the lock icon rather than the shared top-right toast.
// Auto-dismisses after ~5s; a repeat lock replaces any tip still up.
let lockDesignTipTimer = null;
function showLockDesignTip(message) {
  const anchor = document.getElementById("jawLockToggleBtn");
  if (!anchor) return;

  document.getElementById("lockDesignTip")?.remove();
  clearTimeout(lockDesignTipTimer);

  const tip = document.createElement("div");
  tip.id = "lockDesignTip";
  tip.className = "lock-design-tip";
  tip.setAttribute("role", "status");
  tip.textContent = message;
  document.body.appendChild(tip);

  // Center under the lock icon, clamped to stay within the viewport.
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  tip.style.top = `${rect.bottom + margin}px`;
  let left = rect.left + rect.width / 2 - tip.offsetWidth / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tip.offsetWidth - margin));
  tip.style.left = `${left}px`;

  requestAnimationFrame(() => tip.classList.add("is-visible"));

  const dismiss = () => {
    tip.classList.remove("is-visible");
    setTimeout(() => tip.remove(), 200);
  };
  lockDesignTipTimer = setTimeout(dismiss, 5000);
}

export function bindArchWhitespaceDismiss() {
  const shell = document.querySelector("main.annotation-shell");
  if (!shell) return;

  shell.addEventListener("click", (e) => {
    if (!state.designMode) return;
    const t = e.target;
    if (!(t instanceof Element)) return;

    // Tooth / arch placement targets — keep rest & clasp suggestion dots visible.
    // Suggestion dots are parented to the top suggestion layer, not to `.tooth`.
    if (t.closest(".tooth, .tooth-suggestions")) return;

    // All chrome controls (lock, eraser, catalog, actions, tabs, …).
    if (t.closest("button, a[href], input, select, textarea, label")) return;

    if (t.closest(".tooth-radial-backdrop, .tooth-quickpick-backdrop")) return;

    if (state.removeComponentMode) {
      state.removeComponentMode = false;
      const rmBtn = document.getElementById("removeComponentModeBtn");
      if (rmBtn) {
        rmBtn.classList.remove("is-active");
        rmBtn.setAttribute("aria-pressed", "false");
      }
      setMessage("Remove mode off.", false);
    }

    // Clicking whitespace cancels the current placement workflow
    // and clears the active component selection.
    state.selectedComponentId = null;
    renderComponentCatalog();

    state.suppressArchPlacementSuggestions = true;
    closePresentToothRadialQuickPick();
    renderJaws();
  });
}

export function bindRemoveComponentModeBtn() {
  const btn = document.getElementById("removeComponentModeBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const historyBefore = getHistoryStateSignature();
    if (!state.designMode) {
      setMessage("Lock both arches to remove components.", true);
      return;
    }
    state.removeComponentMode = !state.removeComponentMode;
    btn.classList.toggle("is-active", state.removeComponentMode);
    btn.setAttribute("aria-pressed", state.removeComponentMode ? "true" : "false");
    setMessage(
      state.removeComponentMode
        ? "Remove mode: click a tooth, then pick a component to remove."
        : "Remove mode off.",
      false
    );
    renderJaws();
    recordHistoryIfChanged(historyBefore);
  });
}

export async function saveAnnotation() {
  const payload = buildPayload();
  const storageKey = getStorageKey();
  try {
    // Persistence stays JSON (restoreAnnotationFromStorage reads it back).
    localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    toast.error("Failed to save annotation.");
    return;
  }

  // Post the 2D design (both jaws) to the backend (POST /jawstruct/l2 per jaw).
  try {
    const res = await postJawStructToServer();
    if (res?.reason === "no-case") {
      toast.warning("Saved locally. Server save skipped — no case loaded.");
    } else if (res?.reason === "no-auth") {
      toast.warning("Saved locally. Server save skipped — not logged in.");
    } else if (res?.upper?.ok && res?.lower?.ok) {
      toast.success("Saved successfully");
    } else {
      toast.error("Saved locally, but the server save failed for one or both jaws — see console.");
    }
  } catch (err) {
    console.warn("Failed to post jawstruct to server:", err);
    toast.error("Saved locally, but the server save errored — see console.");
  }
}

export function restoreAnnotationFromStorage() {
  const storageKey = getStorageKey();
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      console.log("[2DAnnotation] restore: no data at", storageKey);
      return false;
    }
    const payload = JSON.parse(raw);
    if (payload?.schema !== "smartrpd.2d-arch.v1") {
      console.warn("[2DAnnotation] restore: schema mismatch at", storageKey, payload?.schema);
      return false;
    }
    // Guard: don't restore a different case's data.
    if (payload.caseIntID != null && payload.caseIntID !== state.caseIntID) {
      console.warn("[2DAnnotation] restore: caseIntID mismatch", {
        saved: payload.caseIntID,
        current: state.caseIntID,
        key: storageKey,
      });
      return false;
    }
    console.log("[2DAnnotation] restore ←", storageKey, {
      caseIntID: payload.caseIntID,
      teethCount: payload.teeth?.length,
      componentsCount: payload.components?.length,
    });

    if (payload.locks) {
      state.locks.upper = Boolean(payload.locks.upper);
      state.locks.lower = Boolean(payload.locks.lower);
    }
    if (payload.editMode != null) state.designMode = Boolean(payload.editMode);
    if (Array.isArray(payload.components)) state.components = payload.components;
    if (payload.selectedComponentId != null) state.selectedComponentId = payload.selectedComponentId;
    if (payload.archOverlayPalatalHoleActive != null) {
      state.archOverlayPalatalHoleActive = Boolean(payload.archOverlayPalatalHoleActive);
    }
    if (payload.activeStatus) state.activeStatus = payload.activeStatus;

    if (Array.isArray(payload.teeth)) {
      for (const saved of payload.teeth) {
        const tooth = state.teeth[saved.tooth_id];
        if (!tooth) continue;
        if (saved.status != null) tooth.status = saved.status;
        if (saved.isPresent != null) tooth.isPresent = Boolean(saved.isPresent);
        if (Array.isArray(saved.componentPlacements)) tooth.componentPlacements = saved.componentPlacements;
        if (Array.isArray(saved.components)) tooth.components = saved.components;
        if (Array.isArray(saved.center)) tooth.center = saved.center;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function fetchAsDataUrl(href) {
  const absoluteHref = href.startsWith("http") || href.startsWith("data:")
    ? href
    : new URL(href, location.href).href;
  const response = await fetch(absoluteHref);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let cachedPageCss = "";
function readCssFromStyleSheets() {
  const parts = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try {
      rules = sheet.cssRules || sheet.rules;
    } catch {
      rules = null;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule && rule.cssText) parts.push(rule.cssText);
    }
  }
  return parts.join("\n");
}

async function fetchPageCss() {
  if (cachedPageCss) return cachedPageCss;

  const fromSheets = readCssFromStyleSheets();
  if (fromSheets.trim()) {
    cachedPageCss = fromSheets;
    return cachedPageCss;
  }

  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
  const texts = await Promise.all(
    links.map(async (link) => {
      try {
        const response = await fetch(link.href);
        return await response.text();
      } catch {
        return "";
      }
    })
  );
  const inlineStyles = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent || "")
    .join("\n");
  const combined = `${texts.join("\n")}\n${inlineStyles}`;
  if (combined.trim()) cachedPageCss = combined;
  return combined;
}

async function inlineImagesInSvg(svg) {
  const clone = svg.cloneNode(true);

  // Tint filters live in a shared <svg> on <body>, so a standalone serialized arch resolves
  // every `filter: url(#…)` against nothing and comes out untinted. Paste a copy in.
  const tintDefs = cloneArchTintDefs();
  if (tintDefs) clone.insertBefore(tintDefs, clone.firstChild);

  const cssText = await fetchPageCss();
  if (cssText) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = cssText;
    clone.insertBefore(styleEl, clone.firstChild);
  }

  const imageEls = Array.from(clone.querySelectorAll("image"));
  await Promise.all(
    imageEls.map(async (imgEl) => {
      const href =
        imgEl.getAttribute("href") ||
        imgEl.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
        "";
      if (!href || href.startsWith("data:")) return;
      try {
        const dataUrl = await fetchAsDataUrl(href);
        imgEl.setAttribute("href", dataUrl);
      } catch (e) {
        console.warn("Could not inline image:", href, e);
      }
    })
  );
  return clone;
}

function svgToImage(inlinedSvg, targetWidth, targetHeight) {
  return new Promise((resolve, reject) => {
    if (Number.isFinite(targetWidth)) {
      inlinedSvg.setAttribute("width", String(Math.round(targetWidth)));
    }
    if (Number.isFinite(targetHeight)) {
      inlinedSvg.setAttribute("height", String(Math.round(targetHeight)));
    }
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(inlinedSvg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG image load failed")); };
    img.src = url;
  });
}

// Outer aesthetic margin around a composed image.
const JAW_PAD_X = 10;
const JAW_PAD_Y = 20;
// ViewBox expansion: edge teeth extend past the original viewBox and get clipped,
// so expand the cloned SVG's viewBox to render them in full.
const JAW_VIEWBOX_PAD = 80;
// Gap between the ARCHES themselves, not their padded boxes. Keep below JAW_VIEWBOX_PAD * 2
// (160), or the padding bands stop overlapping and leave a dead strip down the middle.
const JAW_SIDE_BY_SIDE_GAP = 40;

function parseJawViewBox(svg) {
  const parts = (svg.getAttribute("viewBox") || "0 0 620 380").trim().split(/\s+/).map(Number);
  return {
    x: parts[0] || 0,
    y: parts[1] || 0,
    w: parts[2] || 620,
    h: parts[3] || 380,
  };
}

// Inline an arch SVG's images, expand its viewBox so edge-clipped content
// (anterior teeth at the front of the arch) is included, and rasterize it.
async function renderJawImage(svg, dims, scale) {
  const inlined = await inlineImagesInSvg(svg);
  inlined.setAttribute(
    "viewBox",
    `${dims.x - JAW_VIEWBOX_PAD} ${dims.y - JAW_VIEWBOX_PAD} ${dims.w + JAW_VIEWBOX_PAD * 2} ${dims.h + JAW_VIEWBOX_PAD * 2}`
  );
  const renderW = dims.w + JAW_VIEWBOX_PAD * 2;
  const renderH = dims.h + JAW_VIEWBOX_PAD * 2;
  const img = await svgToImage(inlined, renderW * scale, renderH * scale);
  return { img, renderW, renderH };
}

function drawCaseWatermark(ctx, centerX, centerY, scale) {
  const labelText = getCaseLabelTextForExport();
  if (!labelText) return;
  const watermarkText = labelText.startsWith("🦷") ? labelText : `🦷 ${labelText}`;
  const fontPx = Math.round(28 * scale);
  ctx.save();
  ctx.font = `700 ${fontPx}px "Montserrat", "Segoe UI", sans-serif`;
  ctx.fillStyle = "rgba(40, 60, 80, 0.55)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
  ctx.shadowBlur = 4 * scale;
  ctx.fillText(watermarkText, centerX, centerY);
  ctx.restore();
}

function newJawCanvas(canvasW, canvasH) {
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);
  return { canvas, ctx };
}

// Both arches on one canvas SIDE BY SIDE for the case-detail thumbnail. The stacked
// composeJawCanvas layout must stay — the JPEG export and editor base depend on it.
async function composeJawCanvasSideBySide(scale = 1) {
  const upperSvg = document.getElementById("upperArchSvg");
  const lowerSvg = document.getElementById("lowerArchSvg");
  if (!upperSvg || !lowerSvg) return null;

  const upperDims = parseJawViewBox(upperSvg);
  const lowerDims = parseJawViewBox(lowerSvg);

  // Each jaw carries JAW_VIEWBOX_PAD of transparent padding, so two flush images already
  // sit twice that apart. Space by the wanted ARCH gap and let the padding overlap.
  const gap = JAW_SIDE_BY_SIDE_GAP - JAW_VIEWBOX_PAD * 2;

  const [upper, lower] = await Promise.all([
    renderJawImage(upperSvg, upperDims, scale),
    renderJawImage(lowerSvg, lowerDims, scale),
  ]);

  const baseW = upper.renderW + lower.renderW + gap;
  const baseH = Math.max(upper.renderH, lower.renderH);
  const canvasW = Math.round((baseW + JAW_PAD_X * 2) * scale);
  const canvasH = Math.round((baseH + JAW_PAD_Y * 2) * scale);
  const { canvas, ctx } = newJawCanvas(canvasW, canvasH);

  // Each arch is vertically centered so a taller jaw doesn't drag the other up.
  const upperX = JAW_PAD_X * scale;
  const upperY = (JAW_PAD_Y + (baseH - upper.renderH) / 2) * scale;
  const lowerX = (JAW_PAD_X + upper.renderW + gap) * scale;
  const lowerY = (JAW_PAD_Y + (baseH - lower.renderH) / 2) * scale;
  ctx.drawImage(upper.img, upperX, upperY, upper.renderW * scale, upper.renderH * scale);
  ctx.drawImage(lower.img, lowerX, lowerY, lower.renderW * scale, lower.renderH * scale);

  // Watermark spans the full width below both arches, centered in the empty band
  // the viewBox expansion leaves under the lowest visible content.
  const visibleBottom = Math.max(
    upperY + (JAW_VIEWBOX_PAD + upperDims.h) * scale,
    lowerY + (JAW_VIEWBOX_PAD + lowerDims.h) * scale
  );
  drawCaseWatermark(ctx, canvasW / 2, (visibleBottom + canvasH) / 2, scale);

  return canvas;
}

async function composeJawCanvas(scale = 1) {
  const upperSvg = document.getElementById("upperArchSvg");
  const lowerSvg = document.getElementById("lowerArchSvg");
  if (!upperSvg || !lowerSvg) return null;

  const upperDims = parseJawViewBox(upperSvg);
  const lowerDims = parseJawViewBox(lowerSvg);
  const gap = 20;
  const vbPad = JAW_VIEWBOX_PAD;
  const padX = JAW_PAD_X;
  const padY = JAW_PAD_Y;
  const baseW = Math.max(upperDims.w, lowerDims.w) + vbPad * 2;
  const baseH = upperDims.h + lowerDims.h + vbPad * 4 + gap;
  const canvasW = Math.round((baseW + padX * 2) * scale);
  const canvasH = Math.round((baseH + padY * 2) * scale);

  const { canvas, ctx } = newJawCanvas(canvasW, canvasH);

  const [upper, lower] = await Promise.all([
    renderJawImage(upperSvg, upperDims, scale),
    renderJawImage(lowerSvg, lowerDims, scale),
  ]);

  // Center each jaw horizontally in the padded canvas; upper starts at the top
  // padding, lower sits a `gap` below it (no header band).
  const upperX = (padX + (baseW - upper.renderW) / 2) * scale;
  const upperY = padY * scale;
  const lowerX = (padX + (baseW - lower.renderW) / 2) * scale;
  const lowerY = (padY + upper.renderH + gap) * scale;
  ctx.drawImage(upper.img, upperX, upperY, upper.renderW * scale, upper.renderH * scale);
  ctx.drawImage(lower.img, lowerX, lowerY, lower.renderW * scale, lower.renderH * scale);

  // Case-ID watermark — sit in the visible gap between the jaws' content. Computed
  // from actual jaw positions so it stays centered even when one jaw is taller.
  const visibleUpperBottom = upperY + (vbPad + upperDims.h) * scale;
  const visibleLowerTop = lowerY + vbPad * scale;
  drawCaseWatermark(ctx, canvasW / 2, (visibleUpperBottom + visibleLowerTop) / 2, scale);

  return canvas;
}

// Resolve the case-id text to render on the exported JPEG. Prefer the on-screen
// label so the file matches what the user sees; fall back to state.
function getCaseLabelTextForExport() {
  const labelEl = document.getElementById("caseLabel");
  const labelText = (labelEl?.textContent || "").trim();
  if (labelText && labelText !== "Case: Unknown") {
    return labelText.replace(/^Case:\s*/i, "");
  }
  if (state.caseIntID != null && state.caseName) {
    return `${state.caseIntID} : ${state.caseName}`;
  }
  if (state.caseName) return state.caseName;
  if (state.caseIntID != null) return String(state.caseIntID);
  return "";
}

// The editor frame is landscape above 600px and portrait below, so match the base image
// to it or the jaws shrink to fit the wrong orientation.
function isInstructionEditorPortrait() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(max-width: 599.98px)").matches
    : false;
}

// Base image for the editor background, the noticeboard preview and a new instruction's
// baked base. Layout follows the frame orientation; saveAsJpeg uses the stacked one.
export async function captureJawJpegDataUrl(quality = 0.92, scale = 3) {
  const canvas = isInstructionEditorPortrait()
    ? await composeJawCanvas(scale)
    : await composeJawCanvasSideBySide(scale);
  if (!canvas) return null;
  return canvas.toDataURL("image/jpeg", quality);
}

export async function captureJawPngDataUrl(scale = 3) {
  const canvas = await composeJawCanvas(scale);
  if (!canvas) return null;
  return canvas.toDataURL("image/png");
}

// Matches the 3D dialog's APPROVAL_SHOT_MAX_WIDTH — same ~360px panel, same email, where
// a full-scale arch PNG would be megabytes on the wire.
const ARCH_THUMB_WIDTH = 900;

// One PNG per arch on its own white ground — the approval dialog frames each alone rather
// than as the thumbnail's side-by-side composite. null means that SVG isn't on the page.
export async function captureArchThumbnails() {
  const shoot = async (svgId) => {
    const svg = document.getElementById(svgId);
    if (!svg) return null;
    const dims = parseJawViewBox(svg);
    // renderJawImage already pads the viewBox by JAW_VIEWBOX_PAD on every side,
    // so the rendered box — not the arch — is what gets fitted to the width.
    const scale = ARCH_THUMB_WIDTH / (dims.w + JAW_VIEWBOX_PAD * 2);
    const { img, renderW, renderH } = await renderJawImage(svg, dims, scale);
    const { canvas, ctx } = newJawCanvas(
      Math.round(renderW * scale),
      Math.round(renderH * scale)
    );
    ctx.drawImage(img, 0, 0, renderW * scale, renderH * scale);
    return canvas.toDataURL("image/png");
  };

  try {
    return {
      upper: await shoot("upperArchSvg"),
      lower: await shoot("lowerArchSvg"),
    };
  } catch (err) {
    console.warn("[annotation] arch thumbnail capture failed", err);
    return { upper: null, lower: null };
  }
}

// Thumbnail slot for the 2D arch render. The case-detail panel (and legacy 2D
// viewer) treats slot 0 as the primary 2D thumbnail.
const THUMBNAIL_SLOT_2D = 0;

// Captures both jaws side by side and uploads to the case's 2D thumbnail slot. scale=2
// keeps the payload under the server body limit — scale=3 often exceeds 5MB.
export async function uploadJawPngThumbnail() {
  const canvas = await composeJawCanvasSideBySide(2);
  if (!canvas) return false;
  return await uploadCaseThumbnail(canvas.toDataURL("image/png"), THUMBNAIL_SLOT_2D);
}

export async function saveAsJpeg() {
  try {
    setMessage("Exporting JPEG…", false);
    const canvas = await composeJawCanvas(3);
    if (!canvas) {
      setMessage("Cannot find jaw SVGs to export.", true);
      return;
    }
    const jpegUrl = canvas.toDataURL("image/jpeg", 0.92);
    const fileName = `case_${state.caseIntID ?? "unknown"}_arch_annotation.jpg`;

    const a = document.createElement("a");
    a.href = jpegUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // PNG, not JPEG, so the case-detail panel gets a lossless render. Only the thumbnail
    // puts the jaws side by side; the downloaded JPEG stays stacked.
    const uploaded = await uploadJawPngThumbnail();
    if (uploaded) {
      setMessage("Arch annotation saved as JPEG and uploaded to case.", false);
    } else {
      setMessage("Arch annotation saved as JPEG (upload skipped).", false);
    }
  } catch (err) {
    console.error("JPEG export failed", err);
    setMessage("Failed to export as JPEG.", true);
  }
}

// POST /thumbnails — save a thumbnail into a slot for the current case. Body is a
// 2-element array [{authData, caseData}]; `data` is raw base64 (no data-URL prefix).
async function uploadCaseThumbnail(dataUrl, slot) {
  if (!state.caseIntID) {
    console.warn("[uploadCaseThumbnail] Skipped: no caseIntID");
    return false;
  }

  let loggedInUser = null;
  try {
    const raw = localStorage.getItem("loggedInUser");
    loggedInUser = raw ? JSON.parse(raw) : null;
  } catch {
    console.warn("[uploadCaseThumbnail] Skipped: bad loggedInUser");
    return false;
  }
  if (!loggedInUser?.uuid) {
    console.warn("[uploadCaseThumbnail] Skipped: not logged in");
    return false;
  }

  // Server stores base64 only; the receiver re-adds the data URL prefix.
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

  const payload = [
    {
      machine_id: MACHINE_ID,
      uuid: loggedInUser.uuid,
      caseIntID: state.caseIntID,
    },
    {
      case_id: state.caseIntID,
      slot,
      data: base64,
    },
  ];

  try {
    const res = await fetch(
      `${API_BASE}/thumbnails`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    logApi(res, 'POST /thumbnails');
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      console.warn("[uploadCaseThumbnail] POST", res.status, bodyText.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[uploadCaseThumbnail] POST error", err);
    return false;
  }
}

export function buildPayload() {
  const teeth = [...TOOTH_ORDER.upper, ...TOOTH_ORDER.lower].map((toothId) => {
    const record = state.teeth[toothId];
    ensureToothPlacementState(record);
    syncToothComponentsFromPlacements(record);

    return {
      tooth_id: record.tooth_id,
      jaw: record.jaw,
      status: statusJsonForToothRecord(record),
      isPresent: record.isPresent,
      componentPlacements: (record.componentPlacements || []).map((entry) => {
        const row = {
          componentId: entry.componentId,
          surface: normalizeSurface(entry.surface),
        };
        if (
          isBarComponent(entry.componentId) &&
          isBarPlacementSurface(normalizeSurface(entry.surface))
        ) {
          const bx = Number(entry.barOffsetX);
          const by = Number(entry.barOffsetY);
          row.barOffsetX = Number.isFinite(bx) ? bx : 0;
          row.barOffsetY = Number.isFinite(by) ? by : 0;
        }
        return row;
      }),
      components: [...record.components],
      center: record.center,
    };
  });

  return {
    schema: "smartrpd.2d-arch.v1",
    caseIntID: state.caseIntID,
    encryptedCaseId: state.encryptedCaseId || null,
    updatedAt: new Date().toISOString(),
    locks: { upper: state.locks.upper, lower: state.locks.lower },
    editMode: state.designMode,
    components: state.components,
    selectedComponentId: state.selectedComponentId,
    archOverlayPalatalHoleActive: state.archOverlayPalatalHoleActive,
    activeStatus: state.activeStatus,
    teeth,
    arches: {
      upper: TOOTH_ORDER.upper.map((id) => state.teeth[id].center),
      lower: TOOTH_ORDER.lower.map((id) => state.teeth[id].center),
    },
  };
}

export function loadPreviewImage() {
  const img = document.getElementById("previewImage");
  const fallback = document.getElementById("previewFallback");
  const area = document.getElementById("imagePreviewArea");
  if (!img || !fallback || !area) return;

  if (!state.encryptedCaseId) {
    fallback.style.display = "block";
    img.style.display = "none";
    teardown3DPreview();
    return;
  }

  // Used whenever the 3D preview isn't showing: the stored 2D capture if we have
  // one, otherwise the placeholder.
  const showStoredCaptureOrFallback = () => {
    const localImage = localStorage.getItem(`annotateBackground_${state.encryptedCaseId}`);
    if (localImage) {
      img.src = localImage;
      img.style.display = "block";
      fallback.style.display = "none";
      return;
    }
    fallback.style.display = "block";
    img.style.display = "none";
  };

  loadInteractiveJawPreview(area).then((loaded3D) => {
    if (loaded3D) {
      img.style.display = "none";
      fallback.style.display = "none";
      return;
    }
    showStoredCaptureOrFallback();
  }).catch((err) => {
    console.error("3D preview load failed", err);
    teardown3DPreview();
    showStoredCaptureOrFallback();
  });
}

export function getStorageKey() {
  return `dentalAnnotation_${state.encryptedCaseId || "draft"}`;
}
