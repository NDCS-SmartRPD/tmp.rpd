import { state, setMessage, fetchCaseDetail } from "./2DAnnotation.js";
import { saveAsJpeg } from "./annotationLocks.js";
import { toast, confirmModal } from "../shared/toast.js";
// Survey-angle logic; shares this module's state and helpers via its exports.
import {
  handleSurveyButtonClick,
  exitSurveyAiming,
  updateSurveyPlacementArrow,
  autoApplySavedSurveyAngles,
} from "./preview3DSurvey.js";
import {
  API_BASE,
  MACHINE_ID,
  fileToBase64,
  getLoggedInUser,
  uploadWithProgress,
} from "../shared/api.js";
import { buildVertexGrid, mapNearestVertices, NO_VERTEX_MATCH } from "../shared/vertexMatch.js";
import { updateCaseStatus, STATUS_3D_DESIGN_APPROVED } from "./caseNote.js";
import { confirmPreview3DApproval, sendApprovalEmails } from "./preview3DApproval.js";

// Re-exported: sibling 2D modules import it from here.
export { getLoggedInUser };

// ---- Module state, constants and shared config ---------------------------

export let THREE = null;

let TrackballControls = null;

let STLLoader = null;

export const PREVIEW_MACHINE_ID = MACHINE_ID;

export const PREVIEW_FALLBACK_UUID = "AC4gRQXZJoNz9EhhW36Q8jMJXBsf";

export const SMARTRPD_API_BASE = API_BASE;

// Default RPD jaw color used as the "no undercut" base in vertex-color renders.
const DEFAULT_TOOTH_COLOR = [208 / 255, 190 / 255, 141 / 255];

// three.js reads vertex-colour attributes as LINEAR, so heatmap values convert here
// or render washed out. DEFAULT_TOOTH_COLOR is deliberately NOT converted.
export const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

// Shared shading for every jaw material (heatmap + plain, both loader paths).
const JAW_SURFACE_SHADING = {
  metalness: 0.0,
  roughness: 0.5,
};

// Matte variant for the undercut heatmap: roughness 1.0 kills the specular sheen
// that washes out the band colours.
const HEATMAP_SURFACE_SHADING = {
  ...JAW_SURFACE_SHADING,
  roughness: 1.0,
};

const PREVIEW_DESKTOP_PIXEL_RATIO_CAP = 2;

const PREVIEW_EDGE_DESKTOP_PIXEL_RATIO_CAP = 1;

const PREVIEW_MOBILE_PIXEL_RATIO_CAP = 1.5;

const PREVIEW_MAX_DISPLAY_TRIANGLES = 120000;

const PREVIEW_MIN_SIMPLIFY_TRIANGLES = 160000;

// TrackballControls maps action -> button: rotate on right-drag, zoom on middle.
export const PREVIEW3D_MOUSE_BUTTONS = Object.freeze({ LEFT: 2, MIDDLE: 1, RIGHT: 0 });

export const preview3DState = {
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  frameId: 0,
  // Set while the panel shows the Reference Images tab — see setPreview3DRenderPaused.
  renderPaused: false,
  // Removes the webglcontextlost/restored listeners (see bindPreviewContextLossRecovery).
  contextLossCleanup: null,
  resizeObserver: null,
  // The observer's own callback, kept so returning to a 3D tab can re-anchor the
  // controls to a canvas that was 0×0 while hidden.
  resizePreview: null,
  mount: null,
  modelRoot: null,
  groups: { upper: null, lower: null },
  // Per-jaw sampled vertex fingerprint (see recordJawVertexKey), used to tell a real jaw copy
  // from a same-sized but differently ordered mesh before an extra slot borrows the heatmap.
  jawVertexKeys: {},
  // Uploaded "extra 3D files" (jaw_stls_extra_slot_1..4): occupiedSlots = backend-held, extraFileNames = slot→name, extraGroups = slot→{group,jaw}.
  // A slot can be backend-occupied but removed from the panel (row trash = session-only; modal X = permanent delete).
  extraGroups: {},
  extraFileNames: {},
  occupiedSlots: null,
  // The "Extra 3D" stage (maximize + jaws hidden) OUTLIVES its panel — closing the panel
  // changes nothing. extrasPrevStage = pose to restore · stageHiddenJaws = jaws held off.
  extrasVisible: false,
  extrasPrevStage: null,
  stageHiddenJaws: new Set(),
  // On-demand extras load (ensureExtraStlsLoaded): the in-flight promise is also the
  // once-only latch; extrasLoadProgress caches the phase so a remounted card replays it.
  extrasLoadPromise: null,
  extrasLoading: false,
  extrasLoadProgress: null,
  extrasOverlay: null,
  // Uploading slots → { frac, refs } driving each row's inline progress bar. A Map, not
  // a single slot, so the other three stay uploadable during an upload.
  uploadingSlots: new Map(),
  upload3dModal: null,
  // Whether the Extra 3D tab is the one on screen; survives scene rebuilds.
  extrasTabOpen: false,
  // Captures taken with the camera button on that tab, shown by the Request dialog.
  approvalShots: { upper: null, lower: null },
  area: null,
  activeView: "both",
  surveyPrevVisibility: null,
  surveyAutoMaximized: false,
  topControls: null,
  caseData: null,
  // Base64 STL of each shown jaw ({ data, type, filename }), kept so the jaw
  // trash buttons can POST the current STL to /stlclosed/.
  jawFiles: {},
  undercut: { upper: null, lower: null },
  occlusion: { upper: null, lower: null },
  heatmapMode: "normal",
  heatmapEnabled: false,
  heatmapToggleBtn: null,
  heatmapBoard: null,
  occlusionToggleBtn: null,
  occlusionBoard: null,
  occlusionLoading: false,
  occlusionLoadPromise: null,
  // Survey aiming: SET SURVEY ANGLE arms a jaw instead of saving, so the arrow can be aimed and only then confirmed with SET.
  // surveyAiming {jaw,btn,metrics,dir} · surveyArrow (in-scene) · surveyHint (banner) · surveyKeyHandler (Esc) · surveyDragCleanup.
  surveyAiming: null,
  surveyArrow: null,
  surveyRayLight: null,
  surveyHint: null,
  surveyKeyHandler: null,
  surveyDragCleanup: null,
  meshQuality: null,
  // HD/SD toggle re-renders from qualitySource {kind,files,jaws,undercut}. `files` is
  // released on the Extra 3D tab and re-fetched; `jaws` says what it covers meanwhile.
  qualitySource: null,
  qualityToggleEl: null,
  qualityToggleBusy: false,
  meshQualityOverlay: null,
  meshQualityProgressFill: null,
  meshQualityProgressPercent: null,
  meshQualityProgressJaw: null,
  // Flat view-navigation gizmo (bottom-right of the preview).
  previewNav: null,
};

// ---- Entry points and lifecycle ------------------------------------------

// Records what is on screen so the HD/SD toggle can re-load the same source, then
// replays saved survey angles. Clears the progress bar if `populate` throws.
async function finalizeJawLoad(populate, kind, files, normalizedUndercut) {
  try {
    await populate();
    await finishMeshQualityProgress();
    preview3DState.qualitySource = {
      kind,
      files,
      jaws: jawKeysOfFiles(files),
      undercut: normalizedUndercut,
      occlusion: preview3DState.occlusion,
    };
    updateQualityToggle();
    autoApplySavedSurveyAngles().catch((err) =>
      console.warn("[preview3D] saved survey auto-apply failed", err)
    );
    queueOcclusionPrecompute();
  } catch (err) {
    clearMeshQualityProgress();
    throw err;
  }
}

export async function loadInteractiveJawPreview(area) {
  showPreviewLoading(area, "Loading 3D jaws...");
  try {
    // Start the three.js CDN import and the network fetches together so the module
    // download overlaps the STL/undercut requests (the fetches don't need THREE).
    const depsPromise = ensureThreeDeps();
    // DB heatmap retrieval intentionally off — saved insertion angles are the source of truth (autoApplySavedSurveyAngles calls the DLL on load).
    // const undercutPromise = fetchUndercutForCase();
    const undercutPromise = Promise.resolve({ upper: null, lower: null });
    const jawFilesPromise = fetchJawFilesForCase();
    // Prefetch case data so SET SURVEY ANGLE can preserve the unmodified jaw's
    // angles without an extra round-trip when the button is clicked.
    fetchCaseData().then((data) => {
      if (data) preview3DState.caseData = data;
    });

    const depsReady = await depsPromise;
    if (!depsReady) {
      teardown3DPreview();
      return false;
    }

    init3DPreview(area);
    hidePreviewLoading(area);
    const meshQualityPromise = beginMeshQualityLoad();

    const meshFiles = await fetchParameterisedMeshForCase();
    if (meshFiles.length) {
      const [undercut, meshQuality] = await Promise.all([undercutPromise, meshQualityPromise]);
      const normalizedUndercut = undercut || { upper: null, lower: null };
      preview3DState.undercut = normalizedUndercut;
      // Auto-open the heatmap whenever the case already has undercut data.
      setHeatmapEnabled(hasAnyUndercutSurface(normalizedUndercut));
      await waitForPreviewPaint();
      await finalizeJawLoad(
        () => populateJawPreviewFromOFF(meshFiles, normalizedUndercut, meshQuality),
        "off",
        meshFiles,
        normalizedUndercut
      );
      // Extras are NOT fetched here — see ensureExtraStlsLoaded. The jaws are on screen,
      // and every extra would be created hidden, so the panel's first open pays for them.
      return true;
    }

    const jawFiles = await jawFilesPromise;
    if (jawFiles.length) {
      const [undercut, meshQuality] = await Promise.all([undercutPromise, meshQualityPromise]);
      const normalizedUndercut = undercut || { upper: null, lower: null };
      preview3DState.undercut = normalizedUndercut;
      // Auto-open the heatmap whenever the case already has undercut data.
      setHeatmapEnabled(hasAnyUndercutSurface(normalizedUndercut));
      await waitForPreviewPaint();
      await finalizeJawLoad(
        () => populateJawPreview(jawFiles, normalizedUndercut, meshQuality),
        "stl",
        jawFiles,
        normalizedUndercut
      );
      // Extras stay unfetched while the jaws hold the stage — see ensureExtraStlsLoaded.
    } else {
      clearMeshQualityProgress();
      // No jaw STLs yet (or all removed): keep the panel up with both rows in
      // their empty/upload state so the user can still add 3D files.
      showEmptyJawPanel();
      // The one eager load: with no jaw mesh the extras are all there is, so deferring
      // them would strand the user on an empty stage.
      ensureExtraStlsLoaded().catch((err) =>
        console.warn("[preview3D] extra STL background load failed", err)
      );
    }
    return true;
  } finally {
    hidePreviewLoading(area);
    // A rebuild (quality switch, context-loss reload) drops the docked panel and
    // the staged extras; put them back when the Extra 3D tab is the one on screen.
    if (isUpload3dModalOpen()) openUpload3dModal();
  }
}

function init3DPreview(area) {
  teardown3DPreview();

  area.classList.add("is-3d-ready");
  preview3DState.area = area;
  preview3DState.extraGroups = {};
  preview3DState.extraFileNames = {};
  preview3DState.occupiedSlots = new Set();
  preview3DState.extrasVisible = false;
  preview3DState.extrasPrevStage = null;
  preview3DState.stageHiddenJaws = new Set();

  const shell = document.createElement("section");
  shell.className = "jaw-preview-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "jaw-preview-toolbar";

  const rows = document.createElement("div");
  rows.className = "jaw-preview-rows";

  const mount = document.createElement("div");
  mount.className = "jaw-preview-3d-mount";

  const rowUpper = buildJawRow({
    jaw: "upper",
    icon: "../../assets/Icon_UpperJaw_Occlusal.png",
    label: "ALLOW PROCESSING",
  });
  const rowLower = buildJawRow({
    jaw: "lower",
    icon: "../../assets/Icon_LowerJaw_Occlusal.png",
    label: "ALLOW PROCESSING",
  });

  rows.appendChild(rowUpper.row);
  rows.appendChild(rowLower.row);
  toolbar.appendChild(rows);

  // The top-left icon IS the heatmap toggle; the legend below shows only while it's on.
  // Keep the "Undercut.png" casing — GitHub Pages is case-sensitive, the local FS isn't.
  const undercut = document.createElement("div");
  undercut.className = "jaw-preview-undercut is-off";
  undercut.innerHTML = `
    <button type="button" class="jaw-preview-undercut-icon" aria-pressed="false" title="Toggle undercut heatmap" aria-label="Toggle undercut heatmap">
      <img src="../../assets/Undercut.png" alt="" />
    </button>
    <div class="jaw-preview-undercut-panel">
      <div class="jaw-preview-undercut-header">
        <span class="jaw-preview-undercut-title">Undercut (mm)</span>
      </div>
      <div class="jaw-preview-undercut-body">
        <div class="jaw-preview-undercut-scale">
          <span style="background:${undercutBandHex(0.8)}"></span>
          <span style="background:${undercutBandHex(0.6)}"></span>
          <span style="background:${undercutBandHex(0.3)}"></span>
          <span style="background:${undercutBandHex(0.1)}"></span>
        </div>
        <div class="jaw-preview-undercut-labels">
          <span>&gt;0.75</span><span>0.5-0.75</span><span>0.25-0.5</span><span>&lt;0.25</span>
        </div>
      </div>
    </div>
  `;
  const heatmapToggleBtn = undercut.querySelector(".jaw-preview-undercut-icon");
  heatmapToggleBtn.addEventListener("click", () => {
    setHeatmapMode(preview3DState.heatmapMode === "undercut" ? "normal" : "undercut");
  });

  const occlusion = document.createElement("div");
  occlusion.className = "jaw-preview-undercut jaw-preview-occlusion is-off";
  occlusion.innerHTML = `
    <button type="button" class="jaw-preview-undercut-icon jaw-preview-occlusion-icon" aria-pressed="false" title="Toggle occlusion heatmap" aria-label="Toggle occlusion heatmap">
      <img src="../../assets/Occlusion.png" alt="" />
    </button>
    <div class="jaw-preview-undercut-panel jaw-preview-occlusion-panel">
      <div class="jaw-preview-undercut-header">
        <span class="jaw-preview-undercut-title">Occlusion (mm)</span>
      </div>
      <div class="jaw-preview-undercut-body">
        <div class="jaw-preview-undercut-scale">
          <span style="background:${occlusionBandHex(0.05)}"></span>
          <span style="background:${occlusionBandHex(0.18)}"></span>
          <span style="background:${occlusionBandHex(0.32)}"></span>
          <span style="background:${occlusionBandHex(0.45)}"></span>
        </div>
        <div class="jaw-preview-undercut-labels">
          <span>0-0.1</span><span>0.1-0.25</span><span>0.25-0.4</span><span>0.4-0.5</span>
        </div>
      </div>
    </div>
  `;
  const occlusionToggleBtn = occlusion.querySelector(".jaw-preview-occlusion-icon");
  occlusionToggleBtn.addEventListener("click", async () => {
    await handleOcclusionToggle();
  });

  // HD/SD badge (top-right): shows the CURRENT quality; clicking flips it. Hidden until
  // the jaws load and there are source files to re-render — updateQualityToggle() reveals it.
  const qualityToggle = document.createElement("button");
  qualityToggle.type = "button";
  qualityToggle.className = "jaw-preview-quality-toggle is-hidden";
  qualityToggle.setAttribute("aria-label", "Toggle mesh quality");
  qualityToggle.addEventListener("click", () => {
    switchMeshQuality(preview3DState.meshQuality === "high" ? "low" : "high");
  });
  preview3DState.qualityToggleEl = qualityToggle;

  // Download Jaw Profile lives in the footer, which dispatches
  // `request-download-jaw-profile`; we open a two-option menu here.
  const handleDownloadJawProfileRequest = () => {
    openDownloadJawProfileMenu();
  };
  preview3DState.downloadJawCleanup?.();
  window.addEventListener("request-download-jaw-profile", handleDownloadJawProfileRequest);
  preview3DState.downloadJawCleanup = () => {
    window.removeEventListener("request-download-jaw-profile", handleDownloadJawProfileRequest);
  };

  shell.appendChild(toolbar);
  shell.appendChild(mount);
  mount.appendChild(undercut);
  mount.appendChild(occlusion);
  mount.appendChild(qualityToggle);
  area.appendChild(shell);

  const renderer = new THREE.WebGLRenderer({
    // Fissures are sub-pixel features at typical zoom; without MSAA they alias
    // into noise and read as a smooth surface.
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, getPreviewPixelRatioCap()));
  renderer.setClearColor(0xffffff, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.willChange = "transform";
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  camera.position.set(0, 40, 160);

  // Tuned for relief: only the directional lights separate a cusp from a fissure,
  // so the flat terms stay low.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xfff1f5, 0.38);
  scene.add(hemi);

  // Lights are CHILDREN OF THE CAMERA so the model stays lit at every orbit angle.
  // Offsets are deliberately off-axis: a pure headlight flattens the relief away.
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(-60, 80, 100);
  camera.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.32);
  fillLight.position.set(80, 20, 60);
  camera.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.42);
  rimLight.position.set(0, -70, -90);
  camera.add(rimLight);

  // Camera children only get world matrices once the camera is in the scene graph.
  scene.add(camera);

  const ambient = new THREE.AmbientLight(0xffffff, 0.18);
  scene.add(ambient);

  const modelRoot = new THREE.Group();
  // Dental STL files are typically exported Z-up; rotate so the occlusal plane
  // sits horizontal under Three.js's Y-up camera (upper jaw shows upright).
  modelRoot.rotation.x = -Math.PI / 2;
  scene.add(modelRoot);

  // TrackballControls (arcball): free 360° rotation, no up-vector lock or polar limits —
  // switched from OrbitControls so the jaw can be spun to inspect every surface.
  const controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 3.2;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;
  controls.noRotate = false;
  controls.noZoom = false;
  // Lock the jaw at the centre: disable panning so the model can't be dragged
  // off-centre. Rotation (right-drag) and zoom (wheel) stay active.
  controls.noPan = true;
  controls.staticMoving = true;
  controls.dynamicDampingFactor = 0;
  controls.minDistance = 35;
  controls.maxDistance = 700;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = { ...PREVIEW3D_MOUSE_BUTTONS };

  rowUpper.surveyBtn.addEventListener("click", () =>
    handleSurveyButtonClick("upper", rowUpper.surveyBtn)
  );
  rowLower.surveyBtn.addEventListener("click", () =>
    handleSurveyButtonClick("lower", rowLower.surveyBtn)
  );
  rowUpper.cancelBtn.addEventListener("click", () => exitSurveyAiming());
  rowLower.cancelBtn.addEventListener("click", () => exitSurveyAiming());

  // The footer camera button dispatches `request-3d-capture`; the render+upload runs here.
  // preview3DState.capturing is a single-flight guard so rapid clicks don't double-upload.
  const handleCaptureRequest = async () => {
    if (preview3DState.capturing) return;
    preview3DState.capturing = true;
    try {
      // On the Extra 3D tab the button feeds the Request dialog's thumbnails
      // instead of the case thumbnail — that dialog no longer shoots its own.
      if (isUpload3dModalOpen()) {
        const arch = captureExtraSlotShot();
        if (arch) toast.success(`Saved as the ${arch} 3D capture for the request.`);
        return;
      }
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");
      // Thumbnails only: upsert the upper/lower case-thumbnail slots from this render.
      // Adding to the noticeboard is the noticeboard's own "Add Viewcapture" button.
      await uploadLatest3DCapture(dataUrl);
    } catch (err) {
      console.error("Failed to capture 3D preview screenshot:", err);
      toast.error("Screen capture failed.");
    } finally {
      setTimeout(() => { preview3DState.capturing = false; }, 400);
    }
  };
  preview3DState.captureCleanup?.();
  window.addEventListener("request-3d-capture", handleCaptureRequest);
  preview3DState.captureCleanup = () => {
    window.removeEventListener("request-3d-capture", handleCaptureRequest);
  };

  // Intentionally keep ALLOW PROCESSING checkboxes as display-only (no jaw visibility behavior).

  // Jaw row icon toggles that jaw's mesh visibility (no-op if it has no STL).
  const toggleJawVisibility = (jaw) => {
    const group = preview3DState.groups[jaw];
    if (!group) return;
    group.visible = !group.visible;
    // Bringing a jaw back by hand releases the extras stage's hold on it, so a later
    // HD/SD re-render doesn't hide it again.
    if (group.visible) preview3DState.stageHiddenJaws.delete(jaw);
    const row = jaw === "upper" ? rowUpper.row : rowLower.row;
    row.classList.toggle("is-hidden-jaw", !group.visible);
  };
  const onJawIconKeydown = (jaw) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleJawVisibility(jaw);
    }
  };
  rowUpper.iconEl.addEventListener("click", () => toggleJawVisibility("upper"));
  rowLower.iconEl.addEventListener("click", () => toggleJawVisibility("lower"));
  rowUpper.iconEl.addEventListener("keydown", onJawIconKeydown("upper"));
  rowLower.iconEl.addEventListener("keydown", onJawIconKeydown("lower"));

  // Trash icon saves the jaw's current STL to /stlclosed/ then removes it from
  // the preview (confirms first).
  rowUpper.deleteBtn.addEventListener("click", () => saveJawToClosed("upper"));
  rowLower.deleteBtn.addEventListener("click", () => saveJawToClosed("lower"));

  // Empty-state upload icon: pick a .stl and store it as the actual jaw.
  rowUpper.uploadBtn.addEventListener("click", () => pickAndUploadJawStl("upper"));
  rowLower.uploadBtn.addEventListener("click", () => pickAndUploadJawStl("lower"));

  preview3DState.renderer = renderer;
  preview3DState.scene = scene;
  preview3DState.camera = camera;
  preview3DState.controls = controls;
  preview3DState.mount = mount;
  preview3DState.modelRoot = modelRoot;
  preview3DState.groups = { upper: null, lower: null };
  preview3DState.jawVertexKeys = {};
  preview3DState.activeView = "both";
  preview3DState.topControls = { rowUpper, rowLower };
  preview3DState.heatmapEnabled = false;
  preview3DState.heatmapMode = "normal";
  preview3DState.heatmapToggleBtn = heatmapToggleBtn;
  preview3DState.heatmapBoard = undercut;
  preview3DState.occlusionToggleBtn = occlusionToggleBtn;
  preview3DState.occlusionBoard = occlusion;
  // Flat view-navigation gizmo (bottom-right). Plain DOM, removed with the shell.
  preview3DState.previewNav = buildPreviewNavGizmo();
  mount.appendChild(preview3DState.previewNav);

  const resize = () => {
    const rect = mount.getBoundingClientRect();
    // A hidden panel measures 0x0, and TrackballControls divides pointer position by
    // screen.width — every later drag is garbage. Skip until it has a size again.
    if (!rect.width || !rect.height) return;
    const w = Math.max(220, Math.floor(rect.width));
    const h = Math.max(220, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // TrackballControls maps screen coords to arcball math, so it must be re-anchored on
    // canvas resize — otherwise rotation feels off after a layout change.
    controls.handleResize?.();
  };

  preview3DState.resizePreview = resize;
  preview3DState.resizeObserver = new ResizeObserver(resize);
  preview3DState.resizeObserver.observe(mount);
  resize();

  // A rebuild while the panel sits on the Reference Images tab stays paused.
  if (!preview3DState.renderPaused) startPreviewRenderLoop();

  bindPreviewContextLossRecovery(renderer.domElement, area);
}

