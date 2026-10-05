// 顶部引入模块
import { lol } from "../shared/crypt.js";
import { getAppBasePath } from "../shared/pageContext.js";
import { toast, flashToast, attachThemedCalendar, calIsoFromDate } from "../shared/toast.js";
import { logApi } from "../shared/apiLog.js";
import { API_BASE, MACHINE_ID, getLoggedInUser } from "../shared/api.js";
import { attachUserSuggest, initialsFor } from "../shared/userSuggest.js";
import { confirmRemoveUserFromCase } from "../shared/caseRoles.js";
import { normalizeImageFile } from "../shared/imageFiles.js";
import { createCaseHistory } from "../shared/caseHistory.js";

// Resolved against the app root (everything before "/src/") so it loads from
// both src/pages/ and the deeper src/pages/admin/, where a fixed path would not.
function appAsset(relFromRoot) {
  const href = typeof window !== "undefined" && window.location ? window.location.href : "";
  const i = href.indexOf("/src/");
  return i !== -1 ? href.slice(0, i + 1) + relFromRoot : "../../" + relFromRoot;
}
let THREE;
let STLLoader;

// Bare specifiers resolve both ways this ships (page importmap, webpack).
// webpackMode eager keeps one file — deploy.yml ships dist/bundle.js alone.
async function loadThreeDeps() {
  if (THREE && STLLoader) return;
  const [threeMod, loaderMod] = await Promise.all([
    import(/* webpackMode: "eager" */ "three"),
    import(/* webpackMode: "eager" */ "three/addons/loaders/STLLoader.js"),
  ]);
  THREE = threeMod;
  STLLoader = loaderMod.STLLoader;
}

let existingUsers = []; // shared users currently on the case (loaded via role/all/get)
let pendingInvites = []; // usernames queued in the inline create-case view

