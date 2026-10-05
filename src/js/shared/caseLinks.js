// Builds the 3D viewer URL for a case (ThreeDViewer.html reads ?id=<encryptedId>),
// shared by the case list's copy/QR actions and the 2D Case Note's emails.

import { lol } from "./crypt.js";
import { getAppBasePath } from "./pageContext.js";

// Substituted for localhost on shared links only: a phone scanning a QR code
// can't reach a dev machine's localhost.
const LIVE_VIEWER_BASE = "https://ndcs-smartrpd.github.io/tmp.rpd";

// Encrypts the id and respects the GitHub-Pages base path. `forShare` rewrites
// localhost to the live server; deployed builds always use their own origin.
export function buildThreeDViewerUrl(caseId, { forShare = false } = {}) {
  if (!caseId) return "";
  const encryptedId = lol(caseId);
  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "";
  if (forShare && isLocalhost) {
    return `${LIVE_VIEWER_BASE}/src/pages/ThreeDViewer.html?id=${encryptedId}`;
  }
  const basePath = getAppBasePath();
  return `${window.location.origin}${basePath}/src/pages/ThreeDViewer.html?id=${encryptedId}`;
}

// Always land on the MAIN case list. When this tab was opened from the case list,
// refocus that tab and close this one so editor/viewer tabs don't pile up.
export function returnToCaseList(caseListUrl) {
  try {
    if (
      window.opener &&
      !window.opener.closed &&
      window.opener.location?.pathname?.includes("case_list")
    ) {
      window.opener.focus();
      window.close();
      return;
    }
  } catch {
    // Cross-context opener.location access can throw; fall through to nav.
  }
  window.location.href = caseListUrl;
}