// The one render loop, driven off preview3DState so every caller (first start,
// context restore, tab resume) runs the same frame. Never double-starts.
function startPreviewRenderLoop() {
  if (preview3DState.frameId || !preview3DState.renderer) return;
  const tick = () => {
    preview3DState.frameId = requestAnimationFrame(tick);
    preview3DState.controls?.update();
    updateSurveyPlacementArrow();
    preview3DState.renderer.render(preview3DState.scene, preview3DState.camera);
  };
  tick();
}

// Stop drawing while the panel is showing another tab: the canvas is hidden but
// the loop would still run at 60fps, which on mobile is pure battery and heat.
export function setPreview3DRenderPaused(paused) {
  preview3DState.renderPaused = !!paused;
  if (paused) {
    if (preview3DState.frameId) {
      cancelAnimationFrame(preview3DState.frameId);
      preview3DState.frameId = 0;
    }
    return;
  }
  // A dead context draws nothing and the "Reload 3D view" notice already owns
  // that state — don't resurrect the loop on top of it.
  if (preview3DState.renderer?.getContext?.()?.isContextLost?.()) return;
  // Re-anchor the controls to the canvas now that it has a size again: the panel was
  // 0×0 while hidden, and TrackballControls keeps whatever it last measured.
  requestAnimationFrame(() => preview3DState.resizePreview?.());
  startPreviewRenderLoop();
}

// iOS Safari drops the WebGL context under memory pressure and often never restores it,
// leaving render() a silent no-op. Stop the loop and offer a rebuild — the only recovery.
function bindPreviewContextLossRecovery(canvas, area) {
  if (!canvas) return;

  const onLost = () => {
    console.warn("[preview3D] WebGL context lost — pausing the render loop");
    if (preview3DState.frameId) {
      cancelAnimationFrame(preview3DState.frameId);
      preview3DState.frameId = 0;
    }
    showPreviewContextLostNotice(area);
  };

  const onRestored = () => {
    console.log("[preview3D] WebGL context restored — resuming the render loop");
    hidePreviewContextLostNotice(area);
    // three.js has already rebuilt its GL state by the time this fires; just start drawing
    // again — unless the panel is on another tab, where the resume is the tab's job.
    if (!preview3DState.renderPaused) startPreviewRenderLoop();
  };

  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  preview3DState.contextLossCleanup = () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}

function showPreviewContextLostNotice(area) {
  const host = area || preview3DState.area;
  if (!host || host.querySelector(".jaw-preview-context-lost")) return;
  const overlay = document.createElement("div");
  overlay.className = "jaw-preview-loading jaw-preview-context-lost";
  overlay.innerHTML = `
    <div class="jaw-preview-loading-card" role="alert">
      <div class="jaw-preview-loading-label">3D view was interrupted — the device ran low on memory.</div>
    </div>
  `;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "action-btn";
  retry.textContent = "Reload 3D view";
  retry.addEventListener("click", () => {
    hidePreviewContextLostNotice(host);
    // Full rebuild: a dead context cannot be revived in place, only replaced.
    teardown3DPreview();
    loadInteractiveJawPreview(host);
  });
  overlay.querySelector(".jaw-preview-loading-card")?.appendChild(retry);
  host.appendChild(overlay);
}

function hidePreviewContextLostNotice(area) {
  const host = area || preview3DState.area;
  host?.querySelectorAll(".jaw-preview-context-lost").forEach((node) => node.remove());
}

export function teardown3DPreview() {
  if (preview3DState.frameId) {
    cancelAnimationFrame(preview3DState.frameId);
    preview3DState.frameId = 0;
  }
  if (preview3DState.resizeObserver) {
    preview3DState.resizeObserver.disconnect();
    preview3DState.resizeObserver = null;
  }
  // Closes over the renderer/controls just dropped.
  preview3DState.resizePreview = null;
  if (preview3DState.controls) {
    preview3DState.controls.dispose();
    preview3DState.controls = null;
  }
  if (preview3DState.contextLossCleanup) {
    preview3DState.contextLossCleanup();
    preview3DState.contextLossCleanup = null;
  }
  disposeObject3D(preview3DState.scene);
  if (preview3DState.renderer) {
    // dispose() frees three.js objects but not the context, so hand it back before the
    // rebuild allocates another. Skip if gone, or three.js logs a misleading warning.
    if (preview3DState.renderer.getContext?.()?.isContextLost?.() === false) {
      preview3DState.renderer.forceContextLoss?.();
    }
    preview3DState.renderer.dispose();
    preview3DState.renderer.domElement.remove();
    preview3DState.renderer = null;
  }

  const area = document.getElementById("imagePreviewArea");
  if (area) {
    area.querySelectorAll(".jaw-preview-shell, .jaw-preview-loading").forEach((node) => node.remove());
    area.classList.remove("is-3d-ready");
  }

  preview3DState.scene = null;
  preview3DState.camera = null;
  preview3DState.mount = null;
  preview3DState.modelRoot = null;
  preview3DState.groups = { upper: null, lower: null };
  preview3DState.jawVertexKeys = {};
  preview3DState.jawFiles = {};
  preview3DState.undercut = { upper: null, lower: null };
  preview3DState.occlusion = { upper: null, lower: null };
  preview3DState.extraGroups = {};
  preview3DState.extraFileNames = {};
  preview3DState.occupiedSlots = null;
  // Drop the load latch with the scene it populated, so the next case fetches its own
  // slots instead of inheriting this one's.
  preview3DState.extrasLoadPromise = null;
  preview3DState.extrasLoading = false;
  preview3DState.extrasLoadProgress = null;
  clearExtrasLoadingOverlay();
  preview3DState.extrasVisible = false;
  preview3DState.extrasPrevStage = null;
  preview3DState.stageHiddenJaws = new Set();
  preview3DState.area = null;
  preview3DState.topControls = null;
  // The panel lives in the shell just removed; extrasTabOpen is what a rebuild
  // reads to put it back.
  preview3DState.upload3dModal = null;
  closeDownloadJawProfileModal();
  preview3DState.caseData = null;
  clearMeshQualityProgress();
  preview3DState.heatmapEnabled = false;
  preview3DState.heatmapMode = "normal";
  preview3DState.heatmapToggleBtn = null;
  preview3DState.heatmapBoard = null;
  preview3DState.occlusionToggleBtn = null;
  preview3DState.occlusionBoard = null;
  preview3DState.occlusionLoading = false;
  preview3DState.occlusionLoadPromise = null;
  exitSurveyAiming();
  preview3DState.surveyHint?.remove?.();
  preview3DState.surveyHint = null;
  preview3DState.meshQuality = null;
  preview3DState.qualitySource = null;
  preview3DState.qualityToggleEl = null;
  preview3DState.qualityToggleBusy = false;
  if (preview3DState.captureCleanup) {
    preview3DState.captureCleanup();
    preview3DState.captureCleanup = null;
  }
  if (preview3DState.downloadJawCleanup) {
    preview3DState.downloadJawCleanup();
    preview3DState.downloadJawCleanup = null;
  }
  preview3DState.capturing = false;
}

// Dispose every mesh under an Object3D: geometry, materials, and the cached heatmap/flat
// materials in userData. Keeps disposal logic in exactly one place.
function disposeObject3D(obj) {
  if (!obj) return;
  obj.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach((m) => m?.dispose?.());
    else node.material?.dispose?.();
    node.userData?.heatmapMaterial?.dispose?.();
    node.userData?.flatMaterial?.dispose?.();
  });
}

function waitForPreviewPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function showPreviewLoading(area, text) {
  if (!area) return;
  const existing = area.querySelector(".jaw-preview-loading");
  if (existing) {
    const label = existing.querySelector(".jaw-preview-loading-label");
    if (label) label.textContent = text || "Loading...";
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "jaw-preview-loading";
  overlay.innerHTML = `
    <div class="jaw-preview-loading-card" role="status" aria-live="polite">
      <div class="jaw-preview-loading-label">${text || "Loading..."}</div>
      <div class="jaw-preview-loading-track"><span class="jaw-preview-loading-bar"></span></div>
    </div>
  `;
  area.appendChild(overlay);
}

function hidePreviewLoading(area) {
  if (!area) return;
  area.querySelectorAll(".jaw-preview-loading").forEach((node) => node.remove());
}

async function ensureThreeDeps() {
  if (THREE && TrackballControls && STLLoader) return true;
  try {
    // Bare specifiers: the page importmap points them at vendor/three, the same entry
    // createCase.js resolves, so both modules share one THREE instance.
    const [threeMod, trackballMod, stlMod] = await Promise.all([
      import("three"),
      import("three/addons/controls/TrackballControls.js"),
      import("three/addons/loaders/STLLoader.js"),
    ]);
    THREE = threeMod;
    TrackballControls = trackballMod.TrackballControls;
    STLLoader = stlMod.STLLoader;
    return true;
  } catch (err) {
    console.error("Failed loading three.js dependencies", err);
    return false;
  }
}

function getPreviewPixelRatioCap() {
  const ua = navigator.userAgent || "";
  const isEdge = /\bEdg\//.test(ua);
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(ua) ||
    window.matchMedia?.("(pointer: coarse)")?.matches;
  if (isMobile) return PREVIEW_MOBILE_PIXEL_RATIO_CAP;
  return isEdge ? PREVIEW_EDGE_DESKTOP_PIXEL_RATIO_CAP : PREVIEW_DESKTOP_PIXEL_RATIO_CAP;
}

// ---- Mesh quality (HD/SD) and load progress ------------------------------

// Opening a case loads high quality (no prompt); the HD/SD toggle can drop to low afterwards.
const DEFAULT_MESH_QUALITY = "high";

function beginMeshQualityLoad() {
  const mount = preview3DState.mount;
  preview3DState.meshQuality = DEFAULT_MESH_QUALITY;
  if (!mount) return Promise.resolve(DEFAULT_MESH_QUALITY);

  clearMeshQualityProgress();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "jaw-preview-quality-prompt";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-label", "Loading 3D jaw mesh");
    preview3DState.meshQualityOverlay = overlay;
    mount.appendChild(overlay);

    // The overlay is now purely the progress panel.
    showMeshQualityProgress(overlay, DEFAULT_MESH_QUALITY);
    // Yield a frame so the panel paints before the mesh work blocks the thread.
    requestAnimationFrame(() => resolve(DEFAULT_MESH_QUALITY));
  });
}

function showMeshQualityProgress(overlay, meshQuality) {
  const label = meshQuality === "high" ? "High Quality" : "Low Quality";
  overlay.setAttribute("aria-label", "Loading 3D jaw mesh");
  overlay.innerHTML = `
    <div class="jaw-preview-quality-panel jaw-preview-quality-panel-loading">
      <div class="jaw-preview-quality-title">Loading ${label} Mesh</div>
      <div class="jaw-preview-quality-status">Preparing jaw mesh...</div>
      <div class="jaw-preview-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="jaw-preview-progress-fill"></div>
      </div>
      <div class="jaw-preview-progress-meta">
        <span class="jaw-preview-progress-jaw">Waiting for jaw data</span>
        <span class="jaw-preview-progress-percent">0%</span>
      </div>
    </div>
  `;
  preview3DState.meshQualityOverlay = overlay;
  preview3DState.meshQualityProgressFill = overlay.querySelector(".jaw-preview-progress-fill");
  preview3DState.meshQualityProgressPercent = overlay.querySelector(".jaw-preview-progress-percent");
  preview3DState.meshQualityProgressJaw = overlay.querySelector(".jaw-preview-progress-jaw");
  updateMeshQualityProgress(4, "Waiting for jaw data");
}

function updateMeshQualityProgress(percent, jawLabel = "Loading jaw mesh") {
  const overlay = preview3DState.meshQualityOverlay;
  const fill = preview3DState.meshQualityProgressFill;
  const percentEl = preview3DState.meshQualityProgressPercent;
  const jawEl = preview3DState.meshQualityProgressJaw;
  if (!overlay || !fill || !percentEl || !jawEl) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  fill.style.width = `${value}%`;
  percentEl.textContent = `${value}%`;
  jawEl.textContent = jawLabel;
  overlay.querySelector(".jaw-preview-progress")?.setAttribute("aria-valuenow", String(value));
}

async function updateJawMeshProgress(index, total, stage, upper, action) {
  const jawName = upper ? "Upper jaw" : "Lower jaw";
  const safeTotal = Math.max(total || 1, 1);
  const safeIndex = Math.max(index || 0, 0);
  const stageRatio = Math.max(0, Math.min(1, stage || 0));
  const percent = 8 + ((safeIndex + stageRatio) / safeTotal) * 86;
  updateMeshQualityProgress(percent, `${action} ${jawName}`);
  await waitForPreviewPaint();
}

async function finishMeshQualityProgress() {
  if (!preview3DState.meshQualityOverlay) return;
  updateMeshQualityProgress(100, "3D jaw mesh ready");
  await waitForPreviewPaint();
  clearMeshQualityProgress();
}

function clearMeshQualityProgress() {
  preview3DState.meshQualityOverlay?.remove();
  preview3DState.meshQualityOverlay = null;
  preview3DState.meshQualityProgressFill = null;
  preview3DState.meshQualityProgressPercent = null;
  preview3DState.meshQualityProgressJaw = null;
}

// Which jaws a set of source files covers. Kept on qualitySource so the rebuild
// paths still know what to rebuild once the files themselves have been released.
function jawKeysOfFiles(files) {
  return (files || []).map((f) => getJawKeyFromFile(f)).filter(Boolean);
}

// Drops only the base64 jaw source (~66MB on case 3008, the biggest hold on the page);
// the parsed meshes stay. ensureJawSourceFiles re-fetches it if a rebuild needs it.
function dropJawSourceFiles() {
  const src = preview3DState.qualitySource;
  if (src?.files) {
    src.jaws = src.jaws?.length ? src.jaws : jawKeysOfFiles(src.files);
    src.files = null;
  }
  // Same strings, second reference: both have to go or nothing is freed.
  for (const jaw of ["upper", "lower"]) {
    if (preview3DState.jawFiles?.[jaw]) preview3DState.jawFiles[jaw].data = null;
  }
}

// The source files a rebuild needs, fetched again if they were released. Re-cached, so
// a run of rebuilds costs one round trip; released again on the next Extra 3D open.
async function ensureJawSourceFiles() {
  const src = preview3DState.qualitySource;
  if (!src) return [];
  if (src.files?.length) return src.files;
  const fetched = src.kind === "off" ? await fetchParameterisedMeshForCase() : await fetchJawFilesForCase();
  // Jaws removed this session must not come back with the re-fetch.
  const wanted = src.jaws?.length ? new Set(src.jaws) : null;
  const files = wanted ? fetched.filter((f) => wanted.has(getJawKeyFromFile(f))) : fetched;
  src.files = files;
  for (const file of files) {
    const jaw = getJawKeyFromFile(file);
    if (jaw && preview3DState.jawFiles?.[jaw]) preview3DState.jawFiles[jaw].data = file.data;
  }
  return files;
}

// Sync the HD/SD badge: label = current quality, disabled while a switch is in flight,
// hidden when there is no jaw to re-render.
function updateQualityToggle() {
  const el = preview3DState.qualityToggleEl;
  if (!el) return;
  el.classList.toggle("is-hidden", !preview3DState.qualitySource?.jaws?.length);
  const high = preview3DState.meshQuality === "high";
  el.textContent = high ? "HD" : "SD";
  el.title = high
    ? "High quality — click to switch to low (faster)"
    : "Low quality — click to switch to high (original mesh)";
  el.disabled = preview3DState.qualityToggleBusy;
}

// Re-render the jaws at the requested quality, reusing the initial load's overlay.
// Re-fetches the source if it was released — a rare, deliberate click can afford it.
async function switchMeshQuality(quality) {
  const normalized = quality === "high" ? "high" : "low";
  if (preview3DState.qualityToggleBusy) return;
  if (preview3DState.meshQuality === normalized) return;
  const source = preview3DState.qualitySource;
  const mount = preview3DState.mount;
  if (!source?.jaws?.length || !mount) return;

  preview3DState.qualityToggleBusy = true;
  preview3DState.meshQuality = normalized;
  updateQualityToggle();

  clearMeshQualityProgress();
  const overlay = document.createElement("div");
  overlay.className = "jaw-preview-quality-prompt";
  mount.appendChild(overlay);
  showMeshQualityProgress(overlay, normalized);
  await waitForPreviewPaint();

  try {
    const files = await ensureJawSourceFiles();
    if (!files.length) throw new Error("jaw source files unavailable");
    if (source.kind === "off") {
      await populateJawPreviewFromOFF(files, source.undercut, normalized);
    } else {
      await populateJawPreview(files, source.undercut, normalized);
    }
    // populate* clears the model root, which also drops the extra-slot meshes —
    // re-attach the still-alive groups (root.clear() detaches, never disposes).
    if (reattachExtraGroups()) {
      centerRootOnCombinedBounds(preview3DState.modelRoot);
      fitPreviewCamera();
    }
    await finishMeshQualityProgress();
  } catch (err) {
    console.error("[preview3D] mesh quality switch failed", err);
    clearMeshQualityProgress();
    toast?.error?.("Failed to switch mesh quality.");
  } finally {
    preview3DState.qualityToggleBusy = false;
    updateQualityToggle();
  }
}

function getDisplayGeometryForQuality(geometry, label, meshQuality = preview3DState.meshQuality) {
  if (meshQuality === "high") {
    console.log(`[preview3D] high quality mesh selected for ${label}; decimation skipped`);
    return geometry;
  }
  return createDisplayGeometry(geometry, label);
}

function getGeometryTriangleCount(geometry) {
  const index = geometry?.getIndex?.();
  const position = geometry?.getAttribute?.("position");
  if (index) return Math.floor(index.count / 3);
  return position ? Math.floor(position.count / 3) : 0;
}

