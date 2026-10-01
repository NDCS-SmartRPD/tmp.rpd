import {
  ACTION_UPON_FAILURE,
  cancelMeshInteractionDefer,
  COMPONENT_CATALOG,
  COMPONENT_BY_ID,
  COMPONENT_TABS,
  deferMeshInteraction,
  getDefaultMajorConnectorIdForDesignMode,
  handleMeshCatalogDoubleClickApplyAll,
  isBarComponent,
  isMajorConnectorComponent,
  isMeshComponent,
  isClaspComponent,
  isPalatalHoleMajorComponent,
  isPalatalBarMajorComponent,
  isPalatalStrapMajorComponent,
  isPlateComponentId,
  ensurePalatalBarPlacementsOnAnchoredUpperTeeth,
  removeNonBarMajorPlacementsFromUpperArch,
  switchMajorConnectorInJaws,
  syncReciprocatingPlatesToMajorConnector,
} from "./components.js";
import { COMPONENT_GROUPS, forEachTooth, TOOTH_ORDER } from "./constants.js";
import {
  state,
  DEFAULT_COMPONENT_ID,
  getHistoryStateSignature,
  isFullAcrylic,
  isTabBlockedByMaterial,
  recordHistoryIfChanged,
  setMessage,
  renderJaws,
  meshAnnotationEnv,
} from "./2DAnnotation.js";
import {
  ensureToothPlacementState,
  syncToothComponentsFromPlacements,
} from "./annotationTeethModel.js";
import {
  WORK_CATEGORY_OPTIONS,
  STATUS_2D_DESIGN_APPROVED,
  confirmCaseNoteApproval,
  sendCaseEmails,
  sendCaseApprovalAlerts,
  workCategoryForJawMaterial,
  loadCaseNote,
  loadCaseDueDate,
  saveCaseDueDate,
  saveCaseNote,
  toDateInputValue,
  fetchAdditionalCaseDetails,
  updateCaseDueDate,
  updateCaseStatus,
  updateCaseComment,
  updateCaseToothShade,
  publishCaseComment,
  watchCaseComments,
  publishCaseToothShade,
  watchCaseToothShade,
  loadCaseToothShadeDraft,
  saveCaseToothShadeDraft,
} from "./caseNote.js";
import { toast, attachThemedCalendar } from "../shared/toast.js";

// ── Material restrictions ────────────────────────────────────────────────────
// Full-acrylic (jawMaterial === 2) carries no metal framework: the BARS tab, metal mesh and
// the open palatal majors are disabled. Plate, Horseshoe and the flange stay.
/** Components that stay available in a full-acrylic case despite their tab/family. */
const ACRYLIC_ALLOWED_COMPONENT_IDS = new Set(["mesh-flange"]);

export function isComponentBlockedByMaterial(componentId) {
  if (!isFullAcrylic()) return false;
  if (ACRYLIC_ALLOWED_COMPONENT_IDS.has(componentId)) return false;
  return (
    isMeshComponent(componentId) ||
    isBarComponent(componentId) ||
    isPalatalStrapMajorComponent(componentId) ||
    isPalatalHoleMajorComponent(componentId) ||
    isPalatalBarMajorComponent(componentId)
  );
}

// Never leave the user parked on a tab or component the current material forbids.
// Called at the top of every catalog render.
function healSelectionForMaterial() {
  if (!isFullAcrylic()) return;
  if (isTabBlockedByMaterial(state.selectedTab)) {
    const nextTab = COMPONENT_TABS.find(
      (t) => t.kind !== "form" && !isTabBlockedByMaterial(t.id)
    );
    if (nextTab) state.selectedTab = nextTab.id;
  }
  if (state.selectedComponentId && isComponentBlockedByMaterial(state.selectedComponentId)) {
    state.selectedComponentId = null;
  }
}

