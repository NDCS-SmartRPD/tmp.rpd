// A spotlight walk through the current page, from About or a first visit — or
// through one help answer's steps, from its "Show me". Unreachable steps are
// dropped before the numbering is fixed.
//
// The page's tour only points: its overlay swallows clicks so the page can't
// change shape mid-walk. A help walkthrough is done on the page itself — the lit
// control works through a hole in the overlay, and using it moves the walk on.

import { PAGE_LABELS } from "./helpTopics.js";
import { tourFor, tourStorageKey } from "./tourSteps.js";
import { currentPageId, ensureStylesheet } from "./pageContext.js";

export { currentPageId };

const REVEAL_TIMEOUT_MS = 1500;
const AUTOSTART_TIMEOUT_MS = 4000;
const WATCH_MS = 120;       // how often a walkthrough checks on the page
const LOST_GRACE_MS = 350;  // a control the page redraws is back within this
const CARD_GAP = 14;      // space between the spotlight and the card
const VIEWPORT_PAD = 12;  // keep the card this far off every edge

// Below either of these the card becomes a full-width sheet. Height counts as
// much as width: a phone held sideways is ~390px tall.
const SHEET_MAX_WIDTH = 560;
const SHEET_MAX_HEIGHT = 520;
const SHEET_MAX_FRACTION = 0.6; // the sheet never eats more of the screen than this

// What a click can land on inside a step's control without being it — the
// delete button inside a case row.
const CONTROLS = "button, a[href], input, select, textarea, [role='button'], [data-action]";

let root = null;      // #page-tour, built on first run
let maskEl = null;
let blockEl = null;
let cardEl = null;
let steps = [];
let index = 0;
let running = false;
let walking = false;      // a help walkthrough, not the page's tour
let reflowFrame = 0;
let watchTimer = 0;
let currentTarget = null;
let lastBox = "";         // where the spotlight was last placed
let openedByTour = null;  // { key, dismiss } for a panel this tour opened
let openRun = "";         // revealKey of the run whose panel is on screen
let leaveOpenOnDone = false;
let stepRun = null;       // the current step as a walkthrough tracks it (see watchStep)

// -------------------------------------------------------------------- storage

// Private-mode browsers throw on localStorage; a tour that can't remember it ran
// is better than one that breaks the page.
function hasSeen(pageId) {
  try {
    return localStorage.getItem(tourStorageKey(pageId)) === "1";
  } catch {
    return false;
  }
}

function markSeen(pageId) {
  try {
    localStorage.setItem(tourStorageKey(pageId), "1");
  } catch {
    /* nothing to do — the tour just offers itself again next time */
  }
}