function buildClusteredGeometry(geometry, cellSize) {
  const positionAttr = geometry.getAttribute("position");
  if (!positionAttr || positionAttr.count < 3 || !Number.isFinite(cellSize) || cellSize <= 0) {
    return null;
  }

  const colorAttr = geometry.getAttribute("color");
  const hasColors = colorAttr && colorAttr.count === positionAttr.count;
  const positions = positionAttr.array;
  const colors = hasColors ? colorAttr.array : null;
  const indexAttr = geometry.getIndex();
  const sourceIndex = indexAttr?.array || null;
  const vertexCount = positionAttr.count;
  const sourceToCluster = new Uint32Array(vertexCount);
  const clusters = new Map();

  const keyFor = (x, y, z) =>
    `${Math.round(x / cellSize)},${Math.round(y / cellSize)},${Math.round(z / cellSize)}`;

  for (let v = 0; v < vertexCount; v += 1) {
    const p = v * 3;
    const x = positions[p];
    const y = positions[p + 1];
    const z = positions[p + 2];
    const key = keyFor(x, y, z);
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        out: clusters.size,
        count: 0,
        x: 0,
        y: 0,
        z: 0,
        r: 0,
        g: 0,
        b: 0,
        heatR: DEFAULT_TOOTH_COLOR[0],
        heatG: DEFAULT_TOOTH_COLOR[1],
        heatB: DEFAULT_TOOTH_COLOR[2],
        heatSeverity: -1,
      };
      clusters.set(key, cluster);
    }
    cluster.count += 1;
    cluster.x += x;
    cluster.y += y;
    cluster.z += z;
    if (hasColors) {
      const r = colors[p];
      const g = colors[p + 1];
      const b = colors[p + 2];
      cluster.r += r;
      cluster.g += g;
      cluster.b += b;
      const severity = getUndercutColorSeverity(r, g, b);
      if (severity > cluster.heatSeverity) {
        cluster.heatR = r;
        cluster.heatG = g;
        cluster.heatB = b;
        cluster.heatSeverity = severity;
      }
    }
    sourceToCluster[v] = cluster.out;
  }

  const outputVertexCount = clusters.size;
  if (outputVertexCount < 3 || outputVertexCount >= vertexCount) return null;

  const outputPositions = new Float32Array(outputVertexCount * 3);
  const outputColors = hasColors ? new Float32Array(outputVertexCount * 3) : null;
  for (const cluster of clusters.values()) {
    const p = cluster.out * 3;
    const inv = 1 / cluster.count;
    outputPositions[p] = cluster.x * inv;
    outputPositions[p + 1] = cluster.y * inv;
    outputPositions[p + 2] = cluster.z * inv;
    if (hasColors) {
      if (cluster.heatSeverity > 1e-6) {
        outputColors[p] = cluster.heatR;
        outputColors[p + 1] = cluster.heatG;
        outputColors[p + 2] = cluster.heatB;
      } else {
        outputColors[p] = cluster.r * inv;
        outputColors[p + 1] = cluster.g * inv;
        outputColors[p + 2] = cluster.b * inv;
      }
    }
  }

  const sourceIndexCount = sourceIndex ? sourceIndex.length : vertexCount;
  const outputIndices = [];
  const seenTriangles = new Set();
  const getSourceVertex = sourceIndex ? (i) => sourceIndex[i] : (i) => i;
  for (let i = 0; i + 2 < sourceIndexCount; i += 3) {
    const a = sourceToCluster[getSourceVertex(i)];
    const b = sourceToCluster[getSourceVertex(i + 1)];
    const c = sourceToCluster[getSourceVertex(i + 2)];
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((left, right) => left - right);
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
    if (seenTriangles.has(key)) continue;
    seenTriangles.add(key);
    outputIndices.push(a, b, c);
  }

  if (outputIndices.length < 3) return null;

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(outputPositions, 3));
  if (outputColors) out.setAttribute("color", new THREE.BufferAttribute(outputColors, 3));
  out.setIndex(outputVertexCount > 65535
    ? new THREE.Uint32BufferAttribute(outputIndices, 1)
    : new THREE.Uint16BufferAttribute(outputIndices, 1));
  // Kept so a later heatmap can be repainted onto the decimated mesh without the
  // source vertices (see repaintJawCopyHeatmap).
  out.userData.clusterSourceMap = sourceToCluster;
  return out;
}

function createDisplayGeometry(geometry, label = "mesh") {
  const sourceTriangles = getGeometryTriangleCount(geometry);
  if (sourceTriangles < PREVIEW_MIN_SIMPLIFY_TRIANGLES) return geometry;

  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) return geometry;

  const targetVertices = Math.max(5000, Math.floor(PREVIEW_MAX_DISPLAY_TRIANGLES * 0.7));
  const baseDivisions = Math.max(8, Math.round(Math.cbrt(targetVertices)));
  const baseCellSize = longest / baseDivisions;
  let best = null;
  let bestTriangles = sourceTriangles;

  for (const factor of [1, 1.25, 1.6, 2.05, 2.65, 3.4]) {
    const candidate = buildClusteredGeometry(geometry, baseCellSize * factor);
    const triangles = getGeometryTriangleCount(candidate);
    if (!candidate || triangles < 1000) continue;
    if (!best || Math.abs(triangles - PREVIEW_MAX_DISPLAY_TRIANGLES) < Math.abs(bestTriangles - PREVIEW_MAX_DISPLAY_TRIANGLES)) {
      best?.dispose?.();
      best = candidate;
      bestTriangles = triangles;
    } else {
      candidate.dispose();
    }
    if (triangles <= PREVIEW_MAX_DISPLAY_TRIANGLES) break;
  }

  if (!best || bestTriangles >= sourceTriangles) {
    best?.dispose?.();
    return geometry;
  }

  best.computeVertexNormals();
  console.log(`[preview3D] display mesh simplified for ${label}`, {
    sourceTriangles,
    displayTriangles: bestTriangles,
    reductionPct: Math.round((1 - bestTriangles / sourceTriangles) * 100),
  });
  geometry.dispose();
  return best;
}

// ---- Case data and API fetches -------------------------------------------

// Reuses 2D init's /case/get round-trip. Only preserves the other jaw's survey angles,
// so null is harmless; { force: true } bypasses the memoized copy (the survey save does).
export function fetchCaseData(options) {
  return fetchCaseDetail(options);
}

async function fetchJawFilesForCase() {
  if (!state.caseIntID) return [];
  const user = getLoggedInUser();
  if (!user?.uuid) return [];

  const payload = [
    { machine_id: PREVIEW_MACHINE_ID, uuid: user.uuid, caseIntID: state.caseIntID },
    { case_id: state.caseIntID, case_int_id: state.caseIntID, caseIntID: state.caseIntID },
  ];

  const tryEndpoint = async (endpoint, requestPayload) => {
    const path = endpoint.replace(SMARTRPD_API_BASE, "");
    const t0 = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const dt = Math.round(performance.now() - t0);
      const tag = res.ok ? "✓" : "✕";
      console.log(`[preview3D] ${tag} POST ${path} status=${res.status} ${dt}ms`);
      if (!res.ok) return [];
      const data = await res.json();
      const list = Array.isArray(data) ? data : [data];
      return list
        .filter((item) => item?.data && getJawKeyFromFile(item))
        .map((item) => ({ ...item, __sourcePath: path }));
    } catch (err) {
      console.warn(`[preview3D] ✕ POST ${path} failed`, err);
      return [];
    }
  };

  // Primary STL source for preview: /stl/get. Fall back to /stl/raw/get for
  // older cases that only have raw jaw uploads.
  const all = await tryEndpoint(`${SMARTRPD_API_BASE}/stl/get`, payload);
  const validAll = filterRenderableJawFiles(all, "/stl/get");
  if (validAll.length) {
    console.log(`[preview3D] STL source selected: /stl/get (${validAll.length} file(s))`);
    return validAll;
  }
  if (all.length) {
    console.warn("[preview3D] /stl/get returned mesh data, but none of it is renderable as STL/OFF. Trying /stl/raw/get.");
  }

  const raw = await tryEndpoint(`${SMARTRPD_API_BASE}/stl/raw/get`, payload);
  const validRaw = filterRenderableJawFiles(raw, "/stl/raw/get");
  if (validRaw.length) {
    console.log(`[preview3D] STL source selected: /stl/raw/get (${validRaw.length} file(s))`);
    return validRaw;
  }
  if (raw.length) {
    console.warn("[preview3D] /stl/raw/get returned mesh data, but none of it is renderable as STL/OFF.");
  }

  // Fallback per-jaw route: /stl/get/:type (1=upper, 2=lower).
  const upperPayload = [payload[0], { ...payload[1], type: 1, jaw_type: "upper_jaw" }];
  const lowerPayload = [payload[0], { ...payload[1], type: 2, jaw_type: "lower_jaw" }];
  const [upperOnly, lowerOnly] = await Promise.all([
    tryEndpoint(`${SMARTRPD_API_BASE}/stl/get/1`, upperPayload),
    tryEndpoint(`${SMARTRPD_API_BASE}/stl/get/2`, lowerPayload),
  ]);

  const byJaw = new Map();
  [...upperOnly, ...lowerOnly].forEach((item) => {
    const jaw = getJawKeyFromFile(item);
    if (jaw && !byJaw.has(jaw)) byJaw.set(jaw, item);
  });
  if (byJaw.size) {
    console.log(`[preview3D] STL source selected: /stl/get/:type (${byJaw.size} file(s))`);
  }
  return [...byJaw.values()];
}

async function fetchParameterisedMeshForCase() {
  // All /parameterisation, /surface and mesh/getall variants 404 on the live backend, so
  // skip them and let the caller fall through to fetchJawFilesForCase.
  return [];
}

async function fetchUndercutForCase() {
  if (!state.caseIntID) return { upper: null, lower: null };
  const user = getLoggedInUser();
  const uuid = user?.uuid || PREVIEW_FALLBACK_UUID;

  const baseBody = {
    machine_id: PREVIEW_MACHINE_ID,
    uuid,
    case_int_id: state.caseIntID,
    caseIntID: state.caseIntID,
  };

  const requestJaw = async (jawType, label) => {
    const t0 = performance.now();
    try {
      const res = await fetch(`${SMARTRPD_API_BASE}/undercutheatmap/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseBody, jaw_type: jawType }),
      });
      const dt = Math.round(performance.now() - t0);
      const tag = res.ok ? "✓" : "✕";
      console.log(`[preview3D] ${tag} POST /undercutheatmap/get (${label}) status=${res.status} ${dt}ms`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn(`[preview3D] ✕ POST /undercutheatmap/get (${label}) failed`, err);
      return null;
    }
  };

  const normalizeJawType = (value) => {
    if (value === 2 || value === "2") return "upper";
    if (value === 1 || value === "1") return "lower";
    const s = String(value || "").toLowerCase();
    if (s.includes("upper")) return "upper";
    if (s.includes("lower")) return "lower";
    return null;
  };

  const [upperReq, lowerReq] = await Promise.all([
    requestJaw(2, "upper"),
    requestJaw(1, "lower"),
  ]);

  let upper = null;
  let lower = null;
  for (const item of [upperReq, lowerReq]) {
    const key = normalizeJawType(item?.jaw_type);
    if (key === "upper") upper = item;
    else if (key === "lower") lower = item;
  }

  // Fallback to request-order if backend omits jaw_type.
  if (!upper) upper = upperReq;
  if (!lower) lower = lowerReq;

  return { upper, lower };
}

async function handleOcclusionToggle() {
  if (preview3DState.heatmapMode === "occlusion") {
    setOcclusionEnabled(false);
    return;
  }

  if (!hasAnyOcclusionSurface(preview3DState.occlusion)) {
    try {
      await ensureOcclusionHeatmap();
    } catch (err) {
      console.warn("[preview3D] occlusion heatmap failed", err);
      setMessage?.(err?.message || "Unable to compute occlusion heatmap.");
      toast?.error?.(err?.message || "Unable to compute occlusion heatmap.");
      return;
    }
  }

  setOcclusionEnabled(true);
}

function setOcclusionLoading(loading) {
  preview3DState.occlusionLoading = !!loading;
  const btn = preview3DState.occlusionToggleBtn;
  if (!btn) return;
  btn.disabled = !!loading;
  btn.classList.toggle("is-loading", !!loading);
}

function queueOcclusionPrecompute() {
  if (!preview3DState.groups?.upper || !preview3DState.groups?.lower) return;
  if (hasAnyOcclusionSurface(preview3DState.occlusion)) return;
  if (preview3DState.occlusionLoadPromise) return;

  window.setTimeout(() => {
    if (!preview3DState.groups?.upper || !preview3DState.groups?.lower) return;
    ensureOcclusionHeatmap().catch((err) => {
      console.warn("[preview3D] occlusion heatmap precompute skipped/failed", err);
    });
  }, 0);
}

async function ensureOcclusionHeatmap() {
  if (hasAnyOcclusionSurface(preview3DState.occlusion)) return preview3DState.occlusion;
  if (preview3DState.occlusionLoadPromise) return preview3DState.occlusionLoadPromise;

  preview3DState.occlusionLoadPromise = computeAndApplyOcclusionHeatmap()
    .then(() => preview3DState.occlusion)
    .finally(() => {
      preview3DState.occlusionLoadPromise = null;
    });

  return preview3DState.occlusionLoadPromise;
}

async function computeAndApplyOcclusionHeatmap() {
  if (!preview3DState.groups?.upper || !preview3DState.groups?.lower) {
    throw new Error("Occlusion heatmap requires both upper and lower jaw STL files.");
  }
  const caseId = firstNumericCaseId(
    state.caseIntID,
    preview3DState.caseData?.caseIntID,
    preview3DState.caseData?.case_int_id,
    preview3DState.caseData?.id,
    preview3DState.caseData?.case_id
  );
  if (!caseId) throw new Error("Case ID unavailable for occlusion heatmap.");

  const user = getLoggedInUser();
  const uuid = user?.uuid || PREVIEW_FALLBACK_UUID;
  const path = "/dll/compute-occlusion";
  const body = [
    {
      machine_id: PREVIEW_MACHINE_ID,
      uuid,
      caseIntID: caseId,
    },
    {
      case_id: caseId,
      caseIntID: caseId,
      includeFullOcclusion: true,
      returnOcclusionBase64: true,
    },
  ];

  setOcclusionLoading(true);
  const t0 = performance.now();
  let json = null;
  try {
    const res = await fetch(`${SMARTRPD_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const dt = Math.round(performance.now() - t0);
    const tag = res.ok ? "✓" : "✕";
    console.log(`[preview3D] ${tag} POST ${path} status=${res.status} ${dt}ms`);

    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      throw new Error(json?.details || json?.error || `DLL occlusion request failed with status ${res.status}`);
    }
  } finally {
    setOcclusionLoading(false);
  }

  const nextOcclusion = {
    upper: buildDllOcclusionSurface("upper", json),
    lower: buildDllOcclusionSurface("lower", json),
  };
  if (!hasAnyOcclusionSurface(nextOcclusion)) {
    throw new Error("DLL occlusion response did not include heatmap values.");
  }
  applyOcclusionToPreview(nextOcclusion);
}

function firstNumericCaseId(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return null;
}

function filterRenderableJawFiles(files, sourcePath) {
  const valid = [];
  for (const file of files || []) {
    let payloadInfo;
    try {
      payloadInfo = inspectMeshPayload(base64ToArrayBuffer(file.data));
    } catch (err) {
      console.warn(`[preview3D] ${sourcePath} payload check failed for ${file?.filename || "unknown"}`, err);
      continue;
    }

    const checkedFile = { ...file, __sourcePath: sourcePath, __payloadInfo: payloadInfo };
    console.log(`[preview3D] ${sourcePath} payload check for ${file?.filename || "unknown"}`, payloadInfo);

    if (["binary-stl", "ascii-stl", "off"].includes(payloadInfo.format)) {
      valid.push(checkedFile);
    } else {
      console.warn(
        `[preview3D] ${sourcePath} returned ${payloadInfo.format} for ${file?.filename || "unknown"}; expected STL or OFF.`
      );
    }
  }
  return valid;
}

// ---- Jaw mesh building and rendering -------------------------------------

// Mounts the built jaw groups into the model root and finalises the viewport.
// Shared tail of both jaw-loading paths (initial load and quality re-load).
async function mountJawGroups(upperGroup, lowerGroup) {
  const root = preview3DState.modelRoot;
  if (!root) return;
  updateMeshQualityProgress(94, "Positioning jaw mesh");
  await waitForPreviewPaint();
  root.clear();
  if (upperGroup.children.length) root.add(upperGroup);
  if (lowerGroup.children.length) root.add(lowerGroup);

  centerRootOnCombinedBounds(root);

  preview3DState.groups.upper = upperGroup.children.length ? upperGroup : null;
  preview3DState.groups.lower = lowerGroup.children.length ? lowerGroup : null;
  setJawRowMode("upper", !!preview3DState.groups.upper);
  setJawRowMode("lower", !!preview3DState.groups.lower);
  applyJawVisibility();
  setHeatmapMode(preview3DState.heatmapMode);
  fitPreviewCamera();
  updateMeshQualityProgress(98, "Finalizing viewport");
  await waitForPreviewPaint();
}

async function populateJawPreview(jawFiles, undercut, meshQuality = "low") {
  const loader = new STLLoader();
  const upperGroup = new THREE.Group();
  const lowerGroup = new THREE.Group();
  const heatmapMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...HEATMAP_SURFACE_SHADING,
    side: THREE.DoubleSide,
  });
  // DoubleSide + opaque so the hollow STL shell's open base renders solid from every angle.
  // Same base colour as the heatmap; the flat jaw keeps the glossier sculpted look.
  const flatBaseProps = {
    color: new THREE.Color(...DEFAULT_TOOTH_COLOR),
    ...JAW_SURFACE_SHADING,
    side: THREE.DoubleSide,
    transparent: false,
    opacity: 1,
    depthWrite: true,
  };
  const flatUpper = new THREE.MeshStandardMaterial(flatBaseProps);
  const flatLower = new THREE.MeshStandardMaterial(flatBaseProps);

  preview3DState.jawFiles = {};

  const totalFiles = Math.max(jawFiles.length, 1);
  for (let i = 0; i < jawFiles.length; i += 1) {
    const file = jawFiles[i];
    const upper = isUpper(file);
    await updateJawMeshProgress(i, totalFiles, 0.05, upper, "Reading");
    const primarySurface = upper ? undercut?.upper : undercut?.lower;
    const secondarySurface = upper ? undercut?.lower : undercut?.upper;

    const stlBuffer = base64ToArrayBuffer(file.data);
    const payloadInfo = file.__payloadInfo || inspectMeshPayload(stlBuffer);
    const sourcePath = file.__sourcePath || "selected STL source";
    await updateJawMeshProgress(i, totalFiles, 0.2, upper, "Parsing");
    console.log(`[preview3D] ${sourcePath} parse check for ${file?.filename || "unknown"}`, payloadInfo);
    if (!["binary-stl", "ascii-stl", "off"].includes(payloadInfo.format)) {
      console.warn(
        `[preview3D] ${file?.filename || "unknown"} is ${payloadInfo.format}, not a renderable STL/OFF mesh. Parse skipped.`
      );
      continue;
    }

    let geometry;
    let useHeatmap = false;

    if (payloadInfo.format === "off") {
      const offText = new TextDecoder().decode(stlBuffer);
      geometry = parseOFFToGeometry(offText);
      if (!geometry) {
        console.warn(`[preview3D] ${file?.filename || "unknown"} looked like OFF but could not be parsed.`);
        continue;
      }
      applyUndercutVertexColors(geometry, primarySurface);
      useHeatmap = true;
      await updateJawMeshProgress(i, totalFiles, 0.55, upper, "Applying undercut heatmap");
      console.log(`[preview3D] OFF mesh rendered for ${file?.filename || "unknown"}`, {
        source: sourcePath,
        vertices: geometry.attributes.position.count,
      });
    } else {
      geometry = loader.parse(stlBuffer);
      await updateJawMeshProgress(i, totalFiles, 0.35, upper, "Matching undercut vertices");

    // Pick the heatmap surface, then dedup the mesh to match its vertex count so the backend's
    // vertex indices align with ours. Prefer same-jaw; fall back to the opposite only if empty.
    const primaryVerts = surveyingVertexCount(primarySurface);
    const secondaryVerts = surveyingVertexCount(secondarySurface);

    let target = null;
    if (primaryVerts > 0) {
      target = { label: upper ? "upper" : "lower", surface: primarySurface, verts: primaryVerts };
    } else if (secondaryVerts > 0) {
      target = { label: upper ? "lower" : "upper", surface: secondarySurface, verts: secondaryVerts };
    }

    if (target) {
      // Dual-dedup: one walk of the raw STL corners builds our dedup AND a surrogate of the
      // backend's, so colours come from spatial co-occurrence rather than blind index alignment.
      const dual = buildDualDedupGeometry(geometry, target.surface, target.verts);
      geometry = dual.geometry;
      useHeatmap = true;
      const diff = Math.abs(dual.backendVertCount - target.verts);
      console.log(`[preview3D] dual-dedup heatmap applied for ${file?.filename || "unknown"}`, {
        ourVerts: geometry.attributes.position.count,
        heatmapVerts: target.verts,
        surrogateBackendVerts: dual.backendVertCount,
        countDiff: diff,
      });
      if (target.surface !== primarySurface) {
        console.warn("[preview3D] used opposite-jaw heatmap (same-jaw empty)", {
          file: file?.filename || file?.type || "unknown",
          expectedJaw: upper ? "upper" : "lower",
          usedJaw: target.label,
        });
      }
    } else {
      geometry = mergeStlVertices(geometry);
    }
    }
    // Fingerprint the welded mesh before decimation: an extra jaw-copy slot checks itself
    // against it before borrowing this jaw's heatmap.
    recordJawVertexKey(upper ? "upper" : "lower", geometry);
    await updateJawMeshProgress(i, totalFiles, 0.7, upper, meshQuality === "high" ? "Keeping original mesh" : "Building low quality display mesh");
    geometry = getDisplayGeometryForQuality(
      geometry,
      file?.filename || (upper ? "upper jaw" : "lower jaw"),
      meshQuality
    );
    geometry.computeVertexNormals();
    await updateJawMeshProgress(i, totalFiles, 0.88, upper, "Adding to viewport");

    const jawKey = upper ? "upper" : "lower";
    const heatMat = heatmapMaterial.clone();
    const flatMat = (upper ? flatUpper : flatLower).clone();
    const activeMat = (useHeatmap && preview3DState.heatmapMode === "undercut") ? heatMat : flatMat;
    const mesh = new THREE.Mesh(geometry, activeMat);
    mesh.userData.heatmapMaterial = heatMat;
    mesh.userData.flatMaterial = flatMat;
    mesh.userData.surfaceJaw = jawKey;
    mesh.userData.heatmapSurface = primarySurface || null;
    mesh.userData.occlusionSurface = preview3DState.occlusion?.[jawKey] || null;
    if (upper) upperGroup.add(mesh);
    else lowerGroup.add(mesh);

    preview3DState.jawFiles[jawKey] = {
      data: file.data,
      type: file.type ?? file.jaw_type ?? (upper ? "upper_jaw" : "lower_jaw"),
      filename: file.filename || file.name || `${upper ? "upper" : "lower"}.stl`,
    };
    await updateJawMeshProgress(i, totalFiles, 0.98, upper, "Loaded");
  }

  await mountJawGroups(upperGroup, lowerGroup);
}

