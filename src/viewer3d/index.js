// Import the THREE.js library
import * as THREE from "three";
import { getAppBasePath } from "../js/shared/pageContext.js";
// To allow for the camera to move around the scene
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";

import { STLMeshLoader } from "./STLMeshLoader.js";

// Import the OFFLoader class
import { OFFLoader } from "./OFFLoader.js";
// Import the ApiClient class
import { ApiClient } from "./ApiClient.js";

import { addResetButton } from "./resetButton.js";
import { lol } from "../js/shared/crypt.js";
import "../js/pages/createCase.js";
import {
  addVisibilityAndTransparencyControls,
  removeVisibilityAndTransparencyControls,
} from "./newControls.js";
import { createArtificialTeethRenderer } from "./artificialTeeth.js";
import { API_BASE, MACHINE_ID } from "../js/shared/api.js";
import { decodeJawStructResponse, decodedJawMaterial } from "../js/2D/jawStructCodec.js";
import { FULL_ACRYLIC_MATERIAL } from "../js/2D/JawDesignProposal.js";

const LOG_VIEWER_LOAD_TIMINGS_TO_CONSOLE = false;
const LOG_VIEWER_OBJECT_COUNTS_TO_CONSOLE = false;
const LOG_VIEWER_REVISION_TO_CONSOLE = true;
const LOG_POLYLINE_AUTO_AUDITS_TO_CONSOLE = false;
const LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE = false;
const LOG_ARTIFICIAL_TEETH_STATUS_TO_CONSOLE = false;

function startViewerLoadTimer(label) {
  if (LOG_VIEWER_LOAD_TIMINGS_TO_CONSOLE) {
    console.time(label);
  }
}

function endViewerLoadTimer(label) {
  if (LOG_VIEWER_LOAD_TIMINGS_TO_CONSOLE) {
    console.timeEnd(label);
  }
}

if (LOG_VIEWER_REVISION_TO_CONSOLE) {
  console.log(THREE.REVISION);
}

//initialise everything

let all_mesh_mat = {};
window.finished = false;
const viewerContainer = document.getElementById("container3D");

// Get the current URL
const url = new URL(window.location.href);

// Get the value of a specific query parameter, e.g., "param"
let paramValue = url.searchParams.get("id");
const close = url.searchParams.get("close");

// Decryption of ?id= is currently OFF, so the viewer takes a raw case id.
// Uncomment to go back to encrypted links.
//paramValue = lol(paramValue);

if (!paramValue) {
  console.error("Missing case id in URL");
  // either stop here or handle fallback
} else {
  paramValue = lol(paramValue);
}

// Create a Three.JS Scene
const scene = new THREE.Scene();
// Create a new camera with positions and angles
let camera;
camera = new THREE.OrthographicCamera(
  window.innerWidth / -2,
  window.innerWidth / 2,
  window.innerHeight / 2,
  window.innerHeight / -2,
  -500,
  1000
);

let undercut_type = {};
// Keep the 3D object on a global variable so we can access it later

// OrbitControls allow the camera to move around the scene
let controls;
let orb_controls;

function getViewerStageSize() {
  const rect = viewerContainer?.getBoundingClientRect?.();
  return {
    width: Math.max(1, Math.round(rect?.width || window.innerWidth)),
    height: Math.max(1, Math.round(rect?.height || window.innerHeight)),
  };
}

function resizeViewerStage(renderer) {
  if (!renderer || !camera) return;
  const { width, height } = getViewerStageSize();
  camera.left = width / -2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = height / -2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

// Set which object to render
let objToRender = "dino";
let mesh_geo;

// Jaw material. Standard (not Phong) with the same shading as the 2D-annotation
// jaw preview, so the same scan looks identical in both viewers.
const material = new THREE.MeshStandardMaterial({
  vertexColors: true,
  metalness: 0,
  roughness: 0.5,
  side: THREE.DoubleSide,
  transparent: false,
  opacity: 1,
  depthTest: true,
  depthWrite: true,
});
const materialsurface = new THREE.MeshStandardMaterial({
  color: 0xa0a0a0, // Base color
  metalness: 0.75, // Fully metallic
  roughness: 0.2, // Smooth surface
  side: THREE.DoubleSide,
  transparent: false,
  opacity: 1,
  depthTest: true,
  depthWrite: true,
});
const materialsurface_non_metal = new THREE.MeshStandardMaterial({
  color: 0xa0a0a0, // Base color
  metalness: 0, // Fully metallic
  roughness: 0.2, // Smooth surface
  side: THREE.DoubleSide,
  transparent: false,
  opacity: 1,
  depthTest: true,
  depthWrite: true,
});

// Create an instance of the ApiClient with the base URL
const apiClient = new ApiClient(API_BASE);
const parentObject = new THREE.Object3D();
scene.add(parentObject);
const artificialTeethRenderer = createArtificialTeethRenderer({
  scene,
  parentObject,
  camera,
  apiClient,
  onPerformance: (stage, durationMs, details = {}) => {
    addViewerLoadTiming(stage, durationMs, details);
  },
  onStatus: (label, progress = 0, autoHide = false) => {
    window.lastArtificialTeethStatus = { label, progress, autoHide };
    window.updateViewerLoading?.(label);
    if (LOG_ARTIFICIAL_TEETH_STATUS_TO_CONSOLE) {
      console.log("[artificial teeth]", label, progress);
    }
  },
});
const polylineOverlayGroup = new THREE.Group();
polylineOverlayGroup.name = "polyline-overlay-group";
scene.add(polylineOverlayGroup);
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 5;
const pointer = new THREE.Vector2();
const POLYLINE_ENDPOINT = "/polylines/getall";
const polylineDragPlane = new THREE.Plane();
const polylineDragPoint = new THREE.Vector3();
const polylineCameraDirection = new THREE.Vector3();
const polylineHandleGeometry = new THREE.SphereGeometry(1.05, 24, 16);
const polylineHandleMaterial = new THREE.MeshStandardMaterial({
  color: 0xff8a00,
  opacity: 1,
  roughness: 0.3,
  metalness: 0,
  transparent: false,
  depthTest: true,
  depthWrite: false,
});
const POLYLINE_TUBE_RADIUS = 0.75;
const POLYLINE_TUBE_RADIAL_SEGMENTS = 8;
let isPolylineOverlayVisible = true;
let activePolylineDrag = null;
let polylineMenuList = null;
let polylineDepthTestEnabled = true;
const polylineUndoStack = [];
const polylineRedoStack = [];
let polylinePreDragSnapshot = null;
let polylineUndoBtn = null;
let polylineRedoBtn = null;
const polylineComponentVisibility = new Map();
const polylineJawVisibility = new Map([
  ["upper", true],
  ["lower", true],
]);
const polylineJawOpacity = new Map([
  ["upper", 1],
  ["lower", 1],
]);
const polylineDiagnostics = {
  base64DecodeMs: 0,
  base64DecodeCount: 0,
  textParseMs: 0,
  textParseCount: 0,
};
const viewerLoadTimings = [];
const viewerMeshTimings = [];
let hasLoggedFirstSceneRender = false;
const viewerRotationOrigin = new THREE.Vector3(0, 0, 0);
let viewerRotationBoundsRadius = 40;
let hasViewerRotationOrigin = false;
const VIEWER_TARGET_MIN_DRIFT_LIMIT = 45;

const POLYLINE_COMPONENT_COLORS = [
  0x6f35ff,
  0x00a6ff,
  0xff8a00,
  0x1fc16b,
  0xff4f81,
  0xffd400,
];
const POLYLINE_APP_COMPONENTS = [
  "Retainer",
  "Lingual Clasp",
  "MajorConnector",
  "Proximal Plate",
  "Rest",
  "Minor Conn",
  "Mesh",
  "Reversal Line",
  "Gingival Points",
];
const POLYLINE_TEXT_COMPONENTS = [
  "retentionPins",
  "retainer",
  "tissueStop",
  "mesh",
  "reversalLine",
  "proximalPlate",
  "proximalPlates",
  "endingProximalPlate",
  "startingProximalPlate",
  "majorConnector",
  "GingivalPoints",
  "reciprocatingArm",
  "rests",
  "rest",
  "minorConnectorTooth",
];
const POLYLINE_TEXT_COMPONENT_PATTERN = new RegExp(
  `^(${POLYLINE_TEXT_COMPONENTS.join("|")})\\b`,
  "i"
);
const POLYLINE_TEXT_DETECTION_PATTERN = new RegExp(
  `nodeCount|${POLYLINE_TEXT_COMPONENTS.join("|")}`,
  "i"
);

function resetPolylineDiagnostics() {
  polylineDiagnostics.base64DecodeMs = 0;
  polylineDiagnostics.base64DecodeCount = 0;
  polylineDiagnostics.textParseMs = 0;
  polylineDiagnostics.textParseCount = 0;
}

function logPolylineDiagnostics() {
  if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) {
    console.log("[viewer: polyline diagnostics]", {
      base64Decodes: polylineDiagnostics.base64DecodeCount,
      base64DecodeMs: Number(polylineDiagnostics.base64DecodeMs.toFixed(2)),
      textParses: polylineDiagnostics.textParseCount,
      textParseMs: Number(polylineDiagnostics.textParseMs.toFixed(2)),
    });
    console.log(
      `viewer: decode polylines: ${polylineDiagnostics.base64DecodeMs.toFixed(2)} ms`
    );
    console.log(
      `viewer: parse polylines: ${polylineDiagnostics.textParseMs.toFixed(2)} ms`
    );
  }
  addViewerLoadTiming(
    "decode polylines",
    polylineDiagnostics.base64DecodeMs,
    { count: polylineDiagnostics.base64DecodeCount }
  );
  addViewerLoadTiming(
    "parse polylines",
    polylineDiagnostics.textParseMs,
    { count: polylineDiagnostics.textParseCount }
  );
}

function addViewerLoadTiming(stage, durationMs, details = {}) {
  const entry = {
    stage,
    durationMs: Number(durationMs.toFixed(2)),
    ...details,
  };
  viewerLoadTimings.push(entry);
  window.viewerLoadTimings = viewerLoadTimings;
  return entry;
}

function addViewerMeshTiming(entry) {
  viewerMeshTimings.push({
    ...entry,
    decodeMs: Number((entry.decodeMs || 0).toFixed(2)),
    parseMs: Number((entry.parseMs || 0).toFixed(2)),
    addMs: Number((entry.addMs || 0).toFixed(2)),
    totalMs: Number((entry.totalMs || 0).toFixed(2)),
  });
  window.viewerMeshTimings = viewerMeshTimings;
}

function logViewerPerformanceSummary() {
  if (!LOG_VIEWER_LOAD_TIMINGS_TO_CONSOLE) return;
  const sortedStages = [...viewerLoadTimings].sort(
    (a, b) => b.durationMs - a.durationMs
  );
  console.groupCollapsed("[viewer: performance summary]");
  console.table(sortedStages);
  if (viewerMeshTimings.length) {
    console.table(
      [...viewerMeshTimings].sort((a, b) => b.totalMs - a.totalMs)
    );
  }
  console.groupEnd();
}

function saveAnnotationBackground(storageKey, dataUrl) {
  try {
    localStorage.setItem(storageKey, dataUrl);
    return true;
  } catch (err) {
    console.warn("Failed to save annotation background in localStorage.", err);
    return false;
  }
}

// Gate for a guest clicking "Annotate": Login and Continue-as-guest both go
// where the caller says. Styled inline — the viewer doesn't load noticeboard.css.
function openAnnotateGate({
  onLogin,
  onGuest,
  title = "Sign in to continue",
  message = "Log in to open the 2D annotation noticeboard.",
}) {
  const gate = document.createElement("div");
  gate.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.78);";
  gate.innerHTML = `
    <div style="width:min(92vw,420px);background:#fff;border-radius:14px;padding:28px 26px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35);text-align:center;font-family:system-ui,-apple-system,sans-serif;">
      <h2 style="margin:0 0 10px;font-size:20px;font-weight:700;color:#0f172a;">${title}</h2>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.5;color:#475569;">${message}</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <button type="button" data-gate-login style="width:100%;padding:12px 16px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:1px solid transparent;background:#3BAE95;color:#fff;">Login</button>
        <!-- TEMP: "Continue as guest" hidden for now — remove display:none to restore. -->
        <button type="button" data-gate-guest style="${onGuest ? "" : "display:none;"}width:100%;padding:12px 16px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#334155;">Continue as guest</button>
      </div>
    </div>`;
  document.body.appendChild(gate);
  const close = () => gate.remove();
  gate.addEventListener("click", (ev) => {
    if (ev.target === gate) close();
  });
  gate.querySelector("[data-gate-login]").addEventListener("click", () => {
    close();
    onLogin?.();
  });
  gate.querySelector("[data-gate-guest]").addEventListener("click", () => {
    close();
    onGuest?.();
  });
}

// ────────────────────────────────────────────────────────────────────────────

function getViewerRightNav() {
  let nav = document.getElementById("viewer-right-nav");
  if (nav) return nav;

  nav = document.createElement("nav");
  nav.id = "viewer-right-nav";
  nav.setAttribute("aria-label", "Viewer controls");
  (viewerContainer || document.body).appendChild(nav);
  return nav;
}

window.getViewerRightNav = getViewerRightNav;

// One row shared by the design/upload and reset/lock pairs, which are built by
// different modules at different times and join it via display: contents.
function getViewerNavToolbar() {
  let toolbar = document.getElementById("viewer-nav-toolbar");
  if (toolbar) return toolbar;

  toolbar = document.createElement("div");
  toolbar.id = "viewer-nav-toolbar";
  toolbar.style.order = "4";
  getViewerRightNav().appendChild(toolbar);
  return toolbar;
}

window.getViewerNavToolbar = getViewerNavToolbar;

window.viewerPanelManager = (() => {
  const _panels = {};
  function _dimAll() {
    for (const p of Object.values(_panels)) {
      p.btn.classList.remove("vpm-active");
      p.btn.classList.add("vpm-dimmed");
    }
  }
  function _clearAll() {
    for (const p of Object.values(_panels)) {
      p.btn.classList.remove("vpm-active", "vpm-dimmed");
    }
  }
  return {
    register(id, btn, openFn, closeFn) {
      _panels[id] = { btn, openFn, closeFn, isOpen: false };
    },
    open(id) {
      for (const [pid, p] of Object.entries(_panels)) {
        if (pid !== id && p.isOpen) { p.closeFn(); p.isOpen = false; }
      }
      const p = _panels[id];
      if (!p) return;
      p.openFn();
      p.isOpen = true;
      _dimAll();
      p.btn.classList.remove("vpm-dimmed");
      p.btn.classList.add("vpm-active");
    },
    close(id) {
      const p = _panels[id];
      if (!p) return;
      p.closeFn();
      p.isOpen = false;
      if (!Object.values(_panels).some(x => x.isOpen)) _clearAll();
    },
    toggle(id) {
      const p = _panels[id];
      if (!p) return;
      if (p.isOpen) this.close(id);
      else this.open(id);
    },
  };
})();

function getViewerObjectCounts() {
  let jawMeshes = 0;
  let polylineGroups = 0;
  let polylineSegments = 0;
  let draggablePointObjects = 0;
  let artificialTeeth = 0;

  parentObject.traverse((child) => {
    if (child.isMesh && child.userData?.jaw_type) {
      jawMeshes += 1;
    }
  });

  polylineOverlayGroup.children.forEach((group) => {
    if (group.userData?.overlayType !== "polyline") return;
    polylineGroups += 1;
    group.traverse((child) => {
      if (child.userData?.overlayType === "polyline-tube") {
        polylineSegments += 1;
      } else if (child.userData?.overlayType === "polyline-edit-point") {
        draggablePointObjects += 1;
      }
    });
  });

  scene.traverse((child) => {
    if (child.userData?.overlayType === "artificial-tooth") {
      artificialTeeth += 1;
    }
  });

  return {
    jawMeshes,
    polylineGroups,
    polylineSegments,
    draggablePointObjects,
    artificialTeeth,
    sceneChildren: scene.children.length,
  };
}

function logViewerObjectCounts(stage = "rendered") {
  if (!LOG_VIEWER_OBJECT_COUNTS_TO_CONSOLE) return;
  console.log(`[viewer: object counts] ${stage}`, getViewerObjectCounts());
}

function getJawMeshBoundingBox() {
  const box = new THREE.Box3();
  let hasJawMesh = false;
  parentObject.updateMatrixWorld(true);
  parentObject.traverse((child) => {
    if (!child.isMesh || !child.userData?.jaw_type) return;
    child.updateMatrixWorld(true);
    box.expandByObject(child);
    hasJawMesh = true;
  });
  return hasJawMesh && !box.isEmpty() ? box : null;
}

function updateViewerRotationOrigin() {
  const box = getJawMeshBoundingBox();
  if (!box) return viewerRotationOrigin;

  box.getCenter(viewerRotationOrigin);
  viewerRotationBoundsRadius = Math.max(
    VIEWER_TARGET_MIN_DRIFT_LIMIT,
    box.getSize(new THREE.Vector3()).length() * 0.5
  );
  hasViewerRotationOrigin = true;
  window.viewerRotationOrigin = {
    x: Number(viewerRotationOrigin.x.toFixed(3)),
    y: Number(viewerRotationOrigin.y.toFixed(3)),
    z: Number(viewerRotationOrigin.z.toFixed(3)),
  };
  window.viewerRotationGuard = {
    origin: window.viewerRotationOrigin,
    boundsRadius: Number(viewerRotationBoundsRadius.toFixed(3)),
  };
  if (LOG_VIEWER_OBJECT_COUNTS_TO_CONSOLE) {
    console.log("[viewer] rotation origin", window.viewerRotationGuard);
  }
  return viewerRotationOrigin;
}

function applyViewerRotationOrigin() {
  const target = hasViewerRotationOrigin
    ? viewerRotationOrigin
    : updateViewerRotationOrigin();
  if (!target) return;

  if (controls?.target) {
    controls.target.copy(target);
    controls.update();
  }
  if (orb_controls?.target) {
    orb_controls.target.copy(target);
    orb_controls.update();
  }
}

function clampViewerControlTarget(control = controls) {
  if (!control?.target || !hasViewerRotationOrigin) return false;
  const targetOffset = control.target.clone().sub(viewerRotationOrigin);
  const cameraRight = new THREE.Vector3();
  const cameraUp = camera.up.clone().normalize();
  camera.getWorldDirection(cameraRight);
  cameraRight.cross(cameraUp).normalize();

  const zoom = Math.max(camera.zoom || 1, 0.0001);
  const visibleHalfWidth = Math.abs(camera.right - camera.left) / (2 * zoom);
  const visibleHalfHeight = Math.abs(camera.top - camera.bottom) / (2 * zoom);
  const modelMargin = viewerRotationBoundsRadius * 0.55;
  const horizontalLimit = Math.max(
    VIEWER_TARGET_MIN_DRIFT_LIMIT * 0.35,
    visibleHalfWidth - modelMargin
  );
  const verticalLimit = Math.max(
    VIEWER_TARGET_MIN_DRIFT_LIMIT * 0.35,
    visibleHalfHeight - modelMargin
  );
  const horizontalOffset = THREE.MathUtils.clamp(
    targetOffset.dot(cameraRight),
    -horizontalLimit,
    horizontalLimit
  );
  const verticalOffset = THREE.MathUtils.clamp(
    targetOffset.dot(cameraUp),
    -verticalLimit,
    verticalLimit
  );
  const clampedTarget = viewerRotationOrigin
    .clone()
    .addScaledVector(cameraRight, horizontalOffset)
    .addScaledVector(cameraUp, verticalOffset);
  const driftDistance = control.target.distanceTo(clampedTarget);
  if (!Number.isFinite(driftDistance) || driftDistance < 0.0001) return false;

  const correction = clampedTarget.clone().sub(control.target);
  control.target.copy(clampedTarget);
  camera.position.add(correction);
  if (orb_controls?.target) {
    orb_controls.target.copy(clampedTarget);
  }
  camera.updateProjectionMatrix();

  window.viewerRotationGuard = {
    ...(window.viewerRotationGuard || {}),
    lastClamp: {
      driftDistance: Number(driftDistance.toFixed(3)),
      horizontalLimit: Number(horizontalLimit.toFixed(3)),
      verticalLimit: Number(verticalLimit.toFixed(3)),
      correction: {
        x: Number(correction.x.toFixed(3)),
        y: Number(correction.y.toFixed(3)),
        z: Number(correction.z.toFixed(3)),
      },
    },
  };
  return true;
}

function bindViewerRotationTargetAnchor(domElement) {
  if (!domElement) return;
  const activeTouchPointers = new Set();
  const touchPointerPositions = new Map();
  const manualPanState = {
    active: false,
    lastX: 0,
    lastY: 0,
    pointerId: null,
  };
  const touchGestureState = {
    active: false,
    lastCenterX: 0,
    lastCenterY: 0,
    lastDistance: 0,
  };
  const minTouchZoom = 2;
  const maxTouchZoom = 50;

  const releaseManualPan = () => {
    if (manualPanState.pointerId != null) {
      domElement.releasePointerCapture?.(manualPanState.pointerId);
    }
    manualPanState.active = false;
    manualPanState.pointerId = null;
  };

  const getTouchGestureMetrics = () => {
    const points = Array.from(touchPointerPositions.values());
    if (points.length < 2) return null;
    const [first, second] = points;
    const deltaX = second.x - first.x;
    const deltaY = second.y - first.y;
    return {
      centerX: (first.x + second.x) / 2,
      centerY: (first.y + second.y) / 2,
      distance: Math.hypot(deltaX, deltaY),
    };
  };

  const releaseTouchGesture = () => {
    touchGestureState.active = false;
    touchGestureState.lastCenterX = 0;
    touchGestureState.lastCenterY = 0;
    touchGestureState.lastDistance = 0;
    if (controls) {
      controls.enabled = true;
    }
  };

  // Jaw locked at the centre: every pan gesture is disabled so nothing can drag
  // the model off-centre. Rotation and zoom stay active.
  const VIEWER_PAN_LOCKED = true;
  const panViewerTargetByScreenDelta = (deltaX, deltaY) => {
    if (VIEWER_PAN_LOCKED) return;
    if (!camera || !controls?.target) return;
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    camera.getWorldDirection(right);
    right.cross(camera.up).normalize();
    up.copy(camera.up).normalize();

    const panSpeed = Math.max(1, controls.panSpeed || 1) / 8;
    const scale = panSpeed / Math.max(camera.zoom || 1, 0.0001);
    const panOffset = right
      .multiplyScalar(-deltaX * scale)
      .add(up.multiplyScalar(deltaY * scale));

    camera.position.add(panOffset);
    controls.target.add(panOffset);
    if (orb_controls?.target) {
      orb_controls.target.copy(controls.target);
    }
    clampViewerControlTarget(controls);
    camera.updateProjectionMatrix();
  };

  const zoomViewerByScale = (scaleFactor) => {
    if (!camera || !Number.isFinite(scaleFactor) || scaleFactor <= 0) return;
    const nextZoom = THREE.MathUtils.clamp(
      (camera.zoom || 1) * scaleFactor,
      minTouchZoom,
      maxTouchZoom
    );
    if (!Number.isFinite(nextZoom)) return;
    camera.zoom = nextZoom;
    camera.updateProjectionMatrix();
    clampViewerControlTarget(controls);
    if (orb_controls?.target) {
      orb_controls.target.copy(controls.target);
    }
  };

  const startTouchGesture = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation?.();
    releaseManualPan();
    const metrics = getTouchGestureMetrics();
    if (!metrics) return;
    touchGestureState.active = true;
    touchGestureState.lastCenterX = metrics.centerX;
    touchGestureState.lastCenterY = metrics.centerY;
    touchGestureState.lastDistance = Math.max(metrics.distance, 1);
    if (controls) {
      controls.enabled = false;
    }
  };

  const startManualPan = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    manualPanState.active = true;
    manualPanState.pointerId = event.pointerId ?? null;
    manualPanState.lastX = event.clientX;
    manualPanState.lastY = event.clientY;
    if (manualPanState.pointerId != null) {
      domElement.setPointerCapture?.(manualPanState.pointerId);
    }
  };

  const moveManualPan = (event) => {
    if (!manualPanState.active) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    const deltaX = event.clientX - manualPanState.lastX;
    const deltaY = event.clientY - manualPanState.lastY;
    manualPanState.lastX = event.clientX;
    manualPanState.lastY = event.clientY;
    panViewerTargetByScreenDelta(deltaX, deltaY);
  };

  domElement.addEventListener("mousedown", (event) => {
    if (event.button !== 2) return;
    event.preventDefault();
  }, true);

  domElement.addEventListener("pointerdown", (event) => {
    if (!controls?.target) return;

    if (event.pointerType === "touch") {
      activeTouchPointers.add(event.pointerId);
      touchPointerPositions.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (activeTouchPointers.size > 1) {
        startTouchGesture(event);
        return;
      }
    } else if (event.button === 0 || event.button === 1) {
      // Left-drag on a polyline handle edits it, so pan only off the handles.
      if (event.button === 0 && pickPolylinePoint(event, domElement)) return;
      startManualPan(event);
      return;
    } else if (event.button !== 2) {
      return;
    }

  }, true);

  const releasePointer = (event) => {
    if (event.pointerType === "touch") {
      activeTouchPointers.delete(event.pointerId);
      touchPointerPositions.delete(event.pointerId);
      if (activeTouchPointers.size < 2) {
        releaseTouchGesture();
      }
    }
    if (event.type !== "pointerleave") {
      releaseManualPan();
    }
  };

  domElement.addEventListener("pointerup", releasePointer);
  domElement.addEventListener("pointercancel", releasePointer);
  domElement.addEventListener("pointerleave", releasePointer);
  domElement.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" && activeTouchPointers.has(event.pointerId)) {
      touchPointerPositions.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      if (touchGestureState.active) {
        event.preventDefault();
        event.stopImmediatePropagation?.();
        const metrics = getTouchGestureMetrics();
        if (!metrics) return;
        const deltaX = metrics.centerX - touchGestureState.lastCenterX;
        const deltaY = metrics.centerY - touchGestureState.lastCenterY;
        touchGestureState.lastCenterX = metrics.centerX;
        touchGestureState.lastCenterY = metrics.centerY;
        panViewerTargetByScreenDelta(deltaX, deltaY);
        if (touchGestureState.lastDistance > 0 && metrics.distance > 0) {
          zoomViewerByScale(metrics.distance / touchGestureState.lastDistance);
        }
        touchGestureState.lastDistance = Math.max(metrics.distance, 1);
        return;
      }
    }
    moveManualPan(event);
  }, true);
  domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  window.addEventListener("blur", () => {
    activeTouchPointers.clear();
    touchPointerPositions.clear();
    releaseManualPan();
    releaseTouchGesture();
  });
}

function disposeObject3D(object) {
  if (!object) return;
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (Array.isArray(child.material)) {
      child.material.forEach((materialEntry) => materialEntry?.dispose?.());
    } else if (child.material) {
      child.material.dispose();
    }
  });
}

const PRESET_CAMERA_VIEWS = [
  {
    key: "top",
    label: "Top",
    direction: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, -1),
  },
  {
    key: "bottom",
    label: "Bottom",
    direction: new THREE.Vector3(0, -1, 0),
    up: new THREE.Vector3(0, 0, 1),
  },
  {
    key: "left",
    label: "Left",
    direction: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  },
  {
    key: "right",
    label: "Right",
    direction: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  },
  {
    key: "front",
    label: "Front",
    direction: new THREE.Vector3(0, 0, 1),
    up: new THREE.Vector3(0, 1, 0),
  },
  {
    key: "rear",
    label: "Rear",
    direction: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
  },
];
let currentPresetToolbarView = "front";