// Clears the "seen" flag so the tour auto-runs again. Exposed for support and
// for a future "replay the tours" preference.
export function resetTourProgress(pageId = currentPageId()) {
  try {
    localStorage.removeItem(tourStorageKey(pageId));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------- targeting

function safeQuery(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

// Laid out, and not translated wholly past the side of the screen — the phone
// case list parks its detail panel there until a case is picked.
function isVisible(el) {
  if (!el || el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  return r.right > 0 && r.left < window.innerWidth;
}

function isInView(el) {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function waitForVisible(selectors, timeout = REVEAL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      const el = firstVisible(selectors);
      if (el) return resolve(el);
      if (Date.now() >= deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// The 3D viewer covers its stage while the case downloads, so wait for both its
// loading screen and the slot manager. False past the cap skips this visit only.
const LOADING_SCREEN_SELECTOR =
  "#viewer-loading-screen, #design-upload-prompt.is-loading";
const LOADING_SCREEN_TIMEOUT_MS = 180000;

function waitForLoadingScreen(timeout = LOADING_SCREEN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      if (!document.querySelector(LOADING_SCREEN_SELECTOR)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// First selector actually on screen, in preference order — NOT a CSS list, since
// `querySelector("a, b")` returns document order, not the order asked for.
const firstVisible = (selectors) => asList(selectors).map(safeQuery).find(isVisible) || null;

// Each may name several alternatives: the 2D Case Note sits behind a tab or a
// footer button depending on a media query, and the case table prefers a row.
const selectorList = (step) => asList(step.selector);
const revealList = (step) => asList(step.reveal);

// Identifies the run of steps sharing one panel. A string, not the array — each
// step has its own copy, so a reference compare would close the panel between them.
const revealKey = (step) => revealList(step).join("|");

// True without a query, and under jsdom, which has no matchMedia.
function mediaMatches(query) {
  return !query || typeof window.matchMedia !== "function" || window.matchMedia(query).matches;
}

// Already done on this screen — the padlock step while the arches are locked.
const isDone = (step) => !!step.skipIf && !!firstVisible(step.skipIf);

// A placement step's control only counts while the marks to click are showing.
const requiresMet = (step) => !step.requires || !!firstVisible(step.requires);

const findTarget = (step) => (requiresMet(step) ? firstVisible(selectorList(step)) : null);

const isLive = (el, step) => !!el && el.isConnected && isVisible(el) && requiresMet(step);

// `media` gates a step to one kind of input. No selector means a centred card,
// which otherwise always qualifies. Else test VISIBILITY, not existence —
// display:none controls are in the document early.
function stepIsReachable(step, { inMarkup = false } = {}) {
  if (!mediaMatches(step.media) || isDone(step)) return false;
  if (!selectorList(step).length) return true;
  if (firstVisible(selectorList(step))) return true;
  // A help answer is walked on whichever page it was asked from, so a control
  // this page's markup lacks is not coming — unless the reveal builds it.
  if (inMarkup && !step.built && !selectorList(step).some(safeQuery)) return false;
  // An earlier step of the walk puts it on screen — the user does that one.
  if (step.follows) return true;
  return !!firstVisible(revealList(step));
}

// The panel this run of steps lives in is still open: its close control shows.
function panelIsOpen(step) {
  if (!openRun || revealKey(step) !== openRun) return false;
  return !step.dismiss || isVisible(safeQuery(step.dismiss));
}

// Get the step's control on screen, opening its container first when that's
// what it takes — `again` when it was on screen and has closed under the step.
async function resolveTarget(step, { again = false } = {}) {
  if (!selectorList(step).length) return null;
  const existing = firstVisible(selectorList(step));
  if (existing) return existing;

  // The panel is already open, so a missing target is genuinely missing — and
  // re-pressing the opener would reset the form and discard what was typed.
  if (!again && panelIsOpen(step)) return null;

  const opener = firstVisible(revealList(step));
  if (!opener) return null;

  // Wait out the click that got us here: the case-actions dropdown closes on any
  // outside click, and Next is outside it.
  await nextFrame();
  opener.click();
  // Only panels naming a `dismiss` are tracked — the padlock opens design mode,
  // which the user keeps, rather than a panel to tidy away.
  if (step.dismiss) openedByTour = { key: revealKey(step), dismiss: step.dismiss };
  return waitForVisible(selectorList(step));
}

// Shuts the panel this tour opened, on leaving its run of steps and at the end —
// a tour should leave the screen the way it found it. A finished help
// walkthrough is the exception (see endTour), and so is a panel the user opened.
function closeOpenedContainer() {
  const dismiss = openedByTour?.dismiss;
  openedByTour = null;
  if (!dismiss) return;
  const el = safeQuery(dismiss);
  if (isVisible(el)) el.click();
}

// -------------------------------------------------------------------- overlay

function buildOverlay() {
  // The card is measured to place it, and a walkthrough places its first card
  // at once — so place it again when the lazily linked sheet lands.
  ensureStylesheet("pageTour.css").addEventListener("load", scheduleReflow);

  root = document.createElement("div");
  root.id = "page-tour";
  root.className = "pt-root is-hidden";
  // Div-only, deliberately: style.css styles bare <header>, so a semantic tag
  // would inherit the viewer page's chrome. Roles carry the semantics instead.
  root.innerHTML = `
    <div class="pt-mask" id="ptMask"></div>
    <div class="pt-block" id="ptBlock"></div>
    <div class="pt-card" id="ptCard" role="dialog" aria-modal="true" aria-labelledby="ptTitle">
      <div class="pt-card-head">
        <span class="pt-step-count" id="ptCount"></span>
        <button type="button" class="pt-skip" id="ptSkip">Skip tour</button>
      </div>
      <div class="pt-title" id="ptTitle" role="heading" aria-level="2"></div>
      <div class="pt-text" id="ptText"></div>
      <ul class="pt-list" id="ptList" hidden></ul>
      <div class="pt-hint" id="ptHint" hidden></div>
      <div class="pt-dots" id="ptDots" aria-hidden="true"></div>
      <div class="pt-card-foot" id="ptFoot">
        <button type="button" class="pt-btn pt-btn-ghost" id="ptMore" hidden>Read more</button>
        <span class="pt-spacer"></span>
        <button type="button" class="pt-btn pt-btn-quiet" id="ptBack">Back</button>
        <button type="button" class="pt-btn pt-btn-primary" id="ptNext">Next</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  maskEl = root.querySelector("#ptMask");
  blockEl = root.querySelector("#ptBlock");
  cardEl = root.querySelector("#ptCard");

  root.querySelector("#ptSkip").addEventListener("click", () => endTour());
  root.querySelector("#ptBack").addEventListener("click", () => goTo(index - 1));
  root.querySelector("#ptNext").addEventListener("click", () => goTo(index + 1));
  root.querySelector("#ptMore").addEventListener("click", openTopicInHelp);

  // Tapping the dimmed page advances. Bound on the root, not the mask: the mask
  // is only the hole, so the dimming (its shadow) hit-tests against the root.
  root.addEventListener("click", (e) => {
    if (!walking && (e.target === root || e.target === maskEl)) goTo(index + 1);
  });

  for (const type of ["pointerdown", "mousedown", "touchstart", "click", "dblclick", "contextmenu"]) {
    blockEl.addEventListener(type, onBlockedPointer, { passive: type !== "mousedown" && type !== "contextmenu" });
  }
  // Capture on the window, ahead of the page's own handlers.
  for (const type of ["click", "dblclick", "contextmenu", "change"]) {
    window.addEventListener(type, onSpotlightEvent, true);
  }

  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("resize", scheduleReflow);
  // Mobile resizes the visual viewport, not the window, when the address bar
  // slides away — without these the sheet measures a stale screen size.
  window.visualViewport?.addEventListener("resize", scheduleReflow);
  window.visualViewport?.addEventListener("scroll", scheduleReflow);
  // Capture phase: the spotlight has to follow the target through a scrolling
  // pane, not just the window.
  document.addEventListener("scroll", scheduleReflow, true);
  // A panel that slides in (the sidebar) moves its control after the spotlight
  // is first placed, and fires no scroll or resize — only this.
  document.addEventListener("transitionend", scheduleReflow, true);
  document.addEventListener("animationend", scheduleReflow, true);
}

function onKeydown(e) {
  if (!running) return;
  if (e.key === "Escape") {
    e.preventDefault();
    endTour();
    return;
  }
  // A walkthrough is done on the page, so its keys are the page's own.
  if (walking) return;
  if (e.key === "ArrowRight" || e.key === "Enter") {
    e.preventDefault();
    goTo(index + 1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    goTo(index - 1);
  }
}

// ------------------------------------------------------------- walking a step

// How a walkthrough step is done: "act" — use its control (the default); "type"
// — work in it, then Next; "look" — it is only pointed at, and a click moves on.
function stepMode(step) {
  if (!selectorList(step).length) return "card";
  if (step.next) return "type";
  return step.info ? "look" : "act";
}

function swallow(e) {
  e.preventDefault();
  e.stopPropagation();
}

const isDisabled = (el) => !!el.matches?.(":disabled, [aria-disabled='true'], .is-disabled");

// Under the overlay, rather than one of the page's pop-ups risen above it: with
// the hole shut for a moment, the blocker is what the point hits. Clicks sent
// from code or the keyboard carry no point, and pass.
function showsThroughHole(e) {
  if (!(e.clientX || e.clientY) || typeof document.elementFromPoint !== "function") return false;
  const hole = blockEl.style.clipPath;
  blockEl.style.clipPath = "";
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  blockEl.style.clipPath = hole;
  return hit === blockEl;
}

function innerControl(from, hit) {
  const control = from.closest(CONTROLS);
  return control && control !== hit && hit.contains(control) ? control : null;
}

// Outside the lit control a walkthrough's overlay takes the click itself, so it
// can't shut the menu the step is in — and points the user back at the control.
function onBlockedPointer(e) {
  e.stopPropagation();
  if (e.type === "mousedown" || e.type === "contextmenu") e.preventDefault();
  if (e.type === "click") nudge();
}

function nudge() {
  maskEl.classList.remove("is-nudged");
  void maskEl.offsetWidth; // restart the animation
  maskEl.classList.add("is-nudged");
}

// Events inside the lit control, in a walkthrough. They reach the page — that is
// the point — and one that does the step moves the walk on once the page has
// handled it. `advanceOn` narrows which clicks count; the rest of the control
// goes quiet, bar the other controls in it (a dialog's Cancel).
function onSpotlightEvent(e) {
  const run = stepRun;
  if (!running || !walking || !run?.resolved) return;
  const target = currentTarget;
  if (!target || !(e.target instanceof Node) || root.contains(e.target)) return;
  if (!target.contains(e.target)) {
    // The hole is cut round the whole control, so the edge of a neighbour can
    // show through it too.
    if (e.type !== "change" && stepMode(run.step) !== "type" && showsThroughHole(e)) swallow(e);
    return;
  }

  const step = run.step;
  const mode = stepMode(step);
  // A select is used by picking from it — its change, not the click that opens it.
  if (e.type === "change") {
    if (mode === "act" && (!step.advanceOn || e.target.closest(step.advanceOn))) noteUsed(run);
    return;
  }
  if (mode === "type") return;
  if (mode === "look") {
    swallow(e);
    if (e.type === "click") goTo(index + 1);
    return;
  }

  const hit = step.advanceOn ? e.target.closest(step.advanceOn) : target;
  const onHit =
    !!hit && target.contains(hit) && !isDisabled(hit) && !(step.advanceOn && innerControl(e.target, hit));
  if (onHit && hit.tagName === "SELECT") return;
  if (onHit && e.type === (step.rightClick ? "contextmenu" : "click")) return noteUsed(run);
  if (step.advanceOn && (hit || !e.target.closest(CONTROLS))) swallow(e);
}

function noteUsed(run) {
  if (index === steps.length - 1) {
    // Let the page act on the click, then finish where it leaves things.
    setTimeout(() => {
      if (running && stepRun === run) endTour({ completed: true });
    }, 0);
    return;
  }
  run.usedAt = run.usedAt || Date.now();
  setTimeout(watchStep, 0);
}

// Something in the lit control to press: a bar with no mesh near lights no
// tooth, a disabled button takes no click at all, and a dialog left open over
// the control catches every click — Next stands in then.
function hasClickables(step, target) {
  if (!target || isCovered(target)) return false;
  if (!step.advanceOn || stepMode(step) !== "act") return !isDisabled(target);
  const marks = target.matches(step.advanceOn) ? [target] : [...target.querySelectorAll(step.advanceOn)];
  return marks.some((el) => isVisible(el) && !isDisabled(el));
}

// Covered at every sampled point by something of the page's that sits under the
// tour. A pop-up risen above the tour is being dealt with, so it doesn't count.
function isCovered(el) {
  if (!walking || typeof document.elementFromPoint !== "function") return false;
  const r = el.getBoundingClientRect();
  const points = [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]
    .map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy])
    .filter(([x, y]) => x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight);
  const blocked = (hit) => !!hit && !el.contains(hit) && !root.contains(hit);
  if (!points.length || !points.every(([x, y]) => blocked(document.elementFromPoint(x, y)))) return false;
  const hole = blockEl.style.clipPath;
  blockEl.style.clipPath = "";
  const under = points.every(([x, y]) => document.elementFromPoint(x, y) === blockEl);
  blockEl.style.clipPath = hole;
  return under;
}

function nextIsReady() {
  const next = steps[index + 1];
  if (!next) return false;
  return !selectorList(next).length || !!findTarget(next);
}

// The control the user pressed didn't open the next one, but its opener is here.
function canRevealNext() {
  const next = steps[index + 1];
  return !!next && !next.requires && !!firstVisible(revealList(next));
}

// A walkthrough follows the page rather than the other way round: it moves on
// once the control pressed has done its work, re-finds a control the page
// redrew, and steps back when what the step points at closes under it.
function watchStep() {
  const run = stepRun;
  if (!running || !walking || !run?.resolved) return;
  const step = run.step;
  if (!selectorList(step).length) return;

  if (!isLive(currentTarget, step)) {
    const found = findTarget(step);
    if (found) setTarget(found);
  } else if (boxOf(currentTarget) !== lastBox) {
    positionFor(currentTarget);
  }

  if (run.usedAt) {
    if (nextIsReady()) return goTo(index + 1);
    if (Date.now() - run.usedAt >= REVEAL_TIMEOUT_MS && canRevealNext()) return goTo(index + 1);
  }

  if (isLive(currentTarget, step)) {
    run.hadTarget = true;
    run.lostSince = 0;
    const clickable = hasClickables(step, currentTarget);
    if (clickable !== run.clickable) renderControls(step, clickable);
    return;
  }
  if (!run.hadTarget) return;
  run.lostSince = run.lostSince || Date.now();
  // A press can close the control while the next one is still on its way.
  const grace = run.usedAt ? REVEAL_TIMEOUT_MS : LOST_GRACE_MS;
  if (Date.now() - run.lostSince < grace) return;
  if (!run.reopened && stepMode(step) !== "type" && firstVisible(revealList(step))) reopen(run);
  else retreat();
}

// Its panel shut under the step — a press in the sidebar closes the sidebar —
// so open it again, once. Shut twice, the user means it, and the walk steps back.
async function reopen(run) {
  run.reopened = true;
  run.resolved = false;
  run.lostSince = 0;
  const target = await resolveTarget(run.step, { again: true });
  if (!running || stepRun !== run) return;
  run.resolved = true;
  if (!target) return retreat();
  renderControls(run.step, hasClickables(run.step, target));
  setTarget(target);
}

// Back to the last step whose control is on screen — the one to use again.
function retreat() {
  for (let i = index - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (selectorList(step).length && !isDone(step) && findTarget(step)) return goTo(i);
  }
  // Nothing to go back to: carry on from the card instead.
  stepRun.hadTarget = false;
  renderControls(steps[index], false);
}

// ------------------------------------------------------------------ positioning

function scheduleReflow() {
  if (!running || reflowFrame) return;
  reflowFrame = requestAnimationFrame(() => {
    reflowFrame = 0;
    positionFor(currentTarget);
  });
}

function boxOf(el) {
  const r = el.getBoundingClientRect();
  return `${r.left},${r.top},${r.width},${r.height}`;
}

// jsdom reports "" for an overflow it has no style for.
const clipsChildren = (el) => !["", "visible"].includes(getComputedStyle(el).overflow);

// The part of a control that is on screen: its box, taking in children drawn
// outside it (the lower arch overflows its canvas), cut to whatever clips it.
function spotlightBox(el) {
  const r = el.getBoundingClientRect();
  let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom];
  if (!clipsChildren(el)) {
    for (const child of el.children) {
      if (!child.getClientRects().length) continue;
      const c = child.getBoundingClientRect();
      if (!c.width || !c.height) continue;
      [left, top] = [Math.min(left, c.left), Math.min(top, c.top)];
      [right, bottom] = [Math.max(right, c.right), Math.max(bottom, c.bottom)];
    }
  }
  for (let clip = el.parentElement; clip && clip !== document.body; clip = clip.parentElement) {
    if (!clipsChildren(clip)) continue;
    const c = clip.getBoundingClientRect();
    [left, top] = [Math.max(left, c.left), Math.max(top, c.top)];
    [right, bottom] = [Math.min(right, c.right), Math.min(bottom, c.bottom)];
  }
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// The blocker's hole, so clicks there reach the page — clip-path hit-tests too.
function setHole(box) {
  if (!blockEl) return;
  if (!box) {
    blockEl.style.clipPath = "";
    return;
  }
  const [l, t, r, b] = [box.left, box.top, box.right, box.bottom].map(Math.round);
  blockEl.style.clipPath =
    `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ` +
    `${l}px ${t}px, ${r}px ${t}px, ${r}px ${b}px, ${l}px ${b}px, ${l}px ${t}px)`;
}

// The mask is a hole in a page-sized shadow: sized to the target it cuts the
// spotlight; collapsed to a point it dims everything for a step with no target.
function positionFor(el) {
  if (!maskEl || !cardEl) return;

  if (!isVisible(el)) {
    currentTarget = null;
    lastBox = "";
    setHole(null);
    maskEl.classList.add("is-empty");
    maskEl.style.top = `${window.innerHeight / 2}px`;
    maskEl.style.left = `${window.innerWidth / 2}px`;
    maskEl.style.width = "0px";
    maskEl.style.height = "0px";
    centreCard();
    return;
  }

  const r = spotlightBox(el);
  const pad = 6;
  lastBox = boxOf(el);
  maskEl.classList.remove("is-empty");
  maskEl.style.top = `${r.top - pad}px`;
  maskEl.style.left = `${r.left - pad}px`;
  maskEl.style.width = `${r.width + pad * 2}px`;
  maskEl.style.height = `${r.height + pad * 2}px`;
  setHole({ top: r.top - pad, left: r.left - pad, right: r.right + pad, bottom: r.bottom + pad });
  if (isSheetLayout()) placeCardAsSheet(r);
  else placeCardNear(r);
}

function centreCard() {
  clearSheet();
  cardEl.style.top = "50%";
  cardEl.style.left = "50%";
  cardEl.style.transform = "translate(-50%, -50%)";
}

// Phone-shaped viewport — by width, or by height for a phone held sideways.
function isSheetLayout() {
  return window.innerWidth <= SHEET_MAX_WIDTH || window.innerHeight <= SHEET_MAX_HEIGHT;
}

function clearSheet() {
  cardEl.classList.remove("is-sheet", "is-sheet-top");
  cardEl.style.bottom = "";
  cardEl.style.maxHeight = "";
}

// Sheet takes whichever edge leaves most room, so it can't cover the control.
// Capped to a share of the window, so a full-bleed target still shows through.
function placeCardAsSheet(r) {
  cardEl.classList.add("is-sheet");
  cardEl.style.transform = "none";
  cardEl.style.left = "0px";

  const above = Math.max(0, r.top);
  const below = Math.max(0, window.innerHeight - r.bottom);
  const toTop = above > below;

  // Never less than the card needs for its own buttons: a full-bleed target
  // leaves no free space, and sizing to it pushed Back/Next off the screen.
  cardEl.style.maxHeight = "";
  const natural = cardEl.scrollHeight;
  const cap = Math.min(window.innerHeight - VIEWPORT_PAD * 2, Math.round(window.innerHeight * SHEET_MAX_FRACTION));
  const room = Math.round((toTop ? above : below) - CARD_GAP);
  cardEl.style.maxHeight = `${Math.min(cap, Math.max(natural, room))}px`;

  // The opposite edge is cleared, not set to "auto": an inline top left from the
  // previous step would win over bottom and float the sheet mid-screen.
  cardEl.classList.toggle("is-sheet-top", toTop);
  cardEl.style.top = toTop ? "0px" : "";
  cardEl.style.bottom = toTop ? "" : "0px";
}

// Below by preference, then above, then beside, and only last on top. The side
// placements carry the tall panels, where below and above both fail.
function placeCardNear(r) {
  clearSheet();
  cardEl.style.transform = "none";
  const box = cardEl.getBoundingClientRect();
  const clampX = (x) => Math.min(Math.max(x, VIEWPORT_PAD), window.innerWidth - box.width - VIEWPORT_PAD);
  const clampY = (y) => Math.min(Math.max(y, VIEWPORT_PAD), window.innerHeight - box.height - VIEWPORT_PAD);
  const centredX = clampX(r.left + r.width / 2 - box.width / 2);
  const centredY = clampY(r.top + r.height / 2 - box.height / 2);

  let top;
  let left;
  if (window.innerHeight - r.bottom - CARD_GAP - VIEWPORT_PAD >= box.height) {
    top = r.bottom + CARD_GAP;
    left = centredX;
  } else if (r.top - CARD_GAP - VIEWPORT_PAD >= box.height) {
    top = r.top - CARD_GAP - box.height;
    left = centredX;
  } else if (window.innerWidth - r.right - CARD_GAP - VIEWPORT_PAD >= box.width) {
    top = centredY;
    left = r.right + CARD_GAP;
  } else if (r.left - CARD_GAP - VIEWPORT_PAD >= box.width) {
    top = centredY;
    left = r.left - CARD_GAP - box.width;
  } else {
    // Nowhere clear: sit in whichever corner leaves most of the target visible.
    top = r.top + r.height / 2 > window.innerHeight / 2 ? VIEWPORT_PAD : window.innerHeight - box.height - VIEWPORT_PAD;
    left = centredX;
  }

  cardEl.style.top = `${Math.round(clampY(top))}px`;
  cardEl.style.left = `${Math.round(clampX(left))}px`;
}

// ------------------------------------------------------------------- rendering

// A step that describes several things at once — the Components tabs and what
// each of them is for — lists them under the prose rather than in it.
function renderBullets(bullets) {
  const list = root.querySelector("#ptList");
  list.innerHTML = "";
  list.hidden = !bullets?.length;
  for (const line of bullets || []) {
    const item = document.createElement("li");
    // "LABEL — what it does": the label is emphasised so the list can be
    // skimmed for the tab you are looking for.
    const [label, ...rest] = line.split(" — ");
    if (rest.length) {
      const strong = document.createElement("b");
      strong.textContent = label;
      item.append(strong, ` — ${rest.join(" — ")}`);
    } else {
      item.textContent = line;
    }
    list.appendChild(item);
  }
}

function renderDots() {
  const dots = root.querySelector("#ptDots");
  dots.innerHTML = "";
  steps.forEach((_, i) => {
    const dot = document.createElement("span");
    dot.className = `pt-dot${i === index ? " is-active" : ""}${i < index ? " is-done" : ""}`;
    dots.appendChild(dot);
  });
}

function hintFor(step, last) {
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const verb = step.rightClick ? "Right-click in" : coarse ? "Tap" : "Click";
  return `${verb} the highlighted area to ${last ? "finish" : "continue"}.`;
}

// A walkthrough step moves on when its control is used, so Next shows only for
// typing into it, for a card with no control, and for a control with nothing
// to press.
function renderControls(step, clickable) {
  const last = index === steps.length - 1;
  const mode = walking ? stepMode(step) : "tour";
  const byClick = clickable && (mode === "act" || mode === "look");
  if (stepRun?.step === step) stepRun.clickable = clickable;
  const next = root.querySelector("#ptNext");
  next.hidden = byClick;
  next.textContent = last ? "Done" : "Next";
  const back = root.querySelector("#ptBack");
  back.hidden = walking;
  back.disabled = index === 0;
  const hint = root.querySelector("#ptHint");
  hint.hidden = !byClick;
  hint.textContent = byClick ? hintFor(step, last) : "";
  root.querySelector("#ptMore").hidden = !step.topic;
  root.querySelector("#ptFoot").hidden = byClick && !step.topic;
  // Typing can open the page's own pickers anywhere (a calendar, suggestions),
  // so those steps leave the whole page usable.
  root.classList.toggle("is-free", mode === "type");
}

// The current step's help topic, opened in the assistant. Imported on click so
// the knowledge base only loads for someone who asks for it.
async function openTopicInHelp() {
  const topicId = steps[index]?.topic;
  if (!topicId) return;
  endTour();
  try {
    const { openHelpBot } = await import("./helpBot.js");
    openHelpBot({ topicId });
  } catch (err) {
    console.error("[pageTour] help assistant failed to load:", err);
  }
}

async function renderStep() {
  const step = steps[index];
  if (!step) return;

  // Leaving the run of steps that share a panel closes it — including when the
  // move is backwards, where the next step reopens whatever it needs.
  if (openedByTour && revealKey(step) !== openedByTour.key) closeOpenedContainer();
  if (revealKey(step) !== openRun) openRun = "";
  const run = { step, resolved: false, hadTarget: false, clickable: false, reopened: false, usedAt: 0, lostSince: 0 };
  stepRun = run;

  root.querySelector("#ptCount").textContent = `Step ${index + 1} of ${steps.length}`;
  root.querySelector("#ptTitle").textContent = step.title;
  root.querySelector("#ptText").textContent = step.text;
  renderBullets(step.bullets);
  renderDots();
  renderControls(step, selectorList(step).length > 0);

  const target = await resolveTarget(step);
  // The tour may have been ended (or moved on) while we waited for a container
  // to open — drop the stale result rather than spotlighting the wrong thing.
  if (!running || stepRun !== run) return;

  run.resolved = true;
  run.hadTarget = !!target;
  if (target && revealList(step).length) openRun = revealKey(step);
  renderControls(step, hasClickables(step, target));
  setTarget(target);
  // Checked once the hole is cut: until then the overlay is all a point hits.
  if (walking && target && isCovered(target)) {
    closeCoveringPanel(step);
    renderControls(step, hasClickables(step, target));
  }
}

// A panel from the step before, left open over this step's control — the Case
// Note sheet over Save on a tablet. Its own close button clears it.
function closeCoveringPanel(step) {
  const prev = steps[index - 1];
  if (!prev?.dismiss || revealKey(prev) === revealKey(step)) return;
  const close = safeQuery(prev.dismiss);
  if (isVisible(close)) close.click();
}

function setTarget(el) {
  clearTargetMark();
  currentTarget = el;
  if (isVisible(el)) {
    el.classList.add("pt-target");
    // Only when it isn't in full view already: a scroll moves the page under a
    // control about to be pressed, and shuts the page's own menus.
    if (!isInView(el)) el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }
  positionFor(el);
}

function clearTargetMark() {
  document.querySelectorAll(".pt-target").forEach((el) => el.classList.remove("pt-target"));
  currentTarget = null;
}

function goTo(next) {
  if (!running) return;
  if (next < 0) return;
  if (next >= steps.length) return endTour({ completed: true });
  clearTargetMark();
  setHole(null);
  index = next;
  renderStep();
}

// ---------------------------------------------------------------- start / end

// The steps of `script` reachable from here, or null when none of them points at
// a control — a run of centred cards alone is not a tour.
function reachableSteps(script, options) {
  const usable = (script || []).filter((step) => stepIsReachable(step, options));
  return usable.some((s) => s.selector) ? usable : null;
}

function runTour(usable, { pageId, closeLabel, leaveOpen, walk }) {
  if (!root) buildOverlay();
  if (running) endTour();
  closeHelpPanel();

  steps = usable;
  index = 0;
  running = true;
  walking = walk;
  leaveOpenOnDone = leaveOpen;
  root.dataset.page = pageId;
  root.classList.toggle("is-walkthrough", walk);
  root.querySelector("#ptSkip").textContent = closeLabel;
  cardEl.setAttribute("aria-modal", String(!walk));
  // Lets the page's own pop-ups rise above the walk (see pageTour.css).
  document.documentElement.classList.toggle("pt-walking", walk);
  if (walk) watchTimer = setInterval(watchStep, WATCH_MS);
  root.classList.remove("is-hidden");
  requestAnimationFrame(() => root.classList.add("is-open"));
  renderStep();
}

// Run the tour for this page. Returns false when there is nothing to show, so
// the caller can say so rather than flashing an empty overlay.
export function startPageTour({ pageId = currentPageId() } = {}) {
  const usable = reachableSteps(tourFor(pageId));
  if (!usable) return false;
  runTour(usable, { pageId, closeLabel: "Skip tour", leaveOpen: false, walk: false });
  markSeen(pageId);
  return true;
}

// One help answer, done step by step on this page. Finishing leaves open
// whatever the last step opened, so the user carries on from there; Close puts
// back what the walk opened itself.
export function startWalkthrough(script) {
  const usable = reachableSteps(script, { inMarkup: true });
  if (!usable) return false;
  runTour(usable, { pageId: currentPageId(), closeLabel: "Close", leaveOpen: true, walk: true });
  return true;
}

// Whether startWalkthrough() would have anything to point at right now.
export function canStartWalkthrough(script) {
  return reachableSteps(script, { inMarkup: true }) !== null;
}

// Both own the screen, so opening one closes the other. Poked through the DOM
// rather than imported, to keep the help assistant out of the tour's bundle.
function closeHelpPanel() {
  document.querySelector("#help-bot.is-open .hb-close")?.click();
}

export function endTour({ completed = false } = {}) {
  if (!running) return;
  running = false;
  if (completed && leaveOpenOnDone) openedByTour = null;
  else closeOpenedContainer();
  clearInterval(watchTimer);
  watchTimer = 0;
  stepRun = null;
  openRun = "";
  clearTargetMark();
  setHole(null);
  cancelAnimationFrame(reflowFrame);
  reflowFrame = 0;
  document.documentElement.classList.remove("pt-walking");
  root.classList.remove("is-open", "is-walkthrough", "is-free");
  root.classList.add("is-hidden");
  walking = false;
  if (completed) root.dispatchEvent(new CustomEvent("tour:completed", { bubbles: true }));
}

export function isTourRunning() {
  return running;
}

// Names the page in About's "no tour here yet" message.
export function tourPageLabel(pageId = currentPageId()) {
  return PAGE_LABELS[pageId] || "this page";
}

// First visit runs the tour once, unprompted. Waits for the first anchored step's
// control, since toolbars are built after data arrives.
export async function maybeAutoStartTour({ pageId = currentPageId() } = {}) {
  const script = tourFor(pageId);
  if (!script?.length || hasSeen(pageId)) return false;

  const anchor = script.find((s) => s.selector && !s.reveal);
  if (anchor) {
    const el = await waitForVisible(anchor.selector, AUTOSTART_TIMEOUT_MS);
    if (!el) return false;
    // One more frame so the rest of the toolbar lands before we filter steps.
    await nextFrame();
  }
  // Checked after the anchor wait: this module loads dynamically and can arrive
  // before the viewer has even put its loading screen up.
  if (!(await waitForLoadingScreen())) return false;
  // Someone who started working (or opened Help) in the meantime is not waiting
  // for a tour to take over their screen.
  if (running || document.querySelector("#help-bot.is-open")) return false;
  return startPageTour({ pageId });
}