async function populateJawPreviewFromOFF(meshFiles, undercut, meshQuality = "low") {
  const upperGroup = new THREE.Group();
  const lowerGroup = new THREE.Group();

  // vertexColors: true makes the per-vertex undercut RGB show through. Side: DoubleSide
  // so the inside of the jaw isn't dark when the camera tilts under the occlusal plane.
  const meshMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...HEATMAP_SURFACE_SHADING,
    side: THREE.DoubleSide,
  });
  const flatColor = new THREE.Color(
    DEFAULT_TOOTH_COLOR[0],
    DEFAULT_TOOTH_COLOR[1],
    DEFAULT_TOOTH_COLOR[2]
  );
  const flatBase = new THREE.MeshStandardMaterial({
    color: flatColor,
    ...JAW_SURFACE_SHADING,
    side: THREE.DoubleSide,
  });

  const totalFiles = Math.max(meshFiles.length, 1);
  for (let i = 0; i < meshFiles.length; i += 1) {
    const file = meshFiles[i];
    const upper = isUpper(file);
    await updateJawMeshProgress(i, totalFiles, 0.08, upper, "Reading parameterized mesh");
    const offText = atob(file.data);
    let geometry = parseOFFToGeometry(offText);
    if (!geometry) continue;

    const surface = upper ? undercut?.upper : undercut?.lower;
    await updateJawMeshProgress(i, totalFiles, 0.35, upper, "Applying undercut heatmap");
    applyUndercutVertexColors(geometry, surface);
    recordJawVertexKey(upper ? "upper" : "lower", geometry);
    await updateJawMeshProgress(i, totalFiles, 0.68, upper, meshQuality === "high" ? "Keeping original mesh" : "Building low quality display mesh");
    geometry = getDisplayGeometryForQuality(
      geometry,
      file?.filename || (upper ? "upper OFF mesh" : "lower OFF mesh"),
      meshQuality
    );
    geometry.computeVertexNormals();
    await updateJawMeshProgress(i, totalFiles, 0.86, upper, "Adding to viewport");

    const jawKey = upper ? "upper" : "lower";
    const heatMat = meshMaterial.clone();
    const flatMat = flatBase.clone();
    const mesh = new THREE.Mesh(geometry, preview3DState.heatmapMode === "undercut" ? heatMat : flatMat);
    mesh.userData.heatmapMaterial = heatMat;
    mesh.userData.flatMaterial = flatMat;
    mesh.userData.surfaceJaw = jawKey;
    mesh.userData.heatmapSurface = surface || null;
    mesh.userData.occlusionSurface = preview3DState.occlusion?.[jawKey] || null;
    if (upper) upperGroup.add(mesh);
    else lowerGroup.add(mesh);
    await updateJawMeshProgress(i, totalFiles, 0.98, upper, "Loaded");
  }

  await mountJawGroups(upperGroup, lowerGroup);
}

function parseOFFToGeometry(text) {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (!lines.length || lines[0].trim() !== "OFF") return null;

  const header = lines[1].trim().split(/\s+/).map(Number);
  const numVertices = header[0];
  const numFaces = header[1];
  if (!Number.isFinite(numVertices) || !Number.isFinite(numFaces)) return null;

  const vertices = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i += 1) {
    const parts = lines[2 + i].trim().split(/\s+/);
    vertices[i * 3] = Number(parts[0]);
    vertices[i * 3 + 1] = Number(parts[1]);
    vertices[i * 3 + 2] = Number(parts[2]);
  }

  const indices = [];
  const faceStart = 2 + numVertices;
  for (let i = 0; i < numFaces; i += 1) {
    const parts = lines[faceStart + i].trim().split(/\s+/).map(Number);
    if (parts[0] === 3) indices.push(parts[1], parts[2], parts[3]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices.length > 65535
    ? new THREE.Uint32BufferAttribute(indices, 1)
    : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

// Parse a jaw STL into a flat-shaded mesh and install it as groups[jaw]. No heatmap —
// a freshly uploaded jaw has no surveying data until the next backend pass.
async function renderJawStl(jaw, file) {
  if (!(await ensureThreeDeps())) return;
  const root = preview3DState.modelRoot;
  if (!root) return;

  // Clear any existing mesh for this jaw first (also resets the row + jawFiles).
  removeJawMesh(jaw);

  const loader = new STLLoader();
  let geometry = loader.parse(base64ToArrayBuffer(file.data));
  geometry = mergeStlVertices(geometry);
  geometry = getDisplayGeometryForQuality(geometry, file.filename || `${jaw}.stl`);
  geometry.computeVertexNormals();

  // Same shading as every other jaw material: a jaw uploaded now must not look
  // different after a reload.
  const flatMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...DEFAULT_TOOTH_COLOR),
    ...JAW_SURFACE_SHADING,
    side: THREE.DoubleSide,
  });
  const heatMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...HEATMAP_SURFACE_SHADING,
    side: THREE.DoubleSide,
  });
  const existingOcclusion = preview3DState.occlusion?.[jaw] || null;
  if (hasOcclusionSurface(existingOcclusion)) {
    applyOcclusionVertexColors(geometry, existingOcclusion);
  }
  const mesh = new THREE.Mesh(
    geometry,
    preview3DState.heatmapMode === "occlusion" && hasOcclusionSurface(existingOcclusion) ? heatMat : flatMat
  );
  mesh.userData.flatMaterial = flatMat;
  mesh.userData.heatmapMaterial = heatMat;
  mesh.userData.surfaceJaw = jaw;
  mesh.userData.occlusionSurface = existingOcclusion;

  const group = new THREE.Group();
  group.add(mesh);
  root.add(group);

  preview3DState.groups[jaw] = group;
  preview3DState.jawFiles[jaw] = { data: file.data, type: file.type, filename: file.filename };
  // Keep the HD/SD rebuild source in step with the new STL — STL-kind sources only, since
  // an OFF source can't host an STL entry (toggling would revert this jaw to the server mesh).
  const entry = { data: file.data, type: file.type, filename: file.filename };
  const src = preview3DState.qualitySource;
  if (src?.kind === "stl") {
    // Only when the source is still held: a released one re-fetches, and this jaw
    // is on the server too, so it comes back with it.
    if (src.files) src.files = src.files.filter((f) => getJawKeyFromFile(f) !== jaw).concat(entry);
    src.jaws = [...new Set([...(src.jaws || []), jaw])];
  } else if (!src) {
    preview3DState.qualitySource = {
      kind: "stl",
      files: [entry],
      jaws: [jaw],
      undercut: null,
      occlusion: preview3DState.occlusion,
    };
  }
  updateQualityToggle();
  setJawRowMode(jaw, true);
  applyJawVisibility();
  centerRootOnCombinedBounds(root);
  fitPreviewCamera();
  queueOcclusionPrecompute();
}

// Drop a jaw's mesh from the view (dispose + clear) and re-center what remains.
// The row stays and flips to its empty/upload state — only the mesh goes.
function removeJawMesh(jaw) {
  const group = preview3DState.groups[jaw];
  if (group) {
    preview3DState.modelRoot?.remove(group);
    disposeObject3D(group);
    preview3DState.groups[jaw] = null;
  }
  delete preview3DState.jawFiles[jaw];
  if (preview3DState.occlusion) preview3DState.occlusion[jaw] = null;
  // Keeps the HD/SD rebuild source in step so a quality toggle can't resurrect a jaw
  // removed this session; `jaws` also filters a released source's re-fetch.
  const src = preview3DState.qualitySource;
  if (src) {
    if (src.files?.length) src.files = src.files.filter((f) => getJawKeyFromFile(f) !== jaw);
    if (src.jaws?.length) src.jaws = src.jaws.filter((key) => key !== jaw);
    updateQualityToggle();
  }
  setJawRowMode(jaw, false);
  if (preview3DState.modelRoot) centerRootOnCombinedBounds(preview3DState.modelRoot);
}

// Put both jaw rows into their empty/upload state for a case with no jaw STLs.
function showEmptyJawPanel() {
  preview3DState.groups.upper = null;
  preview3DState.groups.lower = null;
  preview3DState.jawFiles = {};
  preview3DState.occlusion = { upper: null, lower: null };
  setHeatmapMode("normal");
  setJawRowMode("upper", false);
  setJawRowMode("lower", false);
}

// ---- Geometry utilities (dedup, STL encode, buffers) ---------------------

function mergeStlVertices(geometry) {
  return mergeStlVerticesWithThreshold(geometry, 1e-4);
}

// Mirrors STLMeshLoader.mergeVertices: the backend computes the heatmap against the
// deduplicated STL, so we must dedupe at the same threshold for indices to align.
function mergeStlVerticesWithThreshold(geometry, threshold) {
  const positions = geometry.attributes.position.array;
  const merged = [];
  const indices = [];
  const map = {};
  let next = 0;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    const key = `${Math.round(x / threshold)},${Math.round(y / threshold)},${Math.round(z / threshold)}`;
    if (map[key] === undefined) {
      merged.push(x, y, z);
      map[key] = next;
      indices.push(next);
      next += 1;
    } else {
      indices.push(map[key]);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(merged, 3));
  out.setIndex(indices.length > 65535
    ? new THREE.Uint32BufferAttribute(indices, 1)
    : new THREE.Uint16BufferAttribute(indices, 1));
  return out;
}

function countUniquePositionsAtThreshold(positions, threshold) {
  const seen = new Set();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    seen.add(`${Math.round(x / threshold)},${Math.round(y / threshold)},${Math.round(z / threshold)}`);
  }
  return seen.size;
}

function estimateBackendThreshold(positions, targetCount) {
  let lo = 1e-6;
  let hi = 1e-1;
  let bestThreshold = 1e-4;
  let bestDiff = Infinity;
  for (let iter = 0; iter < 28; iter += 1) {
    const mid = Math.sqrt(lo * hi);
    const count = countUniquePositionsAtThreshold(positions, mid);
    const diff = Math.abs(count - targetCount);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestThreshold = mid;
    }
    if (count > targetCount) lo = mid;
    else hi = mid;
    if (hi / lo < 1.0001) break;
  }
  for (const factor of [0.95, 0.97, 0.99, 1.01, 1.03, 1.05, 0.9, 1.1]) {
    const t = bestThreshold * factor;
    const count = countUniquePositionsAtThreshold(positions, t);
    const diff = Math.abs(count - targetCount);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestThreshold = t;
    }
  }
  return bestThreshold;
}

function buildDualDedupGeometry(rawGeometry, surface, targetBackendCount) {
  const positions = rawGeometry.attributes.position.array;
  const ourThreshold = 1e-4;
  const backendThreshold = estimateBackendThreshold(positions, targetBackendCount);

  const ourMap = new Map();
  const backendMap = new Map();
  const ourVertPositions = [];
  const ourVertToBackendIdx = [];
  const indices = [];
  let nextOur = 0;
  let nextBackend = 0;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    const ourKey = `${Math.round(x / ourThreshold)},${Math.round(y / ourThreshold)},${Math.round(z / ourThreshold)}`;
    const backendKey = `${Math.round(x / backendThreshold)},${Math.round(y / backendThreshold)},${Math.round(z / backendThreshold)}`;

    let ourIdx = ourMap.get(ourKey);
    if (ourIdx === undefined) {
      ourIdx = nextOur++;
      ourMap.set(ourKey, ourIdx);
      ourVertPositions.push(x, y, z);
      ourVertToBackendIdx.push(-1);
    }
    indices.push(ourIdx);

    let backendIdx = backendMap.get(backendKey);
    if (backendIdx === undefined) {
      backendIdx = nextBackend++;
      backendMap.set(backendKey, backendIdx);
    }

    if (ourVertToBackendIdx[ourIdx] === -1) {
      ourVertToBackendIdx[ourIdx] = backendIdx;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(ourVertPositions, 3));
  geometry.setIndex(indices.length > 65535
    ? new THREE.Uint32BufferAttribute(indices, 1)
    : new THREE.Uint16BufferAttribute(indices, 1));

  const surveyingBuffer = surface?.surveying_values?.data;
  const heatmap = surveyingBuffer ? new Float32Array(new Uint8Array(surveyingBuffer).buffer) : null;
  const heatmapVerts = heatmap ? Math.floor(heatmap.length / 4) : 0;

  const colors = new Float32Array(nextOur * 3);
  for (let i = 0; i < nextOur; i += 1) {
    let r = DEFAULT_TOOTH_COLOR[0];
    let g = DEFAULT_TOOTH_COLOR[1];
    let b = DEFAULT_TOOTH_COLOR[2];
    const bIdx = ourVertToBackendIdx[i];
    if (heatmap && bIdx >= 0 && bIdx < heatmapVerts) {
      [r, g, b] = normalizeUndercutColor(
        heatmap[bIdx * 4],
        heatmap[bIdx * 4 + 1],
        heatmap[bIdx * 4 + 2]
      );
    }
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  // Majority-vote cleanup: dedup-misalignment speckle gets out-voted by neighbours,
  // while the bands stay quantized — crisp thresholds, matching the desktop app.
  snapVertexColorBands(geometry, 2);

  return { geometry, backendVertCount: nextBackend };
}

/**
 * Band-vote cleanup: classify each vertex to its nearest palette band, then adopt the
 * majority band among its neighbours. Kills speckle; ties keep the vertex's own band.
 */
function snapVertexColorBands(geometry, iterations = 2) {
  const colorAttr = geometry.getAttribute("color");
  const indexAttr = geometry.getIndex();
  if (!colorAttr || !indexAttr) return;

  // Palette as written into the attribute: tan raw, band colours linear-converted.
  const palette = [
    DEFAULT_TOOTH_COLOR,
    ...[0.1, 0.3, 0.6, 0.8].map((v) => colorForSurveyingValue(v).map(srgbToLinear)),
  ];

  const vertexCount = colorAttr.count;
  const indices = indexAttr.array;

  // Adjacency once — each triangle's three corners are mutual neighbours. Flat
  // parallel arrays (offsets + neighbours) so the hot loop doesn't walk a Set.
  const neighborSets = new Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) neighborSets[v] = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    neighborSets[a].add(b); neighborSets[a].add(c);
    neighborSets[b].add(a); neighborSets[b].add(c);
    neighborSets[c].add(a); neighborSets[c].add(b);
  }
  const offsets = new Uint32Array(vertexCount + 1);
  let total = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    offsets[v] = total;
    total += neighborSets[v].size;
  }
  offsets[vertexCount] = total;
  const flatNeighbors = new Uint32Array(total);
  let cursor = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    for (const n of neighborSets[v]) flatNeighbors[cursor++] = n;
  }

  // Classify each vertex to its nearest palette band.
  let bands = new Uint8Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const r = colorAttr.getX(v);
    const g = colorAttr.getY(v);
    const b = colorAttr.getZ(v);
    let best = 0;
    let bestDist = Infinity;
    for (let pIdx = 0; pIdx < palette.length; pIdx += 1) {
      const pc = palette[pIdx];
      const d = (r - pc[0]) ** 2 + (g - pc[1]) ** 2 + (b - pc[2]) ** 2;
      if (d < bestDist) { bestDist = d; best = pIdx; }
    }
    bands[v] = best;
  }

  const counts = new Uint32Array(palette.length);
  let next = new Uint8Array(vertexCount);
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let v = 0; v < vertexCount; v += 1) {
      counts.fill(0);
      counts[bands[v]] += 1; // self votes too
      for (let n = offsets[v]; n < offsets[v + 1]; n += 1) {
        counts[bands[flatNeighbors[n]]] += 1;
      }
      let winner = bands[v];
      let winnerVotes = counts[bands[v]];
      for (let pIdx = 0; pIdx < counts.length; pIdx += 1) {
        if (counts[pIdx] > winnerVotes) { winner = pIdx; winnerVotes = counts[pIdx]; }
      }
      next[v] = winner;
    }
    [bands, next] = [next, bands];
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const pc = palette[bands[v]];
    colorAttr.setXYZ(v, pc[0], pc[1], pc[2]);
  }
  colorAttr.needsUpdate = true;
}

// Serialize a THREE.BufferGeometry (indexed or not) to a binary STL ArrayBuffer.
function geometryToBinaryStl(geometry) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const triCount = (index ? index.count : pos.count) / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triCount, true); // 80-byte header left zeroed
  const vert = (i) => {
    const vi = index ? index.getX(i) : i;
    return [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
  };
  let offset = 84;
  for (let t = 0; t < triCount; t += 1) {
    const a = vert(t * 3);
    const b = vert(t * 3 + 1);
    const c = vert(t * 3 + 2);
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;
    for (const v of [a, b, c]) {
      view.setFloat32(offset, v[0], true); offset += 4;
      view.setFloat32(offset, v[1], true); offset += 4;
      view.setFloat32(offset, v[2], true); offset += 4;
    }
    view.setUint16(offset, 0, true); offset += 2; // attribute byte count
  }
  return buffer;
}

// A /stl/get payload may be a real STL *or* OFF text (both render here). A .stl-named file
// holding OFF opens blank in STL viewers, so convert OFF → binary STL; pass STL bytes through.
function jawDataToStlBytes(data) {
  const buffer = base64ToArrayBuffer(data);
  const info = inspectMeshPayload(buffer);
  if (info.format === "off") {
    const geometry = parseOFFToGeometry(new TextDecoder().decode(buffer));
    if (geometry) return geometryToBinaryStl(geometry);
    console.warn("[preview3D] OFF jaw could not be parsed for STL export; shipping raw bytes.");
  }
  return buffer;
}

function base64ToArrayBuffer(base64) {
  let cleaned = String(base64 || "").trim();
  // Some payloads arrive as a data-URI or URL-safe base64 with stray whitespace, which plain
  // atob() rejects. Normalize to standard base64 + padding, like safeAtob() in jawStructCodec.js.
  const comma = cleaned.indexOf(",");
  if (cleaned.startsWith("data:") && comma !== -1) {
    cleaned = cleaned.slice(comma + 1);
  }
  cleaned = cleaned.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  cleaned += "=".repeat((4 - (cleaned.length % 4)) % 4);
  const raw = atob(cleaned);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

function inspectMeshPayload(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  const byteLength = bytes.byteLength;
  const previewLength = Math.min(byteLength, 96);
  let header = "";
  for (let i = 0; i < previewLength; i += 1) {
    const code = bytes[i];
    header += code >= 32 && code <= 126 ? String.fromCharCode(code) : " ";
  }
  const trimmedHeader = header.trim();
  const upperHeader = trimmedHeader.toUpperCase();

  if (upperHeader.startsWith("OFF")) {
    return {
      format: "off",
      byteLength,
      header: trimmedHeader.slice(0, 80),
    };
  }

  if (/^SOLID\b/i.test(trimmedHeader)) {
    return {
      format: "ascii-stl",
      byteLength,
      header: trimmedHeader.slice(0, 80),
    };
  }

  if (byteLength >= 84) {
    const view = new DataView(buffer);
    const triangleCount = view.getUint32(80, true);
    const expectedBinaryBytes = 84 + triangleCount * 50;
    return {
      format: expectedBinaryBytes === byteLength ? "binary-stl" : "unknown-binary",
      byteLength,
      binaryStlTriangleCount: triangleCount,
      expectedBinaryStlBytes: expectedBinaryBytes,
      header: trimmedHeader.slice(0, 80),
    };
  }

  return {
    format: "unknown",
    byteLength,
    header: trimmedHeader.slice(0, 80),
  };
}

// ---- Undercut heatmap ----------------------------------------------------

export function setHeatmapEnabled(enabled) {
  setHeatmapMode(enabled ? "undercut" : "normal");
}

export function setOcclusionEnabled(enabled) {
  setHeatmapMode(enabled ? "occlusion" : "normal");
}

export function setHeatmapMode(mode) {
  const normalized = mode === "undercut" || mode === "occlusion" ? mode : "normal";
  preview3DState.heatmapMode = normalized;
  preview3DState.heatmapEnabled = normalized !== "normal";

  const swap = (group) => {
    if (!group) return;
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      const heat = obj.userData?.heatmapMaterial;
      const flat = obj.userData?.flatMaterial;
      if (!heat || !flat) return;
      // Extras carry both materials but only switch once a jaw heatmap is actually painted in.
      if (obj.userData.surveyJaw === null) return;
      if (normalized === "normal") {
        obj.material = flat;
        return;
      }

      const jaw = obj.userData?.surfaceJaw || obj.userData?.surveyJaw;
      const surface = normalized === "occlusion"
        ? (obj.userData?.occlusionSurface || (jaw ? preview3DState.occlusion?.[jaw] : null))
        : (obj.userData?.heatmapSurface || (jaw ? preview3DState.undercut?.[jaw] : null));
      if (normalized === "occlusion" && !hasOcclusionSurface(surface)) {
        obj.material = flat;
        return;
      }
      if (obj.userData?.surveyJaw && obj.geometry?.userData?.jawVertexMap) {
        paintJawCopyHeatmap(obj.geometry, surface, normalized);
        obj.material = heat;
        return;
      }
      if (normalized === "occlusion") {
        applyOcclusionVertexColors(obj.geometry, surface);
      } else {
        applyUndercutVertexColors(obj.geometry, surface);
        snapVertexColorBands(obj.geometry, 2);
      }
      obj.material = heat;
    });
  };
  swap(preview3DState.groups.upper);
  swap(preview3DState.groups.lower);
  // Jaw-copy slots (1 & 3) follow the same toggle — they wear the jaw's own heatmap.
  for (const entry of Object.values(preview3DState.extraGroups || {})) swap(entry?.group);
  const btn = preview3DState.heatmapToggleBtn;
  if (btn) btn.setAttribute("aria-pressed", normalized === "undercut" ? "true" : "false");
  // .is-off both dims the corner icon and hides the legend dropdown.
  preview3DState.heatmapBoard?.classList.toggle("is-off", normalized !== "undercut");
  const occBtn = preview3DState.occlusionToggleBtn;
  if (occBtn) occBtn.setAttribute("aria-pressed", normalized === "occlusion" ? "true" : "false");
  preview3DState.occlusionBoard?.classList.toggle("is-off", normalized !== "occlusion");
}