document.addEventListener("DOMContentLoaded", async () => {
  const openBtn = document.getElementById("createCaseBtn");
  if (!openBtn) return;
  const formPane = document.getElementById("createCaseForm");
  const uploadPane = document.getElementById("createCaseUpload");
  const pageEl = document.querySelector(".cm-page");

  const jawUploadInput = document.getElementById("jawUploadInput");
  const jawContainer = document.getElementById("uploadedJawModels");

  const refUploadBtn = document.getElementById("addRefImageBtn");
  const refUploadInput = document.getElementById("refImageInput");
  const refContainer = document.getElementById("uploadedReferenceImages");

  const caseNameInput = document.getElementById("caseName");
  const requestDateInput = document.getElementById("requestDate");
  const toothShadeInput = document.getElementById("ccToothShade");
  const instructionsInput = document.getElementById("ccCaseInstructions");
  // Grows with its content instead of taking a drag handle. Height is cleared so
  // it can shrink, and the border added back on top of scrollHeight, which omits it.
  const autoGrowTextarea = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  if (instructionsInput) {
    instructionsInput.addEventListener("input", () => autoGrowTextarea(instructionsInput));
  }
  // Themed calendar for the case request date (no Clear — a request date is required).
  if (requestDateInput) attachThemedCalendar(requestDateInput, { allowClear: false });
  const caseOwnerDisplay = document.getElementById("ccCaseOwner");
  const caseCreateDateDisplay = document.getElementById("ccCreateDate");
  const inviteInput = document.getElementById("ccInviteInput");
  const inviteAddBtn = document.getElementById("ccInviteAdd");
  const inviteListEl = document.getElementById("ccInviteList");
  const suggestEl = document.getElementById("ccInviteSuggest");
  const inviteMsgEl = document.getElementById("ccInviteMsg");
  const inviteSearchEl = document.querySelector(".cc-invite-search");

  const cancelBtn = uploadPane?.querySelector(".cancel-btn");
  const saveBtn = uploadPane?.querySelector(".save-btn");
  const saveStartBtn = uploadPane?.querySelector(".save-start-btn");

  const loadingOverlay = document.getElementById("ccLoadingOverlay");
  const loadingLabel = document.getElementById("ccLoadingLabel");
  const loadingBarFill = document.getElementById("ccLoadingBarFill");
  const loadingPercent = document.getElementById("ccLoadingPercent");

  const userAccessModal = document.getElementById("userAccessModal");
  const closeUserAccessModal = document.getElementById("closeUserAccessModal");
  const cancelInviteBtn = document.getElementById("cancelInviteBtn");
  const userSearchInput = document.getElementById("userSearchInput");
  const userSearchSuggestEl = document.getElementById("userAccessSuggest");
  const addUserBtn = document.getElementById("addUserBtn");
  const saveInviteBtn = document.getElementById("saveInviteBtn");

  let activeTarget = null;

  // Display today as dd/mm/yyyy to match the request-date <input>'s shown format.
  const formatTodayDisplay = () => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  // Format `today + days` as YYYY-MM-DD (for <input type="date"> values).
  // calIsoFromDate reads the local date fields — toISOString() converts to
  // UTC first, which silently shows the wrong day for anyone east of UTC
  // (e.g. Singapore, UTC+8) during the early hours of the local day.
  const formatTodayPlusDays = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return calIsoFromDate(d);
  };

  const showInlineView = () => {
    if (!formPane || !uploadPane || !pageEl) return;
    resetCreateCaseForm();
    const loggedInUser = getLoggedInUser();
    if (caseOwnerDisplay) {
      caseOwnerDisplay.textContent = loggedInUser?.username || "—";
    }
    if (caseCreateDateDisplay) {
      caseCreateDateDisplay.textContent = formatTodayDisplay();
    }
    // Default the request date to 10 days out from the create date (today).
    if (requestDateInput) {
      requestDateInput.value = formatTodayPlusDays(10);
    }
    pageEl.classList.add("creating");
    document.body.classList.add("creating-case");
    formPane.classList.remove("hidden");
    uploadPane.classList.remove("hidden");
  };

  const hideInlineView = () => {
    if (!formPane || !uploadPane || !pageEl) return;
    pageEl.classList.remove("creating");
    document.body.classList.remove("creating-case");
    formPane.classList.add("hidden");
    uploadPane.classList.add("hidden");
  };

  const renderInviteList = () => {
    if (!inviteListEl) return;
    inviteListEl.innerHTML = "";
    pendingInvites.forEach((username, idx) => {
      const li = document.createElement("li");
      li.textContent = username;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${username}`);
      x.addEventListener("click", () => {
        pendingInvites.splice(idx, 1);
        renderInviteList();
      });
      li.appendChild(x);
      inviteListEl.appendChild(li);
    });
    // Queued names drop out of the suggestions, and re-rendering re-opens the list
    // while the box has focus — inviting several people in a row is the norm.
    inviteSuggest.refresh();
  };

  // Suggestions for the invite box: whoever is already queued, and the owner,
  // are the names that can't be invited again.
  const inviteSuggest = attachUserSuggest(inviteInput, suggestEl, {
    excluded: () => [...pendingInvites, getLoggedInUser()?.username || ""],
    onPick: () => addInvite(),
    onSubmit: () => addInvite(),
    // The complaint is about what was typed — it goes as soon as that changes.
    onInput: () => setInviteMsg(""),
  });

  // A non-2xx, an empty body or a body without a uuid all mean "no such user";
  // only a request that never completed throws. Either way the name isn't queued.
  const resolveInviteUuid = async (username) => {
    const res = await fetch(`${API_BASE}/user/checkifusernameexists/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ machine_id: MACHINE_ID }, { username }]),
    });
    logApi(res, "POST /user/checkifusernameexists/get");
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const row = Array.isArray(data) ? data[0] : data;
    return row?.uuid || null;
  };

  // Shown under the box rather than as a toast: it's about the field the user is
  // still standing in, and stays put while they fix the name.
  const setInviteMsg = (text, tone = "error") => {
    if (!inviteMsgEl) return;
    inviteMsgEl.textContent = text || "";
    inviteMsgEl.classList.toggle("is-error", Boolean(text) && tone === "error");
    inviteMsgEl.classList.toggle("is-info", Boolean(text) && tone === "info");
    inviteSearchEl?.classList.toggle("has-error", Boolean(text) && tone === "error");
    if (inviteInput) inviteInput.setAttribute("aria-invalid", String(Boolean(text) && tone === "error"));
  };

  const addInvite = async () => {
    if (!inviteInput) return;
    const name = inviteInput.value.trim();
    if (!name) return;
    setInviteMsg("");

    const key = name.toLowerCase();
    if (key === (getLoggedInUser()?.username || "").toLowerCase()) {
      setInviteMsg("You own this case already.", "info");
      inviteInput.value = "";
      return;
    }
    // Case-insensitively: usernames resolve that way server-side, so "Alice"
    // and "alice" would otherwise queue as two invites for one person.
    if (pendingInvites.some((u) => u.toLowerCase() === key)) {
      setInviteMsg(`"${name}" is already on the list.`, "info");
      inviteInput.value = "";
      return;
    }

    // Nothing is queued until the server confirms the account: the post-create
    // invite loop skips unknown usernames silently, so a typo would vanish unseen.
    if (inviteAddBtn) inviteAddBtn.disabled = true;
    try {
      const uuid = await resolveInviteUuid(name);
      if (!uuid) {
        setInviteMsg(`No user named "${name}".`);
        inviteInput.focus();
        inviteInput.select();
        return;
      }
      pendingInvites.push(name);
      inviteInput.value = "";
      renderInviteList();
    } catch (err) {
      // Couldn't reach the server — still refuse, but say why, since "no such
      // user" would be a lie.
      console.warn("Username check failed:", err);
      setInviteMsg("Couldn't verify that username. Check your connection and try again.");
    } finally {
      if (inviteAddBtn) inviteAddBtn.disabled = false;
    }
  };

  // === Image preview lightbox (click an uploaded thumbnail to enlarge) ===
  let previewOverlay = null;
  const ensurePreviewOverlay = () => {
    if (previewOverlay) return previewOverlay;
    previewOverlay = document.createElement("div");
    previewOverlay.className = "cc-preview-overlay hidden";

    const previewImg = document.createElement("img");
    previewImg.alt = "Preview";
    previewImg.addEventListener("click", (e) => e.stopPropagation());

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cc-preview-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close preview");

    const close = () => previewOverlay.classList.add("hidden");
    closeBtn.addEventListener("click", close);
    previewOverlay.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    previewOverlay.appendChild(previewImg);
    previewOverlay.appendChild(closeBtn);
    document.body.appendChild(previewOverlay);
    previewOverlay._img = previewImg;
    return previewOverlay;
  };

  // Open the lightbox for a thumbnail <img>. Skips empty (not-yet-rendered) sources.
  const openImagePreview = (src) => {
    if (!src) return;
    const overlay = ensurePreviewOverlay();
    overlay._img.src = src;
    overlay.classList.remove("hidden");
  };

  // === Drag & drop helpers (jaw STL placeholders + reference image container) ===
  const eventHasFiles = (e) => {
    const types = e?.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).some((t) => t === "Files");
  };

  // Build a fresh jaw placeholder ("upper" | "lower") with click + drag-drop wired up.
  const buildJawPlaceholder = (jawType) => {
    const placeholder = document.createElement("div");
    placeholder.className = "upload-placeholder cc-jaw-tile";
    placeholder.dataset.jaw = jawType;
    placeholder.dataset.short = jawType === "upper" ? "Upper Jaw" : "Lower Jaw";

    const bgImg = document.createElement("img");
    bgImg.className = "jaw-bg";
    bgImg.alt = jawType === "upper" ? "Upload Upper Jaw" : "Upload Lower Jaw";
    bgImg.src = appAsset("assets/cloud_upload.svg");

    const text = document.createElement("span");
    text.className = "cc-jaw-text";
    text.textContent =
      jawType === "upper" ? "Drag&Drop UpperJaw Here" : "Drag&Drop LowerJaw Here";

    const or = document.createElement("span");
    or.className = "cc-jaw-or";
    or.textContent = "or";

    const browse = document.createElement("span");
    browse.className = "cc-jaw-browse";
    browse.textContent = "Browse Files";

    placeholder.appendChild(bgImg);
    placeholder.appendChild(text);
    placeholder.appendChild(or);
    placeholder.appendChild(browse);

    placeholder.addEventListener("click", () => {
      activeTarget = placeholder;
      jawUploadInput.click();
    });
    enableJawDropZone(placeholder);
    return placeholder;
  };

  // Reset the create-case form (clears inputs + rebuilds upload zones).
  const resetCreateCaseForm = () => {
    if (caseNameInput) caseNameInput.value = "";
    if (requestDateInput) requestDateInput.value = "";
    if (toothShadeInput) toothShadeInput.value = "";
    if (instructionsInput) {
      instructionsInput.value = "";
      // Drop the inline height the auto-grow set, or the box stays expanded to
      // fit the note from the case that was just created.
      instructionsInput.style.height = "";
    }
    if (inviteInput) inviteInput.value = "";
    setInviteMsg("");
    pendingInvites = [];
    renderInviteList();
    document.querySelectorAll(".uploaded-model").forEach((el) => {
      delete el.file;
    });
    if (jawContainer) {
      jawContainer.innerHTML = "";
      ["upper", "lower"].forEach((jaw) => {
        jawContainer.appendChild(buildJawPlaceholder(jaw));
      });
    }
    if (refContainer) {
      refContainer.innerHTML = "";
    }
    if (refUploadBtn) refUploadBtn.classList.remove("has-images");
    if (jawUploadInput) jawUploadInput.value = "";
    if (refUploadInput) refUploadInput.value = "";
  };

  // The wrapper goes into the DOM synchronously with the File attached, so a fast
  // Start-click still finds and uploads the STL; the preview fills in after.
  const processStlFile = (file, target) => {
    if (!file || !target) return;
    const jaw = target.dataset.jaw;

    const wrapper = document.createElement("div");
    wrapper.className = "uploaded-model";
    wrapper.dataset.jaw = jaw;
    wrapper.file = file;

    const img = document.createElement("img");
    img.alt = jaw === "upper" ? "Upper jaw STL" : "Lower jaw STL";
    img.addEventListener("click", () => openImagePreview(img.src));

    const remove = document.createElement("div");
    remove.className = "remove-model";
    remove.textContent = "×";
    remove.onclick = () => {
      delete wrapper.file;
      wrapper.replaceWith(buildJawPlaceholder(wrapper.dataset.jaw));
    };

    wrapper.appendChild(img);
    wrapper.appendChild(remove);
    target.replaceWith(wrapper);
    jawUploadInput.value = "";

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        await loadThreeDeps();
        const loader = new STLLoader();
        const geometry = loader.parse(e.target.result);
        const material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(197 / 255, 173 / 255, 137 / 255),
          opacity: 1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 1));
        const lights = [
          new THREE.DirectionalLight(0xffffff, 1),
          new THREE.DirectionalLight(0xffffff, 1),
          new THREE.DirectionalLight(0xffffff, 1),
          new THREE.DirectionalLight(0xffffff, 1),
        ];
        lights[0].position.set(0, 0, 1);
        lights[1].position.set(0, 0, -1);
        lights[2].position.set(-1, 0, 0);
        lights[3].position.set(1, 0, 0);
        lights.forEach((light) => scene.add(light));
        scene.add(mesh);

        geometry.computeBoundingBox();
        const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        mesh.position.sub(center);

        // Rendered large so the PNG uploaded to the thumbnail slot is crisp; the
        // on-screen preview is CSS-sized, so a 512² source still fits.
        const width = 512;
        const height = 512;
        const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
        camera.position.z = 100;

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        // White backdrop so the rendered thumbnail sits flush on the white
        // upload tile (and the case-list image box) with no visible seam.
        renderer.setClearColor(0xffffff);
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL("image/png");
        img.src = dataUrl;
        wrapper.thumbnailDataUrl = dataUrl;
      } catch (err) {
        console.error("STL 解析失败：", err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // The ref grid lives inside the dashed tile: with images present the tile
  // hides its placeholder content (CSS .has-images) and shows the thumbnails.
  const syncRefTileState = () => {
    if (!refUploadBtn || !refContainer) return;
    refUploadBtn.classList.toggle("has-images", refContainer.children.length > 0);
  };

  // Insert ref image wrapper synchronously (with File attached) so Start-click
  // immediately after drop still sees it; fill the preview when FileReader finishes.
  const addRefImageFromFile = (file) => {
    // Extension is checked too, not just the MIME type: some Android providers
    // hand over a picked photo with `type` empty, and dropping it silently is
    // indistinguishable from the picker doing nothing at all.
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|gif|bmp|webp|hei[cf])$/i.test(file.name || "")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "uploaded-model";
    wrapper.file = file;

    const img = document.createElement("img");
    // stopPropagation: thumbnails sit inside the tile, whose click opens the
    // file picker — a thumbnail click should only open the preview.
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      openImagePreview(img.src);
    });

    const remove = document.createElement("div");
    remove.className = "remove-model";
    remove.textContent = "×";
    remove.onclick = (e) => {
      e.stopPropagation();
      delete wrapper.file;
      wrapper.remove();
      refUploadInput.value = "";
      syncRefTileState();
    };

    wrapper.appendChild(img);
    wrapper.appendChild(remove);
    refContainer.appendChild(wrapper);
    syncRefTileState();

    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const enableJawDropZone = (placeholder) => {
    if (!placeholder || placeholder.dataset.dropBound === "1") return;
    placeholder.dataset.dropBound = "1";
    placeholder.addEventListener("dragenter", (e) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      placeholder.classList.add("is-dragover");
    });
    placeholder.addEventListener("dragover", (e) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      placeholder.classList.add("is-dragover");
    });
    placeholder.addEventListener("dragleave", (e) => {
      if (placeholder.contains(e.relatedTarget)) return;
      placeholder.classList.remove("is-dragover");
    });
    placeholder.addEventListener("drop", (e) => {
      placeholder.classList.remove("is-dragover");
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!/\.stl$/i.test(file.name)) {
        toast.warning("Please drop a .stl file.");
        return;
      }
      activeTarget = placeholder;
      processStlFile(file, placeholder);
    });
  };

  const enableRefDropZone = (container) => {
    if (!container || container.dataset.dropBound === "1") return;
    container.dataset.dropBound = "1";
    container.addEventListener("dragenter", (e) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      container.classList.add("is-dragover");
    });
    container.addEventListener("dragover", (e) => {
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      container.classList.add("is-dragover");
    });
    container.addEventListener("dragleave", (e) => {
      if (container.contains(e.relatedTarget)) return;
      container.classList.remove("is-dragover");
    });
    container.addEventListener("drop", (e) => {
      container.classList.remove("is-dragover");
      if (!eventHasFiles(e)) return;
      e.preventDefault();
      const imageFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!imageFiles.length) {
        toast.warning("Please drop image files (PNG or JPEG).");
        return;
      }
      for (const file of imageFiles) {
        addRefImageFromFile(file);
      }
    });
  };

  // 打开内联创建视图（取代弹窗）
  if (openBtn && formPane && uploadPane) {
    openBtn.addEventListener("click", () => {
      showInlineView();
    });
  }

  /*** 👇 STL 上传逻辑（最多两个） ***/
  if (jawUploadInput && jawContainer) {
    jawContainer.querySelectorAll(".upload-placeholder").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTarget = btn;
        jawUploadInput.click();
      });
      enableJawDropZone(btn);
    });

    jawUploadInput.addEventListener("change", (event) => {
      const file = event.target.files[0];
      processStlFile(file, activeTarget);
    });
  }

  /*** 👇 PNG/JPG 图片上传逻辑（无限上传） ***/
  if (refUploadBtn && refUploadInput && refContainer) {
    refUploadBtn.addEventListener("click", () => {
      refUploadInput.click();
    });
    // Only the tile is a drop zone; the grid now lives inside it, so a second
    // binding there would double-add every dropped file (drop events bubble).
    enableRefDropZone(refUploadBtn);

    refUploadInput.addEventListener("change", (event) => {
      for (const file of event.target.files) {
        addRefImageFromFile(file);
      }
      // Clear the input so picking the same file again re-fires `change`.
      refUploadInput.value = "";
    });
  }

  /*** 👇 Invite Users 内联列表 ***/
  if (inviteAddBtn) {
    inviteAddBtn.addEventListener("click", addInvite);
  }
  /*** 👇 取消按钮：清空状态并关闭内联视图 ***/
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      resetCreateCaseForm();
      hideInlineView();
    });
  }

  /*** 👇 Save / Save & Start 提交流程 ***/
  const submitCase = async (mode, triggerBtn) => {
    if (triggerBtn.dataset.submitting === "1") return;

    const caseName = caseNameInput?.value?.trim();
    if (!caseName) {
      toast.warning("Please enter case name.");
      return;
    }

    const loggedInUser = getLoggedInUser();
    if (!loggedInUser || !loggedInUser.uuid) {
      toast.error("User not logged in.");
      return;
    }

    triggerBtn.dataset.submitting = "1";
    triggerBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    if (saveStartBtn) saveStartBtn.disabled = true;
    const originalText = triggerBtn.textContent;
    triggerBtn.textContent = "Creating…";

    const hasUpperPre = !!jawContainer.querySelector(
      '.uploaded-model[data-jaw="upper"]'
    );
    const hasLowerPre = !!jawContainer.querySelector(
      '.uploaded-model[data-jaw="lower"]'
    );
    const refCountPre = refContainer
      ? refContainer.querySelectorAll(".uploaded-model").length
      : 0;
    const inviteCountPre = pendingInvites.length;
    // Steps: create case + (upper STL + thumb) + (lower STL + thumb) + each ref + each invite + finalize
    const totalSteps =
      1 +
      (hasUpperPre ? 2 : 0) +
      (hasLowerPre ? 2 : 0) +
      refCountPre +
      inviteCountPre +
      1;
    let completedSteps = 0;
    const setProgress = (label) => {
      if (!loadingOverlay) return;
      const pct = Math.min(100, Math.round((completedSteps / totalSteps) * 100));
      if (loadingBarFill) loadingBarFill.style.width = `${pct}%`;
      if (loadingPercent) loadingPercent.textContent = `${pct}%`;
      if (label && loadingLabel) loadingLabel.textContent = label;
    };
    const advance = (label) => {
      completedSteps += 1;
      setProgress(label);
    };
    if (loadingOverlay) {
      completedSteps = 0;
      if (loadingBarFill) loadingBarFill.style.width = "0%";
      if (loadingPercent) loadingPercent.textContent = "0%";
      if (loadingLabel) loadingLabel.textContent = "Creating case…";
      loadingOverlay.classList.remove("hidden");
    }

    const release = () => {
      triggerBtn.dataset.submitting = "";
      triggerBtn.disabled = false;
      triggerBtn.textContent = originalText;
      if (saveBtn) saveBtn.disabled = false;
      if (saveStartBtn) saveStartBtn.disabled = false;
      if (loadingOverlay) loadingOverlay.classList.add("hidden");
    };

    const machine_id = MACHINE_ID;
    const uuid = loggedInUser.uuid;
    const hasUpper = !!jawContainer.querySelector(
      '.uploaded-model[data-jaw="upper"]'
    );
    const hasLower = !!jawContainer.querySelector(
      '.uploaded-model[data-jaw="lower"]'
    );

    const payload = [
      { machine_id, uuid },
      {
        case_id: caseName,
        upper_insertion_angle_x: 0,
        upper_insertion_angle_y: 0,
        upper_insertion_angle_z: 0,
        lower_insertion_angle_x: 0,
        lower_insertion_angle_y: 0,
        lower_insertion_angle_z: 0,
        process_upper: hasUpper ? 1 : 0,
        process_lower: hasLower ? 1 : 0,
      },
    ];

    let caseIntID = null;
    try {
      const res = await fetch(
        `${API_BASE}/case`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      logApi(res, 'POST /case');
      if (!res.ok) {
        let errorText = "";
        try {
          errorText = await res.text();
        } catch {
          errorText = "";
        }
        const err = new Error(`Create case failed: HTTP ${res.status}`);
        err.status = res.status;
        err.body = errorText;
        throw err;
      }
      const data = await res.json();
      caseIntID = data.id;
      await createCaseHistory(caseIntID, "Case created");
      await saveCaseInstructions(
        machine_id,
        uuid,
        caseIntID,
        instructionsInput?.value ?? "",
        toothShadeInput?.value ?? ""
      );
      advance(hasUpperPre ? "Uploading upper jaw…" : hasLowerPre ? "Uploading lower jaw…" : "Saving…");
    } catch (err) {
      console.error("❌ Failed to create case", err);
      const detail = typeof err?.body === "string" && err.body.trim()
        ? `\n${err.body.slice(0, 400)}`
        : "";
      const statusPart = err?.status ? ` (HTTP ${err.status})` : "";
      toast.error(`Failed to create case${statusPart}.${detail}`);
      release();
      return;
    }

    try {
      if (hasUpper) {
        const upperEl = jawContainer.querySelector(
          '.uploaded-model[data-jaw="upper"]'
        );
        await uploadSTL("upper_jaw", upperEl, machine_id, uuid, caseName, caseIntID);
        advance("Saving upper jaw thumbnail…");
        if (upperEl?.thumbnailDataUrl) {
          await uploadCaseThumbnail(machine_id, uuid, caseIntID, 1, upperEl.thumbnailDataUrl);
        }
        advance(hasLower ? "Uploading lower jaw…" : "Saving…");
      }
      if (hasLower) {
        const lowerEl = jawContainer.querySelector(
          '.uploaded-model[data-jaw="lower"]'
        );
        await uploadSTL("lower_jaw", lowerEl, machine_id, uuid, caseName, caseIntID);
        advance("Saving lower jaw thumbnail…");
        if (lowerEl?.thumbnailDataUrl) {
          await uploadCaseThumbnail(machine_id, uuid, caseIntID, 2, lowerEl.thumbnailDataUrl);
        }
        advance(refCountPre ? "Uploading reference images…" : "Saving…");
      }
    } catch (err) {
      console.error("❌ STL Upload failed", err);
    }

    try {
      const refWrappers = refContainer.querySelectorAll(".uploaded-model");
      for (let i = 0; i < refWrappers.length; i++) {
        await uploadReferenceImage(
          refWrappers[i],
          machine_id,
          uuid,
          caseName,
          caseIntID,
          i + 1
        );
        advance(`Uploading reference image ${i + 1} of ${refWrappers.length}…`);
      }
    } catch (err) {
      console.warn("❌ Reference Image Upload failed", err);
    }

    if (pendingInvites.length) {
      setProgress("Sending invites…");
      const from_user = loggedInUser.username || "";
      for (const username of pendingInvites) {
        try {
          const targetUUID = await lookupUserUUID(machine_id, username);
          if (!targetUUID) {
            console.warn(`User "${username}" not found — skipping.`);
            continue;
          }
          const roleInviteRes = await fetch(`${API_BASE}/role`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              { machine_id, uuid, caseIntID },
              { role: 3, uuid: targetUUID, case_int_id: caseIntID },
            ]),
          });
          logApi(roleInviteRes, 'POST /role');
          const alertInviteRes = await fetch(`${API_BASE}/alerts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              { machine_id, uuid, caseIntID },
              {
                case_int_id: caseIntID,
                to_user: username,
                from_user,
                alert_message: `You have been added to case "${caseName}" by ${from_user}.`,
                read_status: 0,
                deleted: 0,
              },
            ]),
          });
          logApi(alertInviteRes, 'POST /alerts');
        } catch (e) {
          console.warn(`❌ Failed to invite ${username}:`, e);
        }
        advance(`Invited ${username}`);
      }
    }

    advance(mode === "start" ? "Opening case…" : "Finalizing…");

    if (mode === "start") {
      const encryptedId = lol(caseIntID);
      const repoBase = getAppBasePath();
      window.location.href = `${window.location.origin}${repoBase}/src/pages/2DAnnotation.html?id=${encryptedId}`;
    } else {
      flashToast("Case created.", "success");
      window.location.reload();
    }
  };

  if (saveBtn) {
    saveBtn.addEventListener("click", () => submitCase("save", saveBtn));
  }
  if (saveStartBtn) {
    saveStartBtn.addEventListener("click", () => submitCase("start", saveStartBtn));
  }

  // Read off the rendered list, not a cached array: two modules repaint this
  // modal, so the DOM is the only copy of that state both keep current.
  const sharedUsernames = () =>
    [...document.querySelectorAll("#sharedUserList .shared-user-item")]
      .map((li) => li.dataset.username || "")
      .filter(Boolean);

  // Bind ADD button click in the userAccessModal (shared-user invite flow).
  if (addUserBtn && userSearchInput) {
    let userSuggest = null; // assigned below, once addSharedUser exists to bind to
    const addSharedUser = async () => {
      const username = userSearchInput.value.trim();
      if (!username) return;

      const ctx = window._inviteContext;
      if (!ctx || !ctx.caseIntID || !ctx.uuid || !ctx.machine_id) {
        toast.error("Unable to load case context — please refresh and try again.");
        return;
      }

      const { caseIntID, machine_id, uuid: ownerUUID } = ctx;

      // Case-insensitively: usernames resolve that way server-side, so "Alice"
      // and "alice" would otherwise both be posted as roles for one person.
      const key = username.toLowerCase();
      if (sharedUsernames().some((n) => n.toLowerCase() === key)) {
        toast.info(`User "${username}" is already added.`);
        return;
      }

      try {
        const targetUUID = await lookupUserUUID(machine_id, username);
        if (!targetUUID) throw new Error("User not found");

        // 2️⃣ 添加为 co-owner
        const roleRes = await fetch(
          `${API_BASE}/role`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              { machine_id, uuid: ownerUUID, caseIntID },
              { role: 3, uuid: targetUUID, case_int_id: caseIntID },
            ]),
          }
        );
        logApi(roleRes, 'POST /role');
        if (!roleRes.ok) throw new Error("Add role failed");

        // Send an in-app notification to the invitee. Failures are non-fatal.
        try {
          const from_user = getLoggedInUser()?.username || "";
          const alertSendRes = await fetch(`${API_BASE}/alerts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              { machine_id, uuid: ownerUUID, caseIntID },
              {
                case_int_id: caseIntID,
                to_user: username,
                from_user,
                alert_message: `You have been added to case "${ctx.caseName}" by ${from_user}.`,
                read_status: 0,
                deleted: 0,
              },
            ]),
          });
          logApi(alertSendRes, 'POST /alerts');
        } catch (e) {
          console.warn("Failed to send invite alert:", e);
        }

        // Refresh the shared-user list from the server.
        const refreshed = await fetch(
          `${API_BASE}/role/all/get`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([
              { machine_id, uuid: ownerUUID, caseIntID },
              { case_int_id: caseIntID },
            ]),
          }
        );
        logApi(refreshed, 'POST /role/all/get');
        existingUsers = await refreshed.json();
        renderSharedUserList();

        userSearchInput.value = "";
        // The name just added drops out of the suggestions.
        userSuggest?.refresh();
      } catch (err) {
        console.error("Failed to add user:", err);
        toast.error("Failed to add user: " + err.message);
      }
    };

    addUserBtn.addEventListener("click", addSharedUser);

    // Same suggestion box as the create-case invite field, minus whoever is
    // already on the case (the owner included — they hold a role row too).
    userSuggest = attachUserSuggest(userSearchInput, userSearchSuggestEl, {
      excluded: sharedUsernames,
      onPick: () => addSharedUser(),
      onSubmit: () => addSharedUser(),
    });
  }

  if (saveInviteBtn) {
    saveInviteBtn.addEventListener("click", () => {
      location.reload();
    });
  }
  if (closeUserAccessModal) {
    closeUserAccessModal.addEventListener("click", () => {
      userAccessModal.classList.add("hidden");
      userAccessModal.classList.remove("show");
    });
  }

  // Invite modal Cancel: clear the search input only (keep modal + user list).
  if (cancelInviteBtn && userSearchInput) {
    cancelInviteBtn.addEventListener("click", () => {
      userSearchInput.value = "";
    });
  }
});

