// Shared slide-in sidebar for every page embedding #appSidebar: open/close plus
// the items common to all of them. Page-specific items are wired by the page.

import { toast, confirmModal } from "./toast.js";

// Labelled in their own script. Pages ship only #sidebarLanguageBtn — the
// dropdown is built from this list, so adding one here adds it everywhere.
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ms", label: "Bahasa Melayu" },
  { code: "hi", label: "हिन्दी" },
];
const LANGUAGE_STORAGE_KEY = "appLanguage";

// Falls back to English for a missing, unknown or unreadable stored value.
function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (LANGUAGES.some((lang) => lang.code === stored)) return stored;
  } catch {
    /* storage blocked (private mode / disabled cookies) — use the default */
  }
  return LANGUAGES[0].code;
}

const IDLE_LOGOUT_MS = 30 * 60 * 1000;
const LAST_ACTIVITY_KEY = "lastActivityAt";

function startIdleLogout(indexHref) {
  if (!localStorage.getItem("loggedInUser")) return;

  let lastWrite = 0;
  const markActive = () => {
    const now = Date.now();
    if (now - lastWrite < 10 * 1000) return;
    lastWrite = now;
    try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* ignore */ }
  };

  const checkIdle = () => {
    if (!localStorage.getItem("loggedInUser")) return;
    const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
    if (Date.now() - last < IDLE_LOGOUT_MS) return;
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    window.location.href = `${indexHref}?expired=1`;
  };

  checkIdle();
  ["pointerdown", "pointermove", "keydown", "wheel"].forEach((type) =>
    window.addEventListener(type, markActive, { capture: true, passive: true })
  );
  setInterval(checkIdle, 60 * 1000);
}