function reapplyHeatmap(undercut) {
  const repaint = (group, surface) => {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        applyUndercutVertexColors(obj.geometry, surface);
        snapVertexColorBands(obj.geometry, 2);
      }
    });
  };
  repaint(preview3DState.groups.upper, undercut?.upper);
  repaint(preview3DState.groups.lower, undercut?.lower);
}

function reapplyOcclusion(occlusion) {
  const repaint = (group, surface) => {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) {
        obj.userData.occlusionSurface = surface || null;
        applyOcclusionVertexColors(obj.geometry, surface);
      }
    });
  };
  repaint(preview3DState.groups.upper, occlusion?.upper);
  repaint(preview3DState.groups.lower, occlusion?.lower);
}

// Paints the undercut colours into the meshes but does NOT switch the display to
// them — showing the heatmap is the caller's decision.
export async function applySurveyUndercutToPreview(nextUndercut) {
  preview3DState.undercut = nextUndercut;
  if (preview3DState.qualitySource) {
    preview3DState.qualitySource.undercut = nextUndercut;
  }

  const source = preview3DState.qualitySource;
  const quality = preview3DState.meshQuality || "low";
  // The SD mesh has to be rebuilt from source: decimation picks the most severe band
  // per cluster, so a new survey changes which vertices survive.
  const files = quality === "low" && source?.jaws?.length ? await ensureJawSourceFiles() : [];
  if (files.length) {
    console.log("[preview3D] rebuilding low quality mesh with updated survey heatmap", {
      kind: source.kind,
      quality,
    });
    if (source.kind === "off") {
      await populateJawPreviewFromOFF(files, nextUndercut, quality);
    } else {
      await populateJawPreview(files, nextUndercut, quality);
    }
    // populate* clears the model root, taking the extra-slot meshes with it (they are
    // detached, never disposed) — put them back or the extras stage goes empty.
    reattachExtraGroups();
    applyJawVisibility();
    // Fresh jaw groups land on the root; the Extra 3D tab wants them back off it.
    if (isUpload3dModalOpen()) setJawMeshesOnStage(false);
    updateQualityToggle();
    repaintExtraJawHeatmaps();
    return;
  }

  reapplyHeatmap(nextUndercut);
  repaintExtraJawHeatmaps();
}

export function applyOcclusionToPreview(nextOcclusion) {
  preview3DState.occlusion = nextOcclusion || { upper: null, lower: null };
  if (preview3DState.qualitySource) {
    preview3DState.qualitySource.occlusion = preview3DState.occlusion;
  }
  const updateSurfaceRefs = (group, jaw) => {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.isMesh) obj.userData.occlusionSurface = preview3DState.occlusion?.[jaw] || null;
    });
  };
  updateSurfaceRefs(preview3DState.groups.upper, "upper");
  updateSurfaceRefs(preview3DState.groups.lower, "lower");

  if (preview3DState.heatmapMode === "occlusion") {
    reapplyOcclusion(preview3DState.occlusion);
    repaintExtraJawHeatmaps();
  }
}

// Re-add the still-alive extra-slot groups to the model root after a jaw rebuild.
function reattachExtraGroups() {
  const root = preview3DState.modelRoot;
  if (!root) return false;
  const extras = Object.values(preview3DState.extraGroups || {});
  if (!extras.length) return false;
  extras.forEach((entry) => entry?.group && root.add(entry.group));
  return true;
}