// Build component tabs and initialize the first visible catalog view.
export function initComponentCatalog() {
  state.components = Array.isArray(state.components)
    ? state.components.filter((id) => COMPONENT_BY_ID.has(id))
    : [];
  if (!state.selectedTab || !COMPONENT_TABS.some((t) => t.id === state.selectedTab)) {
    state.selectedTab = "mesh";
  }
  if (!state.selectedComponentId || !COMPONENT_BY_ID.has(state.selectedComponentId)) {
    state.selectedComponentId = DEFAULT_COMPONENT_ID;
  }
  const tabsEl = document.getElementById("componentTabs");
  if (tabsEl) {
    tabsEl.innerHTML = "";
    for (const tab of COMPONENT_TABS) {
      const button = document.createElement("button");
      button.type = "button";
      const kindClass = tab.kind === "form" ? " is-form-tab" : "";
      button.className = `component-tab${kindClass} ${state.selectedTab === tab.id ? "is-active" : ""}`;
      button.dataset.tab = tab.id;
      button.textContent = tab.label;
      button.addEventListener("click", () => {
        if (isTabBlockedByMaterial(tab.id)) {
          setMessage(`${tab.label} isn't available for a full acrylic case.`, true);
          return;
        }
        state.selectedTab = tab.id;
        state.suppressArchPlacementSuggestions = false;
        if (tab.id === "major") {
          state.selectedComponentId = null;
        }
        renderComponentCatalog();
        renderJaws();
      });
      tabsEl.appendChild(button);
    }
  }
  renderComponentCatalog();
}

// Render component options for the selected tab and grouped sections.
export function renderComponentCatalog() {
  healSelectionForMaterial();
  const tabs = document.querySelectorAll(".component-tab");
  tabs.forEach((tabBtn, index) => {
    const tabId = COMPONENT_TABS[index]?.id;
    tabBtn.classList.toggle("is-active", tabId === state.selectedTab);
    const blocked = isTabBlockedByMaterial(tabId);
    tabBtn.classList.toggle("is-disabled", blocked);
    tabBtn.disabled = blocked;
    tabBtn.setAttribute("aria-disabled", blocked ? "true" : "false");
  });

  const itemsEl = document.getElementById("componentItems");
  if (!itemsEl) return;
  itemsEl.innerHTML = "";
  itemsEl.dataset.tab = state.selectedTab;

  if (state.selectedTab === "case-note") {
    itemsEl.appendChild(createCaseNoteForm());
    const selectedEl = document.getElementById("selectedComponents");
    if (selectedEl) selectedEl.innerHTML = "";
    return;
  }

  const tabItems = COMPONENT_CATALOG.filter(
    (entry) => entry.tab === state.selectedTab && entry.hidden !== true
  );
  const groups = COMPONENT_GROUPS[state.selectedTab];
  if (groups) {
    const columns = document.createElement("div");
    // Per-tab modifier so column widths can differ (assembly is lopsided: five
    // Circum entries against two RPI/RPA ones).
    columns.className = `major-columns major-columns--${state.selectedTab}`;
    groups.forEach((groupMeta) => {
      const groupItems = tabItems.filter((entry) => entry.section === groupMeta.key);
      columns.appendChild(createMajorColumn(groupMeta.title, groupItems));
    });
    itemsEl.appendChild(columns);
    renderSelectedComponents();
    return;
  }

  for (const item of tabItems) {
    itemsEl.appendChild(createComponentItemButton(item));
  }

  renderSelectedComponents();
}

// Create one column block for grouped component sections.
// Build one grouped major-component column.
export function createMajorColumn(title, items) {
  const column = document.createElement("section");
  column.className = "major-column";

  const heading = document.createElement("h4");
  heading.className = "major-column-title";
  heading.textContent = title;
  column.appendChild(heading);

  const list = document.createElement("div");
  list.className = "major-column-items";
  for (const item of items) {
    list.appendChild(createComponentItemButton(item));
  }
  column.appendChild(list);
  return column;
}


// Fills the white mesh catalog icons with the placed-mesh purple. Published once on
// <body> so it doesn't depend on an arch <svg>; CSS references url(#icon-tint-mesh).
function ensureMeshIconTintFilter() {
  if (typeof document === "undefined" || document.getElementById("icon-tint-mesh")) {
    return;
  }
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  const filter = document.createElementNS(NS, "filter");
  filter.setAttribute("id", "icon-tint-mesh");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const matrix = document.createElementNS(NS, "feColorMatrix");
  matrix.setAttribute("type", "matrix");
  // #5b21b6 -> r 91/255=0.3569, g 33/255=0.1294, b 182/255=0.7137; alpha preserved.
  matrix.setAttribute(
    "values",
    "0 0 0 0 0.3569 0 0 0 0 0.1294 0 0 0 0 0.7137 0 0 0 1 0"
  );
  filter.appendChild(matrix);
  svg.appendChild(filter);
  document.body.appendChild(svg);
}