export function setupAppSidebar({ triggerId = "footerMenuBtn", indexHref = "../../index.html" } = {}) {
  startIdleLogout(indexHref);
  const sidebar = document.getElementById("appSidebar");
  const trigger = document.getElementById(triggerId);
  if (!sidebar) return { open() {}, close() {} };

  // Assigned further down (after the common items are wired). Only read from
  // inside callbacks, which can't run before that assignment.
  let languageMenu = null;

  const open = () => {
    sidebar.classList.remove("is-hidden");
    requestAnimationFrame(() => sidebar.classList.add("is-open"));
    sidebar.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    // Collapse the language dropdown so the panel reopens in its resting state.
    languageMenu?.collapse();
    sidebar.classList.remove("is-open");
    sidebar.setAttribute("aria-hidden", "true");
    setTimeout(() => sidebar.classList.add("is-hidden"), 220);
  };

  trigger?.addEventListener("click", () => {
    if (sidebar.classList.contains("is-open")) close();
    else open();
  });
  sidebar.querySelectorAll("[data-sidebar-close]").forEach((el) => {
    el.addEventListener("click", close);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) close();
  });

  // ----- common items -----

  // Admin-only entry (markup ships hidden; only case_list embeds it today).
  // Visibility is cosmetic — every admin endpoint re-checks is_admin server-side.
  try {
    const me = JSON.parse(localStorage.getItem("loggedInUser") || "null");
    if (Number(me?.isAdmin) === 1) {
      // Pages embedding #appSidebar sit at two depths (src/pages/ and
      // src/pages/admin/), so resolve relative to whichever this one is.
      const inAdminDir = /\/admin\//.test(window.location.pathname);
      const adminUsersHref = inAdminDir ? "./admin_users.html" : "./admin/admin_users.html";
      const goToAdmin = () => (window.location.href = adminUsersHref);

      // Sidebar entry (present on every page with #appSidebar) — but skip it
      // when we're already on the User Management page.
      const onAdminUsersPage = /admin_users\.html/.test(window.location.pathname);
      const adminItem = document.getElementById("sidebarAdminUsersItem");
      if (adminItem && !onAdminUsersPage) {
        adminItem.hidden = false;
        document.getElementById("sidebarAdminUsersBtn")?.addEventListener("click", goToAdmin);
      }

      // Prominent header shortcut (case_list only) — same gate, more visible.
      const headerBtn = document.getElementById("adminUsersHeaderBtn");
      if (headerBtn) {
        headerBtn.hidden = false;
        headerBtn.addEventListener("click", goToAdmin);
      }

      // Machine ID Management — sibling admin page, resolved the same way and
      // hidden when we're already on it.
      const machineIdHref = inAdminDir ? "./admin_machineid.html" : "./admin/admin_machineid.html";
      const goToMachineIds = () => (window.location.href = machineIdHref);
      const onMachineIdPage = /admin_machineid\.html/.test(window.location.pathname);
      const machineItem = document.getElementById("sidebarMachineIdItem");
      if (machineItem && !onMachineIdPage) {
        machineItem.hidden = false;
        document
          .getElementById("sidebarMachineIdBtn")
          ?.addEventListener("click", goToMachineIds);
      }

      // Header shortcut for Machine IDs (admin case list only), mirroring
      // adminUsersHeaderBtn.
      const machineHeaderBtn = document.getElementById("machineIdHeaderBtn");
      if (machineHeaderBtn && !onMachineIdPage) {
        machineHeaderBtn.hidden = false;
        machineHeaderBtn.addEventListener("click", goToMachineIds);
      }
    }
  } catch {
    /* malformed loggedInUser — leave the item hidden */
  }

  document.getElementById("sidebarLogoutBtn")?.addEventListener("click", async () => {
    close();
    const ok = await confirmModal({
      title: "Log out?",
      message: "You'll need to sign in again to access your cases.",
      confirmText: "Log out",
      cancelText: "Cancel",
      variant: "info",
    });
    if (!ok) return;
    localStorage.removeItem("loggedInUser");
    window.location.href = indexHref;
  });

  // Change password runs the same emailed-key flow as the login page's forgot
  // view, with the address taken from the session. Imported on click.
  document.getElementById("sidebarChangePasswordBtn")?.addEventListener("click", async () => {
    close();
    try {
      const { openChangePassword } = await import("./changePassword.js");
      openChangePassword();
    } catch (err) {
      console.error("[appSidebar] change password failed to load:", err);
      toast.error("Change password is unavailable right now.");
    }
  });
  // Help opens the in-app assistant. Imported on click so the panel, its
  // knowledge base and its stylesheet only load for users who ask for help.
  const openHelp = async () => {
    close();
    try {
      const { openHelpBot } = await import("./helpBot.js");
      openHelpBot();
    } catch (err) {
      console.error("[appSidebar] help assistant failed to load:", err);
      toast.error("Help is unavailable right now.");
    }
  };
  // About replays the page's guided tour. Imported on click for the same reason
  // Help is: a page whose tour is never asked for shouldn't pay for the overlay.
  const showAbout = async () => {
    close();
    try {
      const { startPageTour, tourPageLabel } = await import("./pageTour.js");
      if (!startPageTour()) toast.info(`No guided tour for ${tourPageLabel()} yet.`);
    } catch (err) {
      console.error("[appSidebar] guided tour failed to load:", err);
      toast.error("The guided tour is unavailable right now.");
    }
  };

  // Sidebar row and footer button do the same thing, so they share a handler
  // (close() is a harmless no-op from the footer). About is sidebar-only.
  ["sidebarHelpBtn", "footerHelpBtn"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", openHelp);
  });
  document.getElementById("sidebarReportIssueBtn")?.addEventListener("click", () => {
    close();
    toast.info("Report Issue — coming soon.");
  });
  document.getElementById("sidebarFeedbackBtn")?.addEventListener("click", () => {
    close();
    window.open(
      "https://forms.office.com/pages/responsepage.aspx?id=P_nIomsSlkWjYIlBqJhLCHRlAf-JbFtOlEA3yGARDhBUN0pHWDA4WlZQUEFMSFJGVUVUSE5OVDYwVC4u&route=shorturl",
      "_blank",
      "noopener,noreferrer"
    );
  });
  document.getElementById("sidebarAboutBtn")?.addEventListener("click", showAbout);

  languageMenu = setupLanguageMenu();

  // First visit to a page that has a tour: run it once, unprompted. Every later
  // visit does nothing — About is how you get it back.
  import("./pageTour.js")
    .then(({ maybeAutoStartTour }) => maybeAutoStartTour())
    .catch((err) => console.error("[appSidebar] guided tour failed to load:", err));

  return { open, close };
}