async function uploadSTL(
  jawType,
  wrapperEl,
  machine_id,
  uuid,
  case_id,
  caseIntID
) {
  if (!wrapperEl || !wrapperEl.file) {
    console.warn(`⚠️ No STL file found for ${jawType}`);
    return;
  }

  const file = wrapperEl.file;
  const reader = new FileReader();

  return new Promise((resolve, reject) => {
    reader.onload = async function (e) {
      try {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);
        const binaryStr = uint8Array.reduce(
          (data, byte) => data + String.fromCharCode(byte),
          ""
        );
        const base64 = btoa(binaryStr);
        const filename = file.name || `${jawType}.stl`;

        const rawPayload = [
          { machine_id, uuid, caseIntID },
          {
            case_id,
            type: jawType, // "upper_jaw" or "lower_jaw"
            data: base64,
            filename,
          },
        ];

        // 1) Raw STL bucket — what the web 3D preview pulls from.
        const rawRes = await fetch(
          `${API_BASE}/stl/raw`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(rawPayload),
          }
        );
        logApi(rawRes, 'POST /stl/raw');
        if (!rawRes.ok) {
          console.error(`❌ Failed to upload ${jawType} (raw)`, rawRes.status);
        } else {
          console.log(`✅ Uploaded ${jawType} STL (raw)`);
        }

        // Processed STL bucket, read by the desktop's RestAPI.CreateSTL. The C#
        // enum is Upper=0/Lower=1 but the DB column is 1-based, hence 1 and 2.
        const dbType = jawType === "upper_jaw" ? 1 : jawType === "lower_jaw" ? 2 : 0;
        const stlPayload = [
          { machine_id, uuid, caseIntID },
          {
            case_id: caseIntID,
            type: dbType,
            data: base64,
            filename,
          },
        ];
        const stlRes = await fetch(
          `${API_BASE}/stl`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stlPayload),
          }
        );
        logApi(stlRes, 'POST /stl');
        if (!stlRes.ok) {
          let body = "";
          try { body = await stlRes.text(); } catch {}
          console.error(
            `❌ Failed to upload ${jawType} (processed)`,
            stlRes.status,
            body.slice(0, 200)
          );
        } else {
          console.log(`✅ Uploaded ${jawType} STL (processed)`);
        }

        resolve();
      } catch (err) {
        console.error(`❌ Error uploading ${jawType}:`, err);
        resolve();
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

function renderSharedUserList() {
  const container = document.getElementById("sharedUserList");
  if (!container) {
    console.warn("Missing element: #sharedUserList");
    return;
  }

  container.innerHTML = "";

  if (!existingUsers || existingUsers.length === 0) {
    const empty = document.createElement("li");
    empty.className = "uam-empty";
    empty.innerHTML = `
      <i class="fa fa-user-group" aria-hidden="true"></i>
      <span>No one else has access yet</span>
      <span style="font-size: 12px; opacity: 0.75;">Invite a user above to share this case.</span>
    `;
    container.appendChild(empty);
    return;
  }

  existingUsers.forEach((user) => {
    const li = document.createElement("li");
    li.className = "shared-user-item";
    // Read back by the invite box to keep people already on the case out of its
    // suggestions — exact, unlike scraping the decorated name text.
    li.dataset.username = user.username || "";

    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    avatar.textContent = initialsFor(user.username);

    const body = document.createElement("div");
    body.className = "user-body";

    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = user.username;

    const roleSpan = document.createElement("span");
    roleSpan.className = "user-role";
    roleSpan.textContent = user.role || "Member";
    if ((user.role || "").toLowerCase() === "owner") {
      roleSpan.classList.add("is-owner");
    }

    body.appendChild(nameSpan);
    body.appendChild(roleSpan);

    li.appendChild(avatar);
    li.appendChild(body);

    // Owner row + rows without a uuid aren't removable.
    if (user.uuid && user.role !== "owner") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.title = "Remove user";
      deleteBtn.setAttribute("aria-label", `Remove ${user.username}`);
      deleteBtn.className = "delete-user-btn";
      deleteBtn.innerHTML = '<i class="fa fa-xmark" aria-hidden="true"></i>';

      deleteBtn.addEventListener("click", async () => {
        if (!(await confirmRemoveUserFromCase(user))) return;
        existingUsers = existingUsers.filter((u) => u.uuid !== user.uuid);
        renderSharedUserList();
      });

      li.appendChild(deleteBtn);
    }

    container.appendChild(li);
  });
}