// Create one catalog item button and bind its click/double-click actions.
export function createComponentItemButton(item) {
  ensureMeshIconTintFilter();
  const button = document.createElement("button");
  button.type = "button";
  const blockedByMaterial = isComponentBlockedByMaterial(item.id);
  button.className = `component-item ${state.selectedComponentId === item.id ? "is-active" : ""}${blockedByMaterial ? " is-disabled" : ""}`;
  button.title = blockedByMaterial
    ? `${item.label} — not available for a full acrylic case`
    : item.label;
  if (blockedByMaterial) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }

  const icon = document.createElement("span");
  icon.className = "component-icon";
  if (item.icon) {
    const iconImg = document.createElement("img");
    iconImg.className = "component-icon-img";
    iconImg.src = item.icon;
    iconImg.alt = item.label;
    icon.appendChild(iconImg);
  } else {
    icon.textContent = item.shortLabel;
  }

  const label = document.createElement("span");
  label.className = "component-label";
  label.textContent = item.label;

  button.appendChild(icon);
  button.appendChild(label);

  if (isMeshComponent(item.id)) {
    button.classList.add("is-mesh");
    if (item.id === "mesh-flange") {
      button.classList.add("is-mesh-native");
    }
    const deferKey = `mesh-catalog:${item.id}`;
    button.addEventListener("click", () => {
      deferMeshInteraction(deferKey, () => handleDesignComponentSelect(item.id));
    });
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      cancelMeshInteractionDefer(deferKey);
      handleMeshCatalogDoubleClickApplyAll(meshAnnotationEnv(), item.id);
    });
  } else {
    button.addEventListener("click", () => handleDesignComponentSelect(item.id));
  }
  return button;
}