// Language dropdown under #sidebarLanguageBtn, persisted to localStorage, with a
// handle so close() can collapse it. Stores a preference only — no i18n layer yet.
function setupLanguageMenu() {
  let current = readStoredLanguage();
  // Done even without the trigger: keeps the document's declared language in
  // step with the stored preference for screen readers and spell-checkers.
  document.documentElement.lang = current;

  const trigger = document.getElementById("sidebarLanguageBtn");
  const row = trigger?.closest("li");
  if (!trigger || !row) return null;

  const label = trigger.querySelector("span");
  const menuId = "sidebarLanguageMenu";

  const caret = document.createElement("i");
  caret.className = "fa fa-chevron-down app-sidebar-item-caret";
  caret.setAttribute("aria-hidden", "true");
  trigger.append(caret);

  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);

  const menu = document.createElement("ul");
  menu.id = menuId;
  menu.className = "app-sidebar-submenu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Language");
  menu.hidden = true;

  const options = LANGUAGES.map(({ code, label: text }) => {
    const li = document.createElement("li");
    // The <li>s are only grouping markup here; role=none keeps them out of the
    // menu's accessibility tree so it reports 4 items, not 4 list items.
    li.setAttribute("role", "none");

    const option = document.createElement("button");
    option.type = "button";
    option.className = "app-sidebar-subitem";
    option.dataset.lang = code;
    // menuitemradio, not menuitem: exactly one language is active at a time.
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", String(code === current));

    const optionLabel = document.createElement("span");
    optionLabel.textContent = text;
    const tick = document.createElement("i");
    tick.className = "fa fa-check app-sidebar-subitem-check";
    tick.setAttribute("aria-hidden", "true");
    option.append(optionLabel, tick);

    li.append(option);
    menu.append(li);
    return option;
  });

  row.append(menu);

  const isOpen = () => !menu.hidden;

  const openMenu = ({ focusActive = false } = {}) => {
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (focusActive) (options.find((o) => o.dataset.lang === current) ?? options[0]).focus();
  };

  const closeMenu = ({ returnFocus = false } = {}) => {
    if (!isOpen()) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus();
  };

  const applyLanguage = (code, { notify = true } = {}) => {
    const picked = LANGUAGES.find((lang) => lang.code === code);
    if (!picked) return;
    current = picked.code;

    options.forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset.lang === current));
    });
    if (label) label.textContent = picked.label;
    // aria-label overrides the button's text, so it has to carry the value too.
    trigger.setAttribute("aria-label", `Language: ${picked.label}`);
    document.documentElement.lang = current;

    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, current);
    } catch {
      /* storage blocked — the choice just won't persist past this page */
    }

    if (notify && current !== LANGUAGES[0].code) {
      toast.info(`${picked.label} selected — interface translation is coming soon.`);
    }
  };

  trigger.addEventListener("click", () => {
    if (isOpen()) closeMenu();
    else openMenu();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    openMenu({ focusActive: true });
  });

  menu.addEventListener("click", (e) => {
    const option = e.target.closest(".app-sidebar-subitem");
    if (!option) return;
    applyLanguage(option.dataset.lang);
    // Keep the sidebar open: the updated label is the confirmation that the
    // choice landed.
    closeMenu({ returnFocus: true });
  });

  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Stop the sidebar's document-level Escape handler from also closing the
      // whole panel — one Escape should collapse one layer.
      e.stopPropagation();
      closeMenu({ returnFocus: true });
      return;
    }

    const moves = { ArrowDown: 1, ArrowUp: -1 };
    const index = options.indexOf(document.activeElement);
    if (e.key in moves && index !== -1) {
      e.preventDefault();
      const next = (index + moves[e.key] + options.length) % options.length;
      options[next].focus();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? options[0] : options[options.length - 1]).focus();
    }
  });

  // Clicking anywhere else in the sidebar (or page) collapses the dropdown.
  document.addEventListener("click", (e) => {
    if (isOpen() && !row.contains(e.target)) closeMenu();
  });

  // Paint the stored choice without a toast — this is a restore, not a change.
  applyLanguage(current, { notify: false });

  return { collapse: () => closeMenu() };
}