// Resolve a username to its uuid, or null when the account doesn't exist.
async function lookupUserUUID(machine_id, username) {
  const res = await fetch(`${API_BASE}/user/checkifusernameexists/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ machine_id }, { username }]),
  });
  logApi(res, "POST /user/checkifusernameexists/get");
  const data = await res.json();
  return data?.uuid || null;
}

async function uploadReferenceImage(
  wrapperEl,
  machine_id,
  uuid,
  case_id,
  caseIntID,
  index = 1
) {
  if (!wrapperEl || !wrapperEl.file) {
    console.warn(`⚠️ No image file found in wrapper`);
    return;
  }

  const file = wrapperEl.file;

  // Re-encoded first: a phone capture is multi-MB, and it is posted twice below.
  // A file that can't be decoded (HEIC on Android) is reported and skipped —
  // never fatal, the case itself is already created by this point.
  let image;
  try {
    image = await normalizeImageFile(file);
  } catch (err) {
    console.warn(`⚠️ Reference image skipped: ${file.name}`, err);
    toast.error(err.message);
    return;
  }
  const base64data = image.dataUrl;

  try {
    const payload = [
      {
        machine_id,
        uuid,
        caseIntID,
      },
      {
        case_id,
        image_name: image.name || `ref_image_${index}.jpg`,
        image_data: base64data,
      },
    ];

    const res = await fetch(
      `${API_BASE}/referenceimages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    logApi(res, 'POST /referenceimages');
    if (!res.ok) {
      console.error(
        `❌ Failed to upload reference image ${image.name}`,
        res.status
      );
    } else {
      console.log(`✅ Uploaded reference image: ${image.name}`);
    }

    // Mirrored into a thumbnail slot so it joins the detail carousel. Slots
    // 0-2 are reserved, and `index` is 1-based, so ref image 1 lands on slot 3.
    await uploadCaseThumbnail(machine_id, uuid, caseIntID, 2 + index, base64data);
  } catch (err) {
    console.error(`❌ Error uploading reference image ${image.name}:`, err);
  }
}