function getPresetArrowGlyph(viewKey) {
  switch (viewKey) {
    case "front":
      return "↗";
    case "rear":
      return "↙";
    case "top":
      return "↑";
    case "bottom":
      return "↓";
    case "left":
      return "←";
    case "right":
      return "→";
    default:
      return "↑";
  }
}

function syncPresetViewToolbarSelection(viewKey) {
  if (!["front", "rear", "top", "bottom", "left", "right"].includes(viewKey)) {
    return;
  }
  currentPresetToolbarView = viewKey;
  const currentButton = document.getElementById("preset-view-current");
  if (currentButton) {
    currentButton.dataset.viewKey = viewKey;
    currentButton.dataset.mobileArrow = viewKey;
    currentButton.setAttribute("aria-label", `${viewKey} view`);
    currentButton.title = `${viewKey} view`;
    currentButton.textContent = getPresetArrowGlyph(viewKey);
  }
  document.querySelectorAll(".preset-view-dropdown-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewKey === viewKey);
  });
}

function computeFitZoom() {
  const box = getPresetViewBounds();
  if (!box) return 7;
  const size = box.getSize(new THREE.Vector3());
  const { width, height } = getViewerStageSize();
  const padding = 1.5;
  const zoomX = width / Math.max(size.x * padding, 1);
  const zoomY = height / Math.max(size.y * padding, 1);
  return Math.min(zoomX, zoomY);
}

function getPresetViewBounds() {
  const jawBox = getJawMeshBoundingBox();
  if (jawBox) return jawBox;

  const box = new THREE.Box3();
  let hasMesh = false;
  parentObject.updateMatrixWorld(true);
  parentObject.traverse((child) => {
    if (!child.isMesh) return;
    child.updateMatrixWorld(true);
    box.expandByObject(child);
    hasMesh = true;
  });

  return hasMesh && !box.isEmpty() ? box : null;
}

function setPresetCameraView(viewKey) {
  if (viewKey === "center") {
    setCenterCameraView();
    return;
  }

  const view = PRESET_CAMERA_VIEWS.find((item) => item.key === viewKey);
  if (!view || !camera) return;

  const box = getPresetViewBounds();
  const target = box
    ? box.getCenter(new THREE.Vector3())
    : hasViewerRotationOrigin
      ? viewerRotationOrigin.clone()
      : new THREE.Vector3(0, 0, 0);
  const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(120, 120, 120);
  const radius = Math.max(size.length() * 0.5, VIEWER_TARGET_MIN_DRIFT_LIMIT);
  const distance = Math.max(radius * 4, 500);
  const direction = view.direction.clone().normalize();

  viewerRotationOrigin.copy(target);
  viewerRotationBoundsRadius = radius;
  hasViewerRotationOrigin = true;
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.up.copy(view.up);
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  if (controls?.target) {
    controls.target.copy(target);
    controls.update();
  }
  if (orb_controls?.target) {
    orb_controls.target.copy(target);
    orb_controls.update();
  }

  document.querySelectorAll(".preset-view-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewKey === viewKey);
  });
  syncPresetViewToolbarSelection(viewKey);
}

function setCenterCameraView() {
  if (!camera) return;

  const box = getPresetViewBounds();
  const target = box
    ? box.getCenter(new THREE.Vector3())
    : hasViewerRotationOrigin
      ? viewerRotationOrigin.clone()
      : new THREE.Vector3(0, 0, 0);
  const size = box ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(120, 120, 120);
  const radius = Math.max(size.length() * 0.5, VIEWER_TARGET_MIN_DRIFT_LIMIT);
  const currentTarget = controls?.target || viewerRotationOrigin;
  const direction = camera.position.clone().sub(currentTarget).normalize();
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 0.000001) {
    direction.set(0, 0, 1);
  }
  const distance = Math.max(radius * 4, 500);

  viewerRotationOrigin.copy(target);
  viewerRotationBoundsRadius = radius;
  hasViewerRotationOrigin = true;
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  if (controls?.target) {
    controls.target.copy(target);
    controls.update();
  }
  if (orb_controls?.target) {
    orb_controls.target.copy(target);
    orb_controls.update();
  }

  document.querySelectorAll(".preset-view-button").forEach((button) => {
    button.classList.remove("active");
  });
}

function createPresetViewControls() {
  if (document.querySelector(".preset-view-panel")) return;

  const panel = document.createElement("div");
  panel.className = "preset-view-panel";
  const sceneHost = viewerContainer || document.getElementById("container3D") || document.body;

  const viewPad = document.createElement("div");
  viewPad.className = "preset-view-pad";

  const mobileWrap = document.createElement("div");
  mobileWrap.className = "preset-view-current-wrap";

  const mobileCurrent = document.createElement("button");
  mobileCurrent.type = "button";
  mobileCurrent.id = "preset-view-current";
  mobileCurrent.className = "preset-view-current";
  mobileCurrent.dataset.viewKey = currentPresetToolbarView;
  mobileCurrent.dataset.mobileArrow = currentPresetToolbarView;
  mobileCurrent.setAttribute("aria-label", "Current positional view");
  mobileCurrent.title = "Choose positional view";
  mobileCurrent.textContent = getPresetArrowGlyph(currentPresetToolbarView);

  const mobileDropdown = document.createElement("div");
  mobileDropdown.className = "preset-view-dropdown";
  sceneHost.appendChild(mobileDropdown);

  const closeMobileDropdown = () => {
    mobileWrap.classList.remove("open");
    mobileDropdown.classList.remove("open");
  };

  const positionMobileDropdown = () => {
    if (!mobileDropdown.classList.contains("open")) return;
    const buttonRect = mobileCurrent.getBoundingClientRect();
    const hostRect = sceneHost.getBoundingClientRect();
    const dropdownRect = mobileDropdown.getBoundingClientRect();
    const gap = window.innerWidth <= 768 ? 18 : 14;
    const maxLeft = Math.max(8, hostRect.width - dropdownRect.width - 8);
    const desiredLeft = buttonRect.right - hostRect.left - dropdownRect.width;
    const desiredTop = buttonRect.top - hostRect.top - dropdownRect.height - gap;
    const left = Math.min(Math.max(8, desiredLeft), maxLeft);
    const top = Math.max(8, desiredTop);
    mobileDropdown.style.left = `${left}px`;
    mobileDropdown.style.top = `${top}px`;
    mobileDropdown.style.right = "auto";
    mobileDropdown.style.bottom = "auto";
  };

  const mobileViews = [
    { key: "front", label: "Front" },
    { key: "rear", label: "Rear" },
    { key: "top", label: "Top" },
    { key: "bottom", label: "Bottom" },
    { key: "left", label: "Left" },
    { key: "right", label: "Right" },
  ];

  mobileViews.forEach((view) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "preset-view-dropdown-button";
    item.dataset.viewKey = view.key;
    item.dataset.mobileArrow = view.key;
    item.title = `${view.label} view`;
    item.setAttribute("aria-label", `${view.label} view`);
    item.textContent = getPresetArrowGlyph(view.key);
    item.addEventListener("click", () => {
      closeMobileDropdown();
      setPresetCameraView(view.key);
    });
    mobileDropdown.appendChild(item);
  });

  mobileCurrent.addEventListener("click", () => {
    const willOpen = !mobileDropdown.classList.contains("open");
    closeMobileDropdown();
    if (willOpen) {
      mobileWrap.classList.add("open");
      mobileDropdown.classList.add("open");
      requestAnimationFrame(positionMobileDropdown);
    }
  });

  document.addEventListener("click", (event) => {
    if (!mobileWrap.contains(event.target) && !mobileDropdown.contains(event.target)) {
      closeMobileDropdown();
    }
  });

  window.addEventListener("resize", () => {
    if (mobileDropdown.classList.contains("open")) {
      requestAnimationFrame(positionMobileDropdown);
    }
  });

  mobileWrap.appendChild(mobileCurrent);

  const visualViews = [
    { key: "bottom", label: "Top", slot: "top" },
    { key: "top", label: "Bottom", slot: "bottom" },
    { key: "right", label: "Left", slot: "left" },
    { key: "left", label: "Right", slot: "right" },
    { key: "rear", label: "Rear", slot: "rear" },
    { key: "front", label: "Front", slot: "front" },
    { key: "center", label: "Center", slot: "center" },
  ];

  visualViews.forEach((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `preset-view-button preset-view-${view.slot}`;
    button.dataset.viewKey = view.key;
    const mobileArrowByView = {
      front: "right",
      rear: "left",
      top: "up",
      bottom: "down",
      left: "left",
      right: "right",
      center: "center",
    };
    button.dataset.mobileArrow = mobileArrowByView[view.key] || "";
    const ariaLabel =
      view.key === "center" ? "Center model view" : `${view.label} view`;
    button.title = ariaLabel;
    button.setAttribute("aria-label", ariaLabel);

    const face = document.createElement("span");
    face.className = "preset-view-face";
    button.appendChild(face);

    button.addEventListener("click", () => {
      setPresetCameraView(view.key);
    });
    viewPad.appendChild(button);
  });

  panel.appendChild(viewPad);
  panel.appendChild(mobileWrap);
  panel.style.order = "10";
  getViewerRightNav().appendChild(panel);
  syncPresetViewToolbarSelection(currentPresetToolbarView);
}

function clearPolylineOverlay() {
  while (polylineOverlayGroup.children.length > 0) {
    const child = polylineOverlayGroup.children[0];
    polylineOverlayGroup.remove(child);
    disposeObject3D(child);
  }
  updatePolylineComponentMenu();
}

function enforceOpaqueJawMesh(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    materials.forEach((materialEntry) => {
      if (!materialEntry) return;
      materialEntry.transparent = false;
      materialEntry.opacity = 1;
      materialEntry.depthTest = true;
      materialEntry.depthWrite = true;
      materialEntry.side = THREE.DoubleSide;
      materialEntry.needsUpdate = true;
    });
  });
}

function syncPolylineFocusMode() {
  parentObject.children.forEach((child) => {
    if (!child.isMesh) return;
    enforceOpaqueJawMesh(child);
  });
}

function normalizeJawKey(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("upper_jaw") || text.includes("upper") || text === "2") {
    return "upper";
  }
  if (text.includes("lower_jaw") || text.includes("lower") || text === "1") {
    return "lower";
  }
  return null;
}

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function getPolylineComponentName(candidate, fallback = "polyline") {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fallback;
  }

  return String(
    candidate.component ??
      candidate.component_name ??
      candidate.componentName ??
      candidate.name ??
      candidate.label ??
      candidate.type ??
      candidate.line_type ??
      candidate.polyline_type ??
      fallback
  );
}

function normalizePolylineComponentName(component) {
  const text = String(component || "polyline");
  if (/retention\s*pins?|^retainer$/i.test(text)) return "Retainer";
  if (/gingival/i.test(text)) return "Gingival Points";
  if (/reciprocating\s*arm/i.test(text)) return "Lingual Clasp";
  if (/^mesh$/i.test(text)) return "Mesh";
  if (/tissue\s*stop|^rests?$|rest/i.test(text)) return "Rest";
  if (/ending\s*proximal\s*plate/i.test(text)) {
    return "Proximal Plate";
  }
  if (/starting\s*proximal\s*plate/i.test(text)) {
    return "Proximal Plate";
  }
  if (/proximal\s*plates?/i.test(text)) return "Proximal Plate";
  if (/minor\s*connector\s*tooth/i.test(text)) return "Minor Conn";
  if (/major\s*connector/i.test(text)) return "MajorConnector";
  if (/reversal/i.test(text)) return "Reversal Line";
  return text;
}

function getPolylinePointSignature(point) {
  return [point.x, point.y, point.z]
    .map((value) => Number(value).toFixed(3))
    .join(",");
}

function createPolylineSegment(points, component = "polyline") {
  const normalizedComponent = normalizePolylineComponentName(component);
  return {
    component: normalizedComponent,
    sourceComponent: component,
    points,
  };
}

function getSegmentPoints(segment) {
  return Array.isArray(segment) ? segment : segment?.points || [];
}

function getSegmentComponent(segment) {
  return normalizePolylineComponentName(
    Array.isArray(segment) ? "polyline" : segment?.component || "polyline"
  );
}

function getSegmentRenderableEdges(segment, points, component) {
  return segment?.renderEdges ||
    getPolylineRenderableEdges(points, segment?.sourceComponent || component);
}

function getPolylineComponentKey(arch, component) {
  return component;
}

function isPolylineJawVisible(arch) {
  return polylineJawVisibility.get(arch) ?? true;
}

function setPolylineJawVisibility(arch, isVisible) {
  if (arch !== "upper" && arch !== "lower") return;
  polylineJawVisibility.set(arch, Boolean(isVisible));
  syncPolylineOverlayVisibility();
}

function getPolylineJawVisibility(arch) {
  return isPolylineJawVisible(arch);
}

function hasPolylineJawComponents(arch) {
  return polylineOverlayGroup.children.some(
    (group) =>
      group.userData?.overlayType === "polyline" &&
      group.userData?.arch === arch
  );
}

function applyPolylineJawOpacity(arch) {
  const opacity = polylineJawOpacity.get(arch) ?? 1;
  polylineOverlayGroup.children.forEach((group) => {
    if (group.userData?.arch !== arch) return;
    group.traverse((child) => {
      if (!child.material) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((materialEntry) => {
        if (!materialEntry) return;
        materialEntry.opacity = opacity;
        materialEntry.transparent = opacity < 1;
        materialEntry.depthWrite = false;
        materialEntry.needsUpdate = true;
      });
    });
  });
}

function setPolylineJawOpacity(arch, opacity) {
  if (arch !== "upper" && arch !== "lower") return;
  const normalizedOpacity = Math.max(0, Math.min(1, Number(opacity)));
  polylineJawOpacity.set(arch, Number.isFinite(normalizedOpacity) ? normalizedOpacity : 1);
  applyPolylineJawOpacity(arch);
}

function getPolylineJawOpacity(arch) {
  return polylineJawOpacity.get(arch) ?? 1;
}

window.setPolylineJawVisibility = setPolylineJawVisibility;
window.getPolylineJawVisibility = getPolylineJawVisibility;
window.hasPolylineJawComponents = hasPolylineJawComponents;
window.setPolylineJawOpacity = setPolylineJawOpacity;
window.getPolylineJawOpacity = getPolylineJawOpacity;

function formatPolylineComponentLabel(key) {
  return key || "polyline";
}

function isPolylineComponentVisibleByDefault(key) {
  return !/gingival\s*points/i.test(key || "");
}

function getPolylineComponentSortRank(key) {
  const componentIndex = POLYLINE_APP_COMPONENTS.indexOf(key);
  return componentIndex >= 0
    ? componentIndex
    : POLYLINE_APP_COMPONENTS.length;
}

function toPointObject(value) {
  if (typeof value === "string") {
    try {
      return toPointObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value.map(Number);
    return { x, y, z };
  }

  if (value && typeof value === "object") {
    const x = Number(
      value.x ??
        value.X ??
        value.pos_x ??
        value.point_x ??
        value.position_x ??
        value.coord_x ??
        value[0]
    );
    const y = Number(
      value.y ??
        value.Y ??
        value.pos_y ??
        value.point_y ??
        value.position_y ??
        value.coord_y ??
        value[1]
    );
    const z = Number(
      value.z ??
        value.Z ??
        value.pos_z ??
        value.point_z ??
        value.position_z ??
        value.coord_z ??
        value[2]
    );

    if ([x, y, z].every(Number.isFinite)) {
      return { x, y, z };
    }
  }

  return null;
}

function extractPointArray(candidate) {
  if (!candidate) return [];

  if (typeof candidate === "string") {
    try {
      return extractPointArray(JSON.parse(candidate));
    } catch {
      return [];
    }
  }

  if (Array.isArray(candidate)) {
    return candidate.map(toPointObject).filter(isValidPoint);
  }

  const nestedArrayKeys = [
    "points",
    "polyline",
    "polylines",
    "vertices",
    "coordinates",
    "coords",
    "data",
    "json",
  ];
  for (const key of nestedArrayKeys) {
    if (candidate[key]) {
      const points = extractPointArray(candidate[key]);
      if (points.length) return points;
    }
  }

  return [];
}

function decodePolylineText(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  const decodeStartedAt = performance.now();
  try {
    const decoded = atob(value.trim());
    polylineDiagnostics.base64DecodeMs += performance.now() - decodeStartedAt;
    polylineDiagnostics.base64DecodeCount += 1;
    if (POLYLINE_TEXT_DETECTION_PATTERN.test(decoded)) {
      return decoded;
    }
  } catch {
    polylineDiagnostics.base64DecodeMs += performance.now() - decodeStartedAt;
    // Keep going: the value may already be plain text.
  }

  return POLYLINE_TEXT_DETECTION_PATTERN.test(value) ? value : "";
}

function parsePolylineTextSegments(value) {
  const text = decodePolylineText(value);
  if (!text) {
    return [];
  }
  const textParseStartedAt = performance.now();

  const lines = text.split(/\r?\n/);
  const segments = [];
  const numberPattern = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  const ignoredPointValue = -9e91;
  let currentComponent = "polyline";

  const getComponentName = (line) => {
    return line.trim().match(POLYLINE_TEXT_COMPONENT_PATTERN)?.[1] || "";
  };

  const isComponentHeader = (line) => Boolean(getComponentName(line));

  const parseCoordinateLine = (line) => {
    if (!/^[\s+\-.0-9eE]+$/.test(line)) return null;

    const numbers = line.match(numberPattern)?.map(Number) || [];
    if (numbers.length < 3) return null;

    const coords = numbers.slice(-3);
    if (
      coords.some(
        (coord) =>
          !Number.isFinite(coord) || Math.abs(coord - ignoredPointValue) < 1e80
      )
    ) {
      return null;
    }

    return { x: coords[0], y: coords[1], z: coords[2] };
  };

  const collectPoints = (startIndex, nodeCount = 0) => {
    const points = [];
    let nextIndex = startIndex;

    while (nextIndex < lines.length) {
      const candidateLine = lines[nextIndex];
      if (nextIndex !== startIndex && isComponentHeader(candidateLine)) break;

      const point = parseCoordinateLine(candidateLine);
      if (point) points.push(point);
      nextIndex += 1;
    }

    return { points, nextIndex };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const componentMatch = line.match(POLYLINE_TEXT_COMPONENT_PATTERN);
    if (componentMatch) {
      currentComponent = componentMatch[1].trim();
    }

    const nodeMatch = line.match(/nodeCount\s*=\s*(\d+)/i);
    const gingivalMatch = line.match(/^GingivalPoints\s+(\d+)/i);
    const nodeCount = Number(nodeMatch?.[1] ?? gingivalMatch?.[1] ?? 0);

    if (!componentMatch && !nodeCount) continue;
    if ((nodeMatch || gingivalMatch) && nodeCount === 0) continue;

    const startIndex = i + 1;
    const { points, nextIndex } = collectPoints(startIndex, nodeCount);
    if (points.length >= 2) {
      segments.push(createPolylineSegment(points, currentComponent));
    }

    i = Math.max(i, nextIndex - 1);
  }

  polylineDiagnostics.textParseMs += performance.now() - textParseStartedAt;
  polylineDiagnostics.textParseCount += 1;
  return segments;
}

function extractPolylineSegments(candidate) {
  if (!candidate) return [];

  if (typeof candidate === "string") {
    const textSegments = parsePolylineTextSegments(candidate);
    if (textSegments.length) return textSegments;

    try {
      return extractPolylineSegments(JSON.parse(candidate));
    } catch {
      return [];
    }
  }

  if (Array.isArray(candidate)) {
    const points = candidate.map(toPointObject).filter(isValidPoint);
    if (points.length === candidate.length && points.length) {
      return [createPolylineSegment(points)];
    }

    return candidate.flatMap((entry) => extractPolylineSegments(entry));
  }

  if (typeof candidate === "object") {
    const dataSegments = parsePolylineTextSegments(candidate.data);
    if (dataSegments.length) return dataSegments;

    const directPoints = extractPointArray(candidate);
    if (directPoints.length) {
      return [
        createPolylineSegment(
          directPoints,
          getPolylineComponentName(candidate)
        ),
      ];
    }

    const nestedKeys = [
      "points",
      "polyline",
      "polylines",
      "vertices",
      "coordinates",
      "coords",
      "data",
      "json",
      "upper",
      "lower",
      "upper_jaw",
      "lower_jaw",
      "upperJaw",
      "lowerJaw",
      "maxillary",
      "mandibular",
    ];

    return nestedKeys.flatMap((key) => extractPolylineSegments(candidate[key]));
  }

  return [];
}

function getLoadedPolylineJawKeys() {
  const keys = new Set();
  parentObject.children.forEach((child) => {
    // Which of the CASE's jaws are loaded — an uploaded slot STL is not one.
    if (child.userData?.isDesignSlot) return;
    const jawKey = normalizeJawKey(child.userData?.jaw_type ?? child.name);
    if (jawKey) keys.add(jawKey);
  });
  return Array.from(keys);
}

function isPolylineJawLoaded(jawKey, loadedJawKeys) {
  return !loadedJawKeys.length || loadedJawKeys.includes(jawKey);
}

function getPolylineSegmentSignature(segment) {
  const component = getSegmentComponent(segment);
  const points = getSegmentPoints(segment);
  const pointSignature = points.map(getPolylinePointSignature).join("|");
  return `${component}:${points.length}:${pointSignature}`;
}

function inferPolylineArrayJawKey(entry, index, total, loadedJawKeys) {
  const explicitJawKey = normalizeJawKey(
    entry?.jaw_type ??
      entry?.jawType ??
      entry?.arch ??
      entry?.type ??
      entry?.jaws
  );
  if (explicitJawKey) return explicitJawKey;

  if (loadedJawKeys.length === 1) return loadedJawKeys[0];

  if (total >= 2) {
    const positionalJawKey = index === 0 ? "upper" : index === 1 ? "lower" : null;
    if (positionalJawKey && isPolylineJawLoaded(positionalJawKey, loadedJawKeys)) {
      return positionalJawKey;
    }
  }

  return null;
}

function normalizePolylineResponse(rawResponse) {
  const normalized = {
    upper: [],
    lower: [],
  };
  const loadedJawKeys = getLoadedPolylineJawKeys();
  const seenSegmentSignatures = {
    upper: new Set(),
    lower: new Set(),
  };

  const assignSegments = (jawKey, candidate) => {
    const segments = extractPolylineSegments(candidate);
    if (!jawKey || !segments.length || !isPolylineJawLoaded(jawKey, loadedJawKeys)) {
      return;
    }
    segments.forEach((segment) => {
      const signature = getPolylineSegmentSignature(segment);
      if (seenSegmentSignatures[jawKey].has(signature)) return;
      seenSegmentSignatures[jawKey].add(signature);
      normalized[jawKey].push(segment);
    });
  };

  if (!rawResponse) {
    return normalized;
  }

  if (Array.isArray(rawResponse)) {
    rawResponse.forEach((entry, index) => {
      const jawKey = inferPolylineArrayJawKey(
        entry,
        index,
        rawResponse.length,
        loadedJawKeys
      );
      assignSegments(jawKey, entry);
    });
    return normalized;
  }

  if (typeof rawResponse === "object") {
    const upperCandidate =
      rawResponse.upper ??
      rawResponse.upper_jaw ??
      rawResponse.upperJaw ??
      rawResponse.maxillary;
    const lowerCandidate =
      rawResponse.lower ??
      rawResponse.lower_jaw ??
      rawResponse.lowerJaw ??
      rawResponse.mandibular;

    assignSegments("upper", upperCandidate);
    assignSegments("lower", lowerCandidate);

    const fallbackJawKey = normalizeJawKey(
      rawResponse.jaw_type ??
        rawResponse.jawType ??
        rawResponse.arch ??
        rawResponse.type ??
        rawResponse.jaws
    );

    if (upperCandidate === undefined && lowerCandidate === undefined) {
      assignSegments(fallbackJawKey, rawResponse);
    }
  }

  return normalized;
}

function getPolylineSegmentColor(component, segmentIndex) {
  if (/omit\s*reference/i.test(component || "")) {
    return 0x9ca3af;
  }

  if (/gingival.*relevant/i.test(component || "")) {
    return 0xff8a00;
  }

  if (/major\s*(connector|conn)/i.test(component || "")) {
    return 0x8b5cf6;
  }

  if (/reversal/i.test(component || "")) {
    return 0xff1f1f;
  }

  if (/retainer/i.test(component || "")) {
    return 0xff4f81;
  }

  if (/tissue\s*stop/i.test(component || "")) {
    return 0x2dd4bf;
  }

  if (/proximal\s*plate/i.test(component || "")) {
    return 0x38bdf8;
  }

  if (/lingual\s*clasp/i.test(component || "")) {
    return 0xf97316;
  }

  if (/minor\s*(connector|conn)/i.test(component || "")) {
    return 0x22c55e;
  }

  if (/^mesh$/i.test(component || "")) {
    return 0x0891b2;
  }

  if (/rest/i.test(component || "")) {
    return 0xffd400;
  }

  const text = String(component || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return POLYLINE_COMPONENT_COLORS[hash % POLYLINE_COMPONENT_COLORS.length];
}

function isGingivalPolylineComponent(component) {
  return /gingival/i.test(component || "");
}

function isMeshPolylineComponent(component) {
  return /^mesh$/i.test(component || "");
}

function shouldSeatPolylineComponentOnJaw(component) {
  return /minor\s*(connector|conn)/i.test(component || "");
}

function getJawMeshForPolyline(jawType) {
  const jawText = jawType.toLowerCase();
  return parentObject.children.find((child) => {
    // Slot STLs share this list and are added FIRST, so an unfiltered search
    // returns one and the polylines inherit its transform, not the case jaw's.
    if (child.userData?.isDesignSlot) return false;
    const type = String(child.userData?.jaw_type || child.name || "").toLowerCase();
    return type.includes(jawText);
  });
}

function applyJawTransformToPolylineGroup(group, jawType, coordinateSpace = "jaw-local") {
  if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE && coordinateSpace === "scene-world") {
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
    return;
  }

  const jawMesh = getJawMeshForPolyline(jawType);
  if (!jawMesh) return;

  group.position.copy(jawMesh.position);
  group.rotation.copy(jawMesh.rotation);
  group.scale.copy(jawMesh.scale);
}

function getDistanceBetweenPoints(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function getPolylineDistanceStats(points) {
  const distances = [];
  for (let index = 1; index < points.length; index += 1) {
    const distance = getDistanceBetweenPoints(points[index - 1], points[index]);
    if (Number.isFinite(distance) && distance > 0) distances.push(distance);
  }

  if (!distances.length) {
    return {
      length: 0,
      median: 0,
      p90: 0,
      max: 0,
      maxIndex: null,
    };
  }

  const sorted = [...distances].sort((a, b) => a - b);
  let max = -Infinity;
  let maxIndex = null;
  distances.forEach((distance, index) => {
    if (distance > max) {
      max = distance;
      maxIndex = index + 1;
    }
  });

  return {
    length: distances.reduce((sum, distance) => sum + distance, 0),
    median: sorted[Math.floor(sorted.length / 2)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    max,
    maxIndex,
  };
}

function getMissingConsecutivePolylineEdges(pointCount, edges) {
  const renderedEdgeKeys = new Set(
    (edges || []).map(([startIndex, endIndex]) => `${startIndex}:${endIndex}`)
  );
  const missing = [];
  for (let index = 1; index < pointCount; index += 1) {
    if (!renderedEdgeKeys.has(`${index - 1}:${index}`)) {
      missing.push(index);
    }
  }
  return missing;
}

function getPolylineCourseSummary(points, edges = null) {
  const stats = getPolylineDistanceStats(points);
  const missingEdges = edges ? getMissingConsecutivePolylineEdges(points.length, edges) : [];
  const jumpRatio = stats.median > 0 ? stats.max / stats.median : 0;

  return {
    pointCount: points.length,
    renderedEdgeCount: edges?.length ?? null,
    missingEdgeCount: missingEdges.length,
    missingEdgeIndices: missingEdges.slice(0, 8),
    length: Number(stats.length.toFixed(3)),
    medianSegment: Number(stats.median.toFixed(3)),
    p90Segment: Number(stats.p90.toFixed(3)),
    maxSegment: Number(stats.max.toFixed(3)),
    maxSegmentIndex: stats.maxIndex,
    maxToMedianRatio: Number(jumpRatio.toFixed(2)),
  };
}

function getClosestJawPolylineSurfacePoint(jawType, point, coordinateSpace = "jaw-local") {
  const jawMesh = getJawMeshForPolyline(jawType);
  const position = jawMesh?.geometry?.attributes?.position;
  if (!position || !isValidPoint(point)) return null;

  jawMesh.updateMatrixWorld(true);
  let bestPoint = null;
  let bestDistanceSq = Infinity;
  const stride = Math.max(1, Math.floor(position.count / 30000));
  const candidateVector = new THREE.Vector3();

  for (let index = 0; index < position.count; index += stride) {
    candidateVector.set(
      position.getX(index),
      position.getY(index),
      position.getZ(index)
    );
    if (coordinateSpace === "scene-world") {
      jawMesh.localToWorld(candidateVector);
    }
    const candidate = { x: candidateVector.x, y: candidateVector.y, z: candidateVector.z };
    const dx = point.x - candidate.x;
    const dy = point.y - candidate.y;
    const dz = point.z - candidate.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestPoint = candidate;
    }
  }

  return bestPoint ? { point: bestPoint, distance: Math.sqrt(bestDistanceSq) } : null;
}

function getPolylineSamplePoints(points, limit = 24) {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)]);
}