// Remove all plate placements across teeth (and dependent clasps when needed).
export function removeAllPlatePlacementsFromTeeth() {
  forEachTooth((toothId) => {
    const tooth = state.teeth[toothId];
    if (!tooth) {
      return;
    }
    ensureToothPlacementState(tooth);
    const hadPlate = tooth.componentPlacements.some((e) => isPlateComponentId(e.componentId));
    tooth.componentPlacements = tooth.componentPlacements.filter(
      (e) => !isPlateComponentId(e.componentId) && !(hadPlate && isClaspComponent(e.componentId))
    );
    syncToothComponentsFromPlacements(tooth);
  });
}
// Handle catalog selection logic in design mode (select/deselect/replace behaviors).
export function handleDesignComponentSelect(componentId) {
  const historyBefore = getHistoryStateSignature();
  try {
  if (!state.designMode) {
    setMessage("Lock both arches to use the component catalog.", true);
    return;
  }
  if (isComponentBlockedByMaterial(componentId)) {
    setMessage("This component isn't available for a full acrylic case.", true);
    return;
  }
  state.suppressArchPlacementSuggestions = false;

  const selected = COMPONENT_BY_ID.get(componentId);
  if (!selected) return;

  if (isMeshComponent(componentId)) {
    const meshDeselect =
      state.selectedComponentId === componentId && state.components.includes(componentId);
    state.selectedComponentId = componentId;

    if (meshDeselect) {
      state.components = state.components.filter((id) => id !== componentId);
      state.selectedComponentId =
        state.components.find((id) => COMPONENT_BY_ID.has(id)) || DEFAULT_COMPONENT_ID;
      renderComponentCatalog();
      renderJaws();
      setMessage(`${selected.label} removed from design list.`, false);
      return;
    }

    state.components = state.components.filter((id) => !isMeshComponent(id));
    if (!state.components.includes(componentId)) {
      state.components.push(componentId);
    }
    renderComponentCatalog();
    renderJaws();
    setMessage(
      `${selected.label} selected. Single-click a missing tooth to place; double-click to change that tooth’s mesh to this type (different teeth can use different meshes).`,
      false
    );
    return;
  }

  if (isPlateComponentId(componentId)) {
    const plateDeselect =
      state.selectedComponentId === componentId && state.components.includes(componentId);
    state.selectedComponentId = componentId;

    if (plateDeselect) {
      state.components = state.components.filter((id) => id !== componentId);
      state.selectedComponentId =
        state.components.find((id) => COMPONENT_BY_ID.has(id)) || DEFAULT_COMPONENT_ID;
      renderComponentCatalog();
      renderJaws();
      setMessage(`${selected.label} deselected. Click a plated tooth to remove its plate.`, false);
      return;
    }

    state.components = state.components.filter((id) => !isPlateComponentId(id));
    if (!state.components.includes(componentId)) {
      state.components.push(componentId);
    }
    renderComponentCatalog();
    renderJaws();
    setMessage(
      `${selected.label} selected. Click cyan suggestion markers on present teeth to toggle this plate.`,
      false
    );
    return;
  }

  if (isMajorConnectorComponent(selected)) {
    state.selectedComponentId = componentId;
    state.archOverlayPalatalHoleActive = isPalatalHoleMajorComponent(componentId);

    // The outgoing bar is cleared by switchMajorConnectorInJaws below — which snapshots the
    // coverage first, so nothing may strip placements ahead of it.
    if (componentId === "major-lower-lingual-bar") {
      state.hideLowerPlateVisuals = true;
    } else if (componentId === "major-lower-lingual-plate") {
      state.hideLowerPlateVisuals = false;
    }

    const jawKeys = String(componentId).startsWith("major-lower-")
      ? ["lower"]
      : String(componentId).startsWith("major-upper-")
        ? ["upper"]
        : ["upper", "lower"];

    if (isPalatalBarMajorComponent(componentId)) {
      ensurePalatalBarPlacementsOnAnchoredUpperTeeth(state.teeth, COMPONENT_BY_ID);
      removeNonBarMajorPlacementsFromUpperArch(state.teeth);
    } else {
      switchMajorConnectorInJaws(state.teeth, componentId, COMPONENT_BY_ID, jawKeys);
    }

    // Keeps plate-prox in step: plate/strap/horseshoe plate what they cover, a bar plates
    // none. Full acrylic plates the same way — the material changes the tint, not the rule.
    syncReciprocatingPlatesToMajorConnector(state.teeth, componentId, jawKeys);

    forEachTooth((toothId) => {
      const tooth = state.teeth[toothId];
      if (!tooth) {
        return;
      }
      syncToothComponentsFromPlacements(tooth);
    });

    renderComponentCatalog();
    renderJaws();
    setMessage(
      isPalatalBarMajorComponent(componentId)
        ? `${selected.label} selected. Connector parts and P_Bar are shown; click any plated tooth to remove or add back a segment.`
        : `${selected.label} selected. Click teeth with mesh or plate to place or remove this major connector.`,
      false
    );
    return;
  }

  state.selectedComponentId = componentId;
  renderJaws();

  if (state.components.includes(componentId)) {
    state.components = state.components.filter((id) => id !== componentId);
    renderComponentCatalog();
    renderJaws();
    setMessage(`${selected.label} removed from design list.`, false);
    return;
  }

  const conflicts = state.components.filter((id) => selected.conflictsWith.includes(id));
  if (conflicts.length > 0 && selected.actionUponFailure === ACTION_UPON_FAILURE.PREVENT_PLACEMENT) {
    setMessage(`Cannot add ${selected.label}. Conflicts with ${conflicts.join(", ")}.`, true);
    return;
  }

  if (conflicts.length > 0 && selected.actionUponFailure === ACTION_UPON_FAILURE.REMOVE_THEN_PLACE) {
    state.components = state.components.filter((id) => !conflicts.includes(id));
  }

  state.components.push(componentId);
  renderComponentCatalog();
  if (isBarComponent(selected)) {
    setMessage(
      `${selected.label} selected. Click a highlighted present tooth within two positions of a mesh-bearing tooth to place.`,
      false
    );
    return;
  }
  if (componentId === "assembly-circ") {
    setMessage(
      "Simple Circum Assembly selected. Click a mesial or distal rest-seat suggestion on posterior teeth (14-18, 24-28, 34-38, 44-48).",
      false
    );
    return;
  }
  if (componentId === "assembly-circ-ring-support") {
    setMessage(
      "Back-action Clasps selected. Click a mesial or distal rest-seat suggestion: the clasp goes on the opposite side, the reciprocating clasp stays on the rest's side.",
      false
    );
    return;
  }
  if (componentId === "assembly-circ-embrasure") {
    setMessage(
      "Combine Clasps selected. Suggestions appear on the rest seats facing a missing tooth; clicking one brackets that gap on both abutments.",
      false
    );
    return;
  }
  if (componentId === "assembly-circ-multi") {
    setMessage(
      "Continuous Clasps selected. Suggestions appear on the rest seats facing a missing tooth; clicking one splints that abutment to the next tooth away from the gap.",
      false
    );
    return;
  }
  if (componentId === "assembly-circ-half-n-half") {
    setMessage(
      "Half & Half selected. Click mesial or distal rest-seat suggestion on posterior teeth to place buccal retainer/reciprocating clasp pair.",
      false
    );
    return;
  }
  if (componentId === "assembly-rpi") {
    setMessage(
      "RPI selected (mesial rest + proximal plate + distal I-bar). Click the mesial rest-seat suggestion on a posterior tooth whose distal neighbour is missing.",
      false
    );
    return;
  }
  if (componentId === "assembly-rpa") {
    setMessage(
      "RPA selected (mesial rest + proximal plate + mesial buccal clasp). Click the mesial rest-seat suggestion on a posterior tooth whose distal neighbour is missing.",
      false
    );
    return;
  }
  setMessage(`${selected.label} added to design list.`, false);
  } finally {
    recordHistoryIfChanged(historyBefore);
  }
}

