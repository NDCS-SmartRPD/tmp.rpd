/**
 * @jest-environment jsdom
 *
 * The guided page tours, both halves:
 *   - the step DATA (src/js/shared/tourSteps.js) — a selector that no longer resolves is
 *     dropped at runtime without a word, quietly shortening the tour;
 *   - the ENGINE (src/js/shared/pageTour.js) — which steps survive the reachability
 *     filter, how the numbering follows, and that the seen-flag stops it running twice.
 *
 * jsdom has no layout, so getBoundingClientRect() is all zeros and getClientRects() is
 * empty — isVisible() would reject every element. Both are stubbed per element that is
 * meant to be on screen; an empty getClientRects() is the stand-in for a shut container.
 */
import { jest } from "@jest/globals";
import { PAGE_TOURS, TOUR_VERSION, tourFor, tourStorageKey } from "../src/js/shared/tourSteps.js";
import { TOPIC_BY_ID, PAGE_LABELS, walkthroughFor } from "../src/js/shared/helpTopics.js";
import { undefinedSelectorParts } from "./helpers/appSources.mjs";

const ALL_STEPS = Object.entries(PAGE_TOURS).flatMap(([pageId, steps]) =>
  steps.map((step, i) => ({ ...step, pageId, position: i }))
);

// Steps are filtered against the live DOM at start, so the fixture has to carry the
// controls the case-list tour points at. Anything left out stands in for a control that
// isn't on the page — which is the case the filter exists for.
const FIXTURE = `
  <button id="createCaseBtn">Create Case</button>
  <div class="cm-stat-filters"></div>
  <input id="searchCaseInput" />
  <table class="cm-table"><thead><tr><th>Name</th></tr></thead></table>
  <button id="notificationBtn">Bell</button>
  <button id="footerMenuBtn">Menu</button>
`;

/** Give an element a box so isVisible() and the spotlight maths have something to work with. */
function makeVisible(el, box = { top: 40, left: 60, width: 120, height: 32 }) {
  const rect = { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top };
  el.getBoundingClientRect = () => rect;
  el.getClientRects = () => [rect];
  return el;
}
const showAll = (selectors) => document.querySelectorAll(selectors).forEach((el) => makeVisible(el));

let tour;

beforeAll(async () => {
  // requestAnimationFrame drives the reveal polling and the open transition; jsdom has
  // it, but a same-tick version keeps the tests synchronous.
  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  // jsdom implements no layout, so it has no scrollIntoView at all.
  Element.prototype.scrollIntoView = () => {};
  // Desktop-wide: fixtures sit up to ~1400px across, and a control wholly past
  // the edge of the window counts as off screen.
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true });
  tour = await import("../src/js/shared/pageTour.js");
});

// The overlay is built once and cached in pageTour's module state, so it has to survive
// every fixture reset — a detached root leaves the engine rendering into a panel that is
// no longer in the document. Held here and put back each time.
let overlayNode = null;

beforeEach(() => {
  overlayNode = document.getElementById("page-tour") || overlayNode;
  document.body.innerHTML = FIXTURE;
  if (overlayNode) document.body.appendChild(overlayNode);
  showAll("#createCaseBtn, .cm-stat-filters, #searchCaseInput, .cm-table thead, #notificationBtn, #footerMenuBtn");
  localStorage.clear();
  window.history.replaceState({}, "", "/src/pages/case_list.html");
});

