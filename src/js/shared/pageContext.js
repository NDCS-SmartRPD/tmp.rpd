// Where the current page sits: which screen it is, and how deep it is nested.
// Shared by the help assistant, the guided tour and the change-password panel.

// Which screen the user is on — drives greetings, starter chips, tour selection
// and the same-page boost in help scoring.
export function currentPageId(pathname = window.location.pathname) {
  const file = pathname.split("/").pop() || "index.html";
  if (/\/admin\//.test(pathname)) {
    if (/admin_users/i.test(file)) return "admin_users";
    if (/admin_machineid/i.test(file)) return "admin_machineid";
    if (/admin_case_list/i.test(file)) return "admin_case_list";
  }
  if (/^case_list/i.test(file)) return "case_list";
  if (/^2DAnnotation/i.test(file)) return "annotation_2d";
  if (/^ThreeDViewer/i.test(file)) return "viewer_3d";
  if (/^AnnotationHistory/i.test(file)) return "annotation_history";
  if (/^VersionHistory/i.test(file)) return "version_history";
  return "login";
}

// Path back to the repo root. Resolving against the page (not import.meta.url)
// keeps links correct however the modules are served.
export function appRoot() {
  const path = window.location.pathname;
  if (/\/src\/pages\/admin\//.test(path)) return "../../../";
  if (/\/src\/pages\//.test(path)) return "../../";
  return "./";
}

export function getAppBasePath() {
  return new URL(appRoot(), window.location.href).pathname.replace(/\/$/, "");
}

// Link a css/ stylesheet on first use, so a page that never opens the panel
// never fetches its styles. Returns the <link>, for callers that must wait for it.
export function ensureStylesheet(cssFile) {
  const href = new URL(`${appRoot()}css/${cssFile}`, window.location.href).href;
  const existing = document.querySelector(`link[href="${href}"]`);
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  return link;
}