function applyMappedHeatmapColors(geometry, heatmap, normalizeColor, options = {}) {
  const vertexCount = geometry.attributes.position.count;
  const colors = new Float32Array(vertexCount * 3);

  // Default everything to the base tooth color.
  for (let i = 0; i < vertexCount; i += 1) {
    colors[i * 3] = DEFAULT_TOOTH_COLOR[0];
    colors[i * 3 + 1] = DEFAULT_TOOTH_COLOR[1];
    colors[i * 3 + 2] = DEFAULT_TOOTH_COLOR[2];
  }

  const heatmapVerts = heatmap ? Math.floor(heatmap.length / 4) : 0;
  const clusterOf = geometry.userData?.clusterSourceMap;
  if (heatmapVerts && clusterOf?.length) {
    const severity = new Float32Array(vertexCount).fill(-1);
    for (let src = 0; src < Math.min(clusterOf.length, heatmapVerts); src += 1) {
      const display = clusterOf[src];
      if (display >= vertexCount) continue;
      const [r, g, b] = normalizeColor(
        heatmap[src * 4],
        heatmap[src * 4 + 1],
        heatmap[src * 4 + 2]
      );
      const bandSeverity = getHeatmapColorSeverity(r, g, b);
      if (bandSeverity > severity[display]) {
        severity[display] = bandSeverity;
        colors[display * 3] = r;
        colors[display * 3 + 1] = g;
        colors[display * 3 + 2] = b;
      }
    }
  } else if (heatmapVerts) {
    const trimTail = Math.max(0, Number(options?.trimTailVertices) || 0);
    const limit = Math.max(0, Math.min(vertexCount, heatmapVerts) - trimTail);
    for (let i = 0; i < limit; i += 1) {
      const [r, g, b] = normalizeColor(
        heatmap[i * 4],
        heatmap[i * 4 + 1],
        heatmap[i * 4 + 2]
      );
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function applyUndercutVertexColors(geometry, surface, options = {}) {
  // surveying_values is the undercut heatmap (yellow to red). Channels of (1,1,1) mark
  // "no undercut" — the API uses that as a sentinel, so we keep the default color there.
  applyMappedHeatmapColors(
    geometry,
    surfaceFloatArray(surface, "surveying_values"),
    normalizeUndercutColor,
    options
  );
}

function applyOcclusionVertexColors(geometry, surface, options = {}) {
  applyMappedHeatmapColors(
    geometry,
    surfaceFloatArray(surface, "occlusion_values"),
    normalizeOcclusionColor,
    options
  );
}

function normalizeUndercutColor(r, g, b) {
  // The backend uses pure white as "no undercut". Real yellow/red heatmap
  // colors may still contain a 1.0 channel, so only full white maps to tooth tan.
  if (r === 1 && g === 1 && b === 1) {
    return DEFAULT_TOOTH_COLOR;
  }
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function normalizeOcclusionColor(r, g, b) {
  if (r === 1 && g === 1 && b === 1) {
    return DEFAULT_TOOTH_COLOR;
  }
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

function getHeatmapColorSeverity(r, g, b) {
  const dr = r - DEFAULT_TOOTH_COLOR[0];
  const dg = g - DEFAULT_TOOTH_COLOR[1];
  const db = b - DEFAULT_TOOTH_COLOR[2];
  return dr * dr + dg * dg + db * db;
}

function getUndercutColorSeverity(r, g, b) {
  return getHeatmapColorSeverity(r, g, b);
}

// Desktop's undercutColourMap, byte-exact. Returns sRGB on purpose (normalizeUndercutColor
// converts later); "no undercut" emits the backend's white sentinel, resolving to raw tan.
export function colorForSurveyingValue(value) {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return [1, 1, 1];

  if (v < 0.25) return [255 / 255, 210 / 255, 0]; // #FFD200
  if (v < 0.5) return [253 / 255, 140 / 255, 0]; // #FD8C00
  if (v < 0.75) return [254 / 255, 70 / 255, 0]; // #FE4600
  return [170 / 255, 0, 3 / 255]; // #AA0003
}

// Unity's "Occlusion Colour Map.asset" in smartrpd-v2_astar, mode ByValue.
export function colorForOcclusionValue(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return [1, 1, 1];
  if (v <= 0) return [1, 1, 1];
  if (v <= 0.1) return [0.5411765, 0, 0.8352942];
  if (v <= 0.25) return [0.027450982, 0, 0.6117647];
  if (v <= 0.4) return [0.29803923, 0.8588236, 1];
  if (v <= 0.5) return [0, 0.91372555, 0.18823531];
  return [1, 1, 1];
}

// Legend swatches are generated from colorForSurveyingValue so the two can't drift.
function undercutBandHex(value) {
  return (
    "#" +
    colorForSurveyingValue(value)
      .map((c) => Math.round(c * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function occlusionBandHex(value) {
  return (
    "#" +
    colorForOcclusionValue(value)
      .map((c) => Math.round(c * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function buildDllUndercutSurface(jaw, response) {
  let values = null;
  if (response?.surveying_values_base64) {
    values = new Float32Array(base64ToArrayBuffer(response.surveying_values_base64));
  } else if (Array.isArray(response?.surveying_values)) {
    values = response.surveying_values;
  } else {
    values = response?.surveying_values_preview;
  }
  if (!values?.length) return null;

  const heatmap = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const [r, g, b] = colorForSurveyingValue(values[i]);
    heatmap[i * 4] = r;
    heatmap[i * 4 + 1] = g;
    heatmap[i * 4 + 2] = b;
    heatmap[i * 4 + 3] = 1;
  }

  return {
    jaw_type: jaw === "upper" ? "upper_jaw" : "lower_jaw",
    point_size: response?.surveying_count || values.length,
    source: "dll_compute_surveying_no_pd",
    surveying_direction: response?.surveying_direction,
    surveying_values: {
      data: Array.from(new Uint8Array(heatmap.buffer)),
    },
  };
}

export function buildDllOcclusionSurface(jaw, response) {
  const record = Array.isArray(response?.records)
    ? response.records.find((item) => normalizeOcclusionJaw(item) === jaw)
    : response;

  let values = null;
  if (record?.occlusion_values_base64) {
    values = new Float32Array(base64ToArrayBuffer(record.occlusion_values_base64));
  } else if (Array.isArray(record?.occlusion_values)) {
    values = record.occlusion_values;
  } else {
    values = record?.occlusion_values_preview;
  }
  if (!values?.length) return null;

  const heatmap = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const [r, g, b] = colorForOcclusionValue(values[i]);
    heatmap[i * 4] = r;
    heatmap[i * 4 + 1] = g;
    heatmap[i * 4 + 2] = b;
    heatmap[i * 4 + 3] = 1;
  }

  return {
    jaw_type: jaw === "upper" ? "upper_jaw" : "lower_jaw",
    point_size: record?.occlusion_count || record?.point_size || values.length,
    source: "dll_compute_occlusion",
    occlusion_values: {
      data: Array.from(new Uint8Array(heatmap.buffer)),
    },
  };
}

function normalizeOcclusionJaw(record) {
  const raw = record?.jaw ?? record?.type ?? record?.jaw_type ?? record?.db_type;
  if (raw === 1 || raw === "1") return "upper";
  if (raw === 2 || raw === "2") return "lower";
  const value = String(raw || "").toLowerCase();
  if (value.includes("upper")) return "upper";
  if (value.includes("lower")) return "lower";
  return null;
}

function bufferDataToFloatArray(data) {
  if (!data?.length) return null;
  return new Float32Array(new Uint8Array(data).buffer);
}

function surfaceFloatArray(surface, field) {
  return bufferDataToFloatArray(surface?.[field]?.data);
}

// Vertices the backend surveyed for this jaw (the heatmap is RGBA float per vertex).
function surveyingVertexCount(surface) {
  return Math.floor((surfaceFloatArray(surface, "surveying_values")?.length || 0) / 4);
}

// Welded jaw positions kept pre-decimation so a slot looks its undercut up BY POSITION:
// slot files are a different tessellation, and index matching paints red speckle.
function recordJawVertexKey(jaw, geometry) {
  const position = geometry?.getAttribute?.("position");
  if (!position?.count) return;
  preview3DState.jawVertexKeys[jaw] = {
    count: position.count,
    positions: Float32Array.from(position.array.subarray(0, position.count * 3)),
    grid: null, // built on first use, see jawVertexGrid
  };
}

// Slot vertex -> nearest jaw vertex, or NO_VERTEX_MATCH when nothing is within the match
// radius. Cached on the geometry so a survey landing later repaints without redoing the search.
function buildJawVertexMap(geometry, jaw) {
  const key = preview3DState.jawVertexKeys?.[jaw];
  const position = geometry?.getAttribute?.("position");
  if (!key?.count || !position?.count) return null;

  key.grid = key.grid || buildVertexGrid(key.positions);
  const result = mapNearestVertices(position.array.subarray(0, position.count * 3), key.grid);
  if (!result) return null;

  geometry.userData.jawVertexMap = result.map;
  return result;
}

function hasUndercutSurface(surface) {
  return !!surfaceFloatArray(surface, "surveying_values")?.length;
}

function hasAnyUndercutSurface(undercut) {
  return hasUndercutSurface(undercut?.upper) || hasUndercutSurface(undercut?.lower);
}

function hasOcclusionSurface(surface) {
  return !!surfaceFloatArray(surface, "occlusion_values")?.length;
}

function hasAnyOcclusionSurface(occlusion) {
  return hasOcclusionSurface(occlusion?.upper) || hasOcclusionSurface(occlusion?.lower);
}

// ---- Camera framing and view navigation ----------------------------------

function centerRootOnCombinedBounds(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -center.y, -center.z);
}

function applyJawVisibility() {
  const upper = preview3DState.groups.upper;
  const lower = preview3DState.groups.lower;
  const view = preview3DState.activeView;
  if (upper) upper.visible = view === "both" || view === "upper";
  if (lower) lower.visible = view === "both" || view === "lower";
  // Jaws the extras stage is holding off screen stay hidden through an HD/SD
  // re-render; the jaw row icon is what takes a jaw back out of that set.
  for (const jaw of preview3DState.stageHiddenJaws || []) {
    const group = preview3DState.groups[jaw];
    if (group) group.visible = false;
  }
}

// World bounds of only the VISIBLE meshes under `root`. Box3.setFromObject ignores
// `.visible`, so a hidden jaw (or a hidden extra STL) would otherwise still drive the fit.
function visibleModelBounds(root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverseVisible((obj) => {
    if (obj.geometry) box.expandByObject(obj);
  });
  return box;
}

// `visibleOnly` frames just what's on screen; `worldView` aims from a WORLD direction —
// deliberately not PREVIEW_VIEW_PRESETS, which are model-local and read inverted here.
function fitPreviewCamera({ visibleOnly = false, worldView = null } = {}) {
  const root = preview3DState.modelRoot;
  const camera = preview3DState.camera;
  const controls = preview3DState.controls;
  if (!root || !camera || !controls) return;

  const box = visibleOnly ? visibleModelBounds(root) : new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Fit BOTH axes: take the larger of the vertical and horizontal distance needs.
  const FIT_PADDING = 1.3;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
  // The camera looks down on the jaw, so its on-screen height comes from both the
  // world Y and Z extents; width is the arch across world X.
  const distV = Math.max(size.y, size.z, 1) / 2 / Math.tan(vFov / 2);
  const distH = Math.max(size.x, 1) / 2 / Math.tan(hFov / 2);
  const fitDist = Math.max(distV, distH) * FIT_PADDING;
  // Normalised so fitDist IS the camera distance.
  let viewOffset = new THREE.Vector3(0, 0.35, 1.25).normalize();
  let viewUp = new THREE.Vector3(0, 1, 0);
  if (worldView) {
    viewOffset = new THREE.Vector3(...worldView.dir).normalize();
    viewUp = new THREE.Vector3(...worldView.up).normalize();
  }
  camera.up.copy(viewUp);
  camera.position.copy(center).addScaledVector(viewOffset, fitDist);
  controls.target.copy(center);
  controls.update();
  // Call only if present (TrackballControls has no saveState).
  controls.saveState?.();
}

// Camera offset + up per snap, in the MODEL's local frame (Z-up: +Z = occlusal); modelRoot is
// tilted -PI/2 on X so these rotate by its quaternion. Keys match the ViewCube face order.
const PREVIEW_VIEW_PRESETS = {
  top: { dir: [0, -1, 0], up: [0, 0, 1] },
  bottom: { dir: [0, 1, 0], up: [0, 0, 1] },
  left: { dir: [-1, 0, 0], up: [0, 1, 0] },
  right: { dir: [1, 0, 0], up: [0, 1, 0] },
  front: { dir: [0, 0, 1], up: [0, 1, 0] },
  back: { dir: [0, 0, -1], up: [0, 1, 0] },
};

// Snap the preview camera to a named orthographic view (or re-fit on "fit").
function snapPreviewView(view) {
  if (view === "fit") {
    fitPreviewCamera();
    return;
  }
  const preset = PREVIEW_VIEW_PRESETS[view];
  const root = preview3DState.modelRoot;
  const camera = preview3DState.camera;
  const controls = preview3DState.controls;
  if (!preset || !root || !camera || !controls) return;

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fitDist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.5;

  // Rotate the model-local direction/up into world space so the view follows the
  // jaw's actual orientation regardless of modelRoot's tilt.
  const modelQuat = root.getWorldQuaternion(new THREE.Quaternion());
  const dir = new THREE.Vector3(preset.dir[0], preset.dir[1], preset.dir[2])
    .applyQuaternion(modelQuat)
    .normalize();
  const up = new THREE.Vector3(preset.up[0], preset.up[1], preset.up[2])
    .applyQuaternion(modelQuat)
    .normalize();
  camera.up.copy(up);
  camera.position.copy(center).addScaledVector(dir, fitDist);
  controls.target.copy(center);
  controls.update();
  controls.saveState?.();
}

// View-navigation gizmo (bottom-right): an isometric cube ringed by SVG arrows pointing inward;
// each snaps the camera via snapPreviewView. One shared "points down" shape, rotated per position.
function buildPreviewNavGizmo() {
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgNode = (tag, attrs = {}) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };

  // Beveled arrow (base shape points DOWN); `rotateDeg` aims it at the cube.
  const makeArrow = (rotateDeg, gradId) => {
    const svg = svgNode("svg", { viewBox: "0 0 24 24", width: 22, height: 22 });
    svg.style.transform = `rotate(${rotateDeg}deg)`;
    const defs = svgNode("defs");
    const grad = svgNode("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svgNode("stop", { offset: 0, "stop-color": "#5fd0b6" }));
    grad.appendChild(svgNode("stop", { offset: 1, "stop-color": "#2f9079" }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    svg.appendChild(
      svgNode("path", {
        d: "M12 19.5 L4 9.5 H8.5 V4.5 H15.5 V9.5 H20 Z",
        fill: `url(#${gradId})`,
        stroke: "#25735f",
        "stroke-width": 0.8,
        "stroke-linejoin": "round",
      })
    );
    return svg;
  };

  // Isometric cube: top (lightest), left (mid), right (darkest) faces.
  const makeCube = () => {
    const svg = svgNode("svg", { viewBox: "0 0 32 34", width: 30, height: 32 });
    const faces = [
      { points: "16,3 29,10.5 16,18 3,10.5", fill: "#dfe4ea" },
      { points: "3,10.5 16,18 16,31 3,23.5", fill: "#a9afb8" },
      { points: "29,10.5 16,18 16,31 29,23.5", fill: "#868c95" },
    ];
    for (const f of faces) {
      svg.appendChild(
        svgNode("polygon", {
          points: f.points,
          fill: f.fill,
          stroke: "#565c65",
          "stroke-width": 0.8,
          "stroke-linejoin": "round",
        })
      );
    }
    return svg;
  };

  const nav = document.createElement("div");
  nav.className = "jaw-preview-nav";

  const grid = document.createElement("div");
  grid.className = "jpnav-grid";

  // rot is clockwise from the base "down" arrow so every arrow points at the cube. Top/bottom
  // and front/back are swapped: the top control snaps to the bottom view, and likewise front ↔ back.
  const items = [
    { cls: "jpnav-top", snap: "bottom", label: "Bottom view", rot: 0 },
    { cls: "jpnav-front", snap: "back", label: "Back view", rot: 45 },
    { cls: "jpnav-left", snap: "left", label: "Left view", rot: 270 },
    { cls: "jpnav-cube", snap: "fit", label: "Default view", cube: true },
    { cls: "jpnav-right", snap: "right", label: "Right view", rot: 90 },
    { cls: "jpnav-back", snap: "front", label: "Front view", rot: 225 },
    { cls: "jpnav-bottom", snap: "top", label: "Top view", rot: 180 },
  ];
  items.forEach((def, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `jpnav-btn ${def.cls}`;
    btn.title = def.label;
    btn.appendChild(def.cube ? makeCube() : makeArrow(def.rot, `jpnav-grad-${i}`));
    btn.addEventListener("click", () => snapPreviewView(def.snap));
    grid.appendChild(btn);
  });
  nav.appendChild(grid);
  return nav;
}

// ---- Screen capture and thumbnails ---------------------------------------

// Case thumbnail slots via POST /thumbnails: 0 = composite 2D, 1/2 = upper/lower jaw renders.
// A capture overwrites the slot of whichever jaw is visible; both visible → write both.
const JAW_UPPER_THUMBNAIL_SLOT = 1;

const JAW_LOWER_THUMBNAIL_SLOT = 2;

// Snapshot the view as a data URL. We re-render first because WebGL's drawing buffer isn't kept
// between frames — leaving preserveDrawingBuffer off is much faster on Windows/Edge.
export function capture3DPreviewDataUrl() {
  const { renderer, scene, camera } = preview3DState;
  if (!renderer || !scene || !camera) return "";
  try {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } catch (err) {
    console.warn("capture3DPreviewDataUrl failed", err);
    return "";
  }
}

// Save the snapshot to the visible jaw's thumbnail slot. POST /thumbnails upserts by
// (case_int_id, slot), so each slot keeps only its latest capture. Best-effort.
async function uploadLatest3DCapture(dataUrl) {
  const caseIntID = state.caseIntID;
  const user = getLoggedInUser();
  if (!caseIntID || !user?.uuid || !dataUrl) {
    toast.error("Screen capture failed — please reload and try again.");
    return;
  }

  // Hidden jaws aren't in the captured pixels, so writing the capture into their slot would
  // replace a good render with a misleading one. Skip slots whose jaw is hidden.
  const upperVisible = !!preview3DState.groups?.upper?.visible;
  const lowerVisible = !!preview3DState.groups?.lower?.visible;
  const slots = [];
  if (upperVisible) slots.push(JAW_UPPER_THUMBNAIL_SLOT);
  if (lowerVisible) slots.push(JAW_LOWER_THUMBNAIL_SLOT);
  if (!slots.length) {
    toast.warning("No jaw is visible to capture.");
    return;
  }

  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;

  const results = await Promise.all(
    slots.map((slot) =>
      fetch(`${SMARTRPD_API_BASE}/thumbnails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { machine_id: PREVIEW_MACHINE_ID, uuid: user.uuid, caseIntID },
          { case_id: caseIntID, slot, data: base64 },
        ]),
      })
        .then((res) => ({ slot, ok: res.ok, status: res.status }))
        .catch((err) => {
          console.error(`[preview3D] thumbnail slot ${slot} fetch failed:`, err);
          return { slot, ok: false, status: 0 };
        })
    )
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("[preview3D] failed thumbnail slots:", failed);
    const msg = `Case thumbnail update failed for slot${failed.length > 1 ? "s" : ""} ${failed.map((r) => r.slot).join(", ")}.`;
    setMessage(msg, true);
    toast.error(msg);
    return;
  }
  const labels = slots
    .map((s) => (s === JAW_UPPER_THUMBNAIL_SLOT ? "upper" : "lower"))
    .join(" + ");
  setMessage(`${labels} thumbnail updated.`, false);
  toast.success(`Screen capture saved to ${labels} thumbnail.`);
}

// Capture one jaw alone into its thumbnail slot (1=upper, 2=lower) after an STL upload, so the
// case tile updates without a manual capture. The other jaw is hidden for the shot, then restored.
async function uploadJawThumbnail(jaw) {
  const { renderer, scene, camera } = preview3DState;
  const caseIntID = state.caseIntID;
  const user = getLoggedInUser();
  if (!renderer || !scene || !camera || !caseIntID || !user?.uuid) return;
  if (!preview3DState.groups?.[jaw]) return;

  const slot = jaw === "upper" ? JAW_UPPER_THUMBNAIL_SLOT : JAW_LOWER_THUMBNAIL_SLOT;

  // Isolate the target jaw for the capture, then restore the prior visibility so
  // the on-screen view is left exactly as it was.
  const prev = {
    upper: preview3DState.groups?.upper?.visible,
    lower: preview3DState.groups?.lower?.visible,
  };
  if (preview3DState.groups?.upper) preview3DState.groups.upper.visible = jaw === "upper";
  if (preview3DState.groups?.lower) preview3DState.groups.lower.visible = jaw === "lower";

  let base64 = "";
  try {
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL("image/png");
    const commaIdx = dataUrl.indexOf(",");
    base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  } catch (err) {
    console.warn(`[preview3D] thumbnail capture (${jaw}) failed`, err);
  } finally {
    if (preview3DState.groups?.upper) preview3DState.groups.upper.visible = !!prev.upper;
    if (preview3DState.groups?.lower) preview3DState.groups.lower.visible = !!prev.lower;
    renderer.render(scene, camera);
  }
  if (!base64) return;

  try {
    const res = await fetch(`${SMARTRPD_API_BASE}/thumbnails`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { machine_id: PREVIEW_MACHINE_ID, uuid: user.uuid, caseIntID },
        { case_id: caseIntID, slot, data: base64 },
      ]),
    });
    if (res.ok) {
      console.log(`[preview3D] ✓ thumbnail slot ${slot} (${jaw}) updated`);
    } else {
      console.error(`[preview3D] ✕ thumbnail slot ${slot} (${jaw}) status=${res.status}`);
    }
  } catch (err) {
    console.error(`[preview3D] thumbnail slot ${slot} (${jaw}) fetch failed`, err);
  }
}

// ---- Jaw STL upload and removal ------------------------------------------

// One-shot .stl file picker; the input is removed as soon as a pick lands.
function pickStlFile(onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".stl";
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) onPick(file);
  });
  input.click();
}

function pickAndUploadJawStl(jaw) {
  pickStlFile((file) => uploadJawStl(jaw, file));
}

// Upload a picked STL as the case's real jaw — mirrors case creation (POST /stl/raw + /stl) so it
// round-trips, then renders into groups[jaw] so the icon/trash/survey controls operate on it.
async function uploadJawStl(jaw, file) {
  if (!state.caseIntID) {
    setMessage?.("Open a case before uploading a 3D file.");
    return;
  }
  if (!/\.stl$/i.test(file.name)) {
    setMessage?.("Only .stl files are supported.");
    return;
  }

  const jawType = jaw === "upper" ? "upper_jaw" : "lower_jaw";
  const dbType = jaw === "upper" ? 1 : 2;
  const auth = extraSlotAuth(); // { machine_id, uuid, caseIntID }
  // /stl/raw keys on the case name string (caseData.case_id); /stl keys on the
  // integer id. Fall back to caseIntID for case_id if case data isn't loaded.
  const caseId = preview3DState.caseData?.case_id || state.caseIntID;

  setMessage?.(`Uploading ${jaw} jaw...`);
  setJawRowUploading(jaw, true);

  // Combined upload progress across both buckets (each tracked 0..1), surfaced
  // as a single % in the row's SET SURVEY ANGLE slot.
  const frac = { raw: 0, stl: 0 };
  const reportProgress = () =>
    setJawRowUploadProgress(jaw, ((frac.raw + frac.stl) / 2) * 100);

  // POST via XHR (for real upload-progress events) and log the exact outcome, so an
  // asymmetric upper/lower problem is visible in the console.
  const postStl = (path, payloadBody, key) =>
    new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${SMARTRPD_API_BASE}${path}`);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) { frac[key] = e.loaded / e.total; reportProgress(); }
        };
        xhr.upload.onload = () => { frac[key] = 1; reportProgress(); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log(`[preview3D] ✓ POST ${path} (${jaw}) status=${xhr.status} type=${JSON.stringify(payloadBody.type)} case_id=${JSON.stringify(payloadBody.case_id)}`);
            resolve(true);
          } else {
            console.error(`[preview3D] ✕ POST ${path} (${jaw}) status=${xhr.status} type=${JSON.stringify(payloadBody.type)} case_id=${JSON.stringify(payloadBody.case_id)} body=${(xhr.responseText || "").slice(0, 300)}`);
            resolve(false);
          }
        };
        xhr.onerror = () => {
          console.error(`[preview3D] ✕ POST ${path} (${jaw}) network error`);
          resolve(false);
        };
        xhr.send(JSON.stringify([auth, payloadBody]));
      } catch (err) {
        console.error(`[preview3D] ✕ POST ${path} (${jaw}) threw`, err);
        resolve(false);
      }
    });

  try {
    const base64 = await fileToBase64(file);

    // Both buckets are attempted independently — a failure in one must not skip
    // the other (the desktop client and the web preview read different tables).
    const [rawOk, stlOk] = await Promise.all([
      postStl("/stl/raw", { case_id: caseId, type: jawType, data: base64, filename: file.name }, "raw"),
      postStl("/stl", { case_id: state.caseIntID, type: dbType, data: base64, filename: file.name }, "stl"),
    ]);

    if (!rawOk && !stlOk) {
      setMessage?.(`${jaw[0].toUpperCase() + jaw.slice(1)} jaw upload failed (server rejected both buckets — see console).`);
      return;
    }

    await renderJawStl(jaw, { data: base64, type: jawType, filename: file.name });
    // Auto-refresh this jaw's case thumbnail from the freshly rendered model so
    // the case tile updates without a manual capture. Best-effort.
    await uploadJawThumbnail(jaw);
    if (rawOk && stlOk) {
      setMessage?.(`${jaw[0].toUpperCase() + jaw.slice(1)} jaw uploaded.`);
    } else {
      setMessage?.(`${jaw[0].toUpperCase() + jaw.slice(1)} jaw uploaded, but ${rawOk ? "/stl" : "/stl/raw"} failed — desktop may not update (see console).`);
    }
  } catch (err) {
    console.error(`[preview3D] ✕ jaw upload (${jaw}) failed`, err);
    setMessage?.("Upload failed. Please try again.");
  } finally {
    setJawRowUploading(jaw, false);
  }
}

// Jaw trash button: save the jaw's currently-shown STL to the closed bucket
// (POST /stlclosed/), then remove it from the preview. Confirms first.
async function saveJawToClosed(jaw) {
  const file = preview3DState.jawFiles?.[jaw];
  if (!file) {
    setMessage?.("No STL data available for this jaw.");
    return;
  }
  const jawLabel = jaw[0].toUpperCase() + jaw.slice(1);
  const confirmed = await confirmModal({
    title: `Remove ${jawLabel} Jaw`,
    message: `Save the ${jaw} jaw to closed and remove it from the preview?`,
    confirmText: "Remove",
    cancelText: "Cancel",
    variant: "danger",
  });
  if (!confirmed) return;
  setMessage?.(`Saving ${jaw} jaw to closed...`);
  // The STL itself is only held while the source is (dropJawSourceFiles releases it),
  // so fetch it back for the upload rather than keeping ~33MB against this one click.
  if (!file.data) await ensureJawSourceFiles();
  if (!file.data) {
    setMessage?.("No STL data available for this jaw.");
    return;
  }
  try {
    const res = await fetch(`${SMARTRPD_API_BASE}/stlclosed/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        extraSlotAuth(),
        { type: file.type, filename: file.filename, data: file.data },
      ]),
    });
    if (!res.ok) {
      console.error(`[preview3D] ✕ POST /stlclosed/ (${jaw}) status=${res.status}`);
      setMessage?.("Failed to save STL to closed. Please try again.");
      return;
    }
    removeJawMesh(jaw);
    setMessage?.(`${jaw[0].toUpperCase() + jaw.slice(1)} jaw saved to closed.`);
  } catch (err) {
    console.error(`[preview3D] ✕ POST /stlclosed/ (${jaw}) failed`, err);
    setMessage?.("Failed to save STL to closed. Please try again.");
  }
}

// ---- Extra 3D file slots (jaw_stls_extra_slot_1..4) ----------------------

// Four fixed, named extra-STL slots per case. The number is the backend key; the name is a
// display label only — the backend slots are not semantically typed.
const EXTRA_STL_SLOTS = [1, 2, 3, 4];

const EXTRA_STL_SLOT_NAMES = {
  1: "Upper jaw",
  2: "Metal RPD",
  3: "Lower jaw",
  4: "Metal RPD",
};

// Per-slot icon, shown only on a a populated Extra 3D slot row. Paths are relative to
// src/js/2D/; `black: true` renders the image fully black via a CSS filter.
const EXTRA_STL_SLOT_ICONS = {
  1: { src: "../../assets/Icon_UpperJaw_Occlusal.png", black: true },
  2: { src: "../../assets/upper.svg" },
  3: { src: "../../assets/Icon_LowerJaw_Occlusal.png", black: true },
  4: { src: "../../assets/lower.svg" },
};

// Jaw slots (1 & 3) in jaw tan: float components into THREE.Color, UNCONVERTED — a hex is
// read as sRGB and lands much darker. A function, not a constant: THREE loads on demand.
const extraJawColor = () => new THREE.Color(...DEFAULT_TOOTH_COLOR);

// Metal RPD slots (2 = upper arch, 4 = lower) render with a metallic finish
// instead of the tan jaw colour.
const METAL_RPD_SLOTS = new Set([2, 4]);

// Jaw-scan slots borrow the matching jaw's heatmap rather than being surveyed — the file is
// a copy, so the DLL values already describe it. Metal-RPD slots never borrow one.
const EXTRA_SLOT_JAW = { 1: "upper", 3: "lower" };

const METAL_RPD_COLOR = 0xd6dadf; // brushed cobalt-chrome / stainless

// Display label for a slot, e.g. "Slot 1: Upper jaw".
function slotLabel(slot) {
  return `Slot ${slot}: ${EXTRA_STL_SLOT_NAMES[slot] || "3D file"}`;
}

function extraSlotAuth() {
  const user = getLoggedInUser();
  return {
    machine_id: PREVIEW_MACHINE_ID,
    uuid: user?.uuid || PREVIEW_FALLBACK_UUID,
    caseIntID: state.caseIntID,
  };
}

// One slot's file, or 404 when empty. Fetched and released one at a time by
// loadExtraStlsIntoPreview — all four at once is ~133MB of base64 held at once.
async function fetchExtraStlSlot(slotNumber) {
  if (!state.caseIntID) return null;
  try {
    const res = await fetch(`${SMARTRPD_API_BASE}/stl/slot/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([extraSlotAuth(), { slotNumber }]),
    });
    if (!res.ok) return null; // 404 = empty slot
    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : data;
    if (!item?.data) return null;
    return { slotNumber, filename: item.filename || `slot${slotNumber}.stl`, data: item.data };
  } catch (err) {
    console.warn(`[preview3D] ✕ POST /stl/slot/get (slot ${slotNumber}) failed`, err);
    return null;
  }
}

// Never load extras on entry: ~133MB of base64 parsed invisibly pushes an iPhone content
// process past its ceiling. The in-flight promise is the latch; clearing it wipes new uploads.
function ensureExtraStlsLoaded() {
  if (!preview3DState.extrasLoadPromise) {
    preview3DState.extrasLoading = true;
    showExtrasLoadingOverlay();
    preview3DState.extrasLoadPromise = loadExtraStlsIntoPreview()
      .then(() => {
        preview3DState.extrasLoading = false;
        clearExtrasLoadingOverlay();
      })
      .catch((err) => {
        preview3DState.extrasLoading = false;
        clearExtrasLoadingOverlay();
        preview3DState.extrasLoadPromise = null;
        throw err;
      });
  }
  return preview3DState.extrasLoadPromise;
}

async function loadExtraStlsIntoPreview() {
  preview3DState.extraGroups = {};
  preview3DState.extraFileNames = {};
  preview3DState.occupiedSlots = new Set();
  setExtrasLoadProgress(0.05, "Fetching extra files");
  let loaded = 0;
  const total = EXTRA_STL_SLOTS.length;
  for (let i = 0; i < total; i += 1) {
    const slotNumber = EXTRA_STL_SLOTS[i];
    setExtrasLoadProgress(0.05 + (i / total) * 0.95, `Loading slot ${i + 1} of ${total}`);
    // Fetched, parsed and released a slot at a time: `extra` is the only base64 alive,
    // and it goes out of scope before the next slot is asked for.
    const extra = await fetchExtraStlSlot(slotNumber);
    if (!extra) continue;
    loaded += 1;
    preview3DState.occupiedSlots.add(slotNumber);
    preview3DState.extraFileNames[slotNumber] = extra.filename;
    // Isolate per-slot failures: a single corrupt/undecodable extra STL must not
    // abort the whole interactive preview (the jaws are already loaded by now).
    try {
      await renderExtraStl(extra);
    } catch (err) {
      console.warn(`[preview3D] ✕ extra STL slot ${slotNumber} failed to render — skipping`, err);
    }
  }
  setExtrasLoadProgress(1, "Extra 3D files ready");
  // Extras stay off stage until the Extra 3D tab is up — unless there are no jaw meshes
  // at all, where hiding them too would leave an empty viewport.
  if (loaded && !preview3DState.groups.upper && !preview3DState.groups.lower) {
    setExtraStlsVisible(true);
    centerRootOnCombinedBounds(preview3DState.modelRoot);
    fitPreviewCamera();
  }
  renderUpload3dList();
}

// Reuses the jaw load's card, centred in the stage, so both tabs load the same way.
// Mounted here, not in the panel — the panel just says the slots aren't known yet.
function showExtrasLoadingOverlay() {
  const mount = preview3DState.mount;
  if (!mount || !preview3DState.extrasLoading || preview3DState.extrasOverlay) return;
  const overlay = document.createElement("div");
  overlay.className = "jaw-preview-quality-prompt";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-label", "Loading extra 3D files");
  overlay.innerHTML = `
    <div class="jaw-preview-quality-panel jaw-preview-quality-panel-loading">
      <div class="jaw-preview-quality-title">Loading Extra 3D Files</div>
      <div class="jaw-preview-quality-status">Preparing extra files...</div>
      <div class="jaw-preview-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="jaw-preview-progress-fill"></div>
      </div>
      <div class="jaw-preview-progress-meta">
        <span class="jaw-preview-progress-jaw">Waiting for file data</span>
        <span class="jaw-preview-progress-percent">0%</span>
      </div>
    </div>
  `;
  mount.appendChild(overlay);
  preview3DState.extrasOverlay = overlay;
  // Replay whatever phase the load already reached into the fresh card.
  setExtrasLoadProgress();
}

function clearExtrasLoadingOverlay() {
  preview3DState.extrasOverlay?.remove();
  preview3DState.extrasOverlay = null;
}

// Drive that card. The phase is cached so a card mounted mid-load (tab opened after
// the fetch started, or a stage rebuild) picks up where the load actually is.
function setExtrasLoadProgress(frac, labelText) {
  if (frac != null) preview3DState.extrasLoadProgress = { frac, labelText };
  const overlay = preview3DState.extrasOverlay;
  const phase = preview3DState.extrasLoadProgress;
  if (!overlay || !phase) return;
  const pct = Math.max(0, Math.min(100, Math.round(phase.frac * 100)));
  overlay.querySelector(".jaw-preview-progress-fill").style.width = `${pct}%`;
  overlay.querySelector(".jaw-preview-progress-percent").textContent = `${pct}%`;
  overlay.querySelector(".jaw-preview-progress-jaw").textContent = phase.labelText;
  overlay.querySelector(".jaw-preview-progress").setAttribute("aria-valuenow", String(pct));
}

// Colours a jaw-copy slot from the jaw's heatmap by nearest vertex, whatever its ordering.
// A missing surface paints tan but keeps the attribute; clusterSourceMap keeps SD bands.
function paintJawCopyHeatmap(geometry, surface, mode = "undercut") {
  const jawMap = geometry.userData?.jawVertexMap;
  if (!jawMap) return;

  const heatmap = surfaceFloatArray(
    surface,
    mode === "occlusion" ? "occlusion_values" : "surveying_values"
  );
  const heatmapVerts = heatmap ? Math.floor(heatmap.length / 4) : 0;
  const clusterOf = geometry.userData?.clusterSourceMap;
  const displayCount = geometry.attributes.position.count;
  const normalizeColor = mode === "occlusion" ? normalizeOcclusionColor : normalizeUndercutColor;

  const colors = new Float32Array(displayCount * 3);
  for (let i = 0; i < displayCount; i += 1) {
    colors[i * 3] = DEFAULT_TOOTH_COLOR[0];
    colors[i * 3 + 1] = DEFAULT_TOOTH_COLOR[1];
    colors[i * 3 + 2] = DEFAULT_TOOTH_COLOR[2];
  }

  if (heatmapVerts) {
    const severity = new Float32Array(displayCount).fill(-1);
    for (let src = 0; src < jawMap.length; src += 1) {
      const jawVertex = jawMap[src];
      if (jawVertex === NO_VERTEX_MATCH || jawVertex >= heatmapVerts) continue;
      const [r, g, b] = normalizeColor(
        heatmap[jawVertex * 4],
        heatmap[jawVertex * 4 + 1],
        heatmap[jawVertex * 4 + 2]
      );
      const display = clusterOf ? clusterOf[src] : src;
      if (display >= displayCount) continue;
      const bandSeverity = getHeatmapColorSeverity(r, g, b);
      if (bandSeverity > severity[display]) {
        severity[display] = bandSeverity;
        colors[display * 3] = r;
        colors[display * 3 + 1] = g;
        colors[display * 3 + 2] = b;
      }
    }
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Only meaningful on the full-resolution mesh; the decimated one already took a max per cluster.
  if (mode !== "occlusion" && heatmapVerts && !clusterOf) snapVertexColorBands(geometry, 2);
}

// Parse a base64 STL into the model root: jaw slots in jaw tan, metal-RPD slots (2 & 4)
// metallic. Jaw copies take the jaw's heatmap if loaded; a later survey repaints them.
async function renderExtraStl({ slotNumber, filename, data }) {
  if (!(await ensureThreeDeps())) return;
  const root = preview3DState.modelRoot;
  if (!root) return;

  const label = filename || `slot ${slotNumber}`;
  const loader = new STLLoader();
  let geometry = loader.parse(base64ToArrayBuffer(data));
  geometry = mergeStlVertices(geometry);

  // Match slot vertices to the jaw's by position while still full resolution. Indexed by
  // welded source vertex — the basis clusterSourceMap uses — so it survives decimation.
  const slotJaw = EXTRA_SLOT_JAW[slotNumber];
  const matchedJaw = slotJaw && preview3DState.jawVertexKeys?.[slotJaw] ? slotJaw : null;
  const matchStart = performance.now();
  const match = matchedJaw ? buildJawVertexMap(geometry, matchedJaw) : null;
  if (match) {
    console.log(`[preview3D] ${label}: matched to the ${matchedJaw} jaw by position`, {
      slotVerts: geometry.attributes.position.count,
      jawVerts: preview3DState.jawVertexKeys[matchedJaw].count,
      matched: match.matched,
      ms: Math.round(performance.now() - matchStart),
    });
  }
  const jaw = match?.matched ? matchedJaw : null;

  geometry = getDisplayGeometryForQuality(geometry, label);
  if (jaw) {
    geometry.userData.jawVertexMap = match.map;
    const copyMode = preview3DState.heatmapMode === "occlusion" ? "occlusion" : "undercut";
    const copySurface = copyMode === "occlusion"
      ? preview3DState.occlusion?.[jaw]
      : preview3DState.undercut?.[jaw];
    paintJawCopyHeatmap(geometry, copySurface, copyMode);
  }
  geometry.computeVertexNormals();

  const isMetal = METAL_RPD_SLOTS.has(slotNumber);
  const flatMaterial = new THREE.MeshStandardMaterial({
    color: isMetal ? METAL_RPD_COLOR : extraJawColor(),
    metalness: isMetal ? 0.85 : 0.05,
    roughness: isMetal ? 0.32 : 0.6,
    side: THREE.DoubleSide,
  });
  // Jaw-copy slots carry both materials so the heatmap toggle can flip them like the jaws do.
  const heatmapMaterial = jaw
    ? new THREE.MeshStandardMaterial({
        vertexColors: true,
        ...HEATMAP_SURFACE_SHADING,
        side: THREE.DoubleSide,
      })
    : null;

  const mesh = new THREE.Mesh(
    geometry,
    heatmapMaterial && preview3DState.heatmapMode !== "normal" ? heatmapMaterial : flatMaterial
  );
  mesh.userData.flatMaterial = flatMaterial;
  mesh.userData.heatmapMaterial = heatmapMaterial;
  // The jaw this slot borrows its heatmap from — null on anything with no jaw to match against,
  // which is what keeps the heatmap toggle off those meshes.
  mesh.userData.surveyJaw = jaw;
  const group = new THREE.Group();
  group.add(mesh);
  // Follow the current stage: hidden unless the "Extra 3D" tab is showing extras.
  group.visible = !!preview3DState.extrasVisible;
  root.add(group);

  preview3DState.extraFileNames[slotNumber] = filename;
  preview3DState.extraGroups[slotNumber] = { group, jaw };
}

// Push the current undercut onto the jaw-copy slots already on screen: they are built with
// whatever heatmap existed at load time, and the DLL survey usually finishes after that.
function repaintExtraJawHeatmaps() {
  const mode = preview3DState.heatmapMode === "occlusion" ? "occlusion" : "undercut";
  for (const entry of Object.values(preview3DState.extraGroups || {})) {
    const jaw = entry?.jaw;
    const surface = jaw
      ? (mode === "occlusion" ? preview3DState.occlusion?.[jaw] : preview3DState.undercut?.[jaw])
      : null;
    if (!entry?.group || !surface) continue;
    entry.group.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.userData?.jawVertexMap || !obj.userData?.heatmapMaterial) return;
      paintJawCopyHeatmap(obj.geometry, surface, mode);
      if (preview3DState.heatmapMode !== "normal") obj.material = obj.userData.heatmapMaterial;
    });
  }
}

// Dispose an extra STL's mesh and drop it from the model root.
function removeExtraStlMesh(slotNumber) {
  const entry = preview3DState.extraGroups[slotNumber];
  if (!entry) return;
  preview3DState.modelRoot?.remove(entry.group);
  disposeObject3D(entry.group);
  delete preview3DState.extraGroups[slotNumber];
  if (preview3DState.modelRoot) centerRootOnCombinedBounds(preview3DState.modelRoot);
  // An empty stage is correct for the Extra 3D tab — the jaws belong to 3D Preview and
  // return on leaving it. Off-tab there's nothing to show, so hand the stage back.
  if (!Object.keys(preview3DState.extraGroups).length && !isUpload3dModalOpen()) {
    exitExtraStlStage();
  }
}

// Permanently delete an extra STL (modal X): frees the backend slot, then drops
// it from the panel + modal list. No confirmation (per product decision).
async function deleteExtraStl(slotNumber) {
  try {
    const res = await fetch(`${SMARTRPD_API_BASE}/stl/slot/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Same contract as the upload: the case id has to be in this object.
      body: JSON.stringify([
        extraSlotAuth(),
        { case_id: state.caseIntID, slotNumber },
      ]),
    });
    if (!res.ok) {
      console.error(`[preview3D] ✕ POST /stl/slot/delete (slot ${slotNumber}) status=${res.status}`);
      setMessage?.("Failed to delete 3D file. Please try again.");
      return;
    }
    preview3DState.occupiedSlots?.delete(slotNumber);
    delete preview3DState.extraFileNames[slotNumber];
    removeExtraStlMesh(slotNumber);
    renderUpload3dList();
    setMessage?.("3D file deleted.");
  } catch (err) {
    console.error(`[preview3D] ✕ POST /stl/slot/delete (slot ${slotNumber}) failed`, err);
    setMessage?.("Failed to delete 3D file. Please try again.");
  }
}

// Upload a user-picked STL into a specific slot (or the next free slot when no
// target is given), then render it.
async function uploadExtraStl(file, targetSlot = null) {
  if (!state.caseIntID) {
    setMessage?.("Open a case before uploading a 3D file.");
    return;
  }
  // Never pick a slot before the server's occupancy is known, or a drop that lands while
  // the extras are still downloading would claim a slot the backend already holds.
  try {
    await ensureExtraStlsLoaded();
  } catch {
    /* slot occupancy unknown — fall through and let the backend reject a taken slot */
  }
  if (!preview3DState.occupiedSlots) preview3DState.occupiedSlots = new Set();
  // A slot already uploading is taken too — the server only learns of it when that
  // upload lands, so two parallel uploads would otherwise both claim it.
  const uploading = preview3DState.uploadingSlots;
  let freeSlot;
  if (targetSlot != null) {
    if (uploading.has(targetSlot)) {
      setMessage?.(`${slotLabel(targetSlot)} is still uploading.`);
      return;
    }
    if (preview3DState.occupiedSlots.has(targetSlot)) {
      setMessage?.(`${slotLabel(targetSlot)} already has a file. Delete it first.`);
      return;
    }
    freeSlot = targetSlot;
  } else {
    freeSlot = EXTRA_STL_SLOTS.find((n) => !preview3DState.occupiedSlots.has(n) && !uploading.has(n));
  }
  if (!freeSlot) {
    setMessage?.("All 4 extra 3D file slots are in use. Delete one first.");
    return;
  }
  if (!/\.stl$/i.test(file.name)) {
    setMessage?.("Only .stl files are supported.");
    return;
  }

  // Draw this slot's row as an inline progress bar, then start the upload.
  preview3DState.uploadingSlots.set(freeSlot, { frac: 0, refs: null });
  renderUpload3dList();
  setMessage?.(`Uploading ${file.name}...`);
  try {
    const base64 = await fileToBase64(file);
    // case_id belongs in the DATA object, not the auth one (same as POST /stl). Without it
    // the insert 500s with no CORS header, surfacing as a bare "Failed to fetch".
    const payload = JSON.stringify([
      extraSlotAuth(),
      {
        case_id: state.caseIntID,
        slotNumber: freeSlot,
        filename: file.name,
        data: base64,
      },
    ]);
    await uploadWithProgress("stl/slot/", payload, (frac) => setSlotUploadProgress(freeSlot, frac));
    preview3DState.occupiedSlots.add(freeSlot);
    await renderExtraStl({ slotNumber: freeSlot, filename: file.name, data: base64 });
    // Uploads always come from the open panel, so stage the new file (this is what puts
    // the FIRST extra on screen — opening an all-empty panel doesn't stage anything).
    if (isUpload3dModalOpen()) {
      enterExtraStlStage();
    } else if (preview3DState.modelRoot) {
      centerRootOnCombinedBounds(preview3DState.modelRoot);
      fitPreviewCamera();
    }
    setMessage?.(`${file.name} uploaded.`);
  } catch (err) {
    console.error("[preview3D] ✕ extra STL upload failed", err);
    setMessage?.("Upload failed. Please try again.");
  } finally {
    preview3DState.uploadingSlots.delete(freeSlot);
    renderUpload3dList();
  }
}

function pickAndUploadExtraStl(slot) {
  pickStlFile((file) => uploadExtraStl(file, slot));
}

// Toggle ONE uploaded extra STL (clicking its file icon). Each slot has its own group in
// extraGroups[slot], so this flips only that group's `visible` flag and dims just this icon.
function toggleExtraStlVisibility(slot, iconEl) {
  const entry = preview3DState.extraGroups?.[slot];
  if (!entry?.group) {
    setMessage?.("That 3D file isn't loaded in the view.");
    return;
  }
  entry.group.visible = !entry.group.visible;
  iconEl?.classList.toggle("is-hidden-extra", !entry.group.visible);
}

// Show/hide every loaded extra STL at once; the panel rows re-render so their icons
// reflect the new state.
function setExtraStlsVisible(visible) {
  preview3DState.extrasVisible = visible;
  for (const entry of Object.values(preview3DState.extraGroups || {})) {
    if (entry?.group) entry.group.visible = visible;
  }
  renderUpload3dList();
}

// Set one jaw's mesh visibility and keep its toolbar row in sync (same as the row icon).
function setJawVisible(jaw, visible) {
  const group = preview3DState.groups?.[jaw];
  if (!group) return;
  group.visible = visible;
  const rowKey = jaw === "upper" ? "rowUpper" : "rowLower";
  preview3DState.topControls?.[rowKey]?.row?.classList.toggle("is-hidden-jaw", !visible);
}

// Jaw meshes come off the model root while the Extra 3D tab is up — detached, never
// disposed — so the camera frames the slots without the jaws' bounds pulling on it.
function setJawMeshesOnStage(onStage) {
  const root = preview3DState.modelRoot;
  if (!root) return;
  for (const jaw of ["upper", "lower"]) {
    const group = preview3DState.groups?.[jaw];
    if (!group) continue;
    if (onStage && group.parent !== root) root.add(group);
    else if (!onStage && group.parent === root) root.remove(group);
  }
}

// Focuses the stage on the extras: jaws off, extras revealed and framed. Idempotent —
// a first upload re-enters to stage the new file. Undone by exitExtraStlStage.
function enterExtraStlStage() {
  const camera = preview3DState.camera;
  const controls = preview3DState.controls;
  if (!preview3DState.extrasPrevStage) {
    preview3DState.extrasPrevStage = {
      // `undefined` = that jaw had no mesh when the tab opened; nothing to restore.
      upper: preview3DState.groups?.upper?.visible,
      lower: preview3DState.groups?.lower?.visible,
      heatmap: preview3DState.heatmapEnabled,
      heatmapMode: preview3DState.heatmapMode,
      camera:
        camera && controls
          ? { position: camera.position.clone(), up: camera.up.clone(), target: controls.target.clone() }
          : null,
    };
    // Extras render plain: the tab opens with the undercut heatmap closed, and
    // its own toggle is what turns it on.
    setHeatmapEnabled(false);
  }
  for (const jaw of ["upper", "lower"]) {
    if (!preview3DState.groups?.[jaw]) continue;
    preview3DState.stageHiddenJaws.add(jaw);
    setJawVisible(jaw, false);
  }
  setJawMeshesOnStage(false);
  setExtraStlsVisible(true);
  fitPreviewCamera({ visibleOnly: true });
}

// Hand the stage back to the jaws — on leaving the tab, or when the extras can no
// longer hold it (the last one was deleted).
function exitExtraStlStage() {
  const prev = preview3DState.extrasPrevStage;
  // Extras go back off stage — unless there are no jaw meshes to hand it back to
  // (same fallback loadExtraStlsIntoPreview uses), which would leave a blank viewport.
  const hasJaws = !!(preview3DState.groups?.upper || preview3DState.groups?.lower);
  setJawMeshesOnStage(true);
  setExtraStlsVisible(!hasJaws);
  preview3DState.stageHiddenJaws.clear();
  if (prev) {
    if (prev.upper !== undefined) setJawVisible("upper", !!prev.upper);
    if (prev.lower !== undefined) setJawVisible("lower", !!prev.lower);
    setHeatmapMode(prev.heatmapMode || (prev.heatmap ? "undercut" : "normal"));
  }
  preview3DState.extrasPrevStage = null;
  // The root's offset now belongs to the extras, but the saved pose was taken against a
  // jaw-centred root. Re-centre first, or trackball orbits around a point off the mesh.
  centerRootOnCombinedBounds(preview3DState.modelRoot);
  const camera = preview3DState.camera;
  const controls = preview3DState.controls;
  if (prev?.camera && camera && controls) {
    camera.position.copy(prev.camera.position);
    camera.up.copy(prev.camera.up);
    controls.target.copy(prev.camera.target);
    controls.update();
  } else {
    fitPreviewCamera();
  }
}

// ---- Approve the 3D design -----------------------------------------------

// Which slots belong to each arch, for the approval dialog's two panels.
const UPPER_EXTRA_SLOTS = [1, 2];
const LOWER_EXTRA_SLOTS = [3, 4];

// Captures downscale to this width first: the canvas is up to ~2700px on retina, and these
// go in a ~360px panel AND every approval email — full-size PNGs would be megabytes.
const APPROVAL_SHOT_MAX_WIDTH = 900;

// Current frame as a PNG data URL. Must run straight after renderer.render() — there's no
// preserved drawing buffer, so the frame is only readable within the same tick.
function renderedShotDataUrl(renderer) {
  const source = renderer.domElement;
  const scale = Math.min(1, APPROVAL_SHOT_MAX_WIDTH / (source.width || 1));
  if (scale >= 1) return source.toDataURL("image/png");
  const scaled = document.createElement("canvas");
  scaled.width = Math.round(source.width * scale);
  scaled.height = Math.round(source.height * scale);
  scaled.getContext("2d").drawImage(source, 0, 0, scaled.width, scaled.height);
  return scaled.toDataURL("image/png");
}

// Which panel an Extra 3D capture belongs to: the arch whose slots are on screen. With
// both or neither showing, it fills whichever panel is still empty, upper first.
function captureArchForExtras() {
  const shown = Object.entries(preview3DState.extraGroups || {})
    .filter(([, entry]) => entry?.group?.visible)
    .map(([slot]) => Number(slot));
  const upper = shown.some((slot) => UPPER_EXTRA_SLOTS.includes(slot));
  const lower = shown.some((slot) => LOWER_EXTRA_SLOTS.includes(slot));
  if (upper && !lower) return "upper";
  if (lower && !upper) return "lower";
  return preview3DState.approvalShots?.upper ? "lower" : "upper";
}

// The camera button on the Extra 3D tab stores the view here instead of writing a
// case thumbnail; the Request dialog shows whatever has been captured.
function captureExtraSlotShot() {
  const { renderer, scene, camera } = preview3DState;
  if (!renderer || !scene || !camera) return null;
  renderer.render(scene, camera);
  const arch = captureArchForExtras();
  preview3DState.approvalShots = {
    ...(preview3DState.approvalShots || { upper: null, lower: null }),
    [arch]: renderedShotDataUrl(renderer),
  };
  return arch;
}

// Approve flips the case status, then mails the ticked users (one /sendCustomEmail each).
// Mail goes only after the status write lands, so a failed approval is never announced.
async function openPreview3DApproval(btn) {
  if (!state.caseIntID) {
    toast.error("Open a case before approving.");
    return;
  }
  if (btn) btn.disabled = true;
  try {
    // The dialog shows whatever the camera button captured on this tab, and comes
    // back with what to attach — the renders left ticked there, plus any uploads.
    const { confirmed, recipients, images } = await confirmPreview3DApproval({
      caseIntID: state.caseIntID,
      shots: preview3DState.approvalShots,
      caseName: preview3DState.caseData?.case_id || "",
      ownerName: state.caseOwner || "",
    });
    if (!confirmed) return;

    const ok = await updateCaseStatus(state.caseIntID, STATUS_3D_DESIGN_APPROVED);
    if (!ok) {
      toast.error("Couldn't set the case status.");
      setMessage?.("Status not updated.", true);
      return;
    }
    toast.success("Approved successfully");
    setMessage?.("3D design approved.", false);

    if (!recipients.length) return;
    const sent = await sendApprovalEmails(state.caseIntID, recipients, images);
    if (sent === recipients.length) {
      toast.success(`Email sent to ${recipients.map((r) => r.email).join(", ")}.`);
    } else if (sent) {
      toast.warning(`Email failed for ${recipients.length - sent} recipient(s).`);
    } else {
      // The approval itself stands; only the notification failed.
      toast.error("Approved, but the email couldn't be sent.");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Read a File as base64 (chunked to stay off the call stack for big STLs).
// ---- Extra 3D files panel -------------------------------------------------

// Docked lower-left under the "Extra 3D" tab so the slot rows sit beside the view they
// toggle. Built lazily once; element refs cached on preview3DState.
function ensureUpload3dModal() {
  const area = preview3DState.area || document.getElementById("imagePreviewArea");
  if (!area) return null;
  const shell = area.querySelector(".jaw-preview-shell");
  const cached = preview3DState.upload3dModal;
  if (cached) {
    // Opened before the shell existed, or a rebuild replaced the shell it was in:
    // drop the stray panel and build again in the right place.
    if (!shell || cached.overlay.parentElement === shell) return cached;
    cached.overlay.remove();
    preview3DState.upload3dModal = null;
  }

  const overlay = document.createElement("div");
  overlay.className = "upload3d-modal is-hidden";
  overlay.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "upload3d-modal-panel";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "Extra 3D files");

  // Request rides in the stage's upper-right corner, opposite the undercut
  // toggle, so the panel row is nothing but the four slot cards.
  const approveBtn = document.createElement("button");
  approveBtn.type = "button";
  approveBtn.className = "upload3d-approve-btn";
  approveBtn.textContent = "Request";
  approveBtn.title = "Email the 3D files to the users on this case";
  approveBtn.addEventListener("click", () => openPreview3DApproval(approveBtn));
  (area.querySelector(".jaw-preview-3d-mount") || panel).appendChild(approveBtn);

  const card = document.createElement("div");
  card.className = "upload3d-card";

  const list = document.createElement("div");
  list.className = "upload3d-list";

  card.appendChild(list);
  panel.appendChild(card);
  overlay.appendChild(panel);
  // Takes the jaw toolbar's place at the top of the shell (CSS hides that
  // toolbar on this tab). Without a shell yet, the frame itself will do.
  if (shell) shell.insertBefore(overlay, shell.firstChild);
  else area.appendChild(overlay);

  preview3DState.upload3dModal = { overlay, panel, list };
  return preview3DState.upload3dModal;
}

// Tab state, not DOM state: the panel lives in the shell, which a rebuild
// replaces wholesale.
function isUpload3dModalOpen() {
  return !!preview3DState.extrasTabOpen;
}

// Entering the "Extra 3D" tab. The extras are fetched here, not on page entry
// (see ensureExtraStlsLoaded), so the tab's first open pays for them.
export function openUpload3dModal() {
  preview3DState.extrasTabOpen = true;
  const modal = ensureUpload3dModal();
  if (!modal) return;
  // Free the jaws' STL source before the slots start downloading: this is the peak
  // that OOMs an iPhone, and the jaw meshes on screen don't need it.
  dropJawSourceFiles();
  const loaded = ensureExtraStlsLoaded().catch(() => {});
  renderUpload3dList();
  modal.overlay.classList.remove("is-hidden");
  modal.overlay.setAttribute("aria-hidden", "false");
  // The jaws leave the stage right away, so the tab never shows them even while
  // the slots are still downloading — the load card holds the empty stage.
  enterExtraStlStage();
  showExtrasLoadingOverlay();
  loaded.then(() => {
    // The tab may have been left again while the slots were downloading.
    if (!isUpload3dModalOpen()) return;
    renderUpload3dList();
    enterExtraStlStage();
    // The extras land plain. Forced here, not just on entry: the jaw load's own
    // heatmap call (and the saved-survey auto-apply) can land mid-download.
    setHeatmapEnabled(false);
  });
}

// Leaving the tab: put the jaw meshes back on the stage so the 3D Preview tab
// shows what it always did, and free the slot meshes.
export function closeUpload3dModal() {
  preview3DState.extrasTabOpen = false;
  const modal = preview3DState.upload3dModal;
  if (modal) {
    modal.overlay.classList.add("is-hidden");
    modal.overlay.setAttribute("aria-hidden", "true");
  }
  // Freed BEFORE handing the stage back: exitExtraStlStage re-centres the root on what
  // is on it, and disposed extras must not still be counted in those bounds.
  disposeExtraStls();
  if (preview3DState.extrasPrevStage) exitExtraStlStage();
}

// Drops every slot mesh and resets the load latch so extras only hold memory while their
// tab is up. They are the biggest thing in the scene and on screen the least.
function disposeExtraStls() {
  // With no jaw meshes the extras ARE the stage (same fallback the load uses);
  // freeing them would leave an empty viewport for a case that has nothing else.
  const hasJaws = !!(preview3DState.groups?.upper || preview3DState.groups?.lower);
  if (!hasJaws) return;
  // Never mid-upload: that slot's row and its rendered result belong to a live request.
  if (preview3DState.uploadingSlots.size || preview3DState.extrasLoading) return;
  for (const slot of Object.keys(preview3DState.extraGroups || {})) {
    const entry = preview3DState.extraGroups[slot];
    if (!entry?.group) continue;
    preview3DState.modelRoot?.remove(entry.group);
    disposeObject3D(entry.group);
  }
  preview3DState.extraGroups = {};
  preview3DState.extrasVisible = false;
  // Drop the latch so the next open re-fetches; occupancy is re-read with it.
  preview3DState.extrasLoadPromise = null;
  preview3DState.extrasLoadProgress = null;
}

// Drives one slot's inline progress bar; `frac` is 0..1, and 1 means the bytes are in but
// the server is still processing. Called with no frac to replay into a rebuilt row.
function setSlotUploadProgress(slot, frac) {
  const phase = preview3DState.uploadingSlots.get(slot);
  if (!phase) return;
  if (frac != null) phase.frac = frac;
  if (!phase.refs) return;
  const pct = Math.max(0, Math.min(100, Math.round((phase.frac ?? 0) * 100)));
  phase.refs.fill.style.width = `${pct}%`;
  phase.refs.label.textContent = pct >= 100 ? "Processing…" : `Uploading… ${pct}%`;
}

// Always render all four named slots in order: an occupied slot shows its filename with
// show/hide + delete; an empty slot shows its name with its own upload button.
function renderUpload3dList() {
  const modal = preview3DState.upload3dModal;
  if (!modal) return;
  const list = modal.list;
  list.innerHTML = "";

  // Slot contents are unknown until the on-demand load finishes, so the list stays empty
  // rather than offering four false "empty" slots. The stage's card says a load is running.
  if (preview3DState.extrasLoading) return;

  const occupied = preview3DState.occupiedSlots || new Set();
  EXTRA_STL_SLOTS.forEach((slot) => {
    if (preview3DState.uploadingSlots.has(slot)) {
      list.appendChild(buildUpload3dUploadingRow(slot));
    } else if (occupied.has(slot)) {
      const filename = preview3DState.extraFileNames[slot] || `slot${slot}.stl`;
      list.appendChild(buildUpload3dFileRow(slot, filename));
    } else {
      list.appendChild(buildUpload3dSlotRow(slot));
    }
  });
}

// One populated file row: file icon w/ slot number (click to show/hide just
// this file in the 3D view), X delete, filename.
function buildUpload3dFileRow(slot, filename) {
  const row = document.createElement("div");
  row.className = "upload3d-row";

  const icon = document.createElement("span");
  icon.className = "upload3d-file-icon";
  icon.setAttribute("role", "button");
  icon.setAttribute("tabindex", "0");
  icon.title = "Show / hide in 3D view";
  icon.setAttribute("aria-label", `Show or hide ${filename} in the 3D view`);
  const customIcon = EXTRA_STL_SLOT_ICONS[slot];
  icon.innerHTML = customIcon
    ? `<img class="upload3d-slot-img${customIcon.black ? " upload3d-slot-img--black" : ""}" src="${customIcon.src}" alt="" />`
    : '<i class="fa fa-file" aria-hidden="true"></i>';
  // Reflect this slot's current visibility, then wire per-file toggling.
  if (preview3DState.extraGroups?.[slot]?.group?.visible === false) {
    icon.classList.add("is-hidden-extra");
  }
  icon.addEventListener("click", () => toggleExtraStlVisibility(slot, icon));
  icon.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExtraStlVisibility(slot, icon);
    }
  });

  // Same trash button as the jaw rows.
  const xBtn = buildPreviewTrashButton({
    ariaLabel: `Delete ${filename}`,
    title: `Delete ${filename}`,
  });
  xBtn.classList.add("upload3d-row-delete");
  xBtn.addEventListener("click", () => deleteExtraStl(slot));

  const text = document.createElement("div");
  text.className = "upload3d-row-text";
  const slotName = document.createElement("span");
  slotName.className = "upload3d-slot-name";
  slotName.textContent = slotLabel(slot);
  const name = document.createElement("span");
  name.className = "upload3d-row-name";
  name.textContent = filename;
  name.title = filename;
  text.appendChild(slotName);
  text.appendChild(name);

  row.appendChild(icon);
  row.appendChild(xBtn);
  row.appendChild(text);
  return row;
}

// An empty, named slot row: slot label + "No file uploaded" and a per-slot
// upload button that targets exactly this slot.
function buildUpload3dSlotRow(slot) {
  const row = document.createElement("div");
  row.className = "upload3d-row upload3d-slot-row";

  const icon = document.createElement("span");
  icon.className = "upload3d-file-icon is-empty";
  icon.innerHTML =
    '<i class="fa fa-image" aria-hidden="true"></i>' +
    '<i class="fa fa-slash upload3d-slash" aria-hidden="true"></i>';

  const text = document.createElement("div");
  text.className = "upload3d-row-text";
  const slotName = document.createElement("span");
  slotName.className = "upload3d-slot-name";
  slotName.textContent = slotLabel(slot);
  const status = document.createElement("span");
  status.className = "upload3d-row-name is-muted";
  // Just the link: the row is a drop zone either way, and the old "Drag & drop
  // .stl or …" prefix cost the card a second line.
  const uploadLink = document.createElement("a");
  uploadLink.href = "#";
  uploadLink.className = "upload3d-upload-link";
  uploadLink.textContent = "Upload .stl";
  uploadLink.setAttribute("role", "button");
  uploadLink.setAttribute("aria-label", `Upload ${slotLabel(slot)}`);
  uploadLink.title = `Drag & drop a .stl here, or click to upload ${slotLabel(slot)}`;
  uploadLink.addEventListener("click", (e) => {
    e.preventDefault();
    pickAndUploadExtraStl(slot);
  });
  status.appendChild(uploadLink);
  text.appendChild(slotName);
  text.appendChild(status);

  row.appendChild(icon);
  row.appendChild(text);
  enableSlotDropZone(row, slot);
  return row;
}

// A slot mid-upload: slot label + an inline progress bar. The bar's fill/label refs
// go on that slot's phase so setSlotUploadProgress can drive them live.
function buildUpload3dUploadingRow(slot) {
  const row = document.createElement("div");
  row.className = "upload3d-row upload3d-slot-row upload3d-uploading-row";

  const icon = document.createElement("span");
  icon.className = "upload3d-file-icon";
  icon.innerHTML = '<i class="fa fa-cloud-arrow-up" aria-hidden="true"></i>';

  const text = document.createElement("div");
  text.className = "upload3d-row-text";
  const slotName = document.createElement("span");
  slotName.className = "upload3d-slot-name";
  slotName.textContent = slotLabel(slot);

  const progress = document.createElement("div");
  progress.className = "upload3d-progress";
  const fill = document.createElement("div");
  fill.className = "upload3d-progress-fill";
  const label = document.createElement("span");
  label.className = "upload3d-progress-label";
  label.textContent = "Uploading… 0%";
  progress.appendChild(fill);
  progress.appendChild(label);

  text.appendChild(slotName);
  text.appendChild(progress);
  row.appendChild(icon);
  row.appendChild(text);

  const phase = preview3DState.uploadingSlots.get(slot);
  if (phase) phase.refs = { fill, label };
  // Replay how far this upload already is into the freshly built bar.
  setSlotUploadProgress(slot);
  return row;
}

// True when a drag event carries files (mirrors createCase.js).
function dragEventHasFiles(e) {
  const types = e?.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).some((t) => t === "Files");
}

// Wire an empty slot row as a .stl drop zone that uploads into `slot`
// (same affordance as the create-case jaw tiles).
function enableSlotDropZone(el, slot) {
  el.addEventListener("dragenter", (e) => {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    el.classList.add("is-dragover");
  });
  el.addEventListener("dragover", (e) => {
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    el.classList.add("is-dragover");
  });
  el.addEventListener("dragleave", (e) => {
    if (el.contains(e.relatedTarget)) return;
    el.classList.remove("is-dragover");
  });
  el.addEventListener("drop", (e) => {
    el.classList.remove("is-dragover");
    if (!dragEventHasFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.stl$/i.test(file.name)) {
      setMessage?.("Only .stl files are supported.");
      return;
    }
    uploadExtraStl(file, slot);
  });
}

// ---- Download jaw profile ------------------------------------------------

// `request-download-jaw-profile` (footer + noticeboard) opens this menu: Download STL file
// (upper + lower zipped) or Download as JPEG (reuses the "Save as JPEG" arch export).
function ensureDownloadJawProfileModal() {
  if (preview3DState.downloadJawModal) return preview3DState.downloadJawModal;

  const overlay = document.createElement("div");
  overlay.className = "jaw-dl-modal is-hidden";
  overlay.setAttribute("aria-hidden", "true");

  const backdrop = document.createElement("div");
  backdrop.className = "jaw-dl-backdrop";
  backdrop.addEventListener("click", closeDownloadJawProfileModal);

  const panel = document.createElement("div");
  panel.className = "jaw-dl-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Download jaw profile");

  const header = document.createElement("div");
  header.className = "jaw-dl-header";
  const title = document.createElement("h2");
  title.className = "jaw-dl-title";
  title.textContent = "Download Jaw Profile";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "jaw-dl-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = '<i class="fa fa-xmark" aria-hidden="true"></i>';
  closeBtn.addEventListener("click", closeDownloadJawProfileModal);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const options = document.createElement("div");
  options.className = "jaw-dl-options";

  const stlBtn = document.createElement("button");
  stlBtn.type = "button";
  stlBtn.className = "jaw-dl-option";
  stlBtn.innerHTML =
    '<i class="fa fa-cube" aria-hidden="true"></i>' +
    '<span class="jaw-dl-option-title">Download STL file</span>' +
    '<span class="jaw-dl-option-sub">Upper &amp; lower jaws as a .zip</span>';
  stlBtn.addEventListener("click", () => {
    closeDownloadJawProfileModal();
    downloadJawStlsAsZip();
  });

  const jpegBtn = document.createElement("button");
  jpegBtn.type = "button";
  jpegBtn.className = "jaw-dl-option";
  jpegBtn.innerHTML =
    '<i class="fa fa-image" aria-hidden="true"></i>' +
    '<span class="jaw-dl-option-title">Download as JPEG</span>' +
    '<span class="jaw-dl-option-sub">Arch annotation image</span>';
  jpegBtn.addEventListener("click", () => {
    closeDownloadJawProfileModal();
    // Reuse the existing "Save as JPEG" flow (also re-uploads the 2D thumbnail).
    saveAsJpeg();
  });

  options.appendChild(stlBtn);
  options.appendChild(jpegBtn);
  panel.appendChild(header);
  panel.appendChild(options);
  overlay.appendChild(backdrop);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  preview3DState.downloadJawModal = { overlay };
  return preview3DState.downloadJawModal;
}

function openDownloadJawProfileMenu() {
  const modal = ensureDownloadJawProfileModal();
  modal.overlay.classList.remove("is-hidden");
  modal.overlay.setAttribute("aria-hidden", "false");
  if (!preview3DState.downloadJawKeyHandler) {
    preview3DState.downloadJawKeyHandler = (e) => {
      if (e.key === "Escape") closeDownloadJawProfileModal();
    };
    document.addEventListener("keydown", preview3DState.downloadJawKeyHandler);
  }
}

function closeDownloadJawProfileModal() {
  const modal = preview3DState.downloadJawModal;
  if (modal) {
    modal.overlay.classList.add("is-hidden");
    modal.overlay.setAttribute("aria-hidden", "true");
  }
  if (preview3DState.downloadJawKeyHandler) {
    document.removeEventListener("keydown", preview3DState.downloadJawKeyHandler);
    preview3DState.downloadJawKeyHandler = null;
  }
}

// Collect upper + lower jaw STLs as { jaw, data(base64), filename }. Prefers the
// jaws currently shown in the 3D preview; falls back to a backend fetch.
async function collectJawStlFiles() {
  const fromState = ["upper", "lower"]
    .map((jaw) => {
      const f = preview3DState.jawFiles?.[jaw];
      return f?.data ? { jaw, data: f.data, filename: f.filename } : null;
    })
    .filter(Boolean);
  if (fromState.length) return fromState;

  const files = await fetchJawFilesForCase();
  const byJaw = {};
  files.forEach((item) => {
    const jaw = getJawKeyFromFile(item);
    if (jaw && !byJaw[jaw] && item?.data) {
      byJaw[jaw] = { jaw, data: item.data, filename: item.filename };
    }
  });
  return Object.values(byJaw);
}

async function downloadJawStlsAsZip() {
  if (typeof window.JSZip === "undefined") {
    setMessage("ZIP library failed to load — cannot download STL files.", true);
    return;
  }
  try {
    setMessage("Preparing STL download…", false);
    const jaws = await collectJawStlFiles();
    if (!jaws.length) {
      setMessage("No jaw STL files found for this case.", true);
      return;
    }
    const zip = new window.JSZip();
    jaws.forEach(({ jaw, data }) => {
      zip.file(`${jaw}.stl`, jawDataToStlBytes(data));
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `case_${state.caseIntID ?? "unknown"}_jaw_profile.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded ${jaws.length} jaw STL file(s) as ZIP.`, false);
  } catch (err) {
    console.error("[preview3D] STL zip download failed", err);
    setMessage("Failed to download STL files.", true);
  }
}

// ---- Jaw panel rows and small helpers ------------------------------------

// The single trash button used everywhere in the preview view bar (jaw rows
// and slot-STL rows). Don't re-create this markup elsewhere — call this.
function buildPreviewTrashButton({ ariaLabel, title }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "jaw-preview-delete-btn";
  btn.setAttribute("aria-label", ariaLabel);
  btn.title = title;
  btn.innerHTML =
    '<svg viewBox="0 -960 960 960" width="15" height="15" aria-hidden="true"><path d="M261-120q-24.75 0-42.37-17.63Q201-155.25 201-180v-570h-41v-60h188v-30h264v30h188v60h-41v570q0 24-18 42t-42 18H261Zm438-630H261v570h438v-570ZM367-266h60v-399h-60v399Zm166 0h60v-399h-60v399ZM261-750v570-570Z" fill="currentColor"/></svg>';
  return btn;
}

function buildJawRow({ jaw, icon, label }) {
  const row = document.createElement("div");
  row.className = "jaw-preview-row";

  const iconEl = document.createElement("img");
  iconEl.className = "jaw-preview-row-icon";
  iconEl.src = icon;
  iconEl.alt = jaw;
  iconEl.role = "button";
  iconEl.tabIndex = 0;
  iconEl.title = `Toggle ${jaw} jaw`;
  iconEl.setAttribute("aria-label", `Toggle ${jaw} jaw visibility`);

  const allowWrap = document.createElement("label");
  allowWrap.className = "jaw-preview-row-check";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = true;
  const txt = document.createElement("span");
  txt.textContent = label;
  allowWrap.appendChild(toggle);
  allowWrap.appendChild(txt);

  const deleteBtn = buildPreviewTrashButton({
    ariaLabel: `Hide ${jaw} jaw`,
    title: `Hide ${jaw} jaw`,
  });

  const surveyBtn = document.createElement("button");
  surveyBtn.type = "button";
  surveyBtn.className = "jaw-preview-survey-btn";
  surveyBtn.textContent = "SET SURVEY ANGLE";

  // Only visible while this jaw is armed; drops the aim without surveying.
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "jaw-preview-survey-cancel-btn";
  cancelBtn.textContent = "CANCEL";
  cancelBtn.title = "Cancel survey aiming";

  // The row is a 4-track grid with the survey control pinned in the last track,
  // so CANCEL + SET share one flex group there instead of taking a new track.
  const surveyGroup = document.createElement("div");
  surveyGroup.className = "jaw-preview-survey-group";
  surveyGroup.appendChild(cancelBtn);
  surveyGroup.appendChild(surveyBtn);

  // Shown only on an empty jaw (no STL): opens the file picker to upload a 3D file for this jaw.
  // Hidden once a jaw STL is loaded — the trash + survey controls take over.
  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "jaw-preview-upload-btn";
  uploadBtn.setAttribute("aria-label", `Upload ${jaw} 3D file`);
  uploadBtn.title = `Upload ${jaw} 3D file`;
  uploadBtn.innerHTML = '<i class="fa fa-arrow-up-from-bracket" aria-hidden="true"></i>';

  // Inline progress shown in the SET SURVEY ANGLE slot while a freshly picked
  // jaw STL is uploading. Hidden until the row gets `is-uploading-jaw`.
  const surveyLoading = document.createElement("div");
  surveyLoading.className = "jaw-preview-survey-loading";
  surveyLoading.innerHTML =
    '<span class="jaw-preview-survey-loading-label">UPLOADING…</span>' +
    '<span class="jaw-preview-survey-loading-track"><span class="jaw-preview-survey-loading-bar"></span></span>';

  row.appendChild(iconEl);
  row.appendChild(allowWrap);
  row.appendChild(deleteBtn);
  row.appendChild(surveyGroup);
  row.appendChild(uploadBtn);
  row.appendChild(surveyLoading);
  return { row, toggle, deleteBtn, surveyBtn, cancelBtn, uploadBtn, surveyLoading, iconEl };
}

// Switch a jaw's row between its "loaded" controls (trash + SET SURVEY ANGLE) and its empty
// upload affordance. The row stays visible so the 3D panel never collapses.
function setJawRowMode(jaw, hasStl) {
  const rowKey = jaw === "upper" ? "rowUpper" : "rowLower";
  const ctrl = preview3DState.topControls?.[rowKey];
  if (!ctrl) return;
  ctrl.row.style.display = "grid";
  // Which buttons show is driven entirely by CSS off this class — toggling `hidden` doesn't work
  // because the buttons' own `display` rules override the UA [hidden] style.
  ctrl.row.classList.toggle("is-empty-jaw", !hasStl);
  ctrl.toggle.checked = hasStl;
  ctrl.toggle.disabled = !hasStl;
}

// Show/hide the inline upload progress bar in a jaw row's SET SURVEY ANGLE slot.
// While set, the survey/trash/upload controls are replaced by the loading bar.
function setJawRowUploading(jaw, uploading) {
  const rowKey = jaw === "upper" ? "rowUpper" : "rowLower";
  const ctrl = preview3DState.topControls?.[rowKey];
  if (!ctrl) return;
  ctrl.row.classList.toggle("is-uploading-jaw", uploading);
  if (uploading) setJawRowUploadProgress(jaw, 0);
}

// Update the inline upload progress (0..100) shown in a jaw row's SET SURVEY
// ANGLE slot — drives both the "UPLOADING… N%" label and the bar width.
function setJawRowUploadProgress(jaw, pct) {
  const rowKey = jaw === "upper" ? "rowUpper" : "rowLower";
  const wrap = preview3DState.topControls?.[rowKey]?.surveyLoading;
  if (!wrap) return;
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const label = wrap.querySelector(".jaw-preview-survey-loading-label");
  const bar = wrap.querySelector(".jaw-preview-survey-loading-bar");
  if (label) label.textContent = `UPLOADING… ${clamped}%`;
  if (bar) bar.style.width = `${clamped}%`;
}

function isUpper(file) {
  return getJawKeyFromFile(file) === "upper";
}

function getJawKeyFromFile(file) {
  const typeRaw = file?.type ?? file?.jaw_type ?? file?.slot ?? file?.jawSlot;
  if (typeRaw === 1 || typeRaw === "1") return "upper";
  if (typeRaw === 2 || typeRaw === "2") return "lower";
  const type = String(typeRaw || "").toLowerCase();
  const name = String(file?.filename || file?.name || "").toLowerCase();
  if (type.includes("upper") || name.includes("upper")) return "upper";
  if (type.includes("lower") || name.includes("lower")) return "lower";
  return null;
}

