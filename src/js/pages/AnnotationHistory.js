import { lol } from "../shared/crypt.js";
import { getAppBasePath } from "../shared/pageContext.js";
import { logApi } from "../shared/apiLog.js";
import { setupAppSidebar } from "../shared/appSidebar.js";
import { VIEWER_UUID } from "../shared/config.js";
import { API_BASE, MACHINE_ID, getLoggedInUser } from "../shared/api.js";

document.addEventListener("DOMContentLoaded", () => {
  initFooter();
  initSidebar();
  loadHistory();
});

function initFooter() {
  const user = getLoggedInUser();
  const userEl = document.getElementById("footerUserName");
  if (userEl) userEl.textContent = user?.username || "—";
}

function initSidebar() {
  setupAppSidebar({ triggerId: "footerMenuBtn", indexHref: "../../index.html" });

  document.getElementById("sidebarReturnBtn")?.addEventListener("click", () => {
    const basePath = getAppBasePath();
    window.location.href = `${basePath}/src/pages/case_list.html`;
  });
}

async function loadHistory() {
  const params      = new URLSearchParams(window.location.search);
  const encryptedId = params.get("id");
  if (!encryptedId) {
    showEmpty("Missing case ID.");
    return;
  }

  const caseIntID  = lol(encryptedId);
  const case_id    = caseIntID;

  // Populate case label in header and footer
  const caseLabel   = document.getElementById("ahCaseLabel");
  const footerCase  = document.getElementById("footerCaseName");
  if (caseLabel)  caseLabel.textContent  = `Case #${caseIntID}`;
  if (footerCase) footerCase.textContent = `${caseIntID}`;

  // Read with the logged-in uuid when present, else the shared viewer account
  // so a guest (no login) still loads the case's annotations standalone.
  let uuid = VIEWER_UUID;
  try { uuid = getLoggedInUser()?.uuid || VIEWER_UUID; } catch (_) {}

  const payload = [
    { machine_id: MACHINE_ID, uuid, caseIntID },
    { case_id }
  ];

  let rows = [];
  try {
    const res = await fetch(
      `${API_BASE}/noticeboard/editedview/get`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) }
    );
    logApi(res, "POST /noticeboard/editedview/get");
    rows = await res.json();
  } catch (err) {
    console.error("❌ Fetch error:", err);
    showEmpty("Failed to load annotation history.");
    return;
  }

  const grid = document.getElementById("annotation-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const list = Array.isArray(rows) ? rows : [rows];
  let total = 0;

  list.forEach(row => {
    if (!row) return;

    let namesArr = [];
    let dataArr  = [];

    try { namesArr = JSON.parse(row.filenames); } catch {}
    try { dataArr  = JSON.parse(row.data);      } catch {}

    if (!Array.isArray(dataArr)) {
      namesArr = [row.filenames];
      dataArr  = [row.data];
    }

    dataArr.forEach((b64, idx) => {
      if (!b64) return;
      const img = new Image();
      img.src = b64;
      img.alt = namesArr[idx] || `annotation-${idx + 1}`;
      grid.appendChild(img);
      total++;
    });
  });

  if (!total) showEmpty("No annotation snapshots found for this case.");
}

function showEmpty(msg) {
  const grid = document.getElementById("annotation-grid");
  if (!grid) return;
  grid.innerHTML = `<p class="ah-empty">${msg}</p>`;
}