// ---------------------------------------------------------------------------
// Legacy 2D-drawing sidebar prototype (formerly src/js/sidebar.js). Kept here,
// commented out, for reference only — it built a floating #sidebarContainer with
// brush/pen/eraser/undo/redo over a draw canvas and predates the current 2D
// annotation tooling. Not wired to anything.
// ---------------------------------------------------------------------------
// // 创建样式
// const style = document.createElement('style');
// style.textContent = `
//   #sidebarContainer {
//     position: absolute;
//     top: 0;
//     right: -180px; /* ✅ 向右再移出 20px，避免重叠 */
//     bottom: 0;
//     width: 160px;
//     background: rgba(255, 255, 255, 0.9);
//     color: #000;
//     display: flex;
//     flex-direction: column;
//     align-items: center;
//     padding: 10px;
//     border-left: 2px solid #ddd;
//     z-index: 10;
//     box-shadow: -2px 0 10px rgba(0, 0, 0, 0.3);
//     border-top-right-radius: 16px;
//     border-bottom-right-radius: 16px;
//     border-top-left-radius: 16px;
//     border-bottom-left-radius: 16px;
//   }

//   #sidebarContainer.hidden {
//     display: none;
//   }

//   #sidebarContainer button {
//     margin: 5px 0;
//     width: 120px;
//   }

//   #sidebarContainer .color {
//     width: 32px;
//     height: 32px;
//     margin: 3px;
//     border: 1px solid #000;
//     cursor: pointer;
//   }
// `;
// document.head.appendChild(style);


// // 🧩 Sidebar DOM 元素
// const sidebar = document.createElement('div');
// sidebar.id = 'sidebarContainer';
// sidebar.classList.add('hidden');
// sidebar.innerHTML = `
//   <button id="cancelBtn">CANCEL</button>
//   <button id="saveBtn">SAVE</button>
//   <div style="margin: 10px 0; font-weight: bold;">Currently Drawing</div>
//   <button id="arrowBtn">🔗</button>
//   <button id="textBtn">💬</button>
//   <button id="clearBtn">Clear</button>
//   <button id="undoBtn">⤺</button>
//   <button id="redoBtn">⤻</button>
//   <button id="brushBtn">🖌</button>
//   <button id="penBtn">✏</button>
//   <button id="eraserBtn">🧽</button>
//   <label for="sizeSlider">Size</label>
//   <input type="range" id="sizeSlider" min="1" max="50" value="10">
//   <label for="colorPicker">Pick Colour</label>
//   <input type="color" id="colorPicker" value="#00ff00">
// `;
// document.body.appendChild(sidebar);

// // 插入 sidebar 到 .twod-group
// function ensureSidebarIn2D() {
//   const container = document.querySelector('.twod-group');
//   if (container && !container.contains(sidebar)) {
//     container.appendChild(sidebar);
//     console.log('✅ Sidebar 插入成功');
//   }
// }

// // 添加绘图 canvas（只有一层）
// function ensureDrawingCanvas() {
//   const group = document.querySelector('.twod-group');
//   const baseImg = group?.querySelector('.twod-fullscreen-image');
//   if (!group || !baseImg) {
//     console.warn('⚠️ 无法找到 .twod-group 或 .twod-fullscreen-image');
//     return;
//   }

//   let drawCanvas = document.getElementById('draw-canvas');
//   if (drawCanvas) {
//     console.log('🎯 Canvas 已存在');
//     return;
//   }

//   drawCanvas = document.createElement('canvas');
//   drawCanvas.id = 'draw-canvas';
//   drawCanvas.style.position = 'absolute';
//   drawCanvas.style.top = '0';
//   drawCanvas.style.left = '0';
//   drawCanvas.style.zIndex = '5';
//   drawCanvas.style.pointerEvents = 'auto';
//   group.appendChild(drawCanvas);