function getMedianDistanceToJaw(points, jawType, coordinateSpace) {
  const distances = getPolylineSamplePoints(points)
    .map((point) => getClosestJawPolylineSurfacePoint(jawType, point, coordinateSpace)?.distance)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!distances.length) return Infinity;
  return distances[Math.floor(distances.length / 2)];
}

function detectPolylineCoordinateSpace(points, jawType, component) {
  if (points.length < 2 || !getJawMeshForPolyline(jawType)) {
    return {
      coordinateSpace: "jaw-local",
      localMedianDistance: null,
      worldMedianDistance: null,
    };
  }

  const localMedianDistance = getMedianDistanceToJaw(points, jawType, "jaw-local");
  const worldMedianDistance = getMedianDistanceToJaw(points, jawType, "scene-world");
  const coordinateSpace =
    worldMedianDistance + 0.35 < localMedianDistance * 0.72
      ? "scene-world"
      : "jaw-local";

  if (coordinateSpace === "scene-world") {
    console.log("[polyline] detected scene-world coordinates", {
      arch: jawType,
      component,
      localMedianDistance: Number(localMedianDistance.toFixed(3)),
      worldMedianDistance: Number(worldMedianDistance.toFixed(3)),
    });
  }

  return { coordinateSpace, localMedianDistance, worldMedianDistance };
}

function seatPolylinePointsOnJaw(points, jawType, component, coordinateSpace = "jaw-local") {
  if (!shouldSeatPolylineComponentOnJaw(component) || points.length < 2) {
    return { points, snappedCount: 0, maxDistance: 0 };
  }

  let snappedCount = 0;
  let maxDistance = 0;
  const seatedPoints = points.map((point) => {
    const closest = getClosestJawPolylineSurfacePoint(jawType, point, coordinateSpace);
    if (!closest) return point;

    maxDistance = Math.max(maxDistance, closest.distance);
    if (closest.distance <= 0.65) return point;

    snappedCount += 1;
    const surfacePoint = closest.point;
    const direction = {
      x: point.x - surfacePoint.x,
      y: point.y - surfacePoint.y,
      z: point.z - surfacePoint.z,
    };
    const length = Math.max(
      0.0001,
      Math.hypot(direction.x, direction.y, direction.z)
    );
    const offset = Math.min(Math.max(POLYLINE_TUBE_RADIUS * 0.45, 0.22), 0.45);
    return {
      x: surfacePoint.x + (direction.x / length) * offset,
      y: surfacePoint.y + (direction.y / length) * offset,
      z: surfacePoint.z + (direction.z / length) * offset,
    };
  });

  return { points: seatedPoints, snappedCount, maxDistance };
}

function getPolylineTurnCosine(previous, current, next) {
  const ax = current.x - previous.x;
  const ay = current.y - previous.y;
  const az = current.z - previous.z;
  const bx = next.x - current.x;
  const by = next.y - current.y;
  const bz = next.z - current.z;
  const aLength = Math.hypot(ax, ay, az);
  const bLength = Math.hypot(bx, by, bz);

  if (!aLength || !bLength) return 1;
  return (ax * bx + ay * by + az * bz) / (aLength * bLength);
}

function getPolylineRenderableEdges(points, component) {
  if (points.length < 2) return [];
  if (points.length < 3) return [[0, 1]];

  const isGingival = isGingivalPolylineComponent(component);
  const isMesh = isMeshPolylineComponent(component);
  const distances = [];
  for (let i = 1; i < points.length; i += 1) {
    const distance = getDistanceBetweenPoints(points[i - 1], points[i]);
    if (Number.isFinite(distance) && distance > 0) {
      distances.push(distance);
    }
  }

  if (!distances.length) {
    return points.slice(1).map((_, index) => [index, index + 1]);
  }

  const sortedDistances = [...distances].sort((a, b) => a - b);
  const medianDistance = sortedDistances[Math.floor(sortedDistances.length / 2)];
  const highDistance = sortedDistances[Math.floor(sortedDistances.length * 0.9)];
  const jumpThreshold = isGingival
    ? Math.max(medianDistance * 3.5, highDistance * 0.65, 5)
    : isMesh
      ? Math.max(medianDistance * 2.8, highDistance * 0.7, 3)
      : Math.max(medianDistance * 8, 12);
  const turnThreshold = Math.max(medianDistance * (isMesh ? 1.8 : 2.2), 4);
  const edges = [];

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const distance = getDistanceBetweenPoints(previous, current);
    const previousTurnCosine =
      (isGingival || isMesh) && i > 1
        ? getPolylineTurnCosine(points[i - 2], previous, current)
        : 1;
    const nextTurnCosine =
      (isGingival || isMesh) && i < points.length - 1
        ? getPolylineTurnCosine(previous, current, points[i + 1])
        : 1;
    const isSuspiciousGingivalTurn =
      isGingival &&
      distance > turnThreshold &&
      (previousTurnCosine < -0.5 || nextTurnCosine < -0.5);
    const isSuspiciousMeshTurn =
      isMesh &&
      distance > turnThreshold &&
      (previousTurnCosine < -0.25 || nextTurnCosine < -0.25);

    if (
      distance <= jumpThreshold &&
      !isSuspiciousGingivalTurn &&
      !isSuspiciousMeshTurn
    ) {
      edges.push([i - 1, i]);
    }
  }

  return edges;
}

function getPositionAttributePoint(positionAttribute, index) {
  return new THREE.Vector3(
    positionAttribute.getX(index),
    positionAttribute.getY(index),
    positionAttribute.getZ(index)
  );
}

function createPolylineTubeGeometryBetweenPoints(start, end) {
  const curve = new THREE.LineCurve3(start, end);
  return new THREE.TubeGeometry(
    curve,
    1,
    POLYLINE_TUBE_RADIUS,
    POLYLINE_TUBE_RADIAL_SEGMENTS,
    false
  );
}

function createPolylineTubeGeometry(positionAttribute, startIndex, endIndex) {
  return createPolylineTubeGeometryBetweenPoints(
    getPositionAttributePoint(positionAttribute, startIndex),
    getPositionAttributePoint(positionAttribute, endIndex)
  );
}

function addPolylineTube(
  tubeGroup,
  geometry,
  material,
  jawType,
  component,
  componentKey,
  segmentIndex,
  edgeIndex
) {
  const tube = new THREE.Mesh(geometry, material.clone());
  tube.material.depthTest = polylineDepthTestEnabled;
  tube.material.needsUpdate = true;
  tube.name = `${jawType}-${component}-polyline-segment-${segmentIndex}-tube-${edgeIndex}`;
  tube.renderOrder = 20;
  tube.userData = {
    overlayType: "polyline-tube",
    arch: jawType,
    component,
    componentKey,
    segmentIndex,
    edgeIndex,
  };
  tubeGroup.add(tube);
}

function syncPolylineTubeGeometries(tubeGroup) {
  const positionAttribute = tubeGroup.userData.sourcePositionAttribute;
  const edges = tubeGroup.userData.edges || [];
  if (!positionAttribute) return;

  tubeGroup.children.forEach((tube, index) => {
    const edge = edges[index];
    if (!edge) return;

    const nextGeometry = createPolylineTubeGeometry(
      positionAttribute,
      edge[0],
      edge[1]
    );
    tube.geometry?.dispose?.();
    tube.geometry = nextGeometry;
    tube.geometry.computeBoundingSphere();
  });
}

function createPolylineObjects(jawType, segment, segmentIndex) {
  const component = getSegmentComponent(segment);
  const rawPoints = getSegmentPoints(segment);
  const coordinateDetection = detectPolylineCoordinateSpace(rawPoints, jawType, component);
  const seating = seatPolylinePointsOnJaw(
    rawPoints,
    jawType,
    component,
    coordinateDetection.coordinateSpace
  );
  const points = seating.points;
  const componentKey = getPolylineComponentKey(jawType, component);
  const edges = getSegmentRenderableEdges(segment, points, component);
  const apiCourseSummary = getPolylineCourseSummary(rawPoints);
  const renderedCourseSummary = getPolylineCourseSummary(points, edges);
  const positionArray = new Float32Array(points.length * 3);
  const apiPositionArray = new Float32Array(rawPoints.length * 3);
  rawPoints.forEach((point, index) => {
    apiPositionArray[index * 3] = point.x;
    apiPositionArray[index * 3 + 1] = point.y;
    apiPositionArray[index * 3 + 2] = point.z;
  });
  points.forEach((point, index) => {
    positionArray[index * 3] = point.x;
    positionArray[index * 3 + 1] = point.y;
    positionArray[index * 3 + 2] = point.z;
  });
  const positionAttribute = new THREE.BufferAttribute(positionArray, 3);
  const group = new THREE.Group();
  group.name = `${jawType}-${component}-polyline-segment-${segmentIndex}`;
  group.visible = isPolylineOverlayVisible &&
    isPolylineJawVisible(jawType) &&
    (polylineComponentVisibility.get(componentKey) ?? true);
  group.userData = {
    overlayType: "polyline",
    arch: jawType,
    component,
    componentKey,
    segmentIndex,
    coordinateSpace: coordinateDetection.coordinateSpace,
    localMedianSurfaceDistance: coordinateDetection.localMedianDistance,
    worldMedianSurfaceDistance: coordinateDetection.worldMedianDistance,
    surfaceSeated: seating.snappedCount > 0,
    surfaceSeatedPointCount: seating.snappedCount,
    maxSurfaceDistance: seating.maxDistance,
    apiCourseSummary,
    renderedCourseSummary,
    apiPositionArray,
    originalPositionArray: positionArray.slice(),
    positionAttribute,
  };

  if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE && seating.snappedCount > 0) {
    console.log("[polyline] seated component on jaw surface", {
      arch: jawType,
      component,
      segmentIndex,
      coordinateSpace: coordinateDetection.coordinateSpace,
      snappedPoints: seating.snappedCount,
      maxDistance: Number(seating.maxDistance.toFixed(3)),
    });
  }

  if (points.length >= 2) {
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: getPolylineSegmentColor(component, segmentIndex),
      transparent: false,
      opacity: 1,
      roughness: 0.28,
      metalness: 0,
      depthTest: polylineDepthTestEnabled,
      depthWrite: false,
    });
    const tubeGroup = new THREE.Group();
    tubeGroup.name = `${jawType}-${component}-polyline-segment-${segmentIndex}-tubes`;
    tubeGroup.renderOrder = 20;
    tubeGroup.userData = {
      overlayType: "polyline-line",
      arch: jawType,
      component,
      componentKey,
      segmentIndex,
      edges,
      tubeMaterial,
      sourcePositionAttribute: positionAttribute,
    };
    edges.forEach(([startIndex, endIndex], edgeIndex) => {
      addPolylineTube(
        tubeGroup,
        createPolylineTubeGeometry(positionAttribute, startIndex, endIndex),
        tubeMaterial,
        jawType,
        component,
        componentKey,
        segmentIndex,
        edgeIndex
      );
    });
    group.add(tubeGroup);
  }

  if (points.length >= 1) {
    const handles = new THREE.Group();
    handles.name = `${jawType}-${component}-polyline-segment-${segmentIndex}-handles`;
    handles.renderOrder = 21;
    handles.userData = {
      overlayType: "polyline-edit-points",
      arch: jawType,
      component,
      componentKey,
      segmentIndex,
      positionAttribute,
    };

    points.forEach((point, index) => {
      const handleMaterial = polylineHandleMaterial.clone();
      handleMaterial.color.setHex(getPolylineSegmentColor(component, segmentIndex));
      handleMaterial.depthTest = polylineDepthTestEnabled;
      handleMaterial.needsUpdate = true;
      const handle = new THREE.Mesh(
        polylineHandleGeometry,
        handleMaterial
      );
      handle.name = `${jawType}-${component}-polyline-segment-${segmentIndex}-point-${index}`;
      handle.position.set(point.x, point.y, point.z);
      handle.renderOrder = 21;
      handle.userData = {
        overlayType: "polyline-edit-point",
        arch: jawType,
        component,
        componentKey,
        segmentIndex,
        index,
        handleGroup: handles,
        positionAttribute,
      };
      handles.add(handle);
    });

    group.add(handles);
  }

  applyJawTransformToPolylineGroup(group, jawType, coordinateDetection.coordinateSpace);

  return group;
}

function renderPolylineData(polylineByJaw) {
  clearPolylineOverlay();

  ["upper", "lower"].forEach((jawType) => {
    const segments = polylineByJaw[jawType] || [];
    segments.forEach((segment, segmentIndex) => {
      const points = getSegmentPoints(segment);
      if (points.length < 2) return;
      const polylineGroup = createPolylineObjects(jawType, segment, segmentIndex);
      polylineOverlayGroup.add(polylineGroup);
    });
  });
  updatePolylineComponentMenu();
  auditRenderedPolylines({ logToConsole: LOG_POLYLINE_AUTO_AUDITS_TO_CONSOLE });
}

function resetPolylineGroup(polylineGroup) {
  const originalPositionArray = polylineGroup.userData?.originalPositionArray;
  const positionAttribute = polylineGroup.userData?.positionAttribute;
  if (!originalPositionArray || !positionAttribute) return;

  for (let index = 0; index < positionAttribute.count; index += 1) {
    positionAttribute.setXYZ(
      index,
      originalPositionArray[index * 3],
      originalPositionArray[index * 3 + 1],
      originalPositionArray[index * 3 + 2]
    );
  }
  positionAttribute.needsUpdate = true;

  polylineGroup.traverse((child) => {
    if (child.userData?.overlayType === "polyline-edit-point") {
      const pointIndex = child.userData.index;
      child.position.set(
        positionAttribute.getX(pointIndex),
        positionAttribute.getY(pointIndex),
        positionAttribute.getZ(pointIndex)
      );
    } else if (child.userData?.overlayType === "polyline-line") {
      syncPolylineTubeGeometries(child);
    } else {
      child.geometry?.computeBoundingSphere?.();
    }
  });
}

function capturePolylineSnapshot() {
  return polylineOverlayGroup.children
    .filter((g) => g.userData?.overlayType === "polyline")
    .map((group) => ({
      group,
      data: group.userData.positionAttribute?.array.slice(),
    }))
    .filter((s) => s.data);
}

function applyPolylineSnapshot(snapshot) {
  snapshot.forEach(({ group, data }) => {
    const posAttr = group.userData?.positionAttribute;
    if (!posAttr || posAttr.array.length !== data.length) return;
    posAttr.array.set(data);
    posAttr.needsUpdate = true;
    group.traverse((child) => {
      if (child.userData?.overlayType === "polyline-edit-point") {
        const idx = child.userData.index;
        child.position.set(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
      } else if (child.userData?.overlayType === "polyline-line") {
        syncPolylineTubeGeometries(child);
      } else {
        child.geometry?.computeBoundingSphere?.();
      }
    });
  });
}

function updatePolylineUndoRedoButtons() {
  if (polylineUndoBtn) polylineUndoBtn.disabled = polylineUndoStack.length === 0;
  if (polylineRedoBtn) polylineRedoBtn.disabled = polylineRedoStack.length === 0;
}

function resetPolylineEdits() {
  polylineUndoStack.length = 0;
  polylineRedoStack.length = 0;
  updatePolylineUndoRedoButtons();
  polylineOverlayGroup.children.forEach(resetPolylineGroup);
  auditRenderedPolylines({ logToConsole: LOG_POLYLINE_AUTO_AUDITS_TO_CONSOLE });
}

function countPolylinePoints(segments) {
  return segments.reduce(
    (total, segment) => total + getSegmentPoints(segment).length,
    0
  );
}

function getPointsFromPackedPositionArray(positionArray) {
  const points = [];
  if (!positionArray?.length) return points;
  for (let index = 0; index + 2 < positionArray.length; index += 3) {
    const point = {
      x: positionArray[index],
      y: positionArray[index + 1],
      z: positionArray[index + 2],
    };
    if (isValidPoint(point)) points.push(point);
  }
  return points;
}

function getPointsFromPositionAttribute(positionAttribute) {
  const points = [];
  if (!positionAttribute?.count) return points;
  for (let index = 0; index < positionAttribute.count; index += 1) {
    const point = {
      x: positionAttribute.getX(index),
      y: positionAttribute.getY(index),
      z: positionAttribute.getZ(index),
    };
    if (isValidPoint(point)) points.push(point);
  }
  return points;
}

function getPolylineAuditIssues(group, apiSummary, renderedSummary) {
  const issues = [];
  const localDistance = group.userData?.localMedianSurfaceDistance;
  const worldDistance = group.userData?.worldMedianSurfaceDistance;
  const maxSurfaceDistance = group.userData?.maxSurfaceDistance;
  const coordinateSpace = group.userData?.coordinateSpace;

  if (renderedSummary.missingEdgeCount > 0) {
    issues.push(`dropped ${renderedSummary.missingEdgeCount} rendered edge(s)`);
  }
  if (apiSummary.maxToMedianRatio >= 6 && apiSummary.maxSegment > 8) {
    issues.push(`API jump at point ${apiSummary.maxSegmentIndex}`);
  }
  if (renderedSummary.maxToMedianRatio >= 6 && renderedSummary.maxSegment > 8) {
    issues.push(`rendered jump at point ${renderedSummary.maxSegmentIndex}`);
  }
  if (
    Number.isFinite(localDistance) &&
    Number.isFinite(worldDistance) &&
    Math.abs(localDistance - worldDistance) < 0.75
  ) {
    issues.push("coordinate space is close/ambiguous");
  }
  if (
    coordinateSpace === "jaw-local" &&
    Number.isFinite(localDistance) &&
    localDistance > 6
  ) {
    issues.push(`far from jaw in jaw-local (${localDistance.toFixed(2)})`);
  }
  if (
    coordinateSpace === "scene-world" &&
    Number.isFinite(worldDistance) &&
    worldDistance > 6
  ) {
    issues.push(`far from jaw in scene-world (${worldDistance.toFixed(2)})`);
  }
  if (Number.isFinite(maxSurfaceDistance) && maxSurfaceDistance > 8) {
    issues.push(`large surface seating distance (${maxSurfaceDistance.toFixed(2)})`);
  }

  return issues;
}

function auditRenderedPolylines({ logToConsole = true } = {}) {
  const rows = [];
  polylineOverlayGroup.children.forEach((group) => {
    if (group.userData?.overlayType !== "polyline") return;

    const tubeGroup = group.children.find(
      (child) => child.userData?.overlayType === "polyline-line"
    );
    const edges = tubeGroup?.userData?.edges || [];
    const apiPoints = getPointsFromPackedPositionArray(group.userData?.apiPositionArray);
    const renderedPoints = getPointsFromPositionAttribute(group.userData?.positionAttribute);
    const apiSummary = getPolylineCourseSummary(apiPoints);
    const renderedSummary = getPolylineCourseSummary(renderedPoints, edges);
    const issues = getPolylineAuditIssues(group, apiSummary, renderedSummary);

    rows.push({
      arch: group.userData.arch,
      component: group.userData.component,
      segment: group.userData.segmentIndex,
      coordinateSpace: group.userData.coordinateSpace,
      apiPoints: apiSummary.pointCount,
      renderedEdges: renderedSummary.renderedEdgeCount,
      missingEdges: renderedSummary.missingEdgeCount,
      apiMaxSegment: apiSummary.maxSegment,
      renderedMaxSegment: renderedSummary.maxSegment,
      localMedianSurfaceDistance: Number.isFinite(group.userData.localMedianSurfaceDistance)
        ? Number(group.userData.localMedianSurfaceDistance.toFixed(3))
        : null,
      worldMedianSurfaceDistance: Number.isFinite(group.userData.worldMedianSurfaceDistance)
        ? Number(group.userData.worldMedianSurfaceDistance.toFixed(3))
        : null,
      surfaceSeatedPoints: group.userData.surfaceSeatedPointCount || 0,
      issueCount: issues.length,
      issues: issues.join("; "),
      apiSummary,
      renderedSummary,
    });
  });

  rows.sort((a, b) => b.issueCount - a.issueCount || a.arch.localeCompare(b.arch));
  window.lastPolylineAudit = rows;
  if (!logToConsole) return rows;
  if (rows.length) {
    console.table(
      rows.map(({ apiSummary, renderedSummary, ...row }) => row)
    );
  } else {
    console.log("[polyline] audit found no rendered polylines.");
  }
  return rows;
}

function syncPolylineOverlayVisibility() {
  polylineOverlayGroup.visible = true;
  polylineOverlayGroup.children.forEach((group) => {
    const key = group.userData?.componentKey;
    const arch = group.userData?.arch;
    group.visible =
      isPolylineOverlayVisible &&
      isPolylineJawVisible(arch) &&
      (polylineComponentVisibility.get(key) ?? true);
    applyPolylineJawOpacity(arch);
  });

  syncPolylineFocusMode();
}

window.auditPolylines = auditRenderedPolylines;

function getPolylineComponentSummary() {
  const summary = new Map();
  polylineOverlayGroup.children.forEach((group) => {
    const key = group.userData?.componentKey;
    if (!key) return;

    const current = summary.get(key) || {
      key,
      color: getPolylineSegmentColor(group.userData.component, 0),
      segments: 0,
      points: 0,
    };
    current.segments += 1;
    current.points += group.userData.positionAttribute?.count || 0;
    summary.set(key, current);
  });

  const loadedArches = new Set();
  polylineOverlayGroup.children.forEach((group) => {
    const arch = group.userData?.arch;
    if (arch) loadedArches.add(arch);
  });
  if (!loadedArches.size) {
    getLoadedPolylineJawKeys().forEach((arch) => loadedArches.add(arch));
  }
  if (!loadedArches.size) {
    loadedArches.add("upper");
    loadedArches.add("lower");
  }

  loadedArches.forEach((arch) => {
    POLYLINE_APP_COMPONENTS.forEach((component) => {
      const key = getPolylineComponentKey(arch, component);
      if (summary.has(key)) return;
      summary.set(key, {
        key,
        color: getPolylineSegmentColor(component, 0),
        segments: 0,
        points: 0,
      });
    });
  });

  return Array.from(summary.values()).sort((a, b) => {
    const rankDelta =
      getPolylineComponentSortRank(a.key) - getPolylineComponentSortRank(b.key);
    if (rankDelta) return rankDelta;
    return formatPolylineComponentLabel(a.key).localeCompare(
      formatPolylineComponentLabel(b.key)
    );
  });
}

function updatePolylineComponentMenu() {
  const summary = getPolylineComponentSummary().filter(({ points }) => points > 0);
  summary.forEach(({ key }) => {
    if (!polylineComponentVisibility.has(key)) {
      polylineComponentVisibility.set(
        key,
        isPolylineComponentVisibleByDefault(key)
      );
    }
  });

  if (!polylineMenuList) return;

  polylineMenuList.replaceChildren();
  if (!summary.length) {
    isPolylineOverlayVisible = false;
    const empty = document.createElement("div");
    empty.textContent = "No polyline components";
    empty.style.padding = "8px 0";
    empty.style.color = "#6b7280";
    polylineMenuList.appendChild(empty);
    syncPolylineOverlayVisibility();
    window.syncComponentPanelRows?.();
    return;
  }

  isPolylineOverlayVisible = Array.from(
    polylineComponentVisibility.values()
  ).some(Boolean);

  summary.forEach(({ key, color, segments, points }) => {
    const row = document.createElement("label");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "18px 14px 1fr";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "6px 0";
    row.style.cursor = "pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = polylineComponentVisibility.get(key) ?? true;
    checkbox.addEventListener("change", () => {
      polylineComponentVisibility.set(key, checkbox.checked);
      isPolylineOverlayVisible = Array.from(
        polylineComponentVisibility.values()
      ).some(Boolean);
      syncPolylineOverlayVisibility();
    });

    const swatch = document.createElement("span");
    swatch.style.width = "14px";
    swatch.style.height = "14px";
    swatch.style.borderRadius = "50%";
    swatch.style.background = `#${color.toString(16).padStart(6, "0")}`;
    swatch.style.display = "inline-block";

    const text = document.createElement("span");
    text.textContent = `${formatPolylineComponentLabel(key)} (${segments} seg, ${points} pts)`;
    text.style.fontSize = "15px";
    text.style.lineHeight = "1.3";

    row.appendChild(checkbox);
    row.appendChild(swatch);
    row.appendChild(text);
    polylineMenuList.appendChild(row);
  });

  syncPolylineOverlayVisibility();
  window.syncComponentPanelRows?.();
}

function setPolylineMenuVisibility(filterSummaryItem, isVisible) {
  getPolylineComponentSummary().forEach((summaryItem) => {
    if (filterSummaryItem(summaryItem)) {
      polylineComponentVisibility.set(summaryItem.key, isVisible);
    }
  });
  isPolylineOverlayVisible = Array.from(polylineComponentVisibility.values()).some(
    Boolean
  );
  updatePolylineComponentMenu();
}

// The panel has no toggle of its own — it is opened from the polyline rows of
// the objects panel (see window.polylinePanelController).
function createPolylineVisibilityToggle(container, domElement) {
  if (document.getElementById("polyline-visibility-panel")) return;

  const _polylineBp = getAppBasePath();

  const panel = document.createElement("div");
  panel.id = "polyline-visibility-panel";
  panel.style.display = "none";
  panel.style.position = "absolute";
  panel.style.right = "20px";
  panel.style.top = "50%";
  panel.style.transform = "translateY(-50%)";
  panel.style.zIndex = "1002";
  panel.style.width = "min(360px, calc(100vw - 40px))";
  panel.style.maxHeight = "calc(100% - 40px)";
  panel.style.overflow = "auto";
  panel.style.background = "rgba(20, 20, 26, 0.97)";
  panel.style.color = "#f0eff4";
  panel.style.border = "1px solid rgba(255, 255, 255, 0.14)";
  panel.style.borderRadius = "10px";
  panel.style.boxShadow = "0 8px 28px rgba(0, 0, 0, 0.45)";
  panel.style.padding = "14px";
  panel.style.pointerEvents = "auto";
  panel.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  panel.addEventListener("wheel", (event) => {
    event.stopPropagation();
  });

  const updatePolylineMenuLayout = () => {
    const phone = window.innerWidth <= 768;
    const tablet = window.innerWidth <= 1024;
    const compact = window.innerWidth <= 640 || window.innerHeight <= 720;
    if (phone) {
      panel.style.left = "12px";
      panel.style.right = "auto";
      panel.style.top = "auto";
      panel.style.bottom = "calc(86px + env(safe-area-inset-bottom, 0px))";
      panel.style.transform = "none";
      panel.style.width = "min(300px, calc(100vw - 24px))";
      panel.style.maxHeight = "calc(100% - 112px)";
    } else if (tablet) {
      panel.style.left = "16px";
      panel.style.right = "auto";
      panel.style.top = "auto";
      panel.style.bottom = "calc(130px + env(safe-area-inset-bottom, 0px))";
      panel.style.transform = "none";
      panel.style.width = "min(320px, calc(100vw - 32px))";
      panel.style.maxHeight = "calc(100% - 154px)";
    } else {
      panel.style.left = "16px";
      panel.style.right = "auto";
      panel.style.top = "50%";
      panel.style.bottom = "auto";
      panel.style.transform = "translateY(-50%)";
      panel.style.width = "min(400px, calc(100vw - 240px))";
      panel.style.maxHeight = compact
        ? "calc(100% - 24px)"
        : "calc(100% - 40px)";
    }
  };

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.flexWrap = "wrap";
  actions.style.gap = "6px";
  actions.style.marginBottom = "8px";
  actions.style.position = "sticky";
  actions.style.top = "0";
  actions.style.zIndex = "1";
  actions.style.paddingBottom = "6px";
  actions.style.background = "rgba(20, 20, 26, 0.97)";

  const makeActionButton = (label, onClick) => {
    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.textContent = label;
    actionButton.style.flex = "1";
    actionButton.style.padding = "8px 10px";
    actionButton.style.border = "1px solid rgba(255, 255, 255, 0.18)";
    actionButton.style.borderRadius = "6px";
    actionButton.style.background = "rgba(255, 255, 255, 0.08)";
    actionButton.style.color = "#f0eff4";
    actionButton.style.cursor = "pointer";
    actionButton.style.fontSize = "14px";
    actionButton.addEventListener("click", onClick);
    return actionButton;
  };

  const closePolylineButton = makeActionButton("\u00d7", () => {
    panel.style.display = "none";
  });
  closePolylineButton.title = "Close polylines";
  closePolylineButton.setAttribute("aria-label", "Close polylines");
  closePolylineButton.style.flex = "0 0 44px";
  closePolylineButton.style.background = "#b91c1c";
  closePolylineButton.style.borderColor = "#ef4444";
  closePolylineButton.style.color = "#ffffff";
  closePolylineButton.style.fontSize = "20px";
  closePolylineButton.style.fontWeight = "800";
  actions.appendChild(closePolylineButton);
  let _polylineAllVisible = true;
  const _eyeToggleBtn = makeActionButton("", () => {
    _polylineAllVisible = !_polylineAllVisible;
    setPolylineMenuVisibility(() => true, _polylineAllVisible);
    _eyeToggleBtn.innerHTML = _polylineAllVisible
      ? '<i class="fa fa-eye" aria-hidden="true"></i>'
      : '<i class="fa fa-eye-slash" aria-hidden="true"></i>';
    const _lbl = _polylineAllVisible ? "Hide all" : "Show all";
    _eyeToggleBtn.title = _lbl;
    _eyeToggleBtn.setAttribute("aria-label", _lbl);
  });
  _eyeToggleBtn.innerHTML = '<i class="fa fa-eye" aria-hidden="true"></i>';
  _eyeToggleBtn.title = "Hide all";
  _eyeToggleBtn.setAttribute("aria-label", "Hide all");
  actions.appendChild(_eyeToggleBtn);
  const _resetBtn = makeActionButton("", resetPolylineEdits);
  _resetBtn.innerHTML = `<img src="${_polylineBp}/assets/reset.png" alt="Reset" style="width:22px;height:22px;object-fit:contain;display:block;margin:auto;pointer-events:none;">`;
  _resetBtn.title = "Reset polylines";
  _resetBtn.setAttribute("aria-label", "Reset polylines");
  _resetBtn.style.background = "#ffffff";
  _resetBtn.style.borderColor = "rgba(0, 0, 0, 0.18)";
  _resetBtn.style.color = "#222222";
  actions.appendChild(_resetBtn);

  const _undoBtn = makeActionButton("", () => {
    if (!polylineUndoStack.length) return;
    const snapshot = polylineUndoStack.pop();
    polylineRedoStack.push(capturePolylineSnapshot());
    applyPolylineSnapshot(snapshot);
    updatePolylineUndoRedoButtons();
  });
  _undoBtn.innerHTML = `<img src="${_polylineBp}/assets/Icon_undo2.png" alt="Undo" style="width:22px;height:22px;object-fit:contain;display:block;margin:auto;pointer-events:none;">`;
  _undoBtn.title = "Undo";
  _undoBtn.setAttribute("aria-label", "Undo");
  _undoBtn.disabled = true;
  actions.appendChild(_undoBtn);

  const _redoBtn = makeActionButton("", () => {
    if (!polylineRedoStack.length) return;
    const snapshot = polylineRedoStack.pop();
    polylineUndoStack.push(capturePolylineSnapshot());
    applyPolylineSnapshot(snapshot);
    updatePolylineUndoRedoButtons();
  });
  _redoBtn.innerHTML = `<img src="${_polylineBp}/assets/Icon_redo2.png" alt="Redo" style="width:22px;height:22px;object-fit:contain;display:block;margin:auto;pointer-events:none;">`;
  _redoBtn.title = "Redo";
  _redoBtn.setAttribute("aria-label", "Redo");
  _redoBtn.disabled = true;
  actions.appendChild(_redoBtn);

  polylineUndoBtn = _undoBtn;
  polylineRedoBtn = _redoBtn;

  const list = document.createElement("div");
  panel.appendChild(actions);
  panel.appendChild(list);

  window.addEventListener("resize", updatePolylineMenuLayout);

  (container || document.getElementById("container3D") || document.body).appendChild(panel);
  // The objects panel is rebuilt on every case/design view switch, so it
  // registers its own polyline button against these handlers each time.
  window.polylinePanelController = {
    open: () => { panel.style.display = "block"; updatePolylineMenuLayout(); },
    close: () => { panel.style.display = "none"; },
    isOpen: () => panel.style.display === "block",
  };
  updatePolylineMenuLayout();

  polylineMenuList = list;
  updatePolylineComponentMenu();
  attachPolylineDragHandlers(domElement);
}

async function fetchAndRenderPolylines(caseIntID) {
  const totalStartedAt = performance.now();
  if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.time("viewer: total polyline load");
  const fetchStartedAt = performance.now();
  if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.time("viewer: fetch polylines");
  let isPolylineFetchTimerActive = true;
  let isPolylineNormalizeTimerActive = false;
  let isPolylineRenderTimerActive = false;
  let isPolylineTotalTimerActive = true;
  clearPolylineOverlay();

  const polylinePayload = [
    {
      machine_id: MACHINE_ID,
      // Fallback UUID keeps direct/shared viewer URLs able to load case assets.
      // Prefer loggedInUser.uuid if this viewer is later wired to authenticated sessions.
      uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
      caseIntID,
    },
    {
      case_id: caseIntID,
    },
  ];

  try {
    const response = await apiClient.post(
      POLYLINE_ENDPOINT,
      polylinePayload,
      false,
      "Polyline"
    );
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: fetch polylines");
    addViewerLoadTiming("fetch polylines", performance.now() - fetchStartedAt);
    isPolylineFetchTimerActive = false;
    resetPolylineDiagnostics();
    const normalizeStartedAt = performance.now();
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.time("viewer: normalize polyline response");
    isPolylineNormalizeTimerActive = true;
    const normalized = normalizePolylineResponse(response);
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: normalize polyline response");
    addViewerLoadTiming(
      "normalize polyline response",
      performance.now() - normalizeStartedAt
    );
    isPolylineNormalizeTimerActive = false;
    logPolylineDiagnostics();
    const upperPointCount = countPolylinePoints(normalized.upper);
    const lowerPointCount = countPolylinePoints(normalized.lower);
    const hasAnyPoints = upperPointCount || lowerPointCount;
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) {
      console.log("[polyline] points", {
        upper: upperPointCount,
        lower: lowerPointCount,
      });
    }

    if (!hasAnyPoints) {
      if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) {
        console.log("[polyline] No polyline data returned.");
        console.timeEnd("viewer: total polyline load");
      }
      addViewerLoadTiming("total polyline load", performance.now() - totalStartedAt);
      isPolylineTotalTimerActive = false;
      return;
    }

    const renderStartedAt = performance.now();
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.time("viewer: render polylines");
    isPolylineRenderTimerActive = true;
    renderPolylineData(normalized);
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: render polylines");
    addViewerLoadTiming("render polylines", performance.now() - renderStartedAt, {
      upperPoints: upperPointCount,
      lowerPoints: lowerPointCount,
    });
    isPolylineRenderTimerActive = false;
    logViewerObjectCounts("after polyline render");
    if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: total polyline load");
    addViewerLoadTiming("total polyline load", performance.now() - totalStartedAt);
    isPolylineTotalTimerActive = false;
  } catch (error) {
    if (isPolylineFetchTimerActive) {
      if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: fetch polylines");
      addViewerLoadTiming("fetch polylines", performance.now() - fetchStartedAt, {
        status: "failed",
      });
    }
    if (isPolylineNormalizeTimerActive) {
      if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: normalize polyline response");
    }
    if (isPolylineRenderTimerActive) {
      if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: render polylines");
    }
    if (isPolylineTotalTimerActive) {
      if (LOG_POLYLINE_LOAD_DETAILS_TO_CONSOLE) console.timeEnd("viewer: total polyline load");
      addViewerLoadTiming("total polyline load", performance.now() - totalStartedAt, {
        status: "failed",
      });
    }
    console.warn("[polyline] Unable to fetch polyline data.", error);
  }
}

