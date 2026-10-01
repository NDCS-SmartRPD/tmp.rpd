// Slide-in panel answering "how do I…", built on first open, answered by
// `provider` (helpMatcher.js). A conversation lasts one open; nothing is stored.

import { PAGE_LABELS, PAGE_PATHS, TOPIC_BY_ID, stepText, walkthroughFor } from "./helpTopics.js";
import { localProvider, relatedTopics, suggestionsFor } from "./helpMatcher.js";
import { appRoot, currentPageId, ensureStylesheet } from "./pageContext.js";
import { canStartWalkthrough, startWalkthrough } from "./pageTour.js";

export { currentPageId };

const TRANSCRIPT_MAX = 30;
const CLOSE_MS = 220;

let provider = localProvider;
let root = null;          // #help-bot, built on first open
let logEl = null;
let inputEl = null;
let transcript = [];      // [{ role: "bot" | "user", text, topicId? }]
let closeTimer = null;

// Swap the answer engine (e.g. a backend-backed one). Contract:
//   async (question, { pageId }) => { confident, topic, alternates }
export function setAnswerProvider(fn) {
  if (typeof fn === "function") provider = fn;
}

function hrefForPage(pageId) {
  const path = PAGE_PATHS[pageId];
  return path ? new URL(appRoot() + path, window.location.href).href : null;
}

// -------------------------------------------------------------------- show me

// The answer's steps, walked as a mini tour on this page. Checked before the
// panel closes, so a walkthrough with nothing to point at never leaves the user
// with neither. The conversation is kept — a walkthrough is a detour, not an exit.
function showMe(walkthrough) {
  if (!canStartWalkthrough(walkthrough)) return;
  closePanel({ keepTranscript: true });
  startWalkthrough(walkthrough);
}

// --------------------------------------------------------------- panel markup

function buildPanel() {
  ensureStylesheet("helpBot.css");

  root = document.createElement("div");
  root.id = "help-bot";
  root.className = "hb-root is-hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="hb-backdrop" data-hb-close></div>
    <aside class="hb-panel" role="dialog" aria-label="Help assistant">
      <header class="hb-header">
        <div class="hb-heading">
          <span class="hb-title">Help</span>
          <span class="hb-context" id="hbContext"></span>
        </div>
        <button type="button" class="hb-icon-btn" id="hbClearBtn" aria-label="Clear conversation" title="Clear conversation">&#8635;</button>
        <button type="button" class="hb-icon-btn hb-close" data-hb-close aria-label="Close help">&times;</button>
      </header>
      <div class="hb-log" id="hbLog" role="log" aria-live="polite"></div>
      <form class="hb-input" id="hbForm" autocomplete="off">
        <input type="text" id="hbInput" class="hb-field" placeholder="Ask how to do something…" aria-label="Ask a question" />
        <button type="submit" class="hb-send">Ask</button>
      </form>
    </aside>
  `;
  document.body.appendChild(root);

  logEl = root.querySelector("#hbLog");
  inputEl = root.querySelector("#hbInput");
  root.querySelector("#hbContext").textContent = PAGE_LABELS[currentPageId()] || "";

  // Wrapped, not passed by reference: the click event must not land in the
  // options argument of either function.
  root.querySelectorAll("[data-hb-close]").forEach((el) =>
    el.addEventListener("click", () => closePanel())
  );
  root.querySelector("#hbClearBtn").addEventListener("click", () => resetConversation());
  root.querySelector("#hbForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const question = inputEl.value.trim();
    if (!question) return;
    inputEl.value = "";
    ask(question);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("is-open")) closePanel();
  });
}

// ------------------------------------------------------------------ rendering

function bubble(role) {
  const el = document.createElement("div");
  el.className = `hb-msg is-${role}`;
  logEl.appendChild(el);
  return el;
}

function scrollToEnd() {
  logEl.scrollTop = logEl.scrollHeight;
}

function renderUser(text) {
  bubble("user").textContent = text;
  scrollToEnd();
}

// A row of clickable topic chips; asking one replays it as a question.
function renderChips(parent, topics, label) {
  if (!topics.length) return;
  if (label) {
    const caption = document.createElement("div");
    caption.className = "hb-chips-label";
    caption.textContent = label;
    parent.appendChild(caption);
  }
  const wrap = document.createElement("div");
  wrap.className = "hb-chips";
  for (const topic of topics) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "hb-chip";
    chip.textContent = topic.title;
    chip.addEventListener("click", () => answerTopic(topic, { echo: topic.title }));
    wrap.appendChild(chip);
  }
  parent.appendChild(wrap);
  scrollToEnd();
}

// One answer: heading, prose, numbered steps, then the actions it supports on
// this page (walk the steps, or open the page it lives on).
function renderAnswer(topic) {
  const el = bubble("bot");

  const heading = document.createElement("div");
  heading.className = "hb-answer-title";
  heading.textContent = topic.title;
  el.appendChild(heading);

  const body = document.createElement("p");
  body.className = "hb-answer-text";
  body.textContent = topic.answer;
  el.appendChild(body);

  if (topic.steps?.length) {
    const list = document.createElement("ol");
    list.className = "hb-steps";
    for (const step of topic.steps) {
      const item = document.createElement("li");
      item.textContent = stepText(step);
      list.appendChild(item);
    }
    el.appendChild(list);
  }

  const actions = document.createElement("div");
  actions.className = "hb-actions";

  const onThisPage = !topic.page || topic.page === currentPageId();
  const walkthrough = onThisPage ? walkthroughFor(topic) : [];
  if (canStartWalkthrough(walkthrough)) {
    const show = document.createElement("button");
    show.type = "button";
    show.className = "hb-action";
    show.textContent = "Show me";
    show.addEventListener("click", () => showMe(walkthrough));
    actions.appendChild(show);
  }

  if (topic.page && !onThisPage) {
    const href = hrefForPage(topic.page);
    if (href) {
      const open = document.createElement("a");
      open.className = "hb-action";
      open.href = href;
      open.textContent = `Open ${PAGE_LABELS[topic.page]}`;
      actions.appendChild(open);
    }
  }

  if (actions.children.length) el.appendChild(actions);

  renderChips(el, relatedTopics(topic), "Related");
  scrollToEnd();
  return el;
}

function renderUnsure(alternates) {
  const el = bubble("bot");
  const text = document.createElement("p");
  text.className = "hb-answer-text";
  text.textContent =
    "I don't have an answer for that one. These are the closest things I know about — or use Feedback in the menu to reach the team.";
  el.appendChild(text);
  renderChips(el, alternates, null);
  scrollToEnd();
}

function renderGreeting() {
  const pageId = currentPageId();
  const el = bubble("bot");
  const text = document.createElement("p");
  text.className = "hb-answer-text";
  text.textContent = `You're on ${PAGE_LABELS[pageId] || "SmartRPD"}. Ask me how to do something, or start with one of these.`;
  el.appendChild(text);
  renderChips(el, suggestionsFor(pageId), null);
  scrollToEnd();
}