afterEach(() => {
  tour.endTour();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (id) => document.getElementById(id);
const currentTitle = () => $("ptTitle").textContent;
const stepTotal = () => Number($("ptCount").textContent.match(/of (\d+)/)[1]);
const onLastStep = () => $("ptNext").textContent === "Done";
const next = async () => {
  $("ptNext").click();
  await flush();
};
const start = async (pageId) => {
  const started = tour.startPageTour({ pageId });
  await flush();
  return started;
};
/**
 * Replace the fixture page with a describe-level one: the overlay goes back in (it is
 * cached in pageTour's module state, so a detached root leaves the engine rendering into
 * a panel that is no longer in the document), `visible` gets boxes, and the path decides
 * which tour currentPageId() resolves.
 */
function buildPage(html, visible, path) {
  document.body.innerHTML = html;
  if (overlayNode) document.body.appendChild(overlayNode);
  showAll(visible);
  window.history.replaceState({}, "", path);
}

/** Walk the whole tour, returning every step title seen. */
async function walkTitles(pageId, limit = 30) {
  await start(pageId);
  const titles = [];
  for (let i = 0; i < limit; i += 1) {
    titles.push(currentTitle());
    if (onLastStep()) break;
    await next();
  }
  return titles;
}

/** Advance until `wanted` is the current step. Returns whether it was reached. */
async function runTo(pageId, wanted, limit = 30) {
  await start(pageId);
  for (let i = 0; i < limit; i += 1) {
    if (currentTitle() === wanted) return true;
    if (onLastStep()) return false;
    await next();
  }
  return false;
}

// ------------------------------------------------------------------ step data
describe("tour structure", () => {
  test("there are tours to check, each keyed by a known page id", () => {
    expect(Object.keys(PAGE_TOURS).length).toBeGreaterThan(3);
    for (const pageId of Object.keys(PAGE_TOURS)) {
      expect(PAGE_LABELS[pageId]).toBeDefined();
    }
  });

  test("every step has a title, text, a real target behind any reveal, and a live topic", () => {
    for (const step of ALL_STEPS) {
      expect(typeof step.title).toBe("string");
      expect(step.title.length).toBeGreaterThan(0);
      expect(typeof step.text).toBe("string");
      expect(step.text.length).toBeGreaterThan(0);
      // A reveal only opens the container; without a selector there is nothing to ring.
      if (step.reveal) expect(step.selector).toBeTruthy();
      // "Read more" hands off to helpBot with this id; an unknown one would open the
      // panel on the greeting instead of the answer.
      if (step.topic) expect(TOPIC_BY_ID.get(step.topic)).toBeDefined();
    }
  });

  test("each tour opens with a centred welcome step", () => {
    // The first card introduces the page; anchoring it to a control would spotlight
    // something before saying what the screen is.
    for (const steps of Object.values(PAGE_TOURS)) {
      expect(steps[0].selector).toBeUndefined();
    }
  });

  test("each tour has enough anchored steps to be worth running", () => {
    // startPageTour() refuses a tour whose anchored steps have all been filtered out,
    // so a tour of nothing but prose would never appear.
    for (const [pageId, steps] of Object.entries(PAGE_TOURS)) {
      const anchored = steps.filter((s) => s.selector).length;
      expect([pageId, anchored >= 3]).toEqual([pageId, true]);
    }
  });

});

describe("lookup helpers", () => {
  test("tourFor returns the script for a page that has one, null otherwise", () => {
    expect(tourFor("case_list")).toBe(PAGE_TOURS.case_list);
    expect(tourFor("login")).toBeNull();
    expect(tourFor("nonsense")).toBeNull();
  });

  test("the storage key is per page and per version", () => {
    expect(tourStorageKey("case_list")).toBe(`smartrpd.tour.case_list.v${TOUR_VERSION}`);
    expect(tourStorageKey("case_list")).not.toBe(tourStorageKey("viewer_3d"));
  });
});

// A step whose selector no longer resolves is dropped when the tour starts — silently.
// This catches the rename that would cause it.
describe("step selectors still exist in the source", () => {
  // `selector` and `reveal` may each be a list of alternatives (a table row ahead of its
  // header; the Case Note's desktop tab ahead of its mobile footer button). Every one of
  // them has to be real.
  const selectors = [
    ...new Set(
      ALL_STEPS.flatMap((s) => [
        ...(Array.isArray(s.selector) ? s.selector : [s.selector]),
        ...(Array.isArray(s.reveal) ? s.reveal : [s.reveal]),
        s.dismiss,
      ]).filter(Boolean)
    ),
  ];

  test("there are selectors to check", () => {
    expect(selectors.length).toBeGreaterThan(10);
  });

  test.each(selectors)("%s is defined somewhere in the app", (selector) => {
    expect(undefinedSelectorParts(selector)).toEqual([]);
  });
});

// --------------------------------------------------------------------- engine
describe("currentPageId()", () => {
  test.each([
    ["/src/pages/case_list.html", "case_list"],
    ["/src/pages/2DAnnotation.html", "annotation_2d"],
    ["/src/pages/ThreeDViewer.html", "viewer_3d"],
    ["/src/pages/admin/admin_users.html", "admin_users"],
    ["/src/pages/admin/admin_case_list.html", "admin_case_list"],
    ["/index.html", "login"],
  ])("%s → %s", (path, expected) => {
    expect(tour.currentPageId(path)).toBe(expected);
  });

  test("an admin file name outside the admin directory is not an admin page", () => {
    expect(tour.currentPageId("/src/pages/case_list.html")).toBe("case_list");
  });
});

describe("starting a tour", () => {
  test("builds the overlay and shows the first step", async () => {
    expect(await start("case_list")).toBe(true);

    const root = $("page-tour");
    expect(root).not.toBeNull();
    expect(root.classList.contains("is-hidden")).toBe(false);
    expect($("ptCount").textContent).toMatch(/^Step 1 of /);
    expect(tour.isTourRunning()).toBe(true);
  });

  test("drops steps whose control is not on the page, and the whole run one reveals", async () => {
    await start("case_list");
    const withEverything = stepTotal();
    tour.endTour();

    // The bell reveals nothing else, so exactly one step goes with it.
    $("notificationBtn").remove();
    await start("case_list");
    const withoutBell = stepTotal();
    expect(withoutBell).toBe(withEverything - 1);
    tour.endTour();

    // Create Case takes its own step plus the nine inside the form it opens.
    $("createCaseBtn").remove();
    await start("case_list");
    expect(stepTotal()).toBe(withoutBell - 10);
  });

  test("refuses a page with no tour", () => {
    expect(tour.startPageTour({ pageId: "login" })).toBe(false);
    expect(tour.isTourRunning()).toBe(false);
  });

  test("drops a step whose control is in the document but not on screen", async () => {
    // The bug this guards: filtering on existence rather than visibility kept steps for
    // controls inside a display:none panel, and the tour then arrived at a step with no
    // spotlight and nothing to look at.
    await start("case_list");
    const before = stepTotal();
    tour.endTour();

    const hidden = document.createElement("textarea");
    hidden.id = "caseInstructions";
    document.body.appendChild(hidden); // present, but jsdom gives it no rects

    await start("case_list");
    expect(stepTotal()).toBe(before);

    // Same control, now on screen: the step comes back.
    tour.endTour();
    makeVisible(hidden, { top: 300, left: 20, width: 400, height: 70 });
    await start("case_list");
    expect(stepTotal()).toBe(before + 1);
  });

  test("refuses a page where none of the anchored steps resolve", () => {
    document.body.innerHTML = "<div>nothing the tour knows about</div>";
    expect(tour.startPageTour({ pageId: "case_list" })).toBe(false);
  });
});

describe("moving through the steps", () => {
  test("Next advances and Back returns, and Back is disabled on the first step", async () => {
    await start("case_list");
    expect($("ptBack").disabled).toBe(true);

    await next();
    expect($("ptCount").textContent).toMatch(/^Step 2 /);

    $("ptBack").click();
    await flush();
    expect($("ptCount").textContent).toMatch(/^Step 1 /);
  });

  test("the last step's button says Done and ends the tour", async () => {
    await start("case_list");
    const total = stepTotal();

    for (let i = 1; i < total; i += 1) await next();
    expect(onLastStep()).toBe(true);

    await next();
    expect(tour.isTourRunning()).toBe(false);
    expect($("page-tour").classList.contains("is-hidden")).toBe(true);
  });

  test("the spotlighted control carries the ring, and only one at a time", async () => {
    await start("case_list");
    // Step 1 is the centred welcome — the ring appears from step 2 on, which is the
    // case table.
    await next();

    const table = document.querySelector(".cm-table thead");
    expect(document.querySelectorAll(".pt-target").length).toBe(1);
    expect(table.classList.contains("pt-target")).toBe(true);

    await next();
    expect(document.querySelectorAll(".pt-target").length).toBe(1);
    expect(table.classList.contains("pt-target")).toBe(false);
  });

  test("the spotlight is sized onto the control it is describing", async () => {
    await start("case_list");
    await next();

    // The fixture's box is 120x32 at (60, 40), padded by 6 on every side.
    const mask = $("ptMask");
    expect(mask.style.width).toBe("132px");
    expect(mask.style.height).toBe("44px");
    expect(mask.style.left).toBe("54px");
    expect(mask.classList.contains("is-empty")).toBe(false);
  });

  test("a step with no control dims the whole page instead", async () => {
    await start("case_list");
    expect($("ptMask").classList.contains("is-empty")).toBe(true);
  });

  test("Skip and Escape both end the tour, clearing the ring", async () => {
    await start("case_list");
    $("ptSkip").click();
    expect(tour.isTourRunning()).toBe(false);
    expect(document.querySelectorAll(".pt-target").length).toBe(0);

    await start("case_list");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tour.isTourRunning()).toBe(false);
    expect(document.querySelectorAll(".pt-target").length).toBe(0);
  });
});

describe("running once, unprompted", () => {
  test("auto-starts on a first visit", async () => {
    expect(await tour.maybeAutoStartTour({ pageId: "case_list" })).toBe(true);
  });

  test("does not auto-start again once it has run — About replays it, reset re-arms it", async () => {
    await tour.maybeAutoStartTour({ pageId: "case_list" });
    tour.endTour();
    expect(await tour.maybeAutoStartTour({ pageId: "case_list" })).toBe(false);

    expect(tour.startPageTour({ pageId: "case_list" })).toBe(true);
    tour.endTour();

    tour.resetTourProgress("case_list");
    expect(await tour.maybeAutoStartTour({ pageId: "case_list" })).toBe(true);
  });

  test("does not take over the screen while the help panel is open", async () => {
    const help = document.createElement("div");
    help.id = "help-bot";
    help.className = "is-open";
    document.body.appendChild(help);
    expect(await tour.maybeAutoStartTour({ pageId: "case_list" })).toBe(false);
  });

  test("a page with no tour is not waited on", async () => {
    expect(await tour.maybeAutoStartTour({ pageId: "login" })).toBe(false);
  });
});

// The 2D design's Components panel is display:none until the arches are locked. The
// tour's own step is what locks them, so the panel it describes is on screen by the time
// the card talks about it.
describe("the 2D design's Components step", () => {
  function build2dPage({ locked = false } = {}) {
    buildPage(
      `
      <div id="selectTeethPanel">Select Teeth</div>
      <button id="jawLockToggleBtn">Lock</button>
      <div id="editModePanel"><div id="componentTabs"></div></div>
      <button id="clearUpperComponentsBtn">Clear Top</button>
      <button id="loadProposalBtn">Load Proposed Design</button>
      <button id="footerCaseNoteBtn">Note</button>
      <button id="openClinicalInfoBtn">Clinical</button>
      <button id="openNoticeboardBtn">Board</button>
      <button id="footerMenuBtn">Menu</button>
    `,
      "#selectTeethPanel, #jawLockToggleBtn, #footerCaseNoteBtn, #openClinicalInfoBtn, #openNoticeboardBtn, #footerMenuBtn",
      "/src/pages/2DAnnotation.html"
    );

    // Everything the padlock reveals: the Components panel, and the clear / template
    // buttons that annotationLocks.js only un-hides in design mode.
    const revealed = ["componentTabs", "clearUpperComponentsBtn", "loadProposalBtn"].map($);
    const lock = $("jawLockToggleBtn");
    const showRevealed = () =>
      revealed.forEach((el, i) => makeVisible(el, { top: 120 + i * 50, left: 900, width: 300, height: 40 }));

    if (locked) showRevealed();
    else revealed.forEach((el) => (el.getClientRects = () => []));
    lock.addEventListener("click", showRevealed);
    return { tabs: revealed[0], lock };
  }

  test("is kept even though the panel starts hidden, and locks the arches to show it", async () => {
    const { tabs, lock } = build2dPage();
    const clicked = jest.spyOn(lock, "click");

    expect(await runTo("annotation_2d", "The Components panel")).toBe(true);
    await flush();

    expect(clicked).toHaveBeenCalled();
    expect(tabs.classList.contains("pt-target")).toBe(true);
    clicked.mockRestore();
  });

  test("does not lock again when the design is already in design mode", async () => {
    const { lock } = build2dPage({ locked: true });
    const clicked = jest.spyOn(lock, "click");

    expect(await runTo("annotation_2d", "The Components panel")).toBe(true);
    await flush();

    // Clicking the padlock here would unlock the design and close the very panel the
    // step is pointing at.
    expect(clicked).not.toHaveBeenCalled();
    clicked.mockRestore();
  });

  test("lists what each Components tab is for, and clears the list on a step without bullets", async () => {
    build2dPage();
    expect(await runTo("annotation_2d", "The Components panel")).toBe(true);

    const list = $("ptList");
    expect(list.hidden).toBe(false);
    expect([...list.querySelectorAll("li b")].map((b) => b.textContent)).toEqual([
      "MESH", "ASSEMBLY", "RESTS", "CLASPS", "BARS", "PLATE", "MAJOR CONNECTOR", "CASE NOTE",
    ]);

    await next();
    expect($("ptList").hidden).toBe(true);
  });

  test("keeps the design-mode-only buttons the padlock reveals, in order after the lock", async () => {
    // These are hidden while the arches are unlocked, and the tour filters its steps
    // before it starts — without naming the padlock as their reveal they would be
    // dropped from every tour begun in tooth-selection mode.
    build2dPage();
    const titles = await walkTitles("annotation_2d");

    expect(titles).toContain("Clear an arch");
    expect(titles).toContain("Propose a design, or start from scratch");
    expect(titles.indexOf("Mark the teeth")).toBeLessThan(titles.indexOf("Lock the arches"));
    expect(titles.indexOf("Lock the arches")).toBeLessThan(titles.indexOf("The Components panel"));
  });
});

// Create Case swaps the case list out for its own panes rather than opening a dialog, so
// the run inside it has to put the list back before the tour carries on with Start Case
// and the 3D link.
describe("the walk through Create Case", () => {
  function buildCreatePage() {
    buildPage(
      `
      ${FIXTURE}
      <div id="createCaseForm" hidden>
        <input id="caseName" /><input id="requestDate" type="date" />
        <input id="ccInviteInput" /><textarea id="ccCaseInstructions"></textarea>
      </div>
      <div id="createCaseUpload" hidden>
        <div id="uploadedJawModels"></div><div id="addRefImageBtn"></div>
        <button class="cancel-btn">Cancel</button><button class="save-btn">Save</button>
        <button class="save-start-btn">Save &amp; Start</button>
      </div>
      <button class="start-case-button">Start Case</button>
      <div id="view3dLinkRow">3D link</div>
      <button id="generateQrBtn">QR</button>
    `,
      "#createCaseBtn, .cm-stat-filters, #searchCaseInput, .cm-table thead, #notificationBtn, " +
        "#footerMenuBtn, .start-case-button, #view3dLinkRow, #generateQrBtn",
      "/src/pages/case_list.html"
    );

    const inside = [
      "#caseName", "#requestDate", "#ccInviteInput", "#ccCaseInstructions", "#uploadedJawModels",
      "#addRefImageBtn", "#createCaseUpload .save-btn", "#createCaseUpload .save-start-btn",
      "#createCaseUpload .cancel-btn",
    ].map((sel) => document.querySelector(sel));
    const hide = () => inside.forEach((el) => (el.getClientRects = () => []));
    const show = () => inside.forEach((el, i) => makeVisible(el, { top: 60 + i * 40, left: 300, width: 220, height: 30 }));
    hide();

    let opens = 0;
    let cancels = 0;
    $("createCaseBtn").addEventListener("click", () => { opens += 1; show(); });
    document.querySelector("#createCaseUpload .cancel-btn").addEventListener("click", () => { cancels += 1; hide(); });
    return { opens: () => opens, cancels: () => cancels };
  }

  test("opens the form once and walks its fields in order", async () => {
    const { opens } = buildCreatePage();
    const titles = await walkTitles("case_list");

    expect(titles).toEqual(expect.arrayContaining([
      "Name the case", "Invite the people working on it", "Instructions for the technician",
      "Upload the jaw scans", "Reference images", "Save the case", "Back to the case list",
    ]));
    // Reopening calls resetCreateCaseForm(), which would wipe the form.
    expect(opens()).toBe(1);
  });

  test("a missing control inside the open form does not reopen it", async () => {
    // Reopening runs resetCreateCaseForm(). A step whose control has been renamed away
    // must lose its spotlight, not the user's typing.
    const { opens } = buildCreatePage();
    $("ccInviteInput").remove();
    const titles = await walkTitles("case_list");

    // The step survives the filter (its reveal is on screen) and still shows — just
    // without a ring on anything.
    expect(titles).toContain("Invite the people working on it");
    expect(opens()).toBe(1);
  });

  test("cancels out of the form before the steps that need the list back", async () => {
    const { cancels } = buildCreatePage();
    expect(await runTo("case_list", "Back to the case list")).toBe(true);
    expect(cancels()).toBe(0); // still inside the form

    await next(); // on to Start designing
    expect(cancels()).toBe(1);
    expect(currentTitle()).toBe("Start designing");
  });

  test("the 3D link and QR come after the form, once the list is back", async () => {
    buildCreatePage();
    const titles = await walkTitles("case_list");
    expect(titles.indexOf("Back to the case list")).toBeLessThan(titles.indexOf("Start designing"));
    expect(titles.indexOf("Start designing")).toBeLessThan(titles.indexOf("Share the 3D link"));
    expect(titles.at(-1)).toBe("Or scan it on a phone");
  });
});

// Six steps walk the fields inside the Case Note sheet, and all six name the note button
// as their reveal so none is filtered out while the sheet is shut. Only the first may
// actually press it.
describe("the walk through the Case Note", () => {
  const FIELDS = ["case-note-date", "case-note-shade", "case-note-category", "case-note-comment"];

  function buildNotePage() {
    buildPage(
      `
      <button id="jawLockToggleBtn">Lock</button>
      <button id="footerCaseNoteBtn">Note</button>
      <button id="footerDownloadJawProfileBtn">Download</button>
      <button id="footerMenuBtn">Menu</button>
      <div id="caseNoteSheetBody"></div>
    `,
      "#jawLockToggleBtn, #footerCaseNoteBtn, #footerDownloadJawProfileBtn, #footerMenuBtn",
      "/src/pages/2DAnnotation.html"
    );

    const sheet = document.createElement("div");
    sheet.id = "caseNoteSheet";
    sheet.innerHTML = `<button class="cn-sheet-close">×</button>`;
    document.body.appendChild(sheet);
    const closeBtn = makeVisible(sheet.querySelector(".cn-sheet-close"), { top: 8, left: 1380, width: 24, height: 24 });
    let closes = 0;
    closeBtn.addEventListener("click", () => {
      closes += 1;
      $("caseNoteSheetBody").innerHTML = "";
    });

    const body = $("caseNoteSheetBody");
    let builds = 0;
    $("footerCaseNoteBtn").addEventListener("click", () => {
      builds += 1;
      // Mirrors 2DAnnotation.js: the form is rebuilt from scratch every time.
      body.innerHTML =
        `<form class="case-note-form">${FIELDS.map((id) => `<input id="${id}" />`).join("")}` +
        `<button class="case-note-save-btn">Approve</button></form>`;
      [body.querySelector(".case-note-form"), ...FIELDS.map($), body.querySelector(".case-note-save-btn")]
        .forEach((el, i) => makeVisible(el, { top: 60 + i * 40, left: 1000, width: 260, height: 30 }));
    });
    return { builds: () => builds, closes: () => closes };
  }

  test("all six field steps survive with the sheet closed, and the form is built once", async () => {
    const { builds } = buildNotePage();
    const titles = await walkTitles("annotation_2d");

    expect(titles).toEqual(expect.arrayContaining([
      "The Case Note", "Date Required", "Tooth Shade", "Work Category", "Special Instruction", "Approving the design",
    ]));
    // Re-opening the sheet rebuilds the form, which would throw away anything already
    // typed into it — so the tour must press that button only once.
    expect(builds()).toBe(1);
  });

  // Above 1200px the footer note button is display:none and the Case Note is the CASE
  // NOTE tab in the Components panel instead. That tab is inside a panel that is shut
  // when the tour's steps are filtered, so the run only survives because the padlock is
  // listed as a further way in.
  test("the note steps survive on a desktop, where only the CASE NOTE tab exists", async () => {
    // No #footerCaseNoteBtn at all — this is the desktop layout.
    buildPage(
      `
      <button id="jawLockToggleBtn">Lock</button>
      <button id="footerDownloadJawProfileBtn">Download</button>
      <button id="footerMenuBtn">Menu</button>
      <div id="editModePanel">
        <div id="componentTabs"><button class="component-tab is-form-tab">CASE NOTE</button></div>
        <div id="componentItems"></div>
      </div>
    `,
      "#jawLockToggleBtn, #footerDownloadJawProfileBtn, #footerMenuBtn",
      "/src/pages/2DAnnotation.html"
    );

    const tab = document.querySelector(".component-tab.is-form-tab");
    tab.getClientRects = () => []; // inside the shut Components panel
    $("jawLockToggleBtn").addEventListener("click", () => {
      makeVisible(tab, { top: 100, left: 1100, width: 90, height: 24 });
    });
    tab.addEventListener("click", () => {
      const items = $("componentItems");
      items.innerHTML = `<form class="case-note-form"><input id="case-note-date" /><button class="case-note-save-btn">Approve</button></form>`;
      [items.querySelector(".case-note-form"), items.querySelector("#case-note-date"), items.querySelector(".case-note-save-btn")]
        .forEach((el, i) => makeVisible(el, { top: 200 + i * 40, left: 1100, width: 200, height: 30 }));
    });

    const titles = await walkTitles("annotation_2d");
    expect(titles).toContain("The Case Note");
    expect(titles).toContain("Approving the design");
  });

  test("the sheet is closed when the tour steps past it onto Save, and stays closed", async () => {
    const { closes } = buildNotePage();
    expect(await runTo("annotation_2d", "Approving the design")).toBe(true);
    expect(closes()).toBe(0); // last step of the note run — sheet still open

    await next(); // on to Save, outside the run
    expect(currentTitle()).toBe("Save before you leave");
    expect(closes()).toBe(1);

    await next(); // Done
    expect(closes()).toBe(1); // not closed a second time on teardown
  });

  test("skipping out mid-note closes the sheet too", async () => {
    const { closes } = buildNotePage();
    expect(await runTo("annotation_2d", "Date Required")).toBe(true);
    $("ptSkip").click();
    expect(closes()).toBe(1);
  });

  test("stepping back out of the note closes the sheet, and returning reopens it", async () => {
    const { builds, closes } = buildNotePage();
    expect(await runTo("annotation_2d", "The Case Note")).toBe(true);
    expect(builds()).toBe(1);

    $("ptBack").click(); // back to Save
    await flush();
    expect(closes()).toBe(1);

    await next(); // forward into the note again
    expect(builds()).toBe(2);
  });

  test("the note follows the download, and Save closes the tour out", async () => {
    buildNotePage();
    const titles = await walkTitles("annotation_2d");
    expect(titles.indexOf("Download the jaw profile")).toBeLessThan(titles.indexOf("The Case Note"));
    expect(titles.indexOf("Approving the design")).toBeLessThan(titles.indexOf("Save before you leave"));
    expect(titles.at(-1)).toBe("Save before you leave");
  });
});

// Where the card lands. The 3D viewer is the page that forces the sheet layout: its
// controls are all in a 35px footer, so a sheet pinned to the bottom of a phone screen
// covered the very buttons those steps point at.
describe("fitting the card to the screen", () => {
  const DESKTOP = { width: 1280, height: 800 };
  const setViewport = ({ width, height }) => {
    Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
  };

  // The viewer, laid out like the real page: the stage fills everything above a 35px
  // footer, and the chat button sits inside that footer.
  function buildViewerPage({ width, height }) {
    setViewport({ width, height });
    buildPage(
      `<div id="container3D"></div>
       <footer class="cm-footer viewer-footer"><button id="footerChatBtn">Chat</button></footer>`,
      "#container3D, #footerChatBtn",
      "/src/pages/ThreeDViewer.html"
    );
    // Then the boxes that matter: the stage fills the window, the button is in the footer.
    makeVisible($("container3D"), { top: 0, left: 0, width, height: height - 35 });
    makeVisible($("footerChatBtn"), { top: height - 33, left: width - 40, width: 30, height: 30 });
  }

  const card = () => $("ptCard");
  // jsdom lays nothing out, so the card reports no content height — and the sheet is
  // sized never to fall below it. A typical card is a little over 200px tall.
  const CARD_CONTENT_H = 205;
  beforeEach(() => {
    if ($("ptCard")) {
      Object.defineProperty($("ptCard"), "scrollHeight", { value: CARD_CONTENT_H, configurable: true });
    }
  });
  afterEach(() => setViewport(DESKTOP));

  test("a phone flips the sheet above a footer control instead of sitting on it", async () => {
    buildViewerPage({ width: 390, height: 844 });
    expect(await runTo("viewer_3d", "Case chat")).toBe(true);

    expect(card().classList.contains("is-sheet")).toBe(true);
    expect(card().classList.contains("is-sheet-top")).toBe(true);
    expect(card().style.top).toBe("0px");
    expect(card().style.bottom).toBe("");
    // The footer starts at 809 — the sheet has to end well above it.
    expect(parseInt(card().style.maxHeight, 10)).toBeLessThan(809);
  });

  test("a full-bleed target gets a short sheet, so the model stays visible behind it", async () => {
    // #container3D is the whole stage: there is no clear edge, and a sheet sized to the
    // window would leave nothing of the thing the step is describing.
    buildViewerPage({ width: 390, height: 844 });
    await start("viewer_3d");
    await next(); // on to "Moving around"

    expect(card().classList.contains("is-sheet")).toBe(true);
    expect(card().classList.contains("is-sheet-top")).toBe(false);
    expect(card().style.bottom).toBe("0px");
    // A leftover inline top would win over bottom and unstick the sheet.
    expect(card().style.top).toBe("");
    // Tall enough for the card's own buttons, short enough to leave the stage visible.
    const height = parseInt(card().style.maxHeight, 10);
    expect(height).toBeGreaterThanOrEqual(CARD_CONTENT_H);
    expect(height).toBeLessThanOrEqual(844 * 0.6);
  });

  test("a phone held sideways is a sheet too, though it is wider than a phone", async () => {
    // The width-only breakpoint this replaced missed landscape entirely: 844px wide reads
    // as a desktop, but 390px tall has no room for a floating card beside a spotlight.
    buildViewerPage({ width: 844, height: 390 });
    expect(await runTo("viewer_3d", "Case chat")).toBe(true);

    expect(card().classList.contains("is-sheet")).toBe(true);
    expect(parseInt(card().style.maxHeight, 10)).toBeLessThanOrEqual(390);
  });

  test("a desktop keeps the floating card, placed beside the control", async () => {
    buildViewerPage(DESKTOP);
    expect(await runTo("viewer_3d", "Case chat")).toBe(true);

    expect(card().classList.contains("is-sheet")).toBe(false);
    expect(card().style.bottom).toBe("");
    expect(card().style.top).toMatch(/px$/);
    expect(card().style.left).toMatch(/px$/);
  });

  test("the welcome card is centred, not sheeted, on a phone", async () => {
    buildViewerPage({ width: 390, height: 844 });
    await start("viewer_3d");

    expect(card().classList.contains("is-sheet")).toBe(false);
    expect(card().style.transform).toBe("translate(-50%, -50%)");
  });

  test("tapping the dimmed page moves on", async () => {
    // The dimming is the mask's box-shadow, so those clicks land on the root — binding
    // this to the mask alone meant only the spotlight itself advanced the tour.
    buildViewerPage({ width: 390, height: 844 });
    await start("viewer_3d");

    $("page-tour").click();
    await flush();
    expect($("ptCount").textContent).toMatch(/^Step 2 /);
  });
});

// The case-actions step points inside a dropdown that is closed by default, so the engine
// has to open it and then ring the item, not the toggle that opened it. That is the
// case-list tour's only `reveal` step.
describe("opening a container to reach its control", () => {
  function addCaseMenu() {
    const detail = document.createElement("div");
    detail.className = "cm-detail";
    detail.innerHTML = `
      <button class="dropdown-toggle">&#9776;</button>
      <div class="dropdown-menu" hidden><button id="renameBtn">Rename</button></div>
    `;
    document.body.appendChild(detail);

    const toggle = makeVisible(detail.querySelector(".dropdown-toggle"), {
      top: 10, left: 200, width: 24, height: 24,
    });
    const rename = detail.querySelector("#renameBtn");
    // Not on screen until the menu opens — getClientRects() is what isVisible() reads,
    // so an empty list is jsdom's stand-in for a closed container.
    rename.getClientRects = () => [];
    toggle.addEventListener("click", () => {
      detail.querySelector(".dropdown-menu").hidden = false;
      makeVisible(rename, { top: 40, left: 200, width: 100, height: 28 });
    });
    return { toggle, rename };
  }

  test("clicks the opener, then rings the item inside — not the opener", async () => {
    const { toggle, rename } = addCaseMenu();
    const clicked = jest.spyOn(toggle, "click");

    expect(await runTo("case_list", "Case actions", 20)).toBe(true);
    await flush();

    expect(clicked).toHaveBeenCalled();
    expect(rename.classList.contains("pt-target")).toBe(true);
    expect(toggle.classList.contains("pt-target")).toBe(false);
    clicked.mockRestore();
  });

  test("the step is dropped when the opener itself is missing", async () => {
    // No case selected — no detail panel, so there is no way in.
    expect(await walkTitles("case_list", 20)).not.toContain("Case actions");
  });
});

// "Show me" in the help panel walks one answer's steps through this same engine,
// using the real topic data. Unlike the page tour it is done on the page: the lit
// control works, and using it moves the walk on. It finishes where it ends — what
// the last step opened stays open to carry on in — and it is not the page's tour,
// so it never marks that as seen.
describe("walking one help answer", () => {
  const logOut = () => walkthroughFor(TOPIC_BY_ID.get("log-out"));
  const hint = () => ($("ptHint").hidden ? null : $("ptHint").textContent);
  const stepNumber = () => Number($("ptCount").textContent.match(/^Step (\d+)/)[1]);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // A press moves the walk on once the page has handled it, and the next card
  // renders after that.
  const settle = async () => {
    await flush();
    await flush();
  };

  // The footer menu opens the sidebar, whose backdrop shuts it again.
  function buildMenuPage() {
    buildPage(
      `${FIXTURE}
       <div id="appSidebar">
         <div class="app-sidebar-backdrop"></div>
         <button id="sidebarLogoutBtn">Logout</button>
       </div>`,
      "#createCaseBtn, .cm-stat-filters, #searchCaseInput, .cm-table thead, #notificationBtn, #footerMenuBtn",
      "/src/pages/case_list.html"
    );
    const item = $("sidebarLogoutBtn");
    const backdrop = document.querySelector("#appSidebar .app-sidebar-backdrop");
    const shut = () => [item, backdrop].forEach((el) => (el.getClientRects = () => []));
    shut();
    let closes = 0;
    $("footerMenuBtn").addEventListener("click", () => {
      makeVisible(item, { top: 500, left: 20, width: 200, height: 40 });
      makeVisible(backdrop, { top: 0, left: 0, width: 1280, height: 800 });
    });
    backdrop.addEventListener("click", () => {
      closes += 1;
      shut();
    });
    return { item, closes: () => closes };
  }

  const walk = async (steps) => {
    const started = tour.startWalkthrough(steps);
    await flush();
    return started;
  };

  test("runs the answer's steps under its title, with Close in place of Skip tour", async () => {
    buildMenuPage();
    expect(await walk(logOut())).toBe(true);
    expect(currentTitle()).toBe("Log out");
    expect($("ptText").textContent).toBe("Select the menu button in the footer bar.");
    expect(stepTotal()).toBe(2);
    expect($("ptSkip").textContent).toBe("Close");
  });

  test("the lit control works, and using it moves the walk on — there is no Next", async () => {
    const { item } = buildMenuPage();
    await walk(logOut());
    expect($("ptNext").hidden).toBe(true);
    expect($("ptBack").hidden).toBe(true);
    expect(hint()).toBe("Click the highlighted area to continue.");

    $("footerMenuBtn").click(); // the page's own handler opens the sidebar
    await settle();
    expect(stepNumber()).toBe(2);
    expect(item.classList.contains("pt-target")).toBe(true);
    expect(hint()).toBe("Click the highlighted area to finish.");
  });

  test("the last press does its job and finishes, leaving open what it opened", async () => {
    const { item, closes } = buildMenuPage();
    let loggedOut = 0;
    item.addEventListener("click", () => (loggedOut += 1));
    await walk(logOut());
    $("footerMenuBtn").click();
    await settle();

    item.click();
    await settle();
    expect(loggedOut).toBe(1);
    expect(tour.isTourRunning()).toBe(false);
    expect(closes()).toBe(0);
  });

  test("Close puts back a panel the walk opened itself", async () => {
    const { item, closes } = buildMenuPage();
    // Starting on the sidebar item, the walk presses the menu button for it.
    await walk(logOut().slice(1));
    await flush();
    expect(item.classList.contains("pt-target")).toBe(true);
    $("ptSkip").click();
    expect(closes()).toBe(1);
  });

  test("Close leaves alone a panel the user opened", async () => {
    const { closes } = buildMenuPage();
    await walk(logOut());
    $("footerMenuBtn").click();
    await settle();
    $("ptSkip").click();
    expect(closes()).toBe(0);
  });

  test("a click outside the lit control never reaches the page, and points back at it", async () => {
    buildMenuPage();
    let reached = 0;
    const listener = () => (reached += 1);
    document.addEventListener("click", listener);
    await walk(logOut());

    $("ptBlock").click();
    document.removeEventListener("click", listener);
    expect(reached).toBe(0);
    expect(stepNumber()).toBe(1);
    expect($("ptMask").classList.contains("is-nudged")).toBe(true);
  });

  test("keys stay with the page; Escape still closes the walk", async () => {
    buildMenuPage();
    await walk(logOut());
    for (const key of ["Enter", "ArrowRight"]) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    await settle();
    expect(stepNumber()).toBe(1);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tour.isTourRunning()).toBe(false);
  });

  // A press in the sidebar shuts the sidebar, taking the next step's item with it.
  test("a panel that closes under its step is opened again, once; twice steps back", async () => {
    const { item } = buildMenuPage();
    const backdrop = document.querySelector("#appSidebar .app-sidebar-backdrop");
    await walk(logOut());
    $("footerMenuBtn").click();
    await settle();
    expect(stepNumber()).toBe(2);

    backdrop.click();
    await wait(600);
    expect(stepNumber()).toBe(2);
    expect(item.classList.contains("pt-target")).toBe(true);

    backdrop.click();
    await wait(600);
    expect(stepNumber()).toBe(1);
    expect($("footerMenuBtn").classList.contains("pt-target")).toBe(true);
  });

  test("is not the page's tour: nothing is marked seen, and the tour keeps its own Skip", async () => {
    buildMenuPage();
    await walk(logOut());
    tour.endTour();
    expect(localStorage.getItem(tourStorageKey("case_list"))).toBeNull();

    expect(await tour.maybeAutoStartTour({ pageId: "case_list" })).toBe(true);
    expect($("ptSkip").textContent).toBe("Skip tour");
    expect($("ptNext").hidden).toBe(false);
  });

  // Answers aren't tied to one page the way a page's tour is. On the case list
  // the footer menu is right there, but the sidebar it opens has no Version
  // History entry — opening it would light nothing.
  test("drops a step for a control this page lacks, though its reveal is here", async () => {
    buildMenuPage();
    const steps = walkthroughFor(TOPIC_BY_ID.get("changes-not-saving"));
    expect(steps.filter((s) => s.selector)).toHaveLength(2);
    // Both of its anchored steps are sidebar items this page doesn't have.
    expect(tour.canStartWalkthrough(steps)).toBe(false);
  });

  // The sidebar slides in: the spotlight is first placed mid-slide, and the
  // slide fires no scroll or resize to say it has moved.
  test("the spotlight follows a control that slides into place", async () => {
    const { item } = buildMenuPage();
    await walk(logOut());
    $("footerMenuBtn").click();
    await settle();
    expect($("ptMask").style.left).toBe("14px"); // placed where the slide began (20 - 6)

    makeVisible(item, { top: 500, left: 60, width: 200, height: 40 });
    document.body.dispatchEvent(new Event("transitionend", { bubbles: true }));
    await flush();
    expect($("ptMask").style.left).toBe("54px");
  });

  test("is refused, and not offered, when none of its controls is on this page", () => {
    document.body.innerHTML = "<div>nothing the answer points at</div>";
    expect(tour.canStartWalkthrough(logOut())).toBe(false);
    expect(tour.startWalkthrough(logOut())).toBe(false);
    expect(tour.isTourRunning()).toBe(false);
  });

  // Typing, and several drops or picks, can't be read off one click — nor kept
  // inside the spotlight, since a field opens its calendar or suggestions anywhere.
  test("a typing step keeps Next, and leaves the whole page usable meanwhile", async () => {
    buildPage(
      `${FIXTURE}
       <div id="createCaseForm"><div class="cc-form-grid"><input id="caseName" /></div></div>
       <div id="createCaseUpload">
         <div id="uploadedJawModels"></div>
         <div id="addRefImageBtn"></div>
         <button class="cancel-btn">Cancel</button>
         <button class="save-btn">Save</button>
       </div>`,
      "#createCaseBtn",
      "/src/pages/case_list.html"
    );
    const form =
      "#createCaseForm .cc-form-grid, #caseName, #uploadedJawModels, #addRefImageBtn, #createCaseUpload .cancel-btn, #createCaseUpload .save-btn";
    $("createCaseBtn").addEventListener("click", () => showAll(form));

    await walk(walkthroughFor(TOPIC_BY_ID.get("create-case")));
    $("createCaseBtn").click();
    await settle();
    expect(stepNumber()).toBe(2);
    expect($("ptNext").hidden).toBe(false);
    expect(hint()).toBeNull();
    expect($("page-tour").classList.contains("is-free")).toBe(true);

    $("caseName").click();
    await settle();
    expect(stepNumber()).toBe(2);
    await next();
    expect(stepNumber()).toBe(3);
  });

  // Extra 3D is too heavy to open for someone who only asked how.
  test("a look-only step moves on without pressing its control", async () => {
    buildPage(`<button id="previewTabExtras">Extra 3D</button>`, "#previewTabExtras", "/src/pages/2DAnnotation.html");
    let opened = 0;
    $("previewTabExtras").addEventListener("click", () => (opened += 1));
    await walk(walkthroughFor(TOPIC_BY_ID.get("extra-reference-stl")));

    $("previewTabExtras").click();
    await settle();
    expect(opened).toBe(0);
    expect(stepNumber()).toBe(2);
  });

  // Undo is disabled with nothing to undo, and a disabled button gets no click.
  test("a disabled control gets Next in place of the hint", async () => {
    buildPage(`<button id="undoWorkflowBtn" disabled>Undo</button>`, "#undoWorkflowBtn", "/src/pages/2DAnnotation.html");
    const [undo] = walkthroughFor(TOPIC_BY_ID.get("remove-component")).slice(-1);
    await walk([undo]);
    await flush();
    expect(hint()).toBeNull();
    expect($("ptNext").textContent).toBe("Done");
    expect($("ptNext").hidden).toBe(false);
  });

  // A picker is used by picking from it — its change — not by the click that opens it.
  test("a select moves the walk on when a new option is picked", async () => {
    buildPage(
      `<select id="searchMode"><option>name</option><option>date</option></select><input id="searchCaseInput" />`,
      "#searchMode, #searchCaseInput",
      "/src/pages/case_list.html"
    );
    await walk(walkthroughFor(TOPIC_BY_ID.get("find-case")));
    $("searchMode").click();
    await settle();
    expect(stepNumber()).toBe(1);

    $("searchMode").dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(stepNumber()).toBe(2);
  });

  describe("picking a case", () => {
    // On a phone the detail panel is parked past the right edge until a row is
    // picked; its controls have boxes, just not on screen.
    function buildCaseRows() {
      buildPage(
        `<table class="cm-table"><tbody>
           <tr class="cm-row">
             <td class="cm-td-name">Case A</td>
             <td class="cm-td-status"><span class="cm-pill" role="button" data-action="edit-status">Draft</span></td>
             <td><button class="cm-row-icon" data-action="delete">Delete</button></td>
           </tr>
         </tbody></table>
         <aside class="cm-detail">
           <button class="dropdown-toggle">☰</button>
           <div id="caseDropdown"><button id="renameBtn">Rename</button></div>
         </aside>`,
        ".cm-table tbody tr, .cm-td-name, .cm-pill, .cm-row-icon",
        "/src/pages/case_list.html"
      );
      const toggle = document.querySelector(".cm-detail .dropdown-toggle");
      const parked = { top: 40, left: 1500, width: 40, height: 40 };
      makeVisible(toggle, parked);
      makeVisible($("renameBtn"), parked);
      const row = document.querySelector(".cm-row");
      row.addEventListener("click", () => {
        row.classList.add("is-active");
        makeVisible(toggle, { top: 40, left: 900, width: 40, height: 40 });
      });
      return { row, toggle };
    }

    test("keeps the steps a row click brings on screen, and starts at the row", async () => {
      const { row, toggle } = buildCaseRows();
      await walk(walkthroughFor(TOPIC_BY_ID.get("rename-case")));
      expect(stepTotal()).toBe(3);
      expect(row.classList.contains("pt-target")).toBe(true);

      document.querySelector(".cm-td-name").click();
      await settle();
      expect(stepNumber()).toBe(2);
      expect(toggle.classList.contains("pt-target")).toBe(true);
    });

    test("the buttons inside a row neither pick the case nor do their own job meanwhile", async () => {
      const { row } = buildCaseRows();
      let deleted = 0;
      document.querySelector('[data-action="delete"]').addEventListener("click", () => (deleted += 1));
      await walk(walkthroughFor(TOPIC_BY_ID.get("rename-case")));

      document.querySelector('[data-action="delete"]').click();
      await settle();
      expect(deleted).toBe(0);
      expect(row.classList.contains("is-active")).toBe(false);
      expect(stepNumber()).toBe(1);
    });
  });

  // Mouse and touch differ in the 2D design, so each case sets one.
  const pointer = (coarse) => (query) => ({
    media: query,
    matches: query === "(pointer: coarse)" ? coarse : query === "not all and (pointer: coarse)" && !coarse,
  });

  describe("in the 2D design", () => {
    beforeEach(() => {
      window.matchMedia = pointer(false);
    });
    afterEach(() => {
      delete window.matchMedia;
    });

    // The padlock shows the Components panel; the CLASPS tab fills the list; a
    // pick lights the dots, and a dot places the clasp.
    function build2D({ locked = false } = {}) {
      buildPage(
        `<button id="jawLockToggleBtn">Lock</button>
         <div id="componentTabs"><button class="component-tab" data-tab="clasps">CLASPS</button></div>
         <div id="componentItems" data-tab="mesh"></div>
         <div class="jaw-combined-canvas">
           <div class="tooth" data-tooth-id="16"></div>
           <div class="tooth-suggestions"></div>
         </div>`,
        "#jawLockToggleBtn, .jaw-combined-canvas, .tooth",
        "/src/pages/2DAnnotation.html"
      );
      const padlock = $("jawLockToggleBtn");
      const items = $("componentItems");
      const marks = document.querySelector(".tooth-suggestions");
      const lock = () => {
        padlock.classList.add("is-locked");
        showAll("#componentTabs, .component-tab, #componentItems");
      };
      if (locked) lock();
      padlock.addEventListener("click", lock);
      document.querySelector(".component-tab").addEventListener("click", () => {
        items.dataset.tab = "clasps";
        items.innerHTML = '<button class="component-item">Retainer</button>';
        showAll(".component-item");
      });
      items.addEventListener("click", (e) => {
        if (!e.target.closest(".component-item")) return;
        marks.innerHTML = '<div class="clasp-suggestion-group"></div>';
        showAll(".clasp-suggestion-group");
      });
      const placed = [];
      marks.addEventListener("click", (e) => {
        if (e.target.closest(".clasp-suggestion-group")) placed.push("clasp");
      });
      let archClicks = 0;
      let released = 0;
      document.querySelector(".jaw-combined-canvas").addEventListener("click", (e) => {
        archClicks += 1;
        // The app lets go of the pick on a click in the white space.
        if (e.target.closest(".tooth, .tooth-suggestions, button")) return;
        released += 1;
        marks.innerHTML = "";
      });
      return { padlock, items, marks, placed, archClicks: () => archClicks, released: () => released };
    }

    const clasps = () => walkthroughFor(TOPIC_BY_ID.get("clasps"));

    async function toPlacement(page) {
      await walk(clasps());
      page.padlock.click();
      await settle();
      document.querySelector(".component-tab").click();
      await settle();
      document.querySelector(".component-item").click();
      await settle();
    }

    test("goes padlock, tab, clasp, the arch, then the white space to finish", async () => {
      const page = build2D();
      await walk(clasps());
      expect(stepTotal()).toBe(5);
      expect(page.padlock.classList.contains("pt-target")).toBe(true);

      page.padlock.click();
      await settle();
      expect(document.querySelector(".component-tab").classList.contains("pt-target")).toBe(true);

      document.querySelector(".component-tab").click();
      await settle();
      expect(page.items.classList.contains("pt-target")).toBe(true);

      // Beside the items rather than on one: nothing is picked, so nothing moves.
      page.items.click();
      await settle();
      expect(stepNumber()).toBe(3);

      document.querySelector(".component-item").click();
      await settle();
      expect(stepNumber()).toBe(4);
      expect(document.querySelector(".jaw-combined-canvas").classList.contains("pt-target")).toBe(true);

      document.querySelector(".clasp-suggestion-group").click();
      await settle();
      expect(page.placed).toEqual(["clasp"]);
      expect(stepNumber()).toBe(5);
      expect(hint()).toBe("Click any white space to finish.");

      document.querySelector(".jaw-combined-canvas").click();
      await settle();
      expect(page.released()).toBe(1);
      expect(tour.isTourRunning()).toBe(false);
    });

    // A click on the arch between the dots would clear the pick, and the dots with it.
    test("only a dot counts on the arch; the rest of it keeps still", async () => {
      const page = build2D();
      await toPlacement(page);
      document.querySelector(".tooth").click();
      await settle();
      expect(page.archClicks()).toBe(0);
      expect(tour.isTourRunning()).toBe(true);
      expect(stepNumber()).toBe(4);
    });

    test("steps back to the list when the dots go", async () => {
      const page = build2D();
      await toPlacement(page);
      page.marks.innerHTML = "";
      await wait(600);
      expect(stepNumber()).toBe(3);
      expect(page.items.classList.contains("pt-target")).toBe(true);
    });

    test("the padlock is left out once the arches are locked — pressing it would unlock them", async () => {
      build2D({ locked: true });
      await walk(clasps());
      expect(stepTotal()).toBe(4);
      expect(document.querySelector(".component-tab").classList.contains("pt-target")).toBe(true);
    });

    test("removing a component: a right-click, then a pick from the list it opens", async () => {
      buildPage(
        `<button id="jawLockToggleBtn" class="is-locked">Lock</button>
         <div class="jaw-combined-canvas"><div class="tooth" data-tooth-id="16"></div></div>
         <div id="removeComponentDialog">
           <div class="remove-component-dialog-panel">
             <button class="remove-component-item-btn">Retainer</button>
           </div>
         </div>
         <button id="undoWorkflowBtn">Undo</button>`,
        "#jawLockToggleBtn, .jaw-combined-canvas, .tooth, #undoWorkflowBtn",
        "/src/pages/2DAnnotation.html"
      );
      const tooth = document.querySelector(".tooth");
      let added = 0;
      tooth.addEventListener("click", () => (added += 1));
      tooth.addEventListener("contextmenu", () => showAll(".remove-component-dialog-panel"));

      await walk(walkthroughFor(TOPIC_BY_ID.get("remove-component")));
      expect(stepTotal()).toBe(3);
      expect(hint()).toBe("Right-click in the highlighted area to continue.");

      tooth.click(); // a left-click adds a component — not this step
      await settle();
      expect(added).toBe(0);
      expect(stepNumber()).toBe(1);

      tooth.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await settle();
      expect(stepNumber()).toBe(2);

      document.querySelector(".remove-component-item-btn").click();
      await settle();
      expect(stepNumber()).toBe(3);
    });

    // With no mesh near, no tooth lights up for a bar — the walk must not strand the user.
    test("with nothing to press in the lit control, Done stands in until something is", async () => {
      buildPage(
        `<button id="jawLockToggleBtn" class="is-locked">Lock</button>
         <div class="jaw-combined-canvas"><div class="tooth" data-tooth-id="16"></div></div>`,
        "#jawLockToggleBtn, .jaw-combined-canvas, .tooth",
        "/src/pages/2DAnnotation.html"
      );
      const [place] = walkthroughFor(TOPIC_BY_ID.get("bars")).slice(-2, -1);
      await walk([place]);
      await flush();
      expect($("ptNext").hidden).toBe(false);
      expect($("ptNext").textContent).toBe("Done");
      expect(hint()).toBeNull();

      document.querySelector(".tooth").classList.add("tooth-bar-suggestible");
      await wait(300);
      expect($("ptNext").hidden).toBe(true);
      expect(hint()).toBe("Click the highlighted area to finish.");
    });

    test("waits on the tooth quick-pick on touch, moving on once the dots show", async () => {
      window.matchMedia = pointer(true);
      const page = build2D({ locked: true });
      await walk(clasps());
      expect(stepTotal()).toBe(3);
      expect(hint()).toBe("Tap the highlighted area to continue.");

      document.querySelector(".tooth").click(); // opens the quick-pick, above the walk
      await settle();
      expect(stepNumber()).toBe(1);

      page.marks.innerHTML = '<div class="clasp-suggestion-group"></div>';
      showAll(".clasp-suggestion-group");
      await wait(300);
      expect(stepNumber()).toBe(2);
    });

    // On touch the quick-pick plates the tapped tooth itself, so the finish comes
    // next — found under the quick-pick if the walk moved on while it was open.
    test("waits for the tooth quick-pick to close before moving on", async () => {
      window.matchMedia = pointer(true);
      buildPage(
        `<button id="jawLockToggleBtn" class="is-locked">Lock</button>
         <div class="jaw-combined-canvas"><div class="tooth" data-tooth-id="16"></div></div>`,
        "#jawLockToggleBtn, .jaw-combined-canvas, .tooth",
        "/src/pages/2DAnnotation.html"
      );
      const tooth = document.querySelector(".tooth");
      tooth.addEventListener("click", () => {
        const sheet = document.createElement("div");
        sheet.className = "tooth-quickpick-backdrop";
        document.body.appendChild(makeVisible(sheet, { top: 0, left: 0, width: 1440, height: 900 }));
      });
      await walk(walkthroughFor(TOPIC_BY_ID.get("plates")));
      expect(stepTotal()).toBe(2);

      tooth.click();
      await wait(300);
      expect(stepNumber()).toBe(1);

      document.querySelector(".tooth-quickpick-backdrop").remove();
      await wait(300);
      expect(stepNumber()).toBe(2);
      expect(hint()).toBe("Tap any white space to finish.");
    });

    // The arch with a clasp picked: a tooth, its dot, and the Undo drawn over it.
    function buildFinish() {
      buildPage(
        `<div class="jaw-combined-canvas">
           <div class="tooth" data-tooth-id="16"></div>
           <div class="tooth-suggestions"><div class="clasp-suggestion-group"></div></div>
           <button id="undoWorkflowBtn">Undo</button>
         </div>`,
        ".clasp-suggestion-group, #undoWorkflowBtn",
        "/src/pages/2DAnnotation.html"
      );
      const canvas = makeVisible(document.querySelector(".jaw-combined-canvas"), { top: 0, left: 0, width: 280, height: 280 });
      const tooth = makeVisible(document.querySelector(".tooth"), { top: 0, left: 0, width: 100, height: 280 });
      const reached = { tooth: 0, dot: 0, undo: 0, white: 0 };
      tooth.addEventListener("click", () => (reached.tooth += 1));
      document.querySelector(".clasp-suggestion-group").addEventListener("click", () => (reached.dot += 1));
      $("undoWorkflowBtn").addEventListener("click", () => (reached.undo += 1));
      canvas.addEventListener("click", (e) => {
        if (e.target === canvas) reached.white += 1;
      });
      return { canvas, tooth, reached };
    }
    const finish = () => clasps().slice(-1);

    test("finishing: only a click in the white space counts — teeth, dots and controls keep still", async () => {
      const { canvas, tooth, reached } = buildFinish();
      await walk(finish());
      expect(hint()).toBe("Click any white space to finish.");

      tooth.click();
      document.querySelector(".clasp-suggestion-group").click();
      $("undoWorkflowBtn").click();
      await settle();
      expect(reached).toEqual({ tooth: 0, dot: 0, undo: 0, white: 0 });
      expect(tour.isTourRunning()).toBe(true);

      canvas.click();
      await settle();
      expect(reached.white).toBe(1);
      expect(tour.isTourRunning()).toBe(false);
    });

    // jsdom has no layout to hit-test, so the tooth is told to fill the left strip.
    test("a spot marks the middle of the white space, and pings when a click lands on a tooth", async () => {
      const { canvas, tooth } = buildFinish();
      const had = document.elementFromPoint;
      document.elementFromPoint = (x) => (x < 100 ? tooth : canvas);
      try {
        await walk(finish());
        const spot = $("ptSpot");
        expect(spot.hidden).toBe(false);
        expect(parseFloat(spot.style.left)).toBeGreaterThan(100);
        expect(parseFloat(spot.style.top)).toBeGreaterThan(80);
        expect(parseFloat(spot.style.top)).toBeLessThan(200);
        expect($("ptSpotLabel").textContent).toBe("Click here");

        tooth.click();
        await settle();
        expect(spot.classList.contains("is-pinged")).toBe(true);

        canvas.click();
        await settle();
        expect(spot.hidden).toBe(true);
      } finally {
        document.elementFromPoint = had;
      }
    });
  });

  // Right-click is for a mouse and the eraser for touch, so each device is walked
  // through its own step only.
  describe("steps for one kind of input", () => {
    afterEach(() => {
      delete window.matchMedia;
    });

    async function removeComponentTexts(coarse) {
      window.matchMedia = pointer(coarse);
      buildPage(
        `<div class="jaw-combined-canvas"></div>
         <button id="jawLockToggleBtn">Lock</button>
         <button id="removeComponentModeBtn">Eraser</button>
         <button id="undoWorkflowBtn">Undo</button>`,
        ".jaw-combined-canvas, #jawLockToggleBtn, #removeComponentModeBtn, #undoWorkflowBtn",
        "/src/pages/2DAnnotation.html"
      );
      await walk(walkthroughFor(TOPIC_BY_ID.get("remove-component")));
      const texts = [];
      for (let i = 0; i < 10; i += 1) {
        texts.push($("ptText").textContent);
        if (onLastStep()) break;
        await next();
      }
      return texts;
    }

    test("a mouse is shown right-click and not the eraser", async () => {
      const texts = await removeComponentTexts(false);
      expect(texts.some((t) => /right-click/.test(t))).toBe(true);
      expect(texts.some((t) => /eraser/.test(t))).toBe(false);
    });

    test("touch is shown the eraser and not right-click", async () => {
      const texts = await removeComponentTexts(true);
      expect(texts.some((t) => /eraser/.test(t))).toBe(true);
      expect(texts.some((t) => /right-click/.test(t))).toBe(false);
    });
  });

  // The panel side of the hand-off: helpBot.js offers Show me only when there is
  // something to walk, closes itself first, and keeps the conversation.
  describe("from the help panel", () => {
    let help;
    let helpNode = null;
    beforeAll(async () => {
      help = await import("../src/js/shared/helpBot.js");
    });
    const reattachHelp = () => {
      helpNode = document.getElementById("help-bot") || helpNode;
      if (helpNode && !helpNode.isConnected) document.body.appendChild(helpNode);
    };
    const showMeButton = () =>
      [...document.querySelectorAll("#help-bot .hb-msg.is-bot")].at(-1)
        ?.querySelector(".hb-actions .hb-action");

    test("Show me runs the walkthrough and the conversation survives it", async () => {
      buildMenuPage();
      reattachHelp();
      help.openHelpBot({ topicId: "log-out" });
      reattachHelp();
      await flush(); // the panel's open transition

      expect(showMeButton()?.textContent).toBe("Show me");
      showMeButton().click();
      await flush();

      expect(tour.isTourRunning()).toBe(true);
      expect(currentTitle()).toBe("Log out");
      expect($("help-bot").classList.contains("is-open")).toBe(false);

      // Past the panel's slide-out, which is when a normal close would clear it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(document.querySelectorAll("#help-bot .hb-msg").length).toBeGreaterThan(1);
    });

    test("no Show me when nothing the answer points at is on this page", () => {
      buildPage("<div>nothing here</div>", "div", "/src/pages/case_list.html");
      reattachHelp();
      help.openHelpBot({ topicId: "log-out" });
      expect(showMeButton() ?? null).toBeNull();
    });
  });
});