async function fetchAndRenderCaseOverlays(caseIntID) {
  const overlaysStartedAt = performance.now();
  startViewerLoadTimer("viewer: case overlays");
  await Promise.all([
    fetchAndRenderPolylines(caseIntID),
    artificialTeethRenderer.fetchAndRender(caseIntID),
  ]);
  endViewerLoadTimer("viewer: case overlays");
  addViewerLoadTiming("case overlays", performance.now() - overlaysStartedAt);
  logViewerObjectCounts("after case overlays");
}

function updatePointerPosition(event, domElement) {
  const bounds = domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}

function getPolylinePointHandles() {
  const handles = [];
  polylineOverlayGroup.traverse((child) => {
    if (
      child.userData?.overlayType === "polyline-edit-point" &&
      child.visible &&
      child.parent?.parent?.visible !== false
    ) {
      handles.push(child);
    }
  });
  return handles;
}

function isSolidPolylineOccluder(child) {
  if (!child.isMesh || !child.visible) return false;

  const materials = Array.isArray(child.material) ? child.material : [child.material];
  return materials.some((materialEntry) => {
    if (!materialEntry) return false;
    const opacity = materialEntry.opacity ?? 1;
    return materialEntry.depthWrite !== false && opacity > 0.95;
  });
}

function getPolylineOccluderMeshes() {
  return parentObject.children.filter(isSolidPolylineOccluder);
}

function isPolylineHandleOccluded(hit) {
  const occluders = getPolylineOccluderMeshes();
  if (!occluders.length) return false;

  const occluderHits = raycaster.intersectObjects(occluders, true);
  const nearestOccluder = occluderHits.find((item) => item.object.visible);
  return Boolean(nearestOccluder && nearestOccluder.distance < hit.distance - 0.05);
}

function pickPolylinePoint(event, domElement) {
  updatePointerPosition(event, domElement);
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(getPolylinePointHandles(), false);
  const hit = intersections.find((item) =>
    Number.isInteger(item.object?.userData?.index)
  );
  if (!hit || isPolylineHandleOccluded(hit)) return null;
  return {
    handle: hit.object,
    index: hit.object.userData.index,
    point: hit.point,
  };
}

function refreshPolylineGeometryForHandle(handle) {
  const handleGroup = handle.userData.handleGroup;
  const polylineGroup = handleGroup?.parent;
  polylineGroup?.children.forEach((child) => {
    if (child.userData?.overlayType === "polyline-line") {
      syncPolylineTubeGeometries(child);
    } else {
      child.geometry?.computeBoundingSphere?.();
    }
  });
}

function updatePolylinePointFromLocal(handle, index, localPoint, options = {}) {
  const handleGroup = handle.userData.handleGroup;
  const positionAttribute = handle.userData.positionAttribute;
  if (!positionAttribute) return;

  positionAttribute.setXYZ(index, localPoint.x, localPoint.y, localPoint.z);
  positionAttribute.needsUpdate = true;
  handle.position.copy(localPoint);

  refreshPolylineGeometryForHandle(handle);
}

function updatePolylinePoint(handle, index, worldPoint, options = {}) {
  const handleGroup = handle.userData.handleGroup;
  const localPoint = handleGroup.worldToLocal(worldPoint.clone());
  updatePolylinePointFromLocal(handle, index, localPoint, options);
}

function setPolylineDragging(enabled) {
  if (controls) controls.enabled = !enabled;
  if (orb_controls) orb_controls.enabled = !enabled;
}

function attachPolylineDragHandlers(domElement) {
  if (!domElement || domElement.dataset.polylineDragBound === "true") return;
  domElement.dataset.polylineDragBound = "true";

  domElement.addEventListener("pointerdown", (event) => {
    // Left button only — right-drag rotates the jaw, even over a handle.
    if (event.pointerType !== "touch" && event.button !== 0) return;
    const hit = pickPolylinePoint(event, domElement);
    if (!hit) return;

    polylinePreDragSnapshot = capturePolylineSnapshot();
    event.preventDefault();
    domElement.setPointerCapture?.(event.pointerId);
    camera.getWorldDirection(polylineCameraDirection);
    polylineDragPlane.setFromNormalAndCoplanarPoint(
      polylineCameraDirection,
      hit.point
    );
    activePolylineDrag = {
      handle: hit.handle,
      index: hit.index,
      pointerId: event.pointerId,
    };
    setPolylineDragging(true);
  });

  domElement.addEventListener("pointermove", (event) => {
    if (!activePolylineDrag) {
      domElement.style.cursor = pickPolylinePoint(event, domElement)
        ? "grab"
        : "";
      return;
    }

    updatePointerPosition(event, domElement);
    raycaster.setFromCamera(pointer, camera);

    if (raycaster.ray.intersectPlane(polylineDragPlane, polylineDragPoint)) {
      updatePolylinePoint(
        activePolylineDrag.handle,
        activePolylineDrag.index,
        polylineDragPoint
      );
    }
    domElement.style.cursor = "grabbing";
  });

  const stopDragging = (event) => {
    if (!activePolylineDrag) return;
    domElement.releasePointerCapture?.(activePolylineDrag.pointerId);
    activePolylineDrag = null;
    setPolylineDragging(false);
    domElement.style.cursor = pickPolylinePoint(event, domElement) ? "grab" : "";
    if (polylinePreDragSnapshot) {
      polylineUndoStack.push(polylinePreDragSnapshot);
      if (polylineUndoStack.length > 50) polylineUndoStack.shift();
      polylineRedoStack.length = 0;
      polylinePreDragSnapshot = null;
      updatePolylineUndoRedoButtons();
    }
  };

  domElement.addEventListener("pointerup", stopDragging);
  domElement.addEventListener("pointercancel", stopDragging);
  domElement.addEventListener("pointerleave", (event) => {
    if (activePolylineDrag) stopDragging(event);
  });
}

function createViewerLoadingScreen() {
  const existing = document.getElementById("viewer-loading-screen");
  if (existing) {
    // A screen mid-fade still answers getElementById but has already dropped
    // window.viewerLoadingEls, so returning early leaves the caller no bar.
    if (!existing.classList.contains("vls-fade")) return;
    existing.remove();
    document.getElementById("viewer-loading-screen-style")?.remove();
  }
  const style = document.createElement("style");
  style.id = "viewer-loading-screen-style";
  style.textContent = `
    #viewer-loading-screen {
      position: absolute;
      inset: 0;
      z-index: 9500;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8f5fb;
      transition: opacity 0.35s ease;
    }
    #viewer-loading-screen.vls-fade {
      opacity: 0;
      pointer-events: none;
    }
    .vls-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      padding: 36px 48px;
      background: rgba(255,255,255,0.22);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      box-shadow: 0 4px 28px rgba(0,0,0,0.14);
      width: min(480px, 88vw);
    }
    .vls-logo {
      width: 80px;
      height: 80px;
      object-fit: contain;
      display: block;
    }
    .vls-bar-track {
      width: 100%;
      height: 6px;
      background: rgba(0,0,0,0.14);
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }
    .vls-bar-fill {
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #1a6bbf, #4fa3e8);
      border-radius: 3px;
      animation: loading 1.4s ease-in-out infinite;
    }
    #vls-progress {
      width: 100%;
      height: 14px;
      border: none;
      border-radius: 7px;
      overflow: hidden;
      display: none;
    }
    #vls-progress::-webkit-progress-bar {
      background: rgba(0,0,0,0.12);
      border-radius: 7px;
    }
    #vls-progress::-webkit-progress-value {
      background: linear-gradient(90deg, #d97706, #fbbf24);
      border-radius: 7px;
    }
    #vls-progress::-moz-progress-bar {
      background: linear-gradient(90deg, #d97706, #fbbf24);
      border-radius: 7px;
    }
    .vls-info-row {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    #vls-display {
      font-family: "Montserrat", sans-serif;
      font-size: 14px;
      color: rgba(26,58,92,0.75);
      text-align: left;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #vls-percent {
      font-family: "Montserrat", sans-serif;
      font-size: 15px;
      font-weight: 700;
      color: #1a3a5c;
      min-width: 46px;
      text-align: right;
    }
    .vls-status {
      font-family: "Montserrat", sans-serif;
      font-size: 14px;
      color: #1a3a5c;
      font-weight: 500;
      text-align: center;
      min-height: 16px;
      opacity: 0.85;
      width: 100%;
    }
  `;
  document.head.appendChild(style);
  const screen = document.createElement("div");
  screen.id = "viewer-loading-screen";
  screen.innerHTML = `
    <div class="vls-card">
      <img class="vls-logo" src="../../assets/profile.png" alt="SmartRPD">
      <div class="vls-status" id="vls-status">Initialising…</div>
      <progress id="vls-progress" value="0" max="100"></progress>
      <div class="vls-info-row">
        <span id="vls-display"></span>
        <span id="vls-percent"></span>
      </div>
    </div>`;
  (viewerContainer || document.body).appendChild(screen);
  window.viewerLoadingEls = {
    progressBar: screen.querySelector("#vls-progress"),
    percentage:  screen.querySelector("#vls-percent"),
    displayBox:  screen.querySelector("#vls-display"),
  };
  window.updateViewerLoading = (label) => {
    const el = document.getElementById("vls-status");
    if (el) el.textContent = label || "Loading…";
  };
}

function removeViewerLoadingScreen() {
  const screen = document.getElementById("viewer-loading-screen");
  if (!screen) return;
  screen.classList.add("vls-fade");
  setTimeout(() => {
    screen.remove();
    document.getElementById("viewer-loading-screen-style")?.remove();
  }, 380);
  delete window.updateViewerLoading;
  delete window.viewerLoadingEls;
}