//   // 等待图片加载完设置宽高
//   if (!baseImg.complete) {
//     baseImg.onload = () => {
//       drawCanvas.width = baseImg.clientWidth;
//       drawCanvas.height = baseImg.clientHeight;
//       initDrawingLogic(drawCanvas);
//     };
//   } else {
//     drawCanvas.width = baseImg.clientWidth;
//     drawCanvas.height = baseImg.clientHeight;
//     initDrawingLogic(drawCanvas);
//   }

//   console.log('✅ Canvas 已插入并准备绘图');
// }

// // 绑定绘图逻辑
// function initDrawingLogic(canvas) {
//   const ctx = canvas.getContext('2d');
//   let drawing = false;
//   let mode = 'brush';
//   const sizeSlider = document.getElementById('sizeSlider');
//   const colorPicker = document.getElementById('colorPicker');
//   let history = [], undone = [];

//   canvas.addEventListener('mousedown', (e) => {
//     drawing = true;
//     ctx.beginPath();
//     ctx.moveTo(e.offsetX, e.offsetY);
//     history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
//     undone = [];
//   });

//   canvas.addEventListener('mousemove', (e) => {
//     if (!drawing) return;
//     ctx.lineWidth = sizeSlider.value;
//     ctx.lineCap = 'round';

//     if (mode === 'eraser') {
//       ctx.globalCompositeOperation = 'destination-out';
//     } else {
//       ctx.globalCompositeOperation = 'source-over';
//       ctx.strokeStyle = colorPicker.value;
//     }

//     ctx.lineTo(e.offsetX, e.offsetY);
//     ctx.stroke();
//   });

//   canvas.addEventListener('mouseup', () => drawing = false);
//   canvas.addEventListener('mouseleave', () => drawing = false);

//   // 工具绑定
//   document.getElementById('brushBtn').onclick = () => mode = 'brush';
//   document.getElementById('penBtn').onclick = () => mode = 'pen';
//   document.getElementById('eraserBtn').onclick = () => mode = 'eraser';

//   document.getElementById('clearBtn').onclick = () => {
//     ctx.clearRect(0, 0, canvas.width, canvas.height);
//     history = []; undone = [];
//   };
//   document.getElementById('undoBtn').onclick = () => {
//     if (history.length > 0) {
//       undone.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
//       ctx.putImageData(history.pop(), 0, 0);
//     }
//   };
//   document.getElementById('redoBtn').onclick = () => {
//     if (undone.length > 0) {
//       history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
//       ctx.putImageData(undone.pop(), 0, 0);
//     }
//   };
//   document.getElementById('saveBtn').onclick = () => {
//     const link = document.createElement('a');
//     link.href = canvas.toDataURL();
//     link.download = 'annotation.png';
//     link.click();
//   };
// }

// // 监听 Annotate 按钮点击
// document.addEventListener('click', (e) => {
//   const annotateBtn = document.querySelector('.smart-btn.annotate');
//   const target = e.target;
//   const isInAnnotate = annotateBtn && (target === annotateBtn || annotateBtn.contains(target));
//   const isInSidebar = target.closest && target.closest('#sidebarContainer');

//   if (isInAnnotate) {
//     console.log('🟢 点击 Annotate');
//     e.stopPropagation();
//     ensureSidebarIn2D();
//     ensureDrawingCanvas();
//     sidebar.classList.toggle('hidden');
//     return;
//   }

//   if (isInSidebar) {
//     console.log('🟡 点击 Sidebar 内部');
//     e.stopPropagation();
//     return;
//   }

//   if (!sidebar.classList.contains('hidden')) {
//     console.log('🔴 点击空白关闭 Sidebar');
//     sidebar.classList.add('hidden');
//   }
// }, true);

// // Cancel 按钮逻辑
// sidebar.querySelector('#cancelBtn').addEventListener('click', () => {
//   sidebar.classList.add('hidden');
// });