// The case is brand new, so there is no row to merge with. Non-fatal: this must
// never fail a case creation that already succeeded.
async function saveCaseInstructions(machine_id, uuid, caseIntID, text, toothShade = "") {
  const comments = (text || "").trim();
  const shade = (toothShade || "").trim();
  if (!caseIntID || (!comments && !shade)) return;
  const payload = [
    { machine_id, uuid, caseIntID },
    { assigned_to: null, due_date: null, new_status: null, comments: comments || null, tooth_shade: shade || null },
  ];
  try {
    const res = await fetch(
      `${API_BASE}/additionalcasedetails`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    logApi(res, "POST /additionalcasedetails");
    if (!res.ok) {
      console.error("❌ Failed to save case instructions:", res.status);
    }
  } catch (err) {
    console.error("❌ Error saving case instructions:", err);
  }
}

// caseData carries the integer case id, the slot, and bare base64 (no data URL
// prefix). Slots: 0 = composite 2D, 1 = upper render, 2 = lower, 3+ = references.
async function uploadCaseThumbnail(machine_id, uuid, caseIntID, slot, dataUrl) {
  if (!caseIntID || !dataUrl) return;
  const commaIdx = dataUrl.indexOf(",");
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const payload = [
    { machine_id, uuid, caseIntID },
    { case_id: caseIntID, slot, data: base64 },
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
      console.error(`❌ Failed to upload thumbnail slot ${slot}:`, res.status);
    } else {
      console.log(`✅ Uploaded thumbnail slot ${slot}`);
    }
  } catch (err) {
    console.error(`❌ Error uploading thumbnail slot ${slot}:`, err);
  }
}