// Render selected component chips in the summary panel.
export function renderSelectedComponents() {
  const selectedEl = document.getElementById("selectedComponents");
  if (!selectedEl) return;

  selectedEl.innerHTML = "";
  for (const componentId of state.components) {
    const chip = document.createElement("span");
    chip.className = "selected-chip";
    chip.textContent = COMPONENT_BY_ID.get(componentId)?.label || componentId;
    selectedEl.appendChild(chip);
  }
}

// Get default major connector pick for a specific jaw.
export function getDefaultMajorConnectorIdForJaw(jaw) {
  const section = jaw === "upper" ? "upper" : "lower";
  const entry = COMPONENT_CATALOG.find((e) => e.tab === "major" && e.section === section);
  return entry?.id ?? getDefaultMajorConnectorIdForDesignMode(COMPONENT_BY_ID);
}

// Ensure major-tab selection matches clicked tooth jaw.
export function ensureMajorCatalogPickForTooth(toothId) {
  if (state.selectedTab !== "major" || !state.designMode) return;
  const jaw = TOOTH_ORDER.upper.includes(toothId)
    ? "upper"
    : TOOTH_ORDER.lower.includes(toothId)
      ? "lower"
      : null;
  if (!jaw) return;
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (sel && isMajorConnectorComponent(sel) && sel.section === jaw) return;
  const id = getDefaultMajorConnectorIdForJaw(jaw);
  if (!id || !COMPONENT_BY_ID.has(id)) return;
  state.selectedComponentId = id;
  if (isPalatalHoleMajorComponent(id)) {
    state.archOverlayPalatalHoleActive = true;
  } else if (jaw === "upper") {
    state.archOverlayPalatalHoleActive = false;
  }
}

// Special Instruction is the case list's CASE INSTRUCTIONS box and can exist twice at once,
// so keep every unfocused copy in step. Wired on first use — tests import without a DOM.
let commentWatchWired = false;
function watchCommentAcrossTabs() {
  if (commentWatchWired) return;
  commentWatchWired = true;
  watchCaseComments((caseIntID, text) => {
    if (String(caseIntID) !== String(state.caseIntID)) return;
    for (const box of document.querySelectorAll("#case-note-comment")) {
      if (box === document.activeElement) continue;
      if (box.value.trim() !== (box.dataset.savedComment ?? "").trim()) continue;
      box.value = text;
      box.dataset.savedComment = text;
    }
  });
}

let toothShadeWatchWired = false;
function watchToothShadeAcrossTabs() {
  if (toothShadeWatchWired) return;
  toothShadeWatchWired = true;
  watchCaseToothShade((caseIntID, text) => {
    if (String(caseIntID) !== String(state.caseIntID)) return;
    for (const input of document.querySelectorAll("#case-note-shade")) {
      if (input === document.activeElement) continue;
      if ((input.value || "").trim() !== (input.dataset.savedToothShade ?? "").trim()) continue;
      input.value = text;
      input.dataset.savedToothShade = text;
    }
  });
}