// ------------------------------------------------------------------- asking

async function ask(question) {
  renderUser(question);
  transcript.push({ role: "user", text: question });

  const typing = bubble("bot");
  typing.classList.add("hb-typing");
  typing.textContent = "…";
  scrollToEnd();

  let result;
  try {
    result = await provider(question, { pageId: currentPageId() });
  } catch (err) {
    console.error("[helpBot] answer provider failed:", err);
    result = { confident: false, topic: null, alternates: suggestionsFor(currentPageId(), undefined, 3) };
  }
  typing.remove();

  if (result?.confident && result.topic) {
    const answerEl = renderAnswer(result.topic);
    transcript.push({ role: "bot", text: result.topic.answer, topicId: result.topic.id });
    if (result.alternates?.length) {
      renderChips(answerEl, result.alternates, "You might also mean");
    }
  } else {
    renderUnsure(result?.alternates || []);
    transcript.push({ role: "bot", text: "No confident answer." });
  }
  transcript = transcript.slice(-TRANSCRIPT_MAX);
}

// Answer a topic directly (chip click), echoing it as though it were asked.
function answerTopic(topic, { echo } = {}) {
  if (echo) {
    renderUser(echo);
    transcript.push({ role: "user", text: echo });
  }
  renderAnswer(topic);
  transcript.push({ role: "bot", text: topic.answer, topicId: topic.id });
  transcript = transcript.slice(-TRANSCRIPT_MAX);
}

// Back to a blank conversation and the page greeting. `focus` is for the header
// button — a reset running behind a closing panel must not pull focus back.
function resetConversation({ focus = true } = {}) {
  transcript = [];
  logEl.innerHTML = "";
  if (inputEl) inputEl.value = "";
  renderGreeting();
  if (focus) inputEl?.focus();
}

// -------------------------------------------------------------- open / close

// Same open/close choreography as the sidebar and chat. `topicId` opens straight
// onto one answer — the hand-off from a tour step's "Read more".
export function openHelpBot({ topicId } = {}) {
  if (!root) {
    buildPanel();
    renderGreeting();
  } else {
    root.querySelector("#hbContext").textContent = PAGE_LABELS[currentPageId()] || "";
  }

  const topic = topicId ? TOPIC_BY_ID.get(topicId) : null;
  if (topic) answerTopic(topic, { echo: topic.title });
  // Reopening inside the close animation: drop the pending hide-and-reset, or it
  // would fire on the panel we just brought back.
  clearTimeout(closeTimer);
  closeTimer = null;
  root.classList.remove("is-hidden");
  requestAnimationFrame(() => root.classList.add("is-open"));
  root.setAttribute("aria-hidden", "false");
  setTimeout(() => inputEl?.focus(), 60);
  scrollToEnd();
}

// Dismissing ends the conversation, reset after the slide-out so the log is
// never seen emptying. `keepTranscript` is for "Show me" — a hand-off, not an exit.
export function closePanel({ keepTranscript = false } = {}) {
  if (!root) return;
  root.classList.remove("is-open");
  root.setAttribute("aria-hidden", "true");
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    root.classList.add("is-hidden");
    closeTimer = null;
    if (!keepTranscript) resetConversation({ focus: false });
  }, CLOSE_MS);
}