//The async prevents processing of data before the stuff is loaded in
(async () => {
  if (!viewerContainer) {
    return;
  }
  const basePath = getAppBasePath();
  createViewerLoadingScreen();
  const viewerTotalStartedAt = performance.now();
  const pageInitializationStartedAt = performance.now();
  startViewerLoadTimer("viewer: page/viewer initialization");

  //datas :)
  // this for the undercut upper and the main json data use to retrieve stuff
  const data = {
    machine_id: MACHINE_ID,
    // Fallback UUID keeps direct/shared viewer URLs able to load case assets.
    // Prefer loggedInUser.uuid if this viewer is later wired to authenticated sessions.
    uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
    //uuid: 'eOqJe2FpjqdECy25l0KuJkH2cPQm', // dev server acc uuid
    case_int_id: paramValue,
    jaw_type: 2,
    caseIntID: paramValue,
  };
  const caseInfoEndpoint = "/case/get/" + paramValue;
  const thumbnailEndpoint = "/thumbnails/get";
  let positionData;
  const caseInfoPromise = apiClient.post(
    caseInfoEndpoint,
    [data],
    false,
    "Case Info"
  );
  const thumbnailPromise = apiClient.post(
    thumbnailEndpoint,
    [data],
    false,
    "2D image"
  );

  //This section is for the processing of creation date, case id and last updated
  try {
    positionData = await caseInfoPromise;
    window.caseID = positionData.case_id;
    window.lastEdited = unixToHumanReadable(positionData.last_updated);
    window.username = positionData.username;
  } catch (error) {
    console.error("Error fetching case info:", error);
  }

  try {
    const thumbnailData = await thumbnailPromise;
      //console.log('Success thumb:', thumbnailData)
      for (const thumb in thumbnailData) {
        if (thumbnailData[thumb].slot == 0) {
          const test = thumbnailData[thumb].data;
          window.thumbnailBase64 = test;
          const isMobile =
            /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
              navigator.userAgent
            );
          // Container for thumbnail + 2D buttons
          const thumbWrapper = document.createElement("div");
          thumbWrapper.dataset.twodViewerBlock = "true";
          thumbWrapper.className = "twod-viewer-nav-block";
          thumbWrapper.style.order = "1";
          thumbWrapper.style.overflow = "hidden";
          thumbWrapper.style.maxHeight = "270px";

          // Create thumbnail button
          const button = document.createElement("button");
          button.dataset.twodViewerButton = "true";
          button.style.padding = "0";
          button.style.border = "none";
          button.style.background = "none";
          button.style.cursor = "pointer";
          button.style.width = "100%";
          button.style.height = "auto";
          button.style.position = "relative";

          // Create thumbnail image
          const img = new Image();
          img.src = "data:image/png;base64," + test;
          img.style.width = "100%";
          img.style.height = "auto";
          img.style.maxHeight = "270px";
          img.style.objectFit = "cover";
          img.style.display = "block";
          img.style.transform = "none";
          button.appendChild(img);

          // Create "Click me" watermark overlay
          const watermark = document.createElement("div");
          watermark.textContent = "Click me";
          watermark.style.position = "absolute";
          watermark.style.top = "50%";
          watermark.style.left = "50%";
          watermark.style.transform = "translate(-50%, -50%)";
          watermark.style.color = "#0078d4";
          watermark.style.fontWeight = "bold";
          watermark.style.fontSize = "18px";
          watermark.style.textShadow = "1px 1px 3px rgba(255, 255, 255, 0.9)";
          watermark.style.pointerEvents = "none";
          button.appendChild(watermark);

          // Append to wrapper
          thumbWrapper.appendChild(button);

          // Static 2D buttons below the image
          const btnContainer = document.createElement("div");
          btnContainer.style.display = "flex";
          btnContainer.style.flexDirection = "column";
          btnContainer.style.gap = "6px";

          // Append buttons to wrapper
          thumbWrapper.appendChild(btnContainer);

          // Append into the right nav sidebar
          getViewerRightNav().appendChild(thumbWrapper);

          function openTwodOverlay() {
            // Fullscreen overlay
            const overlay = document.createElement("div");
            overlay.className = "twod-overlay";

            // Group container (card)
            const twodGroup = document.createElement("div");
            twodGroup.className = "twod-group";
            twodGroup.style.position = "relative"; // Required to position watermark relative to image

            // Enlarged image
            const enlargedImg = new Image();
            enlargedImg.src = img.src;
            enlargedImg.className = "twod-fullscreen-image";
            twodGroup.appendChild(enlargedImg);

            // Watermark centered on image
            const watermark = document.createElement("div");
            watermark.textContent = `🦷 Case: ${window.caseID || "N/A"}`;
            watermark.className = "case-title-watermark";
            watermark.style.position = "absolute";
            watermark.style.top = "8px";
            watermark.style.left = "50%";
            watermark.style.transform = "translateX(-50%)";
            watermark.style.color = "black";
            watermark.style.fontSize = "16px";
            watermark.style.fontWeight = "bold";
            watermark.style.textShadow = "0px 0px 10px rgba(0, 0, 0, 0.8)";
            watermark.style.pointerEvents = "none";
            watermark.style.zIndex = "1";

            twodGroup.appendChild(watermark);

            // Buttons container
            const btnContainer2D = document.createElement("div");
            btnContainer2D.className = "smart-btn-container-2d";

            // 🟣 创建 Annotate 按钮（跳转到 2DAnnotate.html）
            const annotateBtn = document.createElement("button");
            annotateBtn.className = "smart-btn annotate";
            annotateBtn.setAttribute("aria-label", "Annotate");
            annotateBtn.title = "Annotate";
            annotateBtn.innerHTML = `<img src="${basePath}/assets/Icon_annotate.png" alt="Annotate">`;

            annotateBtn.addEventListener("click", (e) => {
              e.stopPropagation();

              const params = new URLSearchParams(window.location.search);
              const encryptedId = params.get("id");
              const caseID = window.caseID || encryptedId;

              if (!encryptedId) {
                alert("❌ 缺少参数，无法跳转 Annotate 页面");
                return;
              }

              const basePath = getAppBasePath();

              // Logged in: compose the annotation background, then open the 2D
              // noticeboard. `then` lets the login flow reuse the same compose.
              const composeBackgroundThen = (then) => {
                const enlargedImg = document.querySelector(
                  ".twod-fullscreen-image"
                );
                if (!enlargedImg) {
                  alert("❌ 未找到图像，无法生成截图");
                  return;
                }
                const canvas = document.createElement("canvas");
                canvas.width = enlargedImg.naturalWidth;
                canvas.height = enlargedImg.naturalHeight;
                const ctx = canvas.getContext("2d");
                const baseImage = new Image();
                baseImage.onload = () => {
                  ctx.drawImage(baseImage, 0, 0);
                  const text = `🦷 Case: ${caseID}`;
                  const fontSize = canvas.width * 0.034;
                  ctx.font = `bold ${fontSize}px sans-serif`;
                  ctx.fillStyle = "white";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
                  ctx.shadowBlur = 10;
                  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
                  const storageKey = `annotateBackground_${encryptedId}`;
                  const composedDataURL = canvas.toDataURL("image/jpeg", 0.82);
                  if (!saveAnnotationBackground(storageKey, composedDataURL)) {
                    alert("Could not prepare the annotation image. Please try again.");
                    return;
                  }
                  then();
                };
                baseImage.src = enlargedImg.src;
              };

              const noticeboardURL = `${window.location.origin}${basePath}/src/pages/2DAnnotation.html?id=${encryptedId}&view=noticeboard`;
              const openNoticeboard = () =>
                composeBackgroundThen(() => window.open(noticeboardURL, "_blank"));
              const openHistory = () =>
                window.open(
                  `${window.location.origin}${basePath}/src/pages/AnnotationHistory.html?id=${encryptedId}`,
                  "_blank"
                );

              let loggedIn = false;
              try {
                loggedIn = !!JSON.parse(
                  localStorage.getItem("loggedInUser") || "null"
                )?.uuid;
              } catch (_) {}

              // Logged-in users skip the gate (pathway 1).
              if (loggedIn) {
                openNoticeboard();
                return;
              }

              // Guests get the gate: Login goes on to the 2D noticeboard,
              // Continue as guest to Annotation History.
              openAnnotateGate({
                onLogin: () =>
                  composeBackgroundThen(() => {
                    // Return to the 2D noticeboard after a successful login.
                    try {
                      localStorage.setItem("postLoginRedirect", noticeboardURL);
                    } catch (_) {}
                    window.location.href = `${window.location.origin}${basePath}/index.html`;
                  }),
                onGuest: openHistory,
              });
            });

            // 插入按钮
            btnContainer2D.appendChild(annotateBtn);

            twodGroup.appendChild(btnContainer2D);
            overlay.appendChild(twodGroup);
            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.addEventListener("click", () => overlay.remove());
          }
          button.addEventListener("click", openTwodOverlay);

          // Mobile/tablet 2D trigger button (hidden on desktop, shown on tablet/mobile)
          const mobileTwodBtn = document.createElement("button");
          mobileTwodBtn.type = "button";
          mobileTwodBtn.className = "twod-mobile-trigger";
          mobileTwodBtn.setAttribute("aria-label", "View 2D design");
          mobileTwodBtn.title = "View 2D design";
          mobileTwodBtn.innerHTML = '<i class="fa-solid fa-tooth" aria-hidden="true" style="font-size:20px;display:block;margin-bottom:2px"></i><span style="font-size:10px;font-weight:700;letter-spacing:0.5px">2D</span>';
          mobileTwodBtn.style.order = "2";
          mobileTwodBtn.addEventListener("click", openTwodOverlay);
          getViewerRightNav().appendChild(mobileTwodBtn);

        }
      }
  } catch (error) {
    console.error("Error:", error);
  }
  // to get the undercut and occulsion values
  let undercut_values = [];

  function heatmapJawType(jawKey) {
    return jawKey === "upper" ? "upper_jaw" : "lower_jaw";
  }

  function dllJawDbType(jawKey) {
    // Same convention as the 2D jaw preview DLL calls.
    return jawKey === "upper" ? 1 : 2;
  }

  function savedSurveyDirection(jawKey) {
    const raw = ["x", "y", "z"].map((axis) =>
      Number(positionData?.[`${jawKey}_insertion_angle_${axis}`])
    );
    if (raw.some((value) => !Number.isFinite(value))) return null;
    const [x, y, z] =
      jawKey === "upper" ? [-raw[0], -raw[1], raw[2]] : [raw[0], raw[1], -raw[2]];
    const length = Math.hypot(x, y, z);
    if (length < 1e-4) return null;
    return [x / length, y / length, z / length].map((value) =>
      Number(Number(value).toFixed(8))
    );
  }

  function colorForSurveyingValue(value) {
    const v = Math.max(0, Number(value) || 0);
    if (v <= 0) return [1, 1, 1];
    if (v < 0.25) return [1, 210 / 255, 0];
    if (v < 0.5) return [253 / 255, 140 / 255, 0];
    if (v < 0.75) return [254 / 255, 70 / 255, 0];
    return [170 / 255, 0, 3 / 255];
  }

  function colorForOcclusionValue(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return [1, 1, 1];
    if (v <= 0.1) return [0.5411765, 0, 0.8352942];
    if (v <= 0.25) return [0.027450982, 0, 0.6117647];
    if (v <= 0.4) return [0.29803923, 0.8588236, 1];
    if (v <= 0.5) return [0, 0.91372555, 0.18823531];
    return [1, 1, 1];
  }

  function floatValuesFromDllResponse(response, base64Key, arrayKey, previewKey) {
    if (response?.[base64Key]) {
      return base64ToFloat32Array(response[base64Key]);
    }
    if (Array.isArray(response?.[arrayKey])) {
      return response[arrayKey];
    }
    return response?.[previewKey] ?? null;
  }

  function buildRuntimeHeatmapSurface(jawKey, values, colorForValue, fieldName, meta = {}) {
    if (!values?.length) return null;
    const heatmap = new Float32Array(values.length * 4);
    for (let i = 0; i < values.length; i += 1) {
      const [r, g, b] = colorForValue(values[i]);
      heatmap[i * 4] = r;
      heatmap[i * 4 + 1] = g;
      heatmap[i * 4 + 2] = b;
      heatmap[i * 4 + 3] = 1;
    }
    const surface = {
      jaw_type: heatmapJawType(jawKey),
      point_size: meta.pointSize || values.length,
      [fieldName]: {
        data: Array.from(new Uint8Array(heatmap.buffer)),
      },
    };
    if (meta.source) surface.source = meta.source;
    if (meta.surveyingDirection) surface.surveying_direction = meta.surveyingDirection;
    return surface;
  }

  function mergeHeatmapSurfaces(...surfaces) {
    const merged = {};
    surfaces.filter(Boolean).forEach((surface) => {
      if (surface.jaw_type) merged.jaw_type = surface.jaw_type;
      if (surface.point_size && !merged.point_size) merged.point_size = surface.point_size;
      if (surface.source) {
        merged.source = merged.source ? `${merged.source}+${surface.source}` : surface.source;
      }
      if (surface.surveying_direction) merged.surveying_direction = surface.surveying_direction;
      if (surface.surveying_values) merged.surveying_values = surface.surveying_values;
      if (surface.occlusion_values) merged.occlusion_values = surface.occlusion_values;
    });
    return merged.surveying_values || merged.occlusion_values ? merged : null;
  }

  function buildRuntimeUndercutSurface(jawKey, response) {
    const values = floatValuesFromDllResponse(
      response,
      "surveying_values_base64",
      "surveying_values",
      "surveying_values_preview"
    );
    return buildRuntimeHeatmapSurface(
      jawKey,
      values,
      colorForSurveyingValue,
      "surveying_values",
      {
        pointSize: response?.surveying_count,
        source: "dll_compute_surveying_no_pd",
        surveyingDirection: response?.surveying_direction,
      }
    );
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

  function buildRuntimeOcclusionSurface(jawKey, response) {
    const record = Array.isArray(response?.records)
      ? response.records.find((item) => normalizeOcclusionJaw(item) === jawKey)
      : response;
    const values = floatValuesFromDllResponse(
      record,
      "occlusion_values_base64",
      "occlusion_values",
      "occlusion_values_preview"
    );
    return buildRuntimeHeatmapSurface(
      jawKey,
      values,
      colorForOcclusionValue,
      "occlusion_values",
      {
        pointSize: record?.occlusion_count || record?.point_size,
        source: "dll_compute_occlusion",
      }
    );
  }

  async function computeRuntimeUndercutSurface(jawKey) {
    const direction = savedSurveyDirection(jawKey);
    if (!direction) {
      console.log("[viewer3D] saved survey auto-apply skipped: insertion angles missing", {
        jaw: jawKey,
        case_id: paramValue,
      });
      return null;
    }

    console.log("[viewer3D] auto-applying saved survey direction", {
      jaw: jawKey,
      case_id: paramValue,
      direction,
    });

    const response = await apiClient.post(
      "/dll/compute-surveying-no-pd",
      [
        {
          machine_id: MACHINE_ID,
          uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
          caseIntID: paramValue,
        },
        {
          case_id: paramValue,
          type: dllJawDbType(jawKey),
          dir: direction,
          printFullSurveying: true,
          returnSurveyingBase64: true,
        },
      ],
      false,
      `${jawKey} undercut`
    );
    return buildRuntimeUndercutSurface(jawKey, response);
  }

  async function computeRuntimeOcclusionSurfaces() {
    const response = await apiClient.post(
      "/dll/compute-occlusion",
      [
        {
          machine_id: MACHINE_ID,
          uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
          caseIntID: paramValue,
        },
        {
          case_id: paramValue,
          caseIntID: paramValue,
          includeFullOcclusion: true,
          returnOcclusionBase64: true,
        },
      ],
      false,
      "Occlusion"
    );
    return {
      upper: buildRuntimeOcclusionSurface("upper", response),
      lower: buildRuntimeOcclusionSurface("lower", response),
    };
  }

  // Per-vertex RGBA arrays, megabytes on a real case, so they ride loadCaseAssets
  // and never load on entry. Uploads fall back to the loaders' "stl" sentinel.
  async function fetchUndercutHeatmaps() {
    try {
      const [upperUndercut, lowerUndercut, occlusion] = await Promise.all([
        computeRuntimeUndercutSurface("upper").catch((error) => {
          console.warn("[viewer3D] upper runtime undercut failed", error);
          return null;
        }),
        computeRuntimeUndercutSurface("lower").catch((error) => {
          console.warn("[viewer3D] lower runtime undercut failed", error);
          return null;
        }),
        computeRuntimeOcclusionSurfaces().catch((error) => {
          console.warn("[viewer3D] runtime occlusion failed", error);
          return { upper: null, lower: null };
        }),
      ]);

      const upperHeat = mergeHeatmapSurfaces(upperUndercut, occlusion.upper);
      const lowerHeat = mergeHeatmapSurfaces(lowerUndercut, occlusion.lower);
      // Downstream convention: undercut_values[0]=lower, [1]=upper.
      undercut_values = [lowerHeat, upperHeat];

      [lowerHeat, upperHeat].forEach((heatmap) => {
        if (!heatmap?.jaw_type) return;
        undercut_type[heatmap.jaw_type] = [
          Boolean(heatmap.surveying_values),
          Boolean(heatmap.occlusion_values),
        ];
      });
    } catch (error) {
      console.error("Error:", error);
    }
  }

  //Processing mesh

  // stl will be true is fail to process parameterisation
  const meshDataStartedAt = performance.now();
  let stl = false;
  const urls = ["/parameterisation/mesh/getall", "/surface/getall"];
  let responseDatas = [];
  let responseData;

  // The viewer lands on the uploads and fetches none of the case's ~50 MB assets
  // until the 3D button asks; loadCaseAssets() flips this and reruns the path.
  let caseMeshRequested = false;

  // Pre-start both mesh downloads in parallel so denture downloads while jaw is being
  // fetched and processed. The promises are consumed inside the loop below.
  const startMeshDownloads = () =>
    !close && caseMeshRequested
      ? {
          "/parameterisation/mesh/getall": apiClient.post("/parameterisation/mesh/getall", [data], false, "Jaw mesh"),
          "/surface/getall":               apiClient.post("/surface/getall",               [data], false, "Denture mesh"),
        }
      : {};
  let meshPromises = startMeshDownloads();

  try {
    // Call the post method and wait for the response
    for (const url of urls) {
      //console.log('raw: ' + close);

      // this is for the generation of button to change to closed mesh if it exist
      let name_of_mesh;
      if (!close) {
        if (url == "/parameterisation/mesh/getall") {
          name_of_mesh = "Jaw mesh";
        } else if (url == "/surface/getall") {
          name_of_mesh = "Denture mesh";
        }
        // Await the pre-started promise rather than issue a second request.
        // Skipped on the landing pass: the UI builds with no case mesh yet.
        responseData = caseMeshRequested ? await meshPromises[url] : "stl";
        //console.log(responseData);
        if (isObject(responseData)) {
          responseDatas = responseDatas.concat(responseData);
        }
        if (url == "/parameterisation/mesh/getall") {
          // Create a container for the buttons
          const btnContainer = document.createElement("div");
          btnContainer.className = "smart-btn-container";


          // === NEW: Container for 3D Buttons under Chat ===
          const btnContainer3D = document.createElement("div");
          btnContainer3D.className = "smart-btn-container-3d";

          // Switches between the uploaded design and the case's own scan.
          // Both stay loaded, so this is a visibility flip, not a reload.
          const loadOtherStlButton = document.createElement("button");
          loadOtherStlButton.id = "center-load-button";
          loadOtherStlButton.className = "smart-btn other-stl";
          loadOtherStlButton.innerHTML = `<img src="${basePath}/assets/Icon_showdesign2.svg" alt="Switch between design and case view">`;
          let viewSwitchBusy = false;
          const setDesignButtonState = (isDesignShown) => {
            const label = isDesignShown
              ? "Show original 3D scan"
              : "Show me 3D RPD design";
            loadOtherStlButton.setAttribute("aria-label", label);
            loadOtherStlButton.setAttribute("aria-pressed", String(isDesignShown));
            loadOtherStlButton.title = label;
            loadOtherStlButton.classList.toggle("active", isDesignShown);
          };
          window.syncDesignViewButton = setDesignButtonState;
          setDesignButtonState(false);
          loadOtherStlButton.addEventListener("click", async () => {
            if (viewSwitchBusy) return;
            viewSwitchBusy = true;
            loadOtherStlButton.disabled = true;
            try {
              if (isDesignViewActive()) await showCaseView();
              else await showDesignView();
              setDesignButtonState(isDesignViewActive());
            } finally {
              viewSwitchBusy = false;
              loadOtherStlButton.disabled = false;
            }
          });
          btnContainer3D.appendChild(loadOtherStlButton);

          // Opens at any time, not only on an empty case — otherwise the four
          // slots are only ever fillable before the first file lands.
          const uploadSlotsButton = document.createElement("button");
          uploadSlotsButton.id = "upload-slots-button";
          uploadSlotsButton.className = "smart-btn upload-slots";
          uploadSlotsButton.title = "Upload 3D files";
          uploadSlotsButton.setAttribute("aria-label", "Upload 3D files");
          uploadSlotsButton.innerHTML = `<img src="${basePath}/assets/cloud_upload.png" alt="Upload 3D files">`;
          uploadSlotsButton.addEventListener("click", () => {
            if (document.getElementById("design-upload-prompt")) {
              window.removeDesignUploadPrompt?.();
              return;
            }
            window.showDesignUploadPrompt?.();
          });
          btnContainer3D.appendChild(uploadSlotsButton);

          // Append the container to the body
          if (btnContainer.children.length > 0) {
            document.body.appendChild(btnContainer);
          }
          //document.body.appendChild(btnContainer2D);
          getViewerNavToolbar().prepend(btnContainer3D);
        }
      }

      if (
        caseMeshRequested &&
        responseData == "stl" &&
        url == "/parameterisation/mesh/getall" &&
        !close
      ) {
        responseData = "stl";
        console.log("[viewer3D] STL source selected: /stl/get (parameterisation fallback)");
        const rawStlStartedAt = performance.now();
        responseData = await apiClient.post(
          "/stl/get",
          [data],
          false,
          "Jaw mesh"
        );
        addViewerLoadTiming("mesh API /stl/raw/get", performance.now() - rawStlStartedAt);
        stl = true;
      } else if (close && url == "/parameterisation/mesh/getall") {
        responseData = "stl";
        console.log("[viewer3D] STL source selected: /stl/get (close view)");
        responseData = await apiClient.post(
          "/stl/get",
          [data],
          false,
          "Jaw mesh"
        );
        //console.log(responseData);
        stl = false;
        const button = document.createElement("button");
        button.textContent = "Back to original"; // Set the text content of the button

        // Style the button
        button.style.position = "fixed";
        button.style.bottom = "45px"; // Adjust the bottom position as needed
        button.style.right = "10px"; // Adjust the right position as needed
        button.style.padding = "10px";
        button.style.backgroundColor = "blue";
        button.style.color = "white";
        button.style.border = "none";
        button.style.cursor = "pointer";
        button.style.borderRadius = "5px";
        button.style.zIndex = "1000"; // Ensure it's above other elements

        // Function to handle button click
        function redirectToUrl() {
          // Change this URL to the desired destination

          window.location.href = window.location.href.slice(0, -11); // Redirect to the specified URL
        }

        // Add click event listener to button
        button.addEventListener("click", redirectToUrl);

        // Append the button to the body or another container
        document.body.appendChild(button);
      } else {
        responseData = "stl";
      }
      //console.log('e')

      //console.log('Success:', responseData);
      if (isObject(responseData)) {
        responseDatas = responseDatas.concat(responseData);
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
  endViewerLoadTimer("viewer: jaw mesh data loading");
  addViewerLoadTiming("mesh API data loading", performance.now() - meshDataStartedAt, {
    files: responseDatas.length,
  });

  const style = document.createElement("style");
  style.textContent = `
  .smart-btn-container {
      position: absolute;
      bottom: 100px;
      right: 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      z-index: 1000;
      pointer-events: none;
  }

  .smart-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 5px;
      color: white;
      cursor: pointer;
      font-weight: bold;
      transition: background-color 0.3s, transform 0.2s;
      min-width: 140px;
      text-align: center;
      pointer-events: auto;
  }

  .smart-btn:hover {
      transform: scale(1.05);
      filter: brightness(1.1);
  }

  .smart-btn img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      display: block;
      margin: 0 auto;
      pointer-events: none;
  }

  .smart-btn.nudge {
      background-color: #007bff;
  }

  .smart-btn.approve {
      background-color: #28a745;
  }

  .smart-btn.edit {
      background-color: #fd7e14;
  }

  .smart-btn.annotate {
      background-color: #6f42c1; /* 例如紫色，你可改成你想要的颜色 */
  }
  
  .smart-btn.history {
      background-color: #17a2b8; /* 蓝绿色, 你可以自由换颜色 */
  }

  .smart-btn.other-stl {
      background-color: transparent;
  }

  /* Design overlay is currently on top of the jaw. */
  /* Shown when a case has no uploaded 3D files — the "+" slots mirror the
     3D preview panel's empty rows. */
  #design-upload-prompt {
      position: absolute;
      inset: 0;
      z-index: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      pointer-events: auto;
  }

  /* Frosted glass, same recipe as the objects panel. Kept fairly opaque because
     the scene behind renders near-white and white card text must stay readable. */
  #design-upload-prompt .dup-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      max-width: min(560px, 92vw);
      padding: 26px 30px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 16px;
      background: rgba(17, 24, 39, 0.55);
      -webkit-backdrop-filter: blur(18px) saturate(140%);
      backdrop-filter: blur(18px) saturate(140%);
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.32),
        inset 0 1px 0 rgba(255, 255, 255, 0.14);
      text-align: center;
      font-family: "Montserrat", Arial, sans-serif;
      color: #f1f5f9;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  }

  #design-upload-prompt .dup-heading {
      font-size: 18px;
      font-weight: 700;
  }

  #design-upload-prompt .dup-sub {
      font-size: 13px;
      opacity: 0.75;
  }

  #design-upload-prompt .dup-slots {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      margin-top: 6px;
  }

  #design-upload-prompt .dup-slot-wrap {
      position: relative;
  }

  #design-upload-prompt .dup-slot {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 132px;
      height: 96px;
      padding: 8px;
      border: 1px dashed rgba(255, 255, 255, 0.42);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.10);
      color: inherit;
      font: inherit;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
  }

  #design-upload-prompt .dup-slot:hover:not(:disabled) {
      border-color: #4fa3e8;
      background: rgba(79, 163, 232, 0.16);
  }

  /* A file dragged over an empty idle slot: hover's highlight plus a solid
     border, since the pointer is carrying a file rather than showing a cursor. */
  #design-upload-prompt .dup-slot-wrap.is-dragover .dup-slot {
      border-style: solid;
      border-color: #4fa3e8;
      background: rgba(79, 163, 232, 0.22);
  }

  /* Per-slot progress: each file reports itself in its own tile, replacing the
     single pooled bar that could not say which of the four was slow. */
  #design-upload-prompt .dup-slot-bar,
  #design-upload-prompt .dup-slot-note {
      display: none;
  }

  #design-upload-prompt .dup-slot-wrap.is-busy .dup-slot-bar {
      display: block;
      width: 88px;
      height: 5px;
  }

  #design-upload-prompt .dup-slot-wrap.is-busy .dup-slot-note {
      display: block;
      font-size: 11px;
      opacity: 0.75;
  }

  /* The tick/plus and the filename give way to the bar while a slot is working,
     so a 96px tile does not have to hold both. */
  #design-upload-prompt .dup-slot-wrap.is-busy .dup-plus,
  #design-upload-prompt .dup-slot-wrap.is-busy .dup-slot-file {
      display: none;
  }

  #design-upload-prompt .dup-slot-delete {
      position: absolute;
      top: -8px;
      right: -8px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 50%;
      background: #2b3242;
      color: #f8fafc;
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
  }

  #design-upload-prompt .dup-slot-delete:hover {
      border-color: #f87171;
      background: #b91c1c;
  }

  #design-upload-prompt .dup-slot-delete:disabled {
      opacity: 0.4;
      cursor: default;
  }

  #design-upload-prompt .dup-slot-wrap.is-busy .dup-slot-delete {
      display: none;
  }

  #design-upload-prompt .dup-plus {
      font-size: 28px;
      font-weight: 300;
      line-height: 1;
  }

  #design-upload-prompt .dup-slot-label {
      font-size: 12px;
      opacity: 0.85;
  }

  /* A slot that already holds a file: solid border, tick instead of "+", and the
     filename underneath. Not clickable — use its × to free the slot first. */
  #design-upload-prompt .dup-slot-wrap.is-filled .dup-slot {
      border-style: solid;
      border-color: rgba(74, 222, 128, 0.55);
      background: rgba(74, 222, 128, 0.12);
      cursor: default;
  }

  #design-upload-prompt .dup-slot-wrap.is-filled .dup-plus {
      font-size: 20px;
      color: #4ade80;
  }

  #design-upload-prompt .dup-slot-file {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11px;
      opacity: 0.7;
  }

  /* A filled tile is disabled by design, so only an empty one that is disabled
     is actually waiting on something. */
  #design-upload-prompt .dup-slot-wrap:not(.is-filled) .dup-slot:disabled {
      opacity: 0.45;
      cursor: progress;
  }

  #design-upload-prompt .dup-slot-wrap.is-busy .dup-slot:disabled {
      opacity: 1;
  }

  #design-upload-prompt .dup-status {
      min-height: 18px;
      font-size: 12.5px;
      opacity: 0.9;
  }

  #design-upload-prompt .dup-open-scan {
      margin-top: 4px;
      padding: 8px 16px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
  }

  #design-upload-prompt .dup-open-scan:hover {
      background: rgba(255, 255, 255, 0.12);
  }

  #design-upload-prompt .dup-open-scan:disabled {
      opacity: 0.5;
      cursor: progress;
  }

  @media (max-width: 640px) {
    #design-upload-prompt .dup-slot {
        width: 108px;
        height: 84px;
    }
  }

  .smart-btn.other-stl.active {
      background-color: transparent;
      box-shadow: 0 0 0 2px #38bdf8;
  }

  /* Same "on" ring as the 3D/case toggle above, while the Objects panel this
     button opens is showing. */
  .smart-btn.objects-toggle.active {
      box-shadow: 0 0 0 2px #38bdf8;
  }

  .smart-btn.upload-slots img {
      filter: brightness(0) invert(1);
  }

  .smart-btn:disabled {
      opacity: 0.6;
      cursor: progress;
  }

  #viewer-right-nav {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    width: 238px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    overflow-y: auto;
    overflow-x: visible;
    padding: 12px 10px;
    border-left: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(18, 18, 18, 0.74);
    box-shadow: -10px 0 26px rgba(0, 0, 0, 0.22);
    backdrop-filter: blur(6px);
    pointer-events: auto;
    box-sizing: border-box;
  }

  #viewer-right-nav > * {
    flex: 0 0 auto;
    pointer-events: auto;
  }

  #viewer-nav-toolbar {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 0 0 auto;
  }

  #viewer-right-nav-top-row {
    display: contents;
  }


	.smart-btn-container-3d {
		display: contents;
	}

  /* Nav toolbar buttons are bare icons — no plate behind them. */
  #viewer-nav-toolbar .smart-btn {
    flex: 0 0 auto;
    width: 46px;
    min-width: 0;
    height: 46px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    pointer-events: auto;
  }

  #viewer-nav-toolbar .smart-btn img {
    width: 30px;
    height: 30px;
  }

  .preset-view-panel {
    position: static;
    order: 10;
    margin-top: auto;
    z-index: 1000;
    width: 100%;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 2px;
    box-shadow: none;
    color: #f5f5f5;
    font-family: Arial, sans-serif;
    text-align: center;
    pointer-events: none;
  }

  .preset-view-pad {
    position: relative;
    width: 196px;
    height: 214px;
    /* Centered in the sidebar's content column, not pinned to its right edge. */
    margin: 0 auto;
  }

  .preset-view-current-wrap {
    display: none;
  }

  .preset-view-dropdown {
    display: none;
  }

  .twod-viewer-nav-block {
    width: 100%;
    flex: 0 0 auto;
    border-radius: 6px;
    overflow: hidden;
    max-height: 270px;
  }

  .twod-viewer-nav-block [data-twod-viewer-button="true"] {
    display: block;
    width: 100% !important;
  }

  .twod-viewer-nav-block [data-twod-viewer-button="true"] img {
    width: 100%;
    height: auto;
    max-height: 270px;
    object-fit: cover;
    display: block;
  }

  .twod-mobile-trigger {
    display: none;
  }

  .preset-view-button {
    position: absolute;
    width: 58px;
    height: 48px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.25));
    pointer-events: auto;
  }

  .preset-view-face {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #bcbcbc, #8f8f8f);
    border: 2px solid rgba(255, 255, 255, 0.08);
    box-sizing: border-box;
  }

  .preset-view-button:hover,
  .preset-view-button.active {
    filter: drop-shadow(0 0 8px rgba(255, 255, 255, 0.65));
  }

  .preset-view-button:hover .preset-view-face,
  .preset-view-button.active .preset-view-face {
    background: linear-gradient(135deg, #ffffff, #d6d6d6);
  }

  .preset-view-center {
    left: 69px;
    top: 74px;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    overflow: hidden;
  }

  .preset-view-center .preset-view-face {
    clip-path: none;
    background: url(${basePath}/assets/Icon_CenterTeethButton.png) center / contain no-repeat;
    border: 0;
    border-radius: 50%;
  }

  .preset-view-front {
    left: 22px;
    top: 138px;
    width: 58px;
    height: 36px;
    transform: rotate(-45deg);
  }

  .preset-view-front .preset-view-face {
    clip-path: polygon(0 0, 78% 0, 100% 50%, 78% 100%, 0 100%);
  }

  .preset-view-top {
    left: 83px;
    top: 0;
    width: 36px;
    height: 62px;
  }

  .preset-view-top .preset-view-face {
    clip-path: polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%);
  }

  .preset-view-bottom {
    left: 83px;
    top: 132px;
    width: 36px;
    height: 58px;
  }

  .preset-view-bottom .preset-view-face {
    clip-path: polygon(50% 0, 100% 32%, 100% 100%, 0 100%, 0 32%);
  }

  .preset-view-left {
    left: 0;
    top: 82px;
    width: 58px;
    height: 36px;
  }

  .preset-view-left .preset-view-face {
    clip-path: polygon(0 0, 78% 0, 100% 50%, 78% 100%, 0 100%);
  }

  .preset-view-right {
    right: 0;
    top: 82px;
    width: 58px;
    height: 36px;
  }

  .preset-view-right .preset-view-face {
    clip-path: polygon(22% 0, 100% 0, 100% 100%, 22% 100%, 0 50%);
  }

  .preset-view-rear {
    right: 22px;
    top: 38px;
    width: 58px;
    height: 36px;
    transform: rotate(-45deg);
  }

  .preset-view-rear .preset-view-face {
    clip-path: polygon(22% 0, 100% 0, 100% 100%, 22% 100%, 0 50%);
  }

  @media (max-width: 640px), (max-height: 720px) {
    .smart-btn {
      min-width: 132px;
      padding: 9px 12px;
      font-size: 12px;
    }

    #viewer-nav-toolbar {
      gap: 4px;
    }

    .preset-view-panel {
      transform: scale(0.82);
      transform-origin: bottom right;
    }
  }

  /* Tablet toolbar: full-width bar across the bottom, above the footer. */
  @media (min-width: 769px) and (max-width: 1024px) {

    #viewer-right-nav {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      height: auto;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 10px;
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)) 14px;
      border-left: 0;
      border-right: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 0;
      background: rgba(18, 18, 18, 0.92);
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.28);
    }

    .twod-viewer-nav-block {
      display: none;
    }

    .twod-mobile-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 2px;
      width: 58px;
      height: 58px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      background: rgba(48, 48, 48, 0.92);
      color: #ffffff;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .twod-mobile-trigger:active {
      background: rgba(68, 68, 68, 0.98);
    }

    #viewer-right-nav > * {
      flex: 0 0 auto;
      position: static;
    }

    .preset-view-panel {
      position: static;
      margin-top: 0;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      width: auto;
      height: auto;
      padding: 0;
      overflow: visible;
      transform: none;
      background: transparent;
      border: 0;
      box-shadow: none;
      z-index: auto;
    }

    .preset-view-pad { display: none; }

    .preset-view-current-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: 64px;
      pointer-events: auto;
    }

    .preset-view-current,
    .preset-view-dropdown-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 58px;
      height: 58px;
      border: 0;
      border-radius: 50%;
      background: rgba(42, 42, 42, 0.96);
      color: #ffffff;
      font-size: 46px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
      -webkit-text-stroke: 1px currentColor;
      text-rendering: geometricPrecision;
    }

    .preset-view-dropdown {
      display: none;
      position: absolute;
      left: 0;
      top: 0;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      max-height: min(360px, calc(100dvh - 220px));
      overflow-y: auto;
      overscroll-behavior: contain;
      border-radius: 12px;
      background: rgba(30, 30, 30, 0.96);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.38);
      pointer-events: auto;
    }

    .preset-view-dropdown.open {
      display: flex;
    }

    .preset-view-dropdown-button.active,
    .preset-view-current:hover,
    .preset-view-dropdown-button:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffd166;
    }

    .preset-view-center {
      display: none;
    }

    .preset-view-top,
    .preset-view-front,
    .preset-view-rear {
      position: static;
      width: 58px;
      height: 58px;
      transform: none;
    }

    .preset-view-left,
    .preset-view-right {
      position: static;
      width: 58px;
      height: 58px;
      transform: none;
    }

    .preset-view-bottom {
      position: static;
      width: 58px;
      height: 58px;
      transform: none;
    }

    .preset-view-front {
      left: auto;
      top: auto;
    }

    .preset-view-top .preset-view-face,
    .preset-view-front .preset-view-face,
    .preset-view-rear .preset-view-face {
      clip-path: none;
    }

    .preset-view-rear {
      left: auto;
      top: auto;
    }

    .preset-view-top {
      left: auto;
      top: auto;
    }

    .preset-view-bottom {
      left: auto;
      top: auto;
    }

    .preset-view-bottom .preset-view-face {
      clip-path: none;
    }

    .preset-view-left {
      left: auto;
      top: auto;
    }

    .preset-view-left .preset-view-face {
      clip-path: none;
    }

    .preset-view-right {
      left: auto;
      top: auto;
    }

    .preset-view-right .preset-view-face {
      clip-path: none;
    }

    .preset-view-button {
      filter: none;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.04);
    }

    .preset-view-button .preset-view-face {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      background: transparent;
      border: 0;
    }

    .preset-view-front .preset-view-face::after,
    .preset-view-rear .preset-view-face::after,
    .preset-view-top .preset-view-face::after,
    .preset-view-bottom .preset-view-face::after,
    .preset-view-left .preset-view-face::after,
    .preset-view-right .preset-view-face::after {
      position: absolute;
      left: 50%;
      top: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1em;
      height: 1em;
      color: #ffffff;
      font-size: 60px;
      font-weight: 800;
      line-height: 1;
      transform: translate(-50%, -50%);
      -webkit-text-stroke: 1px currentColor;
      text-rendering: geometricPrecision;
    }

    .preset-view-button:hover,
    .preset-view-button.active {
      background: rgba(255, 255, 255, 0.12);
      filter: none;
    }

    .preset-view-button:hover .preset-view-face,
    .preset-view-button.active .preset-view-face {
      background: transparent;
    }

    .preset-view-button.active .preset-view-face::after {
      color: #ffd166;
    }

    .preset-view-front .preset-view-face::after {
      content: "\\2197";
    }

    .preset-view-rear .preset-view-face::after {
      content: "\\2199";
    }

    .preset-view-top .preset-view-face::after {
      content: "\\2191";
    }

    .preset-view-bottom .preset-view-face::after {
      content: "\\2193";
    }

    .preset-view-left .preset-view-face::after {
      content: "\\2190";
    }

    .preset-view-right .preset-view-face::after {
      content: "\\2192";
    }

    #viewer-right-nav-top-row,
    .smart-btn-container-3d {
      display: contents;
    }

    #viewer-nav-toolbar {
      position: static;
      flex: 0 0 auto;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
      z-index: auto;
      order: 4;
      /* Matches its siblings' height at this breakpoint (see --toolbar-btn-size),
         so every icon sits on one visual line rather than in two rows. */
      height: 58px;
      /* The ONLY place reset/lock's size is set for this breakpoint —
         resetButton.js reads this variable rather than declaring its own. */
      --toolbar-btn-size: 58px;
    }

    #viewer-nav-toolbar .smart-btn {
      display: flex !important;
      /* Without these the icon sits flush at the TOP of the taller button: the
         img's margin:0 auto centres it horizontally only. */
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 58px;
      min-width: 58px;
      height: 58px;
      padding: 0;
    }

    #reset-icon,
    #lock-icon {
      width: 36px;
      height: 36px;
      /* reset.png/lock.png read slightly low once centred, so nudge both up.
         Tablet/mobile only — the desktop reset button is unaffected. */
      margin-bottom: 3px;
    }

    #viewer-nav-toolbar .smart-btn img {
      width: 36px;
      height: 36px;
    }

  }

  /* Phone toolbar: full-width bar across the bottom, above the footer. */
  @media (max-width: 768px) {

    #viewer-right-nav {
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      width: auto;
      height: auto;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 8px;
      overflow-x: auto;
      overflow-y: visible;
      -webkit-overflow-scrolling: touch;
      padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px)) 12px;
      border-left: 0;
      border-right: 0;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 0;
      background: rgba(18, 18, 18, 0.94);
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.28);
    }

    .twod-viewer-nav-block {
      display: none;
    }

    .twod-mobile-trigger {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 2px;
      width: 56px;
      height: 56px;
      padding: 0;
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 12px;
      background: rgba(48, 48, 48, 0.92);
      color: #ffffff;
      cursor: pointer;
      flex: 0 0 auto;
    }

    #viewer-right-nav > * {
      flex: 0 0 auto;
      position: static;
    }

    .preset-view-panel {
      position: static;
      margin-top: 0;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      width: auto;
      max-width: none;
      height: auto;
      padding: 0;
      overflow: visible;
      transform: none;
      background: transparent;
      border: 0;
      box-shadow: none;
      z-index: auto;
    }

    .preset-view-pad { display: none; }

    .preset-view-current-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: 60px;
      pointer-events: auto;
    }

    .preset-view-current,
    .preset-view-dropdown-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 50%;
      background: rgba(42, 42, 42, 0.96);
      color: #ffffff;
      font-size: 44px;
      font-weight: 800;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);
      -webkit-text-stroke: 1px currentColor;
      text-rendering: geometricPrecision;
    }

    .preset-view-dropdown {
      display: none;
      position: absolute;
      left: 0;
      top: 0;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      max-height: min(320px, calc(100dvh - 180px));
      overflow-y: auto;
      overscroll-behavior: contain;
      border-radius: 12px;
      background: rgba(30, 30, 30, 0.96);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.38);
      pointer-events: auto;
    }

    .preset-view-dropdown.open {
      display: flex;
    }

    .preset-view-dropdown-button.active,
    .preset-view-current:hover,
    .preset-view-dropdown-button:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffd166;
    }

    .preset-view-center {
      display: none;
    }

    .preset-view-top,
    .preset-view-front,
    .preset-view-rear {
      position: static;
      width: 56px;
      height: 56px;
      transform: none;
    }

    .preset-view-left,
    .preset-view-right {
      position: static;
      width: 56px;
      height: 56px;
      transform: none;
    }

    .preset-view-bottom {
      position: static;
      width: 56px;
      height: 56px;
      transform: none;
    }

    .preset-view-front {
      left: auto;
      top: auto;
    }

    .preset-view-top .preset-view-face,
    .preset-view-front .preset-view-face,
    .preset-view-rear .preset-view-face {
      clip-path: none;
    }

    .preset-view-rear {
      left: auto;
      top: auto;
    }

    .preset-view-top {
      left: auto;
      top: auto;
    }

    .preset-view-bottom {
      left: auto;
      top: auto;
    }

    .preset-view-bottom .preset-view-face {
      clip-path: none;
    }

    .preset-view-left {
      left: auto;
      top: auto;
    }

    .preset-view-left .preset-view-face {
      clip-path: none;
    }

    .preset-view-right {
      left: auto;
      top: auto;
    }

    .preset-view-right .preset-view-face {
      clip-path: none;
    }

    .preset-view-button {
      filter: none;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.04);
    }

    .preset-view-button .preset-view-face {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      background: transparent;
      border: 0;
    }

    .preset-view-button[data-mobile-arrow="right"] .preset-view-face::after,
    .preset-view-button[data-mobile-arrow="left"] .preset-view-face::after,
    .preset-view-button[data-mobile-arrow="up"] .preset-view-face::after,
    .preset-view-button[data-mobile-arrow="down"] .preset-view-face::after {
      position: absolute;
      left: 50%;
      top: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 1em;
      height: 1em;
      color: #ffffff;
      font-size: 60px;
      font-weight: 800;
      line-height: 1;
      transform: translate(-50%, -50%);
      -webkit-text-stroke: 1px currentColor;
      text-rendering: geometricPrecision;
    }

    .preset-view-button:hover,
    .preset-view-button.active {
      background: rgba(255, 255, 255, 0.12);
      filter: none;
    }

    .preset-view-button:hover .preset-view-face,
    .preset-view-button.active .preset-view-face {
      background: transparent;
    }

    .preset-view-button.active .preset-view-face::after {
      color: #ffd166;
    }

    .preset-view-front .preset-view-face::after {
      content: "\\2197";
    }

    .preset-view-rear .preset-view-face::after {
      content: "\\2199";
    }

    .preset-view-top .preset-view-face::after {
      content: "\\2191";
    }

    .preset-view-bottom .preset-view-face::after {
      content: "\\2193";
    }

    .preset-view-left .preset-view-face::after {
      content: "\\2190";
    }

    .preset-view-right .preset-view-face::after {
      content: "\\2192";
    }

    #viewer-right-nav-top-row,
    .smart-btn-container-3d {
      display: contents;
    }

    #viewer-nav-toolbar {
      position: static;
      flex: 0 0 auto;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 6px;
      z-index: auto;
      order: 4;
      /* Matches its siblings' height at this breakpoint (see --toolbar-btn-size),
         so every icon sits on one visual line rather than in two rows. */
      height: 56px;
      /* See the tablet rule above — the only place reset/lock's size is set
         for this breakpoint, read by resetButton.js's var(). */
      --toolbar-btn-size: 56px;
    }

    #viewer-nav-toolbar .smart-btn {
      display: flex !important;
      /* See the tablet rule above — without these, the icon sits flush at
         the top of the button's box instead of centered ("floating top"). */
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      width: 56px;
      min-width: 56px;
      height: 56px;
      padding: 0;
    }

    #reset-icon,
    #lock-icon {
      width: 34px;
      height: 34px;
      margin-right: 0;
      /* reset.png/lock.png read slightly low once centred, so nudge both up.
         Phone/tablet only — the desktop reset button is unaffected. */
      margin-bottom: 3px;
    }

    #viewer-nav-toolbar .smart-btn img {
      width: 34px;
      height: 34px;
    }

  }

  @media (max-width: 430px) {
    .preset-view-current,
    .preset-view-dropdown-button {
      width: 50px;
      height: 50px;
      font-size: 40px;
    }
  }
	
	.twod-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0,0,0,0.6);
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;
}

.twod-group {
  background: #fff;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 0 15px rgba(0,0,0,0.3);
  text-align: center;
}

.twod-fullscreen-image {
  max-width: 90vw;
  max-height: 70vh;
  margin-bottom: 15px;
}

@media (max-width: 1024px) {
  .twod-group {
    padding: 12px;
    max-width: min(520px, 88vw);
    max-height: 78dvh;
    overflow-y: auto;
  }
  .twod-fullscreen-image {
    max-width: 100%;
    max-height: 48dvh;
    margin-bottom: 8px;
  }
}

.smart-btn-container-2d {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.smart-btn-container-2d .smart-btn {
  min-width: 0;
  width: 52px;
  height: 52px;
  padding: 8px;
  border-radius: 10px;
  flex: 0 0 auto;
}

.smart-btn-container-2d .smart-btn img {
  width: 30px;
  height: 30px;
}

  
  #center-load-button {
    position: static;
    transform: none;
  }

  #container3D {
      position: relative;
  }

  .case-title {
      position: absolute;
      top: 8px;
      left: 50%;
      font-size: 22px;
      font-weight: bold;
      color: black;
      text-shadow: 0px 0px 8px rgba(0, 0, 0, 0.7);
      z-index: 10;
      pointer-events: none;
  }
  
  @media (max-height: 950px) {
	  #center-load-button {
		transform: none;
	  }
	}

	@media (max-height: 700px) {
	  #center-load-button {
		transform: none;
	  }
	}

  
  @media (max-width: 1024px) {
    #center-load-button {
		transform: none;
		}
	}

  @media (max-width: 768px) {
      .smart-btn-container {
          grid-template-columns: 1fr !important;
      }
  }

  .vpm-active {
    box-shadow: 0 0 0 2px #38bdf8, 0 0 10px rgba(56, 189, 248, 0.35) !important;
    background: #0c4a6e !important;
    transition: box-shadow 0.15s, background 0.15s, opacity 0.15s, filter 0.15s;
  }

  .vpm-dimmed {
    opacity: 0.35;
    filter: grayscale(0.55);
    transition: opacity 0.15s, filter 0.15s;
  }
`;
  document.head.appendChild(style);


  // The viewer LANDS on the uploaded slot STLs; the case's own mesh and overlays
  // load hidden behind the 3D button. Both stay in memory, so switching is instant.
  const designSlotMeshes = [];
  let designViewActive = false;

  // Fixed slot layout, mirroring EXTRA_STL_SLOT_NAMES in 2D/preview3D.js:
  // 1 upper jaw, 2 upper framework, 3 lower jaw, 4 lower framework.
  const EXTRA_STL_SLOT_JAW = { 1: "upper", 2: "upper", 3: "lower", 4: "lower" };
  // Framework slots follow the case's denture-base material in name and finish
  // (slotDisplayName / frameworkFinish), as the 2D page's Extra 3D tab does.
  const FRAMEWORK_SLOTS = new Set([2, 4]);
  // Row label + icon per slot, same as the 3D preview panel's "Other 3D files".
  const EXTRA_STL_SLOT_NAMES = {
    1: "Upper jaw",
    3: "Lower jaw",
  };
  const EXTRA_STL_SLOT_ICONS = {
    1: "Icon_UpperJaw_Occlusal.png",
    2: "upper.svg",
    3: "Icon_LowerJaw_Occlusal.png",
    4: "lower.svg",
  };
  // Identical to the 3D preview panel's extraJawColor / METAL_RPD_COLOR, so one
  // upload reads the same in both places.
  //
  // Float components go into THREE.Color UNCONVERTED (three treats them as
  // already-linear), which is what matches the jaw meshes' 208/190/141. A hex
  // instead is read as sRGB and converted, landing a much darker brown.
  const EXTRA_STL_JAW_COLOR = new THREE.Color(208 / 255, 190 / 255, 141 / 255);
  const METAL_RPD_COLOR = 0xd6dadf; // brushed cobalt-chrome / stainless
  const ACRYLIC_RPD_COLOR = 0xd9928a; // acrylic denture base: warm salmon-rose

  // The saved 2D design's "Jaw Material" (0 = metal, 2 = full acrylic). null until
  // fetched, or when the case has no design yet — both read as metal.
  let caseJawMaterial = null;
  const isFullAcrylicCase = () => caseJawMaterial === FULL_ACRYLIC_MATERIAL;

  // Label per slot. Framework slots keep their arch prefix: the upload tiles show
  // the name alone, so two bare "Monoblock" tiles would be indistinguishable.
  function slotDisplayName(slot) {
    if (FRAMEWORK_SLOTS.has(slot)) {
      const arch = EXTRA_STL_SLOT_JAW[slot] === "lower" ? "Lower" : "Upper";
      return `${arch} ${isFullAcrylicCase() ? "Monoblock" : "Metal RPD"}`;
    }
    return EXTRA_STL_SLOT_NAMES[slot] || "3D file";
  }

  // Surface of a framework slot under the case material — same values as preview3D.
  function frameworkFinish() {
    return isFullAcrylicCase()
      ? { color: ACRYLIC_RPD_COLOR, metalness: 0.05, roughness: 0.55 }
      : { color: METAL_RPD_COLOR, metalness: 0.85, roughness: 0.32 };
  }

  // One small request per slot load. apiClient.post hands back the string "stl" on
  // a 404/500, which decodes to no material — i.e. metal.
  async function loadCaseJawMaterial() {
    try {
      const records = await apiClient.post(
        "/jawstruct/l2/getall",
        [
          {
            machine_id: MACHINE_ID,
            uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
            caseIntID: paramValue,
          },
          { case_id: paramValue },
        ],
        false,
        "Case material"
      );
      caseJawMaterial = decodedJawMaterial(decodeJawStructResponse(records));
    } catch (error) {
      console.warn("[viewer3D] jawstruct fetch failed — framework slots read as metal", error);
      caseJawMaterial = null;
    }
  }

  function disposeDesignSlotMesh(mesh) {
    parentObject.remove(mesh);
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((entry) => entry?.dispose?.());
    // STLMeshLoader returns geometry variants (normal/occlusion/undercut) in
    // this map, not materials — dispose them too.
    all_mesh_mat[mesh.name]?.forEach?.((entry) => entry?.dispose?.());
    delete all_mesh_mat[mesh.name];
  }

  // Shared by the initial load and by an upload, which renders the bytes it just
  // sent rather than asking for them back — as preview3D's renderExtraStl does.
  function addDesignSlotMesh(slot, filename, binarySTL) {
    // Re-uploading a slot replaces what was there.
    const previous = designSlotMeshes.findIndex(
      (mesh) => mesh.userData?.designSlot === slot
    );
    if (previous !== -1) {
      disposeDesignSlotMesh(designSlotMeshes[previous]);
      designSlotMeshes.splice(previous, 1);
    }

    // Same finish the 3D preview panel gives these files: jaw uploads in the jaw
    // tan, framework slots in the case material's finish.
    const slotMaterial = new THREE.MeshStandardMaterial({
      // Passing a Color copies it into the material's own instance, so the shared
      // jaw constant above is never mutated by a slot.
      ...(FRAMEWORK_SLOTS.has(slot)
        ? frameworkFinish()
        : { color: EXTRA_STL_JAW_COLOR, metalness: 0.05, roughness: 0.6 }),
      opacity: 1,
      transparent: false,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });

    // Jaw side comes from the SLOT NUMBER, never the filename — uploads are named
    // freely, so "jawSTLSlot3.stl" (lower) was read as upper and mis-transformed.
    const isLower = EXTRA_STL_SLOT_JAW[slot] === "lower";
    const undercutForSlot =
      (isLower ? undercut_values[0] : undercut_values[1]) ?? "stl";
    // Names key all_mesh_mat, so keep them unique even if two slots hold files
    // with the same name.
    const slotFilename = `Slot ${slot}: ${filename || "3D file"}`;

    const stlLoader = new STLMeshLoader(slotMaterial);
    const [mesh, meshMaterials] = stlLoader.load(binarySTL, undercutForSlot);
    all_mesh_mat[slotFilename] = meshMaterials.slice();

    mesh.name = slotFilename;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      jaw_type: isLower ? "lower" : "upper",
      archLabel: isLower ? "Lower Arch" : "Upper Arch",
      // Marks this as a design-slot mesh and carries which slot it came from, so
      // the objects panel can give each slot its own row.
      isDesignSlot: true,
      designSlot: slot,
      // Raw upload name, for the slot manager's row label.
      sourceFilename: filename || "3D file",
    };

    // NO transform: slots render exactly as uploaded, so the viewer shows what is
    // in the files. The OFF upper jaw's 180° Z flip must NOT be applied — it turns
    // the arch upside down through the lower one.
    //
    // Uploads aren't guaranteed to share a frame (case 2967: both casts teeth-up
    // over one Z band, ~20mm interpenetration). An articulated export is the fix.

    enforceOpaqueJawMesh(mesh);
    parentObject.add(mesh);
    designSlotMeshes.push(mesh);
    return mesh;
  }

  // ---- Undercut heatmap on the uploaded jaw slots -------------------------
  //
  // NEVER copy the case scan's heatmap onto an upload: the viewer serves the scan
  // as the parameterisation mesh (re-oriented and smoothed), so neither
  // coordinates nor vertex order line up — only 17% of case 2270's upload
  // vertices land within 1mm — and copying scatters the heatmap as speckle.
  //
  // The upload is surveyed on its own via /dll/compute-surveying-no-pd, which
  // takes the STL as `stl_data` and returns one value per welded vertex in
  // exactly STLMeshLoader.mergeVertices' order (both weld at 1e-4, first-seen),
  // so this is a straight index lookup with nothing to match.
  //
  // Matches preview3D.js: the survey rides with the slot's own mesh load
  // (ensureSlotUndercutGeometry, called right after addDesignSlotMesh) rather
  // than waiting for the undercut button — the button only toggles between
  // geometry variants that are already sitting in mesh.userData, same as the
  // preview's heatmap-is-baked-in-before-display approach.

  const UNDERCUT_TAN = [208 / 255, 190 / 255, 141 / 255];

  // three.js reads colour attributes as LINEAR, so the sRGB bands below convert.
  // UNDERCUT_TAN deliberately does NOT, matching preview3D.js — do not "fix".
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  // Desktop's undercutColourMap, in the same raw-float convention the loaders use for the
  // API's own heatmap RGBA. Thresholds/hex values match preview3D.js's colorForSurveyingValue.
  function slotUndercutColour(value) {
    if (!(value > 0)) return UNDERCUT_TAN;
    let rgb;
    if (value < 0.25) rgb = [1, 210 / 255, 0]; // #FFD200
    else if (value < 0.5) rgb = [253 / 255, 140 / 255, 0]; // #FD8C00
    else if (value < 0.75) rgb = [254 / 255, 70 / 255, 0]; // #FE4600
    else rgb = [170 / 255, 0, 3 / 255]; // #AA0003
    return rgb.map(srgbToLinear);
  }

  // Insertion vectors are already stored in the DLL/mesh frame; the only step to
  // the DLL's `dir` is desktop's per-jaw flip. (0,0,0) means never surveyed.
  function slotSurveyDirection(jawKey) {
    return savedSurveyDirection(jawKey);
  }

  function base64ToFloat32Array(base64) {
    const binary = atob(String(base64).replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }

  // Paces the survey phase of the progress bar; measured 5-17s on case 2270. The
  // bar eases to the end of its phase and waits there rather than claiming done.
  const SLOT_SURVEY_EXPECTED_MS = 15000;

  // The viewer's loading screen, used only to cover a click that lands before the
  // slot's eager survey (see ensureSlotUndercutGeometry) has resolved — the DLL
  // call itself reports no server-side progress, so this eases across it on a timer.
  function beginSlotSurveyProgress(slotLabel) {
    const ownsScreen = !document.getElementById("viewer-loading-screen");
    if (ownsScreen) createViewerLoadingScreen();
    // Captured before any stand-in is swapped in below, so painting always reaches the real bar.
    const els = window.viewerLoadingEls;
    const bar = els?.progressBar;
    const percentEl = els?.percentage;
    const displayEl = els?.displayBox;
    let creepTimer = null;

    const paint = (fraction, label) => {
      const percent = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
      if (bar) {
        bar.max = 100;
        bar.value = percent;
        // The card ships with the bar hidden — ApiClient reveals it when a download reports a
        // content-length, and that write goes into the stand-in here, so do it ourselves.
        bar.style.display = "block";
      }
      if (percentEl) percentEl.textContent = `${percent}%`;
      if (displayEl) displayEl.textContent = slotLabel;
      if (label) window.updateViewerLoading?.(label);
    };

    const stopCreep = () => {
      if (creepTimer) clearInterval(creepTimer);
      creepTimer = null;
    };

    paint(0.02, `Reading ${slotLabel}…`);

    return {
      // The DLL answers in one go, so ease across its phase on a timer instead.
      startSurveyPhase(from, to, label) {
        paint(from, label);
        const startedAt = performance.now();
        creepTimer = setInterval(() => {
          const elapsed = (performance.now() - startedAt) / SLOT_SURVEY_EXPECTED_MS;
          paint(from + (to - from) * Math.min(elapsed, 1));
        }, 250);
      },
      set(fraction, label) {
        stopCreep();
        paint(fraction, label);
      },
      end() {
        stopCreep();
        if (ownsScreen) removeViewerLoadingScreen();
      },
    };
  }

  // Survey this slot's own STL (already in hand from the mesh load — never
  // re-fetched). `values` is one undercut value per welded vertex; `reason` is
  // set (and values null) whenever the survey couldn't run at all, so the
  // panel can tell the user WHY the toggle didn't turn on instead of just
  // silently reverting — see ensureSlotUndercutGeometry/buildSlotUndercutGeometry.
  async function computeSlotSurveyValues(slot, jawKey, stlDataBase64, progress) {
    const dir = slotSurveyDirection(jawKey);
    if (!dir) {
      console.warn(
        `[viewer3D] slot ${slot}: the case has no ${jawKey} insertion angle, so there is nothing to survey`
      );
      return {
        values: null,
        reason: `No saved insertion angle for the ${jawKey} jaw — set the survey angle first, then re-open this file.`,
      };
    }
    if (!stlDataBase64) {
      console.warn(`[viewer3D] slot ${slot}: no upload bytes to survey`);
      return { values: null, reason: "No upload data to survey." };
    }

    const authPayload = {
      machine_id: MACHINE_ID,
      uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
      caseIntID: paramValue,
    };

    const startedAt = performance.now();
    // Paced estimate while the DLL works — there is no download phase any more,
    // the bytes rode in with the slot's own mesh load.
    progress?.startSurveyPhase?.(0.1, 0.95, "Surveying undercut…");
    let response;
    try {
      response = await apiClient.post(
        "/dll/compute-surveying-no-pd",
        [
          authPayload,
          {
            case_id: paramValue,
            type: jawKey === "upper" ? 1 : 2,
            // The mesh to survey travels with the request, so this is the upload's own
            // undercut rather than the case scan's.
            stl_data: stlDataBase64,
            dir,
            printFullSurveying: true,
            returnSurveyingBase64: true,
          },
        ],
        false,
        `Slot ${slot} undercut`
      );
    } finally {
      progress?.set?.(0.95);
    }
    const base64 = response?.surveying_values_base64;
    if (!base64) {
      console.warn(`[viewer3D] slot ${slot}: the surveying call returned no values`, response);
      return { values: null, reason: "The undercut survey returned no data — try again." };
    }
    const values = base64ToFloat32Array(base64);
    console.log(
      `[viewer3D] slot ${slot}: surveyed ${values.length} vertices in ${Math.round(
        performance.now() - startedAt
      )}ms`
    );
    return { values, reason: null };
  }

  // Kicks off this slot's undercut survey as soon as its mesh lands (initial
  // load or a re-upload) instead of waiting for the undercut button — mirrors
  // preview3D.js, where the heatmap rides with the mesh fetch. Fire-and-forget:
  // callers don't await this, so a slow slot's survey never holds up the
  // others' downloads. Idempotent — a second call while one is in flight
  // (or already resolved) reuses the same promise rather than re-surveying.
  function ensureSlotUndercutGeometry(slot, stlDataBase64) {
    if (FRAMEWORK_SLOTS.has(slot)) return null; // framework slots carry no undercut
    const mesh = designSlotMeshes.find((m) => m.userData?.designSlot === slot);
    if (!mesh) return null;
    if (mesh.userData.undercutSurveyPromise) return mesh.userData.undercutSurveyPromise;

    const jawKey = mesh.userData?.jaw_type === "lower" ? "lower" : "upper";
    const promise = computeSlotSurveyValues(slot, jawKey, stlDataBase64)
      .then(({ values, reason }) => {
        mesh.userData.undercutGeometry = values ? buildSlotUndercutGeometry(mesh, values) : null;
        // buildSlotUndercutGeometry sets its own (more specific) reason when values
        // exist but still fail to apply — only fall back to the survey-level one
        // when there were no values to try in the first place.
        if (!mesh.userData.undercutGeometry && !mesh.userData.undercutUnavailableReason) {
          mesh.userData.undercutUnavailableReason = reason;
        }
        return mesh.userData.undercutGeometry;
      })
      .catch((error) => {
        console.warn(`[viewer3D] slot ${slot}: eager undercut survey failed`, error);
        mesh.userData.undercutGeometry = null;
        mesh.userData.undercutUnavailableReason = "The undercut survey failed — try again.";
        return null;
      });
    mesh.userData.undercutSurveyPromise = promise;
    return promise;
  }

  // The slot's undercut geometry variant: its own mesh, coloured by its own survey.
  // Sets slotMesh.userData.undercutUnavailableReason on failure (cleared on success)
  // so the panel can explain why the toggle didn't turn on, instead of it just
  // silently reverting — see ensureSlotUndercutGeometry above and the undercut
  // button's click handler in newControls.js.
  function buildSlotUndercutGeometry(slotMesh, values) {
    const base = all_mesh_mat[slotMesh.name]?.[0];
    if (!base || !values?.length) {
      slotMesh.userData.undercutUnavailableReason = "No base mesh to colour.";
      return null;
    }

    const geometry = base.clone();
    const count = geometry.attributes.position.count;
    if (values.length !== count) {
      // The DLL welds the STL the way the loader does, so this should be exact. A mismatch
      // means the two disagree about the mesh, and colouring by index would misplace bands.
      console.warn(
        `[viewer3D] ${slotMesh.name}: survey returned ${values.length} values for ${count} vertices — undercut not applied`
      );
      slotMesh.userData.undercutUnavailableReason =
        "This file changed after it was surveyed — re-upload it to refresh the undercut view.";
      return null;
    }
    slotMesh.userData.undercutUnavailableReason = null;

    const colors = new Float32Array(count * 3);
    for (let v = 0; v < count; v += 1) {
      const [r, g, b] = slotUndercutColour(values[v]);
      colors[v * 3] = r;
      colors[v * 3 + 1] = g;
      colors[v * 3 + 2] = b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  function isDesignSlotUndercutOn(slot) {
    return Boolean(
      designSlotMeshes.find((mesh) => mesh.userData?.designSlot === slot)?.userData
        ?.undercutOn
    );
  }

  // The survey itself already ran when this slot's mesh landed
  // (ensureSlotUndercutGeometry) — this only ever toggles between the two
  // geometry variants that are already sitting in mesh.userData, so pressing
  // the button never starts a network call of its own. Still async because a
  // fast click can land before that eager survey has resolved, in which case
  // this just waits on it rather than firing a second one.
  async function setDesignSlotUndercut(slot, enabled) {
    const mesh = designSlotMeshes.find((m) => m.userData?.designSlot === slot);
    if (!mesh) return false;

    if (!enabled) {
      const base = all_mesh_mat[mesh.name]?.[0];
      if (base) mesh.geometry = base;
      if (mesh.userData.slotPlainMaterial) mesh.material = mesh.userData.slotPlainMaterial;
      mesh.userData.undercutOn = false;
      return false;
    }

    if (mesh.userData.undercutGeometry === undefined && mesh.userData.undercutSurveyPromise) {
      const progress = beginSlotSurveyProgress(
        `Slot ${slot}: ${slotDisplayName(slot)}`
      );
      progress.set(0.5, "Finishing undercut survey…");
      try {
        await mesh.userData.undercutSurveyPromise;
        progress.set(1, "Done");
      } finally {
        progress.end();
      }
    }
    const geometry = mesh.userData.undercutGeometry;
    if (!geometry) {
      mesh.userData.undercutOn = false;
      return false;
    }

    // The slot's own material paints a flat colour; the heatmap needs the vertex colours, so
    // each slot keeps a second material and swaps between the two.
    mesh.userData.slotPlainMaterial = mesh.userData.slotPlainMaterial || mesh.material;
    mesh.userData.undercutMaterial =
      mesh.userData.undercutMaterial ||
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0,
        roughness: 0.5,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
        depthTest: true,
        depthWrite: true,
      });
    mesh.geometry = geometry;
    mesh.material = mesh.userData.undercutMaterial;
    mesh.userData.undercutOn = true;
    return true;
  }

  // Jaw uploads open in undercut mode once their eager survey is ready. Keep the
  // slot download flow non-blocking: the remaining files can continue loading
  // while the DLL computes the heatmap for slots 1 and 3.
  function enableDefaultSlotUndercut(slot, mesh, surveyPromise) {
    if (FRAMEWORK_SLOTS.has(slot) || !surveyPromise) return;

    Promise.resolve(surveyPromise)
      .then(async (geometry) => {
        // A re-upload may have replaced this mesh while its old survey was still
        // running. Never apply stale geometry to the replacement.
        const currentMesh = designSlotMeshes.find(
          (entry) => entry.userData?.designSlot === slot
        );
        if (!geometry || currentMesh !== mesh) return;

        const applied = await setDesignSlotUndercut(slot, true);
        if (applied && designViewActive) rebuildObjectsPanel();
      })
      .catch((error) => {
        console.warn(`[viewer3D] slot ${slot}: default undercut view failed`, error);
      });
  }

  function isDesignViewActive() {
    return designViewActive;
  }

  // In design view the panel lists the four slots (empty ones disabled) instead of
  // the case's rows. Returns [] in case view, which restores them.
  function getDesignSlotRoster() {
    if (!designViewActive || !designSlotMeshes.length) return [];
    return [1, 2, 3, 4].map((slot) => ({
      slot,
      label: `Slot ${slot}: ${slotDisplayName(slot)}`,
      iconPath: `${basePath}/assets/${EXTRA_STL_SLOT_ICONS[slot]}`,
      // Lets the mini icon tray split into an upper row and a lower row (see
      // buildDesignSlotGroups/getMiniIconRow in newControls.js) the same way
      // the plain case view's jaw/mesh/polyline/teeth groups do.
      jawGroup: EXTRA_STL_SLOT_JAW[slot],
      mesh: designSlotMeshes.find((m) => m.userData?.designSlot === slot) || null,
      // Only the jaw slots get their own survey — the framework slots are a
      // different mesh with no undercut data. Jaw slots switch to undercut mode
      // automatically as soon as their eager survey completes.
      supportsUndercut: !FRAMEWORK_SLOTS.has(slot),
      getUndercut: () => isDesignSlotUndercutOn(slot),
      setUndercut: (enabled) => setDesignSlotUndercut(slot, enabled),
      // Why the toggle didn't turn on, when it didn't — set by
      // ensureSlotUndercutGeometry/buildSlotUndercutGeometry above.
      getUndercutUnavailableReason: () =>
        designSlotMeshes.find((m) => m.userData?.designSlot === slot)?.userData
          ?.undercutUnavailableReason ?? null,
    }));
  }

  // What was hidden to show the design, with the visibility each item had
  // beforehand, so switching back restores exactly what was on screen.
  const hiddenCaseMeshes = [];
  const hiddenCaseOverlays = [];
  const hiddenDesignMeshes = [];

  const JAW_KEYS = ["upper", "lower"];

  // Hides the case's meshes and both overlays, which belong to the scan, not the
  // uploads. Re-callable: overlays finish loading long after the design is up.
  function hideCaseAssetsForDesign() {
    parentObject.children.forEach((child) => {
      if (!child.isMesh || child.userData?.isDesignSlot) return;
      if (hiddenCaseMeshes.some((entry) => entry.mesh === child)) return;
      hiddenCaseMeshes.push({ mesh: child, visible: child.visible });
      child.visible = false;
    });

    JAW_KEYS.forEach((jaw) => {
      if (hiddenCaseOverlays.some((entry) => entry.jaw === jaw)) return;
      hiddenCaseOverlays.push({
        jaw,
        polyline: window.getPolylineJawVisibility?.(jaw) ?? true,
        teeth: artificialTeethRenderer.getJawVisibility?.(jaw) ?? true,
      });
      window.setPolylineJawVisibility?.(jaw, false);
      artificialTeethRenderer.setJawVisibility?.(jaw, false);
    });
  }

  function restoreCaseAssets() {
    hiddenCaseMeshes.splice(0).forEach(({ mesh, visible }) => {
      mesh.visible = visible;
    });
    hiddenCaseOverlays.splice(0).forEach(({ jaw, polyline, teeth }) => {
      window.setPolylineJawVisibility?.(jaw, polyline);
      artificialTeethRenderer.setJawVisibility?.(jaw, teeth);
    });
    window.syncArtificialTeethToJaw?.();
  }

  // Slot meshes are kept in memory when the case view is showing, so coming
  // back to the design costs nothing.
  function hideDesignMeshes() {
    designSlotMeshes.forEach((mesh) => {
      hiddenDesignMeshes.push({ mesh, visible: mesh.visible });
      mesh.visible = false;
    });
  }

  function showDesignMeshes() {
    if (!hiddenDesignMeshes.length) return;
    hiddenDesignMeshes.splice(0).forEach(({ mesh, visible }) => {
      mesh.visible = visible;
    });
  }

  function rebuildObjectsPanel() {
    removeVisibilityAndTransparencyControls();
    addVisibilityAndTransparencyControls(
      parentObject,
      name,
      all_mesh_mat,
      getDesignSlotRoster()
    );
  }

  // Fetches the uploads on first use, then it is just a visibility flip. False
  // when the case has none, so the caller offers the upload affordance instead.
  async function showDesignView({ silent = false } = {}) {
    if (!designSlotMeshes.length) {
      const loaded = await loadAllSTLSlots({ silent });
      if (!loaded) return false;
    } else {
      showDesignMeshes();
    }
    removeDesignUploadPrompt();
    activateDesignView();
    return true;
  }

  // Design view with whatever slot meshes are already loaded. Split out so an
  // upload can show what it just added without re-fetching all four slots.
  function activateDesignView() {
    designViewActive = true;
    hideCaseAssetsForDesign();
    updateViewerRotationOrigin();
    syncPolylineFocusMode();
    controls.update();
    rebuildObjectsPanel();
    window.syncDesignViewButton?.(true);
  }

  // ── Upload affordance for a case with no uploads ────────────────────────
  // Mirrors the 3D preview panel's empty rows: a "+" per slot that picks a file,
  // POSTs to /stl/slot/, then reloads the design view.
  function removeDesignUploadPrompt() {
    document.getElementById("design-upload-prompt")?.remove();
  }

  function uploadSlotStl(payload, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/stl/slot/`);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve(xhr.responseText)
          : reject(new Error(`HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error("network error"));
      xhr.send(payload);
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",").pop());
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // Validates, uploads and renders one File into one slot. Shared by the file
  // picker and drag-and-drop, which each just hand it a File.
  async function uploadFileToSlot(file, slot, statusEl) {
    if (!file) return;
    if (!/\.stl$/i.test(file.name)) {
      statusEl.textContent = "Only .stl files are supported.";
      return;
    }

    statusEl.textContent = `Uploading ${file.name}…`;
    setUploadPromptBusy(true);
    setSlotTileBusy(slot, "Reading file");
    try {
      const base64 = await fileToBase64(file);
      await uploadSlotStl(
        JSON.stringify([
          {
            machine_id: MACHINE_ID,
            uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
            caseIntID: paramValue,
          },
          // case_id belongs in THIS object, not the auth one (same as POST /stl):
          // without it the insert 500s with no CORS header, seen as "Failed to fetch".
          {
            case_id: paramValue,
            slotNumber: slot,
            filename: file.name,
            data: base64,
          },
        ]),
        (fraction) => setSlotTileBusy(slot, "Uploading", fraction)
      );

      // Render the bytes just sent rather than showDesignView(), which re-downloads
      // every slot and tears the panel down, ending the session after one upload.
      statusEl.textContent = `${file.name} uploaded. Preparing…`;
      setSlotTileBusy(slot, "Preparing");
      // Parsing blocks the main thread, so let the tile paint "Preparing…" first.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const mesh = addDesignSlotMesh(slot, file.name, atob(base64));
      // Same as the initial load: survey rides with the mesh, not the button.
      const surveyPromise = ensureSlotUndercutGeometry(slot, base64);
      enableDefaultSlotUndercut(slot, mesh, surveyPromise);
      activateDesignView();
      statusEl.textContent = `${file.name} uploaded.`;
    } catch (error) {
      console.error("[viewer3D] slot upload failed", error);
      statusEl.textContent = "Upload failed. Please try again.";
    } finally {
      clearSlotTileBusy(slot);
      setUploadPromptBusy(false);
    }
  }

  async function pickAndUploadSlot(slot, statusEl) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".stl";
    input.hidden = true;
    document.body.appendChild(input);
    const file = await new Promise((resolve) => {
      input.addEventListener("change", () => resolve(input.files?.[0] || null));
      input.click();
    });
    input.remove();
    await uploadFileToSlot(file, slot, statusEl);
  }

  // Lets a tile take a dragged-in STL, not just the file picker. Same guard as
  // the click path: a filled or busy slot refuses the drop.
  function wireSlotDropTarget(wrap, slot, statusEl) {
    const canAcceptDrop = () =>
      !wrap.classList.contains("is-filled") && !wrap.classList.contains("is-busy");

    wrap.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = canAcceptDrop() ? "copy" : "none";
      if (canAcceptDrop()) wrap.classList.add("is-dragover");
    });
    wrap.addEventListener("dragleave", (event) => {
      // Children re-fire dragenter/dragleave as the pointer crosses them —
      // only clear the highlight once the pointer has actually left wrap.
      if (wrap.contains(event.relatedTarget)) return;
      wrap.classList.remove("is-dragover");
    });
    wrap.addEventListener("drop", (event) => {
      event.preventDefault();
      wrap.classList.remove("is-dragover");
      if (!canAcceptDrop()) {
        statusEl.textContent = "Delete the existing file before replacing it.";
        return;
      }
      const file = event.dataTransfer.files?.[0];
      if (file) uploadFileToSlot(file, slot, statusEl);
    });
  }

  // Which slot numbers already hold a file, from the meshes themselves — a slot
  // is occupied exactly when something is rendered for it.
  function getUploadedSlotName(slot) {
    return designSlotMeshes.find((mesh) => mesh.userData?.designSlot === slot)
      ?.userData?.sourceFilename;
  }

  function getSlotWrap(slot) {
    return document.querySelector(
      `#design-upload-prompt .dup-slot-wrap[data-slot="${slot}"]`
    );
  }

  // Each slot gets its own bar, so four downloads don't share one number.
  // A null fraction draws an indeterminate bar (parsing, deleting — no bytes).
  function setSlotTileBusy(slot, note, fraction = null) {
    const wrap = getSlotWrap(slot);
    if (!wrap) return;
    wrap.classList.add("is-busy");
    const bar = wrap.querySelector(".dup-slot-bar");
    const noteEl = wrap.querySelector(".dup-slot-note");
    if (bar) {
      if (fraction == null) {
        bar.removeAttribute("value");
      } else {
        bar.value = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
      }
    }
    if (noteEl) {
      noteEl.textContent =
        fraction == null ? `${note}…` : `${note} ${Math.round(fraction * 100)}%`;
    }
  }

  function clearSlotTileBusy(slot) {
    const wrap = getSlotWrap(slot);
    if (!wrap) return;
    wrap.classList.remove("is-busy");
    const bar = wrap.querySelector(".dup-slot-bar");
    if (bar) bar.value = 0;
    const noteEl = wrap.querySelector(".dup-slot-note");
    if (noteEl) noteEl.textContent = "";
  }

  // Gives ApiClient a per-slot stand-in for the loading screen's progress
  // elements. Restore() MUST run before the next slot starts.
  function routeSlotDownloadProgress(slot) {
    const previous = window.viewerLoadingEls;
    let fileMax = 1;
    let fileValue = 0;
    const progressStandIn = {
      style: {},
      get max() {
        return fileMax;
      },
      set max(bytes) {
        fileMax = Number(bytes) || 1;
      },
      get value() {
        return fileValue;
      },
      set value(bytes) {
        fileValue = Number(bytes) || 0;
        setSlotTileBusy(slot, "Downloading", Math.min(fileValue / fileMax, 1));
      },
    };
    window.viewerLoadingEls = {
      progressBar: progressStandIn,
      // ApiClient writes a percentage and a speed readout; the tile shows its own.
      percentage: { textContent: "" },
      displayBox: { textContent: "" },
    };
    return {
      restore() {
        if (previous) window.viewerLoadingEls = previous;
        else delete window.viewerLoadingEls;
      },
    };
  }

  // Repaints every tile from current state, so the panel stays open for the next
  // file after each upload — as preview3D's "Other 3D files" list does.
  function refreshUploadPromptSlots() {
    const prompt = document.getElementById("design-upload-prompt");
    if (!prompt) return;

    prompt.querySelectorAll(".dup-slot-wrap").forEach((wrap) => {
      const slot = Number(wrap.dataset.slot);
      const filename = getUploadedSlotName(slot);
      const label = slotDisplayName(slot);
      const tile = wrap.querySelector(".dup-slot");
      const deleteBtn = wrap.querySelector(".dup-slot-delete");

      wrap.classList.toggle("is-filled", Boolean(filename));
      tile.disabled = Boolean(filename);
      tile.title = filename ? `${label}: ${filename}` : `Upload ${label}`;
      tile.setAttribute(
        "aria-label",
        filename ? `${label}: ${filename}` : `Upload ${label}`
      );
      tile.querySelector(".dup-plus").textContent = filename ? "✓" : "+";
      tile.querySelector(".dup-slot-label").textContent = label;
      tile.querySelector(".dup-slot-file").textContent = filename || "";

      deleteBtn.hidden = !filename;
      deleteBtn.title = filename ? `Delete ${filename}` : "";
      deleteBtn.setAttribute(
        "aria-label",
        filename ? `Delete ${filename} from ${label}` : "Delete"
      );
    });

    const anyUploaded = designSlotMeshes.length > 0;
    const heading = prompt.querySelector(".dup-heading");
    if (heading) {
      heading.textContent = anyUploaded
        ? "3D RPD design files"
        : "No 3D RPD design uploaded yet";
    }
    const sub = prompt.querySelector(".dup-sub");
    if (sub) {
      sub.textContent = anyUploaded
        ? "Add another file to an empty slot, or close this to view the design."
        : "Add an STL to a slot, or open the 3D scan.";
    }
    const closeBtn = prompt.querySelector(".dup-open-scan");
    if (closeBtn) {
      closeBtn.textContent = anyUploaded
        ? "Done — view the design"
        : "Open the 3D scan instead";
    }
  }

  // An upload or delete holds the whole panel: two at once would race the slot
  // list, and the file being parsed already blocks the main thread.
  function setUploadPromptBusy(isBusy) {
    const prompt = document.getElementById("design-upload-prompt");
    if (!prompt) return;
    prompt.classList.toggle("is-busy", isBusy);
    prompt
      .querySelectorAll("button")
      .forEach((button) => (button.disabled = isBusy));
    // Re-disables the filled tiles, which are never clickable.
    if (!isBusy) refreshUploadPromptSlots();
  }

  // Frees the slot on the backend, then drops its mesh. Confirmed first: the file
  // goes for every viewer of the case, and re-uploading needs the original STL.
  async function deleteSlotFile(slot, statusEl) {
    const filename = getUploadedSlotName(slot);
    if (!filename) return;
    const label = slotDisplayName(slot);
    if (!window.confirm(`Delete "${filename}" from ${label}?`)) return;

    setUploadPromptBusy(true);
    setSlotTileBusy(slot, "Deleting");
    if (statusEl) statusEl.textContent = `Deleting ${filename}…`;
    try {
      const response = await fetch(`${API_BASE}/stl/slot/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same contract as the upload: case_id rides in the second object.
        body: JSON.stringify([
          {
            machine_id: MACHINE_ID,
            uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
            caseIntID: paramValue,
          },
          { case_id: paramValue, slotNumber: slot },
        ]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const index = designSlotMeshes.findIndex(
        (mesh) => mesh.userData?.designSlot === slot
      );
      if (index !== -1) {
        disposeDesignSlotMesh(designSlotMeshes[index]);
        designSlotMeshes.splice(index, 1);
      }
      rebuildObjectsPanel();
      if (statusEl) statusEl.textContent = `${filename} deleted.`;
    } catch (error) {
      console.error(`[viewer3D] slot ${slot} delete failed`, error);
      if (statusEl) statusEl.textContent = "Delete failed. Please try again.";
    } finally {
      clearSlotTileBusy(slot);
      setUploadPromptBusy(false);
    }
  }

  // Four tiles, one per slot, mirroring preview3D's "Other 3D files" list. Opens
  // automatically on a case with no uploads, and on demand from the toolbar.
  function showDesignUploadPrompt() {
    if (document.getElementById("design-upload-prompt")) {
      refreshUploadPromptSlots();
      return;
    }

    const prompt = document.createElement("div");
    prompt.id = "design-upload-prompt";
    // Own card + background: the viewer stage can be light or dark depending on
    // the case, and the text has to stay readable either way.
    const card = document.createElement("div");
    card.className = "dup-card";

    const heading = document.createElement("div");
    heading.className = "dup-heading";

    const sub = document.createElement("div");
    sub.className = "dup-sub";

    const slotsRow = document.createElement("div");
    slotsRow.className = "dup-slots";

    const status = document.createElement("div");
    status.className = "dup-status";

    [1, 2, 3, 4].forEach((slot) => {
      // The delete button can't live inside the tile (a button in a button), so
      // each slot is a wrapper holding the tile, its own progress bar and the ×.
      const wrap = document.createElement("div");
      wrap.className = "dup-slot-wrap";
      wrap.dataset.slot = String(slot);

      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "dup-slot";
      tile.innerHTML =
        `<span class="dup-plus" aria-hidden="true"></span>` +
        `<span class="dup-slot-label"></span>` +
        `<span class="dup-slot-file"></span>` +
        `<progress class="dup-slot-bar" max="100" value="0"></progress>` +
        `<span class="dup-slot-note"></span>`;
      tile.addEventListener("click", () => pickAndUploadSlot(slot, status));
      wireSlotDropTarget(wrap, slot, status);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "dup-slot-delete";
      deleteBtn.textContent = "×";
      deleteBtn.hidden = true;
      deleteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSlotFile(slot, status);
      });

      wrap.append(tile, deleteBtn);
      slotsRow.appendChild(wrap);
    });

    // Doubles as "done" once something is uploaded: with files in the scene,
    // closing beats switching to the case scan.
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dup-open-scan";
    closeBtn.addEventListener("click", async () => {
      closeBtn.disabled = true;
      if (designSlotMeshes.length) {
        removeDesignUploadPrompt();
        return;
      }
      await showCaseView();
      window.syncDesignViewButton?.(false);
    });

    card.append(heading, sub, slotsRow, status, closeBtn);
    prompt.appendChild(card);
    (viewerContainer || document.body).appendChild(prompt);
    refreshUploadPromptSlots();

    // A drop that hits the card but misses a tile must still be swallowed, or the
    // browser navigates to the dropped file.
    prompt.addEventListener("dragover", (event) => event.preventDefault());
    prompt.addEventListener("drop", (event) => event.preventDefault());
  }

  // The toolbar is built in another scope (same as syncDesignViewButton), so the
  // slot manager is reached through the window.
  window.showDesignUploadPrompt = showDesignUploadPrompt;
  window.removeDesignUploadPrompt = removeDesignUploadPrompt;

  // ── Case assets, loaded on demand ───────────────────────────────────────
  // Nothing here is fetched on entry: the 3D button pulls the case's mesh and
  // overlays once, after which switching views is a visibility flip.
  let caseAssetsPromise = null;

  // Parameterisation meshes first, /stl/get as fallback — which also sets `stl`,
  // the flag deciding the upper jaw's orientation.
  async function fetchCaseMeshData() {
    const fetched = [];
    const jawMesh = await apiClient.post(
      "/parameterisation/mesh/getall",
      [data],
      false,
      "Jaw mesh"
    );
    if (isObject(jawMesh)) {
      fetched.push(...[].concat(jawMesh));
    } else {
      console.log("[viewer3D] STL source selected: /stl/get (parameterisation fallback)");
      const rawStl = await apiClient.post("/stl/get", [data], false, "Jaw mesh");
      if (isObject(rawStl)) {
        fetched.push(...[].concat(rawStl));
        stl = true;
      }
    }

    const dentureMesh = await apiClient.post(
      "/surface/getall",
      [data],
      false,
      "Denture mesh"
    );
    if (isObject(dentureMesh)) fetched.push(...[].concat(dentureMesh));

    return fetched;
  }

  async function loadCaseAssets() {
    const startedAt = performance.now();
    caseMeshRequested = true;
    const ownsLoadingScreen = !document.getElementById("viewer-loading-screen");
    if (ownsLoadingScreen) createViewerLoadingScreen();
    window.updateViewerLoading?.("Loading Original 3D Scan…");

    try {
      // Heatmaps first: renderCaseMeshes colours the jaws from undercut_values.
      await fetchUndercutHeatmaps();
      const fetched = await fetchCaseMeshData();
      window.updateViewerLoading?.("Preparing 3D scan…");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      renderCaseMeshes(fetched);
      // The design is still on screen at this point, so these land hidden (see
      // renderCaseMeshes) and are revealed by showCaseView below.
      window.updateViewerLoading?.("Loading design lines…");
      await fetchAndRenderCaseOverlays(paramValue).catch((error) => {
        console.warn("Case overlays failed to load:", error);
      });
      if (isDesignViewActive()) hideCaseAssetsForDesign();
      addViewerLoadTiming("case assets (on demand)", performance.now() - startedAt);
    } finally {
      if (ownsLoadingScreen) removeViewerLoadingScreen();
    }
  }

  function ensureCaseAssets() {
    if (!caseAssetsPromise) {
      caseAssetsPromise = loadCaseAssets().catch((error) => {
        // Let a failed load be retried by the next click rather than wedging
        // the button on a rejected promise forever.
        caseAssetsPromise = null;
        throw error;
      });
    }
    return caseAssetsPromise;
  }

  // Show the case's own mesh, polylines and artificial teeth (the 3D button).
  async function showCaseView() {
    await ensureCaseAssets();
    removeDesignUploadPrompt();
    designViewActive = false;
    hideDesignMeshes();
    restoreCaseAssets();
    updateViewerRotationOrigin();
    syncPolylineFocusMode();
    controls.update();
    rebuildObjectsPanel();
  }

  // Fetches the four slots into the scene; visibility is showDesignView's job.
  // `silent` skips alerts for the automatic load on entry.
  async function loadAllSTLSlots({ silent = false } = {}) {
    const slotLoadStartedAt = performance.now();
    startViewerLoadTimer("viewer: framework/denture mesh loading");
    const apiUrl = "/stl/slot/get";

    const authPayload = {
      machine_id: MACHINE_ID,
      uuid: "AC4gRQXZJoNz9EhhW36Q8jMJXBsf",
      caseIntID: paramValue,
    };

    // Drop any previous slot meshes so a re-load can't stack copies.
    designSlotMeshes.splice(0).forEach(disposeDesignSlotMesh);
    hiddenDesignMeshes.splice(0);

    // Remove previous GUI controls if any
    const oldGui = document.querySelector(".dg.ac");
    if (oldGui) oldGui.remove();

    const oldGuiContainer = document.querySelector(".guiContainer");
    if (oldGuiContainer) oldGuiContainer.remove();

    const oldToggleBtn = [...document.querySelectorAll("button")].find((btn) =>
      btn.innerText.includes("controls")
    );
    if (oldToggleBtn) oldToggleBtn.remove();

    const guiBlackBox = [...document.querySelectorAll("div")].find(
      (div) =>
        div.style.backgroundColor === "black" && div.style.zIndex === "999"
    );
    if (guiBlackBox) guiBlackBox.remove();

    // The slot manager IS the progress UI, each tile reporting its own file —
    // one pooled bar hid which file was slow and which slots the case had.
    showDesignUploadPrompt();
    const prompt = document.getElementById("design-upload-prompt");
    prompt?.classList.add("is-loading");
    setUploadPromptBusy(true);
    [1, 2, 3, 4].forEach((slot) => setSlotTileBusy(slot, "Waiting"));

    let anyLoaded = false;

    // Rides alongside slot 1's download; awaited before any mesh is finished so the
    // framework slots land in the right material, and the tiles re-label once known.
    const materialReady = loadCaseJawMaterial().then(refreshUploadPromptSlots);

    // A throttled burst returns without CORS headers, so the browser reports a CORS
    // failure, not a status. Pause and retry before dropping a slot.
    const fetchSlot = async (payload, slot) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await apiClient.post(apiUrl, payload, false, `Slot ${slot}`);
        } catch (error) {
          if (attempt >= 3) throw error;
          console.warn(
            `[viewer3D] Slot ${slot} attempt ${attempt} failed (${error.message || error}) — retrying`
          );
          await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
        }
      }
    };

    try {
      for (let slot = 1; slot <= 4; slot++) {
        //for (let slot = 4; slot>0; slot--){
        const slotStartedAt = performance.now();
        const payload = [authPayload, { slotNumber: slot }];

        // Bytes for this slot go to this slot's bar.
        const slotProgress = routeSlotDownloadProgress(slot);
        try {
          setSlotTileBusy(slot, "Downloading", 0);
          const result = await fetchSlot(payload, slot);

          // /stl/slot/get returns a single object OR a one-element array — newly
          // created slots come back wrapped, and were silently skipped.
          const slotItem = Array.isArray(result) ? result[0] : result;

          if (!slotItem || !slotItem.data) {
            console.log(`❌ Slot ${slot}: No STL data found.`);
            continue;
          }

          // Parsing a 15-20 MB STL blocks the main thread, so yield a frame to
          // paint this status first or the bar sits at 100% with no explanation.
          setSlotTileBusy(slot, "Preparing");
          await new Promise((resolve) => requestAnimationFrame(resolve));

          await materialReady;
          const mesh = addDesignSlotMesh(slot, slotItem.filename, atob(slotItem.data));
          // Fire the undercut survey now, alongside the mesh — not gated behind
          // the undercut button (see ensureSlotUndercutGeometry).
          const surveyPromise = ensureSlotUndercutGeometry(slot, slotItem.data);
          enableDefaultSlotUndercut(slot, mesh, surveyPromise);

          console.log(`✅ Loaded STL from slot ${slot}`);
          anyLoaded = true;
        } catch (error) {
          console.warn(`⚠️ Slot ${slot} failed:`, error.message || error);
        } finally {
          slotProgress.restore();
          clearSlotTileBusy(slot);
          refreshUploadPromptSlots();
        }
      }

    } finally {
      // A thrown slot must not leave the panel stuck in its loading state.
      const loadedPrompt = document.getElementById("design-upload-prompt");
      loadedPrompt?.classList.remove("is-loading");
      setUploadPromptBusy(false);
      // Files arrived, so the design itself is what the user wants to see. A
      // case with none keeps the panel up — it is the upload affordance.
      if (anyLoaded) removeDesignUploadPrompt();
    }

    endViewerLoadTimer("viewer: framework/denture mesh loading");
    addViewerLoadTiming(
      "framework/denture mesh loading",
      performance.now() - slotLoadStartedAt
    );

    // On entry this runs unattended, so a case with no uploads must fall back
    // to the case view quietly rather than opening with an alert.
    if (!silent) {
      alert(
        anyLoaded
          ? "✅ STL loading completed."
          : "❌ No STL files found in slots 1 to 4."
      );
    } else if (!anyLoaded) {
      console.log("[viewer3D] No slot STLs for this case — showing case mesh.");
    }

    return anyLoaded;
  }

  // Decodes/parses/adds the case's own meshes. Extracted so the 3D button can run
  // it later: on entry `responseDatas` is empty and this is a no-op.
  function renderCaseMeshes(responseDatas) {
    const meshCpuStartedAt = performance.now();
    let jawMeshCpuMs = 0;
    let frameworkMeshCpuMs = 0;
    startViewerLoadTimer("viewer: mesh decode/parse/render");

    // Normalized so the `.includes()` checks below never throw: /stl/get can send a
    // NUMERIC `type` or omit `filename`, which halted the loop at 100%.
    for (const f of responseDatas) {
      if (typeof f.filename !== "string") f.filename = String(f.filename ?? "");
      const t = String(f.type ?? "").toLowerCase();
      if (!t.includes("upper") && !t.includes("lower")) {
        const name = f.filename.toLowerCase();
        if (f.type === 1 || f.type === "1" || name.includes("upper")) f.type = "upper_jaw";
        else if (f.type === 2 || f.type === "2" || name.includes("lower")) f.type = "lower_jaw";
        else f.type = t;
      }
    }

    const jawFirstResponseDatas = [...responseDatas].sort((left, right) => {
      const leftIsSurface = left.filename.includes("surface");
      const rightIsSurface = right.filename.includes("surface");
      return Number(leftIsSurface) - Number(rightIsSurface);
    });
    for (const offFile of jawFirstResponseDatas) {
      const meshFileStartedAt = performance.now();
      let meshDecodeMs = 0;
      let meshParseMs = 0;
      let meshAddMs = 0;
      const meshCategory = offFile.filename.includes("surface")
        ? "framework/denture"
        : "jaw";
      let loader;
      //console.log(offFile)
      if (offFile.filename.includes("surface")) {
        loader = new OFFLoader(
          materialsurface.clone(),
          materialsurface_non_metal.clone()
        );
      } else {
        loader = new OFFLoader(material.clone());
      }

      // Fetch the OFF file data
      //const offData = await apiClient.get(offFile); // Assuming the ApiClient has a get method for fetching data
      const meshDecodeStartedAt = performance.now();
      const offdata = atob(offFile.data);
      meshDecodeMs = performance.now() - meshDecodeStartedAt;
      let x;
      if (
        offFile.filename.includes("ParameterisationMesh") ||
        offFile.filename.includes("closed")
      ) {
        x = true;
      }
      // Load the OFF file
      //console.log('check stl:' + stl)
      const meshParseStartedAt = performance.now();

      // `stl` records only that we fell back to /stl/get — it does NOT mean the
      // bytes are STL. That route serves OFF for some cases, and OFF text in the
      // STL loader throws a DataView RangeError that escapes the loop and sticks
      // the loader at 100%. So sniff the decoded head and route by real format,
      // keeping `stl` for ORIENTATION only (closed OFF jaws must not get +180).
      const isOffData = offdata.trimStart().slice(0, 3).toUpperCase() === "OFF";
      // "stl" is the loaders' no-heatmap sentinel: an undefined surface throws
      // inside OFFLoader ('surveying_values' in undefined) and re-creates the hang.
      const undercutForJaw =
        (offFile.type.includes("upper")
          ? undercut_values[1]
          : undercut_values[0]) ?? "stl";
      const jawSideKnown =
        offFile.type.includes("upper") || offFile.type.includes("lower");
      if (jawSideKnown) {
        if (stl && !isOffData) {
          const stlMeshLoader = new STLMeshLoader(material);
          mesh_geo = stlMeshLoader.load(offdata, undercutForJaw);
        } else {
          mesh_geo = loader.parse(offdata, undercutForJaw, x);
        }
      }
      meshParseMs = performance.now() - meshParseStartedAt;

      // An unresolved jaw side, or a payload OFFLoader.parse rejected, leaves
      // mesh_geo not a pair. SKIP — a throw here sticks the loader at 100%.
      if (!mesh_geo || typeof mesh_geo === "string" || !mesh_geo[0]) {
        console.warn(
          `[viewer3D] Skipping mesh with unresolved geometry: ${offFile.filename} (type=${offFile.type})`
        );
        continue;
      }

      const meshAddStartedAt = performance.now();
      const mesh = mesh_geo[0];
      mesh.name = offFile.filename;

      mesh.userData = {
        jaw_type: offFile.type,
        archLabel: offFile.type.includes("upper") ? "Upper Arch" : "Lower Arch",
      };
      if (all_mesh_mat != null) {
        all_mesh_mat[offFile.filename] = mesh_geo[1].slice();
      }

      // Add the mesh to the parent object

      if (offFile.type.includes("upper") && !stl && !close) {
        //console.log('check');
        changeMeshRotation(mesh, 1, 1, 180);
        mesh.position.y += 5;
      }

      //console.log(mesh)
      enforceOpaqueJawMesh(mesh);
      parentObject.add(mesh);
      syncPolylineFocusMode();
      meshAddMs = performance.now() - meshAddStartedAt;

      const meshTotalMs = performance.now() - meshFileStartedAt;
      if (meshCategory === "jaw") {
        jawMeshCpuMs += meshTotalMs;
      } else {
        frameworkMeshCpuMs += meshTotalMs;
      }
      addViewerMeshTiming({
        file: offFile.filename,
        type: offFile.type,
        category: meshCategory,
        decodeMs: meshDecodeMs,
        parseMs: meshParseMs,
        addMs: meshAddMs,
        totalMs: meshTotalMs,
        vertices: mesh.geometry?.attributes?.position?.count ?? null,
        children: mesh.children?.length ?? 0,
      });
    }
    endViewerLoadTimer("viewer: mesh decode/parse/render");
    addViewerLoadTiming(
      "mesh decode/parse/render",
      performance.now() - meshCpuStartedAt,
      { files: responseDatas.length }
    );
    if (LOG_VIEWER_LOAD_TIMINGS_TO_CONSOLE) {
      console.log(`viewer: load jaw mesh: ${jawMeshCpuMs.toFixed(2)} ms`);
      console.log(
        `viewer: load framework/denture mesh: ${frameworkMeshCpuMs.toFixed(2)} ms`
      );
    }
    addViewerLoadTiming("load jaw mesh", jawMeshCpuMs);
    addViewerLoadTiming("load framework/denture mesh", frameworkMeshCpuMs);
    logViewerObjectCounts("after jaw/framework mesh load");
    updateViewerRotationOrigin();
  }

  renderCaseMeshes(responseDatas);
  //console.log(all_mesh_mat);

  // Only meaningful once the scan has been requested: on entry nothing is
  // fetched, and an empty `responseDatas` just means "not asked for".
  const hasJawFiles = responseDatas.some(
    (f) => f.filename && !f.filename.includes("surface")
  );
  if (caseMeshRequested && !hasJawFiles) {
    const noScanOverlay = document.createElement("div");
    noScanOverlay.id = "no-scan-overlay";
    noScanOverlay.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;" +
      "justify-content:center;z-index:100;pointer-events:none;";
    const noScanMsg = document.createElement("div");
    noScanMsg.style.cssText =
      "background:rgba(0,0,0,0.65);color:#fff;font-family:Arial,sans-serif;" +
      "font-size:18px;font-weight:600;padding:24px 36px;border-radius:12px;" +
      "letter-spacing:0.3px;text-align:center;";
    noScanMsg.textContent = "No STL/3D Scan File Found!";
    noScanOverlay.appendChild(noScanMsg);
    (viewerContainer || document.body).appendChild(noScanOverlay);
  }

  function changeMeshRotation(mesh, x, y, z) {
    mesh.rotation.set(
      THREE.MathUtils.degToRad(x),
      THREE.MathUtils.degToRad(y),
      THREE.MathUtils.degToRad(z)
    );
  }

  // Example usage

  function unixToHumanReadable(unixTimestamp) {
    const date = new Date(unixTimestamp * 1000); // Multiply by 1000 to convert seconds to milliseconds
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0"); // Months are zero-indexed
    const day = date.getDate().toString().padStart(2, "0");
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Instantiate the OFFLoader
  // Load the OFF file

  // ---- Viewer background theme (dark/light canvas) ------------------------
  // Toggled from the footer (viewerShell.js's footerThemeBtn). NOT persisted —
  // every fresh load starts dark regardless of what was toggled last time; the
  // button only changes it for the current viewing session. Dark clears to
  // fully transparent instead of a hardcoded colour, so #container3D's own
  // dark radial gradient (already authored in style.css) shows through
  // unchanged, and it beats light on silhouette contrast (tan crowns measure
  // 5.6:1 on slate vs 2.6:1 on white).
  function applyViewerBackgroundTheme(theme) {
    try {
      if (theme === "dark") renderer.setClearColor(0x000000, 0);
      else renderer.setClearColor(0xffffff, 1);
    } catch {
      // The renderer doesn't exist yet — a stray call during the earliest page load.
    }
  }

  // The footer button calls this to apply its change immediately, without a
  // reload — see viewerShell.js's wireThemeToggle.
  window.setViewerBackgroundTheme = applyViewerBackgroundTheme;

  window.finished = true; // window property (declared at top) — a bare `finished` only resolves through it
  // antialias on: fissures are sub-pixel at normal zoom and alias into noise.
  // Do NOT add setPixelRatio — resizeViewerStage() calls setSize(w, h, false), so
  // the canvas has no CSS size and is laid out at its INTRINSIC size; a ratio of
  // 2 then doubles the stage and pushes the jaw off-screen.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  applyViewerBackgroundTheme("dark");
  resizeViewerStage(renderer);

  // Add the renderer to the DOM
  const container = document.getElementById("container3D");
  container.style.position = "relative"; // <- Add this line
  if (container) {
    container.appendChild(renderer.domElement);
    createPolylineVisibilityToggle(container, renderer.domElement);

    // After container3D and renderer are set up
    const caseTitle = document.createElement("div");
    caseTitle.textContent = `🦷 Case: ${window.caseID}`; // Display the case name
    caseTitle.className = "case-title"; // CSS class for styling

    const isMobile =
      /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
    caseTitle.style.transform = "translateX(-50%)";

    // Insert it into container3D
    container.appendChild(caseTitle);
  } else {
    console.error("No container element found");
  }

  // Set how far the camera will be from the 3D model

  camera.position.z = objToRender === "dino" ? 100 : 500;

  // Lighting is tuned for surface relief, NOT for even illumination — the previous
  // rig (ambient 1.0 plus four opposing directionals "for even lighting") lit every
  // facing equally, which is exactly what erases cusps and fissures.
  //
  // The directional lights are children of the camera, the way dental CAD viewers
  // rig them, so the surface being looked at is always the lit one. World-fixed
  // lights leave the far side dark when the camera orbits (measured 43% brightness
  // swing front-to-back, versus 4% rigged this way). The offsets are deliberately
  // off-axis: a pure headlight lights everything evenly and flattens relief again.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xfff1f5, 0.38));
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  // Aim point parented to the camera too, so the rig is unaffected by where the
  // jaw sits or by panning — direction stays fixed relative to the view.
  const lightAim = new THREE.Object3D();
  lightAim.position.set(0, 0, -100);
  camera.add(lightAim);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(-60, 80, 100);
  keyLight.target = lightAim;
  camera.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.32);
  fillLight.position.set(80, 20, 60);
  fillLight.target = lightAim;
  camera.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.42);
  rimLight.position.set(0, -70, -90);
  rimLight.target = lightAim;
  camera.add(rimLight);

  // Camera children only get world matrices once the camera is in the scene graph.
  scene.add(camera);

  // This adds controls to the camera, so we can rotate / zoom it with the mouse
  if (objToRender === "dino") {
    controls = new TrackballControls(camera, renderer.domElement);
    orb_controls = new OrbitControls(camera, renderer.domElement);

    controls.rotateSpeed = 4.0;
    controls.zoomSpeed = 1.4;
    controls.panSpeed = 30;
    // Panning is handled manually rather than by the controls.
    // Action -> button: rotate on right-drag, matching the 2D page's 3D preview.
    controls.mouseButtons = {
      LEFT: 2,
      MIDDLE: -1,
      RIGHT: 1,
    };
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = true;
    controls.dynamicDampingFactor = 0.3;

    orb_controls.enabled = false;
    orb_controls.enableRotate = false;
    orb_controls.enablePan = false;
    orb_controls.enableZoom = false;

    applyViewerRotationOrigin();
    bindViewerRotationTargetAnchor(renderer.domElement);

    //console.log('changed2');
  }

  // Render the scene
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    // Hard position lock: snap orbit target back to jaw centre every frame.
    // Rotation and zoom still work; panning is fully suppressed.
    if (hasViewerRotationOrigin && controls?.target) {
      const _snapDelta = viewerRotationOrigin.clone().sub(controls.target);
      if (_snapDelta.lengthSq() > 1e-10) {
        controls.target.copy(viewerRotationOrigin);
        camera.position.add(_snapDelta);
        if (orb_controls?.target) orb_controls.target.copy(viewerRotationOrigin);
        camera.updateProjectionMatrix();
      }
    }
    artificialTeethRenderer.syncToJawMeshes();

    renderer.render(scene, camera);
    if (!hasLoggedFirstSceneRender) {
      hasLoggedFirstSceneRender = true;
      endViewerLoadTimer("viewer: final scene render/update");
      addViewerLoadTiming(
        "final scene render/update",
        performance.now() - finalSceneRenderStartedAt
      );
      logViewerObjectCounts("after first scene render");
    }
  }

  function applyFitZoomIfLoaded() {
    if (!getPresetViewBounds()) return;
    camera.zoom = computeFitZoom();
    camera.updateProjectionMatrix();
  }

  // Add a listener to the window, so we can resize the window and the camera
  window.addEventListener("resize", function () {
    resizeViewerStage(renderer);
    clampViewerControlTarget(controls);
    applyFitZoomIfLoaded();
  });
  new ResizeObserver(() => {
    resizeViewerStage(renderer);
    applyFitZoomIfLoaded();
  }).observe(container);

  camera.zoom = computeFitZoom();
  camera.updateProjectionMatrix();

  const VIEWER_MAX_ZOOM = 50;
  window.setViewerZoom = (zoom) => {
    if (!camera) return;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  };
  window.VIEWER_MAX_ZOOM = VIEWER_MAX_ZOOM;

  const clonedCamera = camera.clone();
  addResetButton(camera, clonedCamera, controls, () => {
    const target = hasViewerRotationOrigin
      ? viewerRotationOrigin
      : updateViewerRotationOrigin();
    return target?.clone?.() || null;
  });
  createPresetViewControls();

  // Yellow "Objects" toggle, back in the black toolbar alongside reset — a
  // second, always-on-screen path to the same Show/Hide panel the persistent
  // top-left eye icon opens (newControls.js's #component-panel-toggle), at
  // every screen size including desktop, not just mobile/tablet. A fresh
  // button rather than a relocated one: the old footer twin this used to be
  // is gone, and this one only ever needs to live in the toolbar.
  const objectsToolbarBtn = document.createElement("button");
  objectsToolbarBtn.type = "button";
  objectsToolbarBtn.id = "toolbar-objects-button";
  objectsToolbarBtn.className = "smart-btn objects-toggle";
  objectsToolbarBtn.style.order = "30"; // the slot lock-rotation-button used to hold
  objectsToolbarBtn.setAttribute("aria-label", "Objects");
  objectsToolbarBtn.title = "Objects";
  objectsToolbarBtn.setAttribute("aria-pressed", "false");
  objectsToolbarBtn.innerHTML = `<img src="${basePath}/assets/Icon_objects3.png" alt="Objects" style="width:30px;height:30px;object-fit:contain;display:block;margin:auto;pointer-events:none;">`;
  objectsToolbarBtn.addEventListener("click", () => {
    if (window.viewerPanelManager) {
      window.viewerPanelManager.toggle("objects-panel");
      return;
    }
    // Fallback for a click landing before the panel has registered itself:
    // the top-left toggle drives the same panel once it exists.
    document.getElementById("component-panel-toggle")?.click();
  });
  window.addEventListener("viewerobjectspanelchange", (event) => {
    const open = Boolean(event.detail?.open);
    objectsToolbarBtn.classList.toggle("active", open);
    objectsToolbarBtn.setAttribute("aria-pressed", String(open));
    objectsToolbarBtn.title = open ? "Close objects panel" : "Objects";
  });
  getViewerNavToolbar().appendChild(objectsToolbarBtn);
  //console.log(camera)

  // Start the 3D rendering
  const finalSceneRenderStartedAt = performance.now();
  startViewerLoadTimer("viewer: final scene render/update");
  animate();
  // Scene is ready — the slot STLs are still arriving, but their progress is
  // reported per file by the slot manager, which this screen would cover.
  removeViewerLoadingScreen();
  endViewerLoadTimer("viewer: page/viewer initialization");
  addViewerLoadTiming(
    "page/viewer initialization",
    performance.now() - pageInitializationStartedAt
  );
  //console.log(parentObject);
  //console.log(undercut_type);
  const controlsStartedAt = performance.now();
  startViewerLoadTimer("viewer: controls setup");
  removeVisibilityAndTransparencyControls();
  addVisibilityAndTransparencyControls(parentObject, name, all_mesh_mat);
  endViewerLoadTimer("viewer: controls setup");
  addViewerLoadTiming("controls setup", performance.now() - controlsStartedAt);
  addViewerLoadTiming(
    "initial viewer usable",
    performance.now() - viewerTotalStartedAt
  );
  logViewerObjectCounts("initial viewer usable");
  logViewerPerformanceSummary();

  // Polylines and artificial teeth are case assets: they are fetched by
  // loadCaseAssets() when the 3D button asks for them, not on entry.

  // The viewer lands on the uploaded 3D files. Silent, so a case with no
  // uploads shows the upload affordance instead of opening with an alert.
  const designViewPromise = showDesignView({ silent: true })
    .then((shown) => {
      window.syncDesignViewButton?.(shown);
      // No uploads for this case: offer the "+" slots rather than an empty
      // viewer. The case scan is one tap away via the prompt or the 3D button.
      if (!shown) showDesignUploadPrompt();
    })
    .catch((error) => {
      console.warn("[viewer3D] Design view failed to load:", error);
    });

  // NO /user/logout here: it ended the shared server-side session while the page
  // was still open, so the 3D button 401'd on its first request.

  addViewerLoadTiming(
    "total viewer load",
    performance.now() - viewerTotalStartedAt
  );
  logViewerPerformanceSummary();
  designViewPromise.finally(() => {
    // Defensive: the screen is dropped as soon as the scene is ready, but a
    // throw before that point must not leave it up.
    removeViewerLoadingScreen();
    logViewerObjectCounts("entry load complete");
  });
})();

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

function isObject(variable) {
  return variable !== null && typeof variable === "object";
}

window.addEventListener("load", () => {
  const fixToothMapPosition = () => {
    const allButtons = document.getElementsByTagName("button");
    for (let btn of allButtons) {
      if (btn.dataset.twodViewerButton === "true") continue;
      const img = btn.querySelector("img");

      if (img && img.src.startsWith("data:image/png;base64")) {
        // ✅ 分别控制按钮位置 & 图片宽度
        const topValue = isMobileDevice() ? "200px" : "150px";
        const imgWidth = isMobileDevice() ? "200px" : "140px";

        btn.style.position = "fixed";
        btn.style.top = topValue;
        btn.style.left = "15px";
        btn.style.width = imgWidth; // ← 设置按钮宽度
        btn.style.height = "auto";
        btn.style.padding = "0";
        btn.style.border = "none";
        btn.style.background = "none";
        btn.style.cursor = "pointer";
        btn.style.zIndex = "1000";

        img.style.width = "100%"; // ← 图片宽度始终相对于按钮宽度
        img.style.height = "auto";
        img.style.transform = "none";
        img.style.display = "block";

        return true;
      }
    }
    return false;
  };

  const interval = setInterval(() => {
    if (fixToothMapPosition()) {
      clearInterval(interval);
    }
  }, 200);
});

window.addEventListener("load", () => {
  const interval = setInterval(() => {
    const allButtons = document.getElementsByTagName("button");

    for (let btn of allButtons) {
      if (btn.dataset.twodViewerButton === "true") continue;
      const img = btn.querySelector("img");

      if (img && img.src.startsWith("data:image/png")) {
        if (!btn.hasAttribute("data-zoom-bound")) {
          btn.setAttribute("data-zoom-bound", "true");

          btn.addEventListener("click", () => {
            const overlayDivs = document.querySelectorAll(
              "div[style*='position: fixed']"
            );
            for (let div of overlayDivs) {
              if (div.dataset.twodViewerBlock === "true") continue;
              const popupImg = div.querySelector("img");
              if (popupImg && popupImg.src.startsWith("data:image/png")) {
                // ✅ 放大样式
                popupImg.style.maxWidth = "80vw";
                popupImg.style.maxHeight = "80vh";
                popupImg.style.width = "auto";
                popupImg.style.height = "auto";

                // Close the chat sidebar if it's open during image zoom
                const chatWidget = document.getElementById("chat-widget");
                if (chatWidget && chatWidget.classList.contains("is-open")) {
                  chatWidget.classList.remove("is-open");
                  setTimeout(() => chatWidget.classList.add("is-hidden"), 220);
                }

                div.addEventListener("click", () => div.remove(), { once: true });

                break;
              }
            }
          });
        }

        clearInterval(interval);
        break;
      }
    }
  }, 300);
});