// Build the Case Note form (renders inside the catalog area when the case-note tab is active).
export function createCaseNoteForm() {
  watchCommentAcrossTabs();
  watchToothShadeAcrossTabs();
  const saved = loadCaseNote(state.caseIntID);

  const form = document.createElement("form");
  form.className = "case-note-form";
  form.addEventListener("submit", (e) => e.preventDefault());

  const ownerName = state.caseOwner || saved.caseOwner || "—";
  const caseNumber = state.caseIntID ?? "—";

  form.appendChild(buildReadonlyRow("Case Owner", ownerName));
  form.appendChild(buildReadonlyRow("Case Number", String(caseNumber)));

  // "Date Required" IS additionalcasedetails.due_date. Seeded instantly from the
  // localStorage stash, then replaced by the server value unless the user is editing.
  const dueDateDefault = loadCaseDueDate(state.caseIntID);
  const dateInput = buildInputRow(
    "Date Required",
    "date",
    "case-note-date",
    saved.dateRequired || dueDateDefault || ""
  );
  form.appendChild(dateInput.row);
  // Themed calendar for the "Date Required" field.
  attachThemedCalendar(dateInput.input, { allowClear: true });

  let userTouchedDate = false;
  dateInput.input.addEventListener("input", () => {
    userTouchedDate = true;
  });

  const shadeDraft = loadCaseToothShadeDraft(state.caseIntID);
  const shadeInput = buildInputRow("Tooth Shade", "text", "case-note-shade", saved.toothShade || shadeDraft || "", {
    placeholder: "e.g. A2",
    maxlength: "64",
  });
  form.appendChild(shadeInput.row);
  let userTouchedShade = false;
  shadeInput.input.dataset.savedToothShade = shadeInput.input.value;
  shadeInput.input.addEventListener("input", () => {
    userTouchedShade = true;
  });

  const autoCategory = workCategoryForJawMaterial(state.jawMaterial);
  const categorySelect = buildSelectRow(
    "Work Category",
    "case-note-category",
    WORK_CATEGORY_OPTIONS,
    (saved.workCategoryTouched ? saved.workCategory : autoCategory)||
    saved.workCategory || 
    ""
  );
  form.appendChild(categorySelect.row);

  let userTouchedCategory = Boolean(saved.workCategoryTouched);
  categorySelect.input.addEventListener("change",()=> {userTouchedCategory=true;});

  const commentField = buildTextareaRow(
    "Special Instruction",
    "case-note-comment",
    saved.comment || ""
  );
  form.appendChild(commentField.row);

  let userTouchedComment = false;
  // Last value known to be on the server. On the element (not a closure) so the
  // cross-tab watcher below can tell a stale copy from one with unsaved edits.
  commentField.input.dataset.savedComment = commentField.input.value;
  commentField.input.addEventListener("input", () => {
    userTouchedComment = true;
  });

  // One read for both server-backed fields (same row). Neither overwrites what the user
  // typed, and an empty server comment leaves the local draft alone.
  fetchAdditionalCaseDetails(state.caseIntID).then(({ ok, detail }) => {
    if (!ok) return;
    const live = toDateInputValue(detail?.due_date);
    if (!userTouchedDate && live && live !== dateInput.input.value) {
      dateInput.input.value = live;
      saveCaseDueDate(state.caseIntID, live);
    }
    const liveComment = detail?.comments ?? "";
    if (!userTouchedComment && liveComment && liveComment !== commentField.input.value) {
      commentField.input.value = liveComment;
      commentField.input.dataset.savedComment = liveComment;
    }
    const liveShade = detail?.tooth_shade ?? "";
    if (!userTouchedShade && liveShade !== shadeInput.input.value) {
      shadeInput.input.value = liveShade;
      shadeInput.input.dataset.savedToothShade = liveShade;
      saveCaseToothShadeDraft(state.caseIntID, liveShade);
    }
  });

  const actions = document.createElement("div");
  actions.className = "case-note-actions";
  // One button saves the note AND sets the status, so a design can't be approved with its
  // note unsaved. Confirms first — the status change is case-level and visible to all.
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "case-note-save-btn";
  approveBtn.textContent = "Approve";
  const status = document.createElement("span");
  status.className = "case-note-status";
  status.setAttribute("aria-live", "polite");

  // Special Instruction commits on its own when focus leaves, like the case
  // list's box — no need to approve the design to get the note to the technician.
  let pendingCommentSave = null;
  let pendingToothShadeSave = null;
  shadeInput.input.addEventListener("blur", () => {
    const text = shadeInput.input.value.trim();
    const savedText = shadeInput.input.dataset.savedToothShade ?? "";
    if (state.caseIntID == null || text === savedText.trim()) return;
    status.textContent = "Saving...";
    status.classList.remove("is-error");
    pendingToothShadeSave = updateCaseToothShade(state.caseIntID, text).then((ok) => {
      if (ok) {
        shadeInput.input.value = text;
        shadeInput.input.dataset.savedToothShade = text;
        publishCaseToothShade(state.caseIntID, text);
        const note = loadCaseNote(state.caseIntID);
        saveCaseNote(state.caseIntID, { ...note, toothShade: text, updatedAt: new Date().toISOString() });
        status.textContent = "Saved.";
        setTimeout(() => {
          if (status.textContent === "Saved.") status.textContent = "";
        }, 2000);
      } else {
        status.textContent = "Couldn't save - try again.";
        status.classList.add("is-error");
      }
      pendingToothShadeSave = null;
    });
  });
  commentField.input.addEventListener("blur", () => {
    const text = commentField.input.value;
    const savedText = commentField.input.dataset.savedComment ?? "";
    if (state.caseIntID == null || text.trim() === savedText.trim()) return;
    status.textContent = "Saving…";
    status.classList.remove("is-error");
    pendingCommentSave = updateCaseComment(state.caseIntID, text).then((ok) => {
      if (ok) {
        commentField.input.dataset.savedComment = text;
        publishCaseComment(state.caseIntID, text);
        const note = loadCaseNote(state.caseIntID);
        saveCaseNote(state.caseIntID, { ...note, comment: text, updatedAt: new Date().toISOString() });
        status.textContent = "Saved.";
        setTimeout(() => {
          if (status.textContent === "Saved.") status.textContent = "";
        }, 2000);
      } else {
        status.textContent = "Couldn't save — try again.";
        status.classList.add("is-error");
      }
      pendingCommentSave = null;
    });
  });

  approveBtn.addEventListener("click", async () => {
    // A full dialog returning who to mail and what to attach, sent only once the approval
    // lands. annotationLocks is imported dynamically because it imports this module back.
    approveBtn.disabled = true;
    status.textContent = "Preparing preview…";
    status.classList.remove("is-error");
    const { captureArchThumbnails } = await import("./annotationLocks.js");
    const { confirmed, recipients, images } = await confirmCaseNoteApproval({
      caseIntID: state.caseIntID,
      caseNumber,
      statusLabel: STATUS_2D_DESIGN_APPROVED,
      shots: await captureArchThumbnails(),
    });
    if (!confirmed) {
      approveBtn.disabled = false;
      status.textContent = "";
      return;
    }

    const dateRequired = dateInput.input.value;
    const note = {
      caseOwner: ownerName,
      caseNumber,
      dateRequired,
      toothShade: shadeInput.input.value,
      workCategory: categorySelect.input.value,
      workCategoryTouched: userTouchedCategory,
      comment: commentField.input.value,
      updatedAt: new Date().toISOString(),
    };
    // Other fields have no API yet and stay in localStorage. The due date writes through
    // to additionalcasedetails.due_date, so it shares across devices.
    const localOk = saveCaseNote(state.caseIntID, note);

    // Button is already disabled from the report wait above.
    status.textContent = "Approving…";

    // Clicking Approve blurs the comment box first, so let that write land —
    // all three are full upserts of one row and must not overlap.
    await pendingCommentSave;
    await pendingToothShadeSave;

    // Both are full upserts of the SAME row, so they must stay sequential — the status
    // write re-reads what the first wrote. Skipped if the first fails.
    const remoteOk = await updateCaseDueDate(
      state.caseIntID,
      dateRequired,
      commentField.input.value
    );
    if (remoteOk) {
      saveCaseDueDate(state.caseIntID, dateRequired);
      commentField.input.dataset.savedComment = commentField.input.value;
      publishCaseComment(state.caseIntID, commentField.input.value);
    }
    const statusOk =
      remoteOk && (await updateCaseStatus(state.caseIntID, STATUS_2D_DESIGN_APPROVED));

    approveBtn.disabled = false;

    if (statusOk) {
      // Confirm the moment the approval lands: the notifications below are seconds more
      // network, and a disabled button until then reads as nothing happening.
      toast.success("Approved successfully");
      status.textContent = "Approved.";
      setMessage("2D design approved.", false);
      setTimeout(() => {
        if (status.textContent === "Approved.") status.textContent = "";
      }, 2000);

      // Fired only after the status flipped, never awaited. Only the email is reported on —
      // the alerts can't tell "nobody to alert" from a failed write, both returning 0.
      Promise.all([
        sendCaseEmails(state.caseIntID, recipients, {
          link: window.location.href,
          images,
        }),
        sendCaseApprovalAlerts(state.caseIntID, {
          statusLabel: STATUS_2D_DESIGN_APPROVED,
          alertMessage: "The 2D design is ready for review.",
        }),
      ]).then(([sent]) => {
        if (!recipients.length) return;
        if (sent === recipients.length) {
          toast.success(`Email sent to ${recipients.map((r) => r.email).join(", ")}.`);
        } else if (sent) {
          toast.warning(`Email failed for ${recipients.length - sent} recipient(s).`);
        } else {
          // The approval itself stands; only the notification failed.
          toast.error("Approved, but the email couldn't be sent.");
        }
      });
    } else if (remoteOk) {
      status.textContent = "Status not updated.";
      status.classList.add("is-error");
      toast.warning("Case note saved — couldn't set the case status.");
    } else if (localOk) {
      status.textContent = "Saved locally.";
      status.classList.add("is-error");
      toast.warning("Saved locally — couldn't reach the server.");
    } else {
      status.textContent = "Approve failed.";
      status.classList.add("is-error");
      toast.error("Approve failed.");
    }
  });

  actions.appendChild(approveBtn);
  actions.appendChild(status);
  form.appendChild(actions);

  return form;
}

