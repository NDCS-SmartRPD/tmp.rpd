// A hand-written selector that no longer resolves fails silently: the help
// panel just loses its "Show me" button, the tour quietly drops a step. Both
// suites catch the rename that would cause it by looking the selector up in the
// pages it could be defined in.
//
// Jest runs from the repo root and these files are transpiled to CJS, so paths
// resolve against process.cwd() rather than import.meta.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_FILES = [
  "src/pages/case_list.html",
  "src/pages/2DAnnotation.html",
  "src/pages/ThreeDViewer.html",
  "src/pages/admin/admin_users.html",
  "src/pages/admin/admin_machineid.html",
  "src/pages/admin/admin_case_list.html",
  // Controls built in JS — case-list rows, the 2D catalog, the viewer — appear
  // in no HTML file.
  "src/js/pages/caseManagement.js",
  "src/js/2D/preview3D.js",
  "src/js/2D/preview3DSurvey.js",
  "src/js/2D/annotationCatalog.js",
  // What a help walkthrough waits on and counts clicks on: the placement marks,
  // the lock state, the quick-pick and remove lists, the status menu.
  "src/js/2D/2DAnnotation.js",
  "src/js/2D/annotationLocks.js",
  "src/js/2D/annotationRender.js",
  "src/js/2D/annotationVisuals.js",
  "src/js/2D/clinicalInfo.js",
  "src/js/shared/selectMenu.js",
  "src/js/shared/changePassword.js",
  "src/viewer3d/index.js",
];

export const APP_SOURCES = SOURCE_FILES.map((f) => {
  try {
    return readFileSync(join(process.cwd(), f), "utf8");
  } catch {
    return "";
  }
}).join("\n");

/**
 * The id/class names in `selector` that no source file defines — [] when it is
 * real. Only the last descendant part matters (the leading parts are
 * positional), and that part may itself be compound
 * (".component-tab.is-form-tab"), so every name in it is checked.
 */
export function undefinedSelectorParts(selector) {
  const target = String(selector).trim().split(/\s+/).pop();
  const names = target.match(/[#.][A-Za-z0-9_-]+/g) || [target];
  return names.map((n) => n.replace(/^[#.]/, "")).filter((n) => !APP_SOURCES.includes(n));
}