function buildReadonlyRow(labelText, value) {
  const row = document.createElement("div");
  row.className = "case-note-row";
  const label = document.createElement("span");
  label.className = "case-note-label";
  label.textContent = labelText;
  const display = document.createElement("span");
  display.className = "case-note-readonly";
  display.textContent = value;
  row.appendChild(label);
  row.appendChild(display);
  return row;
}

function buildInputRow(labelText, type, id, value, opts = {}) {
  const row = document.createElement("div");
  row.className = "case-note-row";
  const label = document.createElement("label");
  label.className = "case-note-label";
  label.textContent = labelText;
  label.htmlFor = id;
  const input = document.createElement("input");
  input.type = type;
  input.id = id;
  input.className = "case-note-input";
  input.value = value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.maxlength) input.maxLength = Number(opts.maxlength);
  row.appendChild(label);
  row.appendChild(input);
  return { row, input };
}

function buildSelectRow(labelText, id, options, value) {
  const row = document.createElement("div");
  row.className = "case-note-row";
  const label = document.createElement("label");
  label.className = "case-note-label";
  label.textContent = labelText;
  label.htmlFor = id;
  const input = document.createElement("select");
  input.id = id;
  input.className = "case-note-input";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    input.appendChild(o);
  }
  row.appendChild(label);
  row.appendChild(input);
  return { row, input };
}

function buildTextareaRow(labelText, id, value) {
  const row = document.createElement("div");
  row.className = "case-note-row case-note-row--block";
  const label = document.createElement("label");
  label.className = "case-note-label";
  label.textContent = labelText;
  label.htmlFor = id;
  const input = document.createElement("textarea");
  input.id = id;
  input.className = "case-note-input case-note-textarea";
  input.rows = 4;
  input.value = value;
  row.appendChild(label);
  row.appendChild(input);
  return { row, input };
}

// Ensure major tab has a valid default selected component.
export function ensureMajorTabDefaultSelection() {
  if (!state.designMode) return;
  const sel = COMPONENT_BY_ID.get(state.selectedComponentId || "");
  if (sel && isMajorConnectorComponent(sel)) {
    if (isPalatalHoleMajorComponent(sel.id)) state.archOverlayPalatalHoleActive = true;
    return;
  }
  const id = getDefaultMajorConnectorIdForDesignMode(COMPONENT_BY_ID);
  if (!id || !COMPONENT_BY_ID.has(id)) return;
  state.selectedComponentId = id;
  state.archOverlayPalatalHoleActive = isPalatalHoleMajorComponent(id);
}
