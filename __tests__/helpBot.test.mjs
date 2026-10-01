// __tests__/helpBot.test.mjs
//
// Guards the help assistant's ranking layer (src/js/shared/helpMatcher.js) and
// the integrity of its knowledge base (src/js/shared/helpTopics.js). The panel
// itself is DOM-only wiring; everything that decides WHICH answer a user gets
// lives in these two pure modules, so that is what's tested here.
//
// Runs in the default node environment — neither module touches the DOM.

import {
  normalize,
  tokenize,
  canonicalize,
  scoreTopic,
  findMatches,
  relatedTopics,
  suggestionsFor,
  localProvider,
  MIN_SCORE,
} from "../src/js/shared/helpMatcher.js";
import {
  HELP_TOPICS,
  TOPIC_BY_ID,
  PAGE_LABELS,
  PAGE_PATHS,
  stepText,
  walkthroughFor,
} from "../src/js/shared/helpTopics.js";
import { COMPONENT_TABS } from "../src/js/2D/components.js";
import { undefinedSelectorParts } from "./helpers/appSources.mjs";

const idsOf = (matches) => matches.map((m) => m.topic.id);

describe("text preparation", () => {
  test("normalize lowercases and strips punctuation", () => {
    expect(normalize("How do I CREATE a case?!")).toBe("how do i create a case");
  });

  test("tokenize drops stopwords", () => {
    expect(tokenize("how do i create a case")).toEqual(["create", "case"]);
  });

  test("canonicalize folds a word onto its canonical form, replacing rather than adding", () => {
    expect(canonicalize(["photos"])).toEqual(["image"]);
    // Keeping both "photos" and "image" would let a single query word hit the
    // same topic twice; folding two spellings must not score twice either.
    expect(canonicalize(["photos"])).not.toContain("photos");
    expect(canonicalize(["photo", "photos", "picture"])).toEqual(["image"]);
  });
});

describe("findMatches()", () => {
  test("plain phrasing finds the create-case topic", () => {
    expect(idsOf(findMatches("how do i create a case"))[0]).toBe("create-case");
  });

  test("synonyms route an unseen phrasing to the same topic", () => {
    // "make" → create, "patient" → case: neither word is in the topic verbatim.
    expect(idsOf(findMatches("how do i make a new patient"))[0]).toBe("create-case");
  });

  test("finds the undercut topic from the colour question a user would actually ask", () => {
    expect(idsOf(findMatches("what do the colours mean", HELP_TOPICS, { pageId: "viewer_3d" })))
      .toContain("undercut-heatmap");
  });

  test("returns nothing for a question made only of stopwords", () => {
    expect(findMatches("how do i")).toEqual([]);
  });

  test("respects the limit", () => {
    expect(findMatches("case", HELP_TOPICS, { limit: 2 })).toHaveLength(2);
  });

  test("ranking is stable across identical calls", () => {
    expect(idsOf(findMatches("how do i save"))).toEqual(idsOf(findMatches("how do i save")));
  });
});

describe("page context", () => {
  // "Where do I write notes" has a different right answer on each screen: the
  // case-instructions box, the 2D case note, or the 3D clinical notes.
  test("an ambiguous question answers with the notes box on the page you're on", async () => {
    const onList = await localProvider("where do i write notes", { pageId: "case_list" });
    const on2d = await localProvider("where do i write notes", { pageId: "annotation_2d" });
    const on3d = await localProvider("where do i write notes", { pageId: "viewer_3d" });
    expect(onList.topic.id).toBe("case-instructions");
    expect(on2d.topic.id).toBe("case-note");
    expect(on3d.topic.id).toBe("clinical-notes-3d");
  });

  test("a question whose answer lives elsewhere still resolves across pages", async () => {
    // Asked from the 3D viewer, this must still reach the case-list topic —
    // the page boost must not become an off-page penalty.
    const result = await localProvider("how do i create a case", { pageId: "viewer_3d" });
    expect(result.topic.id).toBe("create-case");
  });

  test("a partial phrase earns less than the whole phrase it came from", () => {
    // "where do i write notes" is a prefix of clinical-notes-3d's phrase; the
    // words it drops are the ones that discriminate, so it must not earn full
    // credit for them.
    const topic = TOPIC_BY_ID.get("clinical-notes-3d");
    const tokens = ["write", "note"];
    const partial = scoreTopic(tokens, topic, {}, "where do i write notes");
    const whole = scoreTopic(tokens, topic, {}, "where do i write notes in the 3d viewer");
    expect(partial).toBeLessThan(whole);
  });

  test("the same-page boost only applies to topics that already scored", () => {
    const topic = TOPIC_BY_ID.get("save-2d");
    const tokens = ["banana"];
    expect(scoreTopic(tokens, topic, { pageId: "annotation_2d" })).toBe(0);
  });

  test("an exact phrase outranks scattered keyword hits", () => {
    const topic = TOPIC_BY_ID.get("delete-case");
    const withPhrase = scoreTopic(["delete", "case"], topic, {}, "how do i delete a case");
    const withoutPhrase = scoreTopic(["delete", "case"], topic, {}, "delete case");
    expect(withPhrase).toBeGreaterThan(withoutPhrase);
  });
});

describe("localProvider()", () => {
  test("a confident answer carries a topic and alternates", async () => {
    const result = await localProvider("how do i share the 3d link", { pageId: "case_list" });
    expect(result.confident).toBe(true);
    expect(result.topic.id).toBe("share-3d-link");
    expect(result.alternates.length).toBeGreaterThan(0);
  });

  test("gibberish is not answered confidently but still offers somewhere to go", async () => {
    const result = await localProvider("asdfgh qwerty", { pageId: "case_list" });
    expect(result.confident).toBe(false);
    expect(result.topic).toBeNull();
    expect(result.alternates.length).toBeGreaterThan(0);
  });

  test("a single weak keyword falls below the confidence floor", async () => {
    const result = await localProvider("thing", { pageId: null });
    expect(result.confident).toBe(false);
  });

  test("MIN_SCORE is the floor a confident answer must clear", async () => {
    const result = await localProvider("how do i create a case", { pageId: "case_list" });
    const [best] = findMatches("how do i create a case", HELP_TOPICS, { pageId: "case_list" });
    expect(result.confident).toBe(true);
    expect(best.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe("suggestionsFor()", () => {
  test("puts topics from the current page first", () => {
    const suggestions = suggestionsFor("viewer_3d");
    expect(suggestions[0].page).toBe("viewer_3d");
  });

  test("falls back to global topics on a page with none of its own", () => {
    expect(suggestionsFor("admin_case_list").length).toBeGreaterThan(0);
  });
});

// The knowledge base is hand-maintained, so these guard the shape a topic must
// keep for the panel to render it and for matching to reach it.
describe("knowledge base integrity", () => {
  test("topic ids are unique, and TOPIC_BY_ID covers every one", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOPIC_BY_ID.size).toBe(HELP_TOPICS.length);
  });

  test("every topic has a title, an answer, keywords, real related ids and a known page", () => {
    for (const topic of HELP_TOPICS) {
      expect(typeof topic.title).toBe("string");
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.answer.length).toBeGreaterThan(0);
      expect(topic.keywords.length).toBeGreaterThan(0);
      expect(relatedTopics(topic)).toHaveLength(topic.related.length);
      expect(topic.related).not.toContain(topic.id);
      if (topic.page === null) continue;
      expect(PAGE_LABELS[topic.page]).toBeTruthy();
      expect(PAGE_PATHS[topic.page]).toBeTruthy();
    }
  });

  test("every topic is reachable by at least one of its own phrases", async () => {
    for (const topic of HELP_TOPICS) {
      for (const phrase of topic.phrases || []) {
        const matches = findMatches(phrase, HELP_TOPICS, { pageId: topic.page });
        expect(idsOf(matches)).toContain(topic.id);
      }
    }
  });
});

// The 3D jaw preview (preview3D.js, inside the 2D design) and the standalone
// 3D Viewer page are different surfaces with different capabilities. Conflating
// them sent people asking about surveying to a page that cannot survey, so the
// split is pinned here.
describe("3D surfaces are not conflated", () => {
  test("surveying belongs to the 2D design, where the jaw preview lives", () => {
    expect(TOPIC_BY_ID.get("survey-angle").page).toBe("annotation_2d");
  });

  test("asking about the survey angle never routes to the 3D Viewer", async () => {
    for (const pageId of ["case_list", "annotation_2d", "viewer_3d"]) {
      const result = await localProvider("how do i set the survey angle", { pageId });
      expect(result.topic.id).toBe("survey-angle");
      expect(result.topic.page).not.toBe("viewer_3d");
    }
  });

  test("no topic on the 3D Viewer claims the viewer can survey", () => {
    const viewerTopics = HELP_TOPICS.filter((t) => t.page === "viewer_3d");
    expect(viewerTopics.length).toBeGreaterThan(0);
    for (const topic of viewerTopics) {
      const claimsSurveying = /\bsurvey(ing)?\b/i.test(`${topic.title} ${topic.steps.map(stepText).join(" ")}`);
      expect(claimsSurveying).toBe(false);
    }
  });

  // The 3D Viewer has no heatmap control of its own, so the heatmap question is
  // answered by the 2D jaw preview's topic from either screen.
  test("the heatmap question routes to the jaw preview from every screen", async () => {
    const inPreview = await localProvider("what do the colours mean", { pageId: "annotation_2d" });
    const inViewer = await localProvider("what do the colours mean", { pageId: "viewer_3d" });
    expect(inPreview.topic.id).toBe("undercut-heatmap");
    expect(inViewer.topic.id).toBe("undercut-heatmap");
  });
});

const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Every step that names a control, with its topic.
const ANCHORED = HELP_TOPICS.flatMap((topic) =>
  topic.steps.filter((step) => typeof step !== "string").map((step) => ({ topic, step }))
);

// The card for `selector` in a topic's walkthrough.
const cardFor = (id, selector) =>
  walkthroughFor(TOPIC_BY_ID.get(id)).find((card) => listOf(card.selector).includes(selector));

const CREATE_CASE = ["#createCaseBtn", "#mobileCreateCaseBtn"];
const PADLOCK = "#jawLockToggleBtn";
const MOUSE = "not all and (pointer: coarse)";
const inComponentsPanel = (step) =>
  listOf(step.selector).length > 0 &&
  listOf(step.selector).every((s) => /^#(componentTabs|componentItems|editModePanel)\b/.test(s));

// "Show me" used to ring one control and stop: asking how to create a case lit
// the Create Case button and never went into the form it opens. It now walks the
// answer's own steps as a mini tour, one card per step.
describe("Show me walks the answer's steps", () => {
  test("the walkthrough is the topic's steps in order, each carded under its title", () => {
    const topic = TOPIC_BY_ID.get("create-case");
    const cards = walkthroughFor(topic);
    expect(cards.map((card) => card.text)).toEqual(topic.steps.map(stepText));
    expect(cards.every((card) => card.title === topic.title)).toBe(true);
  });

  test("creating a case starts at the button, goes into the form, and ends on Save", () => {
    const cards = walkthroughFor(TOPIC_BY_ID.get("create-case"));
    expect(cards[0].selector).toEqual(CREATE_CASE);
    for (const card of cards.slice(1)) expect(card.reveal).toEqual(CREATE_CASE);
    expect(cards.at(-1).selector).toBe("#createCaseUpload .save-btn");
  });

  test("prose steps stay in as centred cards; with none anchored there is no walkthrough", () => {
    const due = walkthroughFor(TOPIC_BY_ID.get("due-date"));
    expect(due).toHaveLength(3);
    expect(due.filter((card) => !card.selector)).toHaveLength(2);
    expect(walkthroughFor(TOPIC_BY_ID.get("share-link-privacy"))).toEqual([]);
    expect(walkthroughFor(TOPIC_BY_ID.get("app-frozen"))).toEqual([]);
  });

  test("every step has wording, whichever shape it takes", () => {
    for (const topic of HELP_TOPICS) {
      for (const step of topic.steps) {
        expect([topic.id, typeof stepText(step)]).toEqual([topic.id, "string"]);
        expect(stepText(step).length).toBeGreaterThan(0);
      }
    }
  });

  test("the matcher indexes an anchored step's wording, not the object", () => {
    // "save" is only in create-case's last step — not its title, answer or keywords.
    const topic = TOPIC_BY_ID.get("create-case");
    expect(scoreTopic(["save"], topic)).toBeGreaterThan(0);
    expect(scoreTopic(["object"], topic)).toBe(0);
  });
});

// The target is always the control the step talks about; opening the view it
// sits in is `reveal`'s job.
describe("Show me points at the control, not at what opens it", () => {
  test("a reveal never names the control it uncovers", () => {
    const offenders = ANCHORED.filter(({ step }) =>
      listOf(step.reveal).some((r) => listOf(step.selector).includes(r))
    ).map(({ topic }) => topic.id);
    expect(offenders).toEqual([]);
  });

  test("uploading a jaw scan points into the create-case form", () => {
    expect(cardFor("upload-jaw-scans", "#uploadedJawModels").reveal).toEqual(CREATE_CASE);
  });

  test.each([
    ["rename-case", "#renameBtn"],
    ["duplicate-case", "#duplicateBtn"],
    ["delete-case", "#deleteBtn"],
    ["download-references", "#downloadReferencesBtn"],
    ["user-access", "#editUserAccessBtn"],
    ["dashboard", "#viewDashboardBtn"],
  ])("%s ends on its own item in the case-actions menu", (id, selector) => {
    const cards = walkthroughFor(TOPIC_BY_ID.get(id));
    expect(cards.at(-1).selector).toBe(selector);
    expect(cards.at(-1).reveal).toBe(".cm-detail .dropdown-toggle");
  });

  // Reopening the view resets the form, so it is opened once and put back by
  // Cancel — never by pressing Create Case again.
  test("every step inside the create-case view opens it, and Cancel puts it back", () => {
    const inside = ANCHORED.filter(({ step }) => listOf(step.reveal).includes("#createCaseBtn"));
    expect(inside.length).toBeGreaterThan(8);
    for (const { step } of inside) {
      expect(step.reveal).toEqual(CREATE_CASE);
      expect(step.dismiss).toBe("#createCaseUpload .cancel-btn");
    }
  });

  // "How do I place a clasp" used to spotlight the whole Components tab strip.
  // Each tab id must be one the catalog renders — it stamps data-tab from COMPONENT_TABS.
  test.each([
    ["clasps", "clasps"],
    ["bars", "bars"],
    ["major-connector", "major"],
    ["plates", "plate"],
  ])("%s opens the %s tab, then points at that tab's item list", (id, tabId) => {
    const tab = `#componentTabs .component-tab[data-tab="${tabId}"]`;
    const cards = walkthroughFor(TOPIC_BY_ID.get(id));
    const open = cards.find((card) => card.selector === tab);
    const pick = cards.find((card) => card.selector === `#componentItems[data-tab="${tabId}"]`);
    expect(open.reveal).toBe(PADLOCK);
    // The tab is what opens the list; the padlock only keeps the step through the
    // start-of-tour filter while the arches are unlocked.
    expect(pick.reveal).toEqual([tab, PADLOCK]);
    expect(cards.indexOf(open)).toBeLessThan(cards.indexOf(pick));
    expect(COMPONENT_TABS.some((t) => t.id === tabId)).toBe(true);
  });

  test("only the topic about the tab strip itself targets the whole strip", () => {
    const onStrip = ANCHORED.filter(({ step }) => step.selector === "#componentTabs").map(({ topic }) => topic.id);
    expect([...new Set(onStrip)]).toEqual(["component-tabs"]);
  });

  // The panel is display:none until the arches are locked — the state someone
  // asking "how do I place a clasp" is most likely in.
  test("every step inside the Components panel reveals it with the padlock", () => {
    const inPanel = ANCHORED.filter(({ step }) => inComponentsPanel(step));
    expect(inPanel.length).toBeGreaterThanOrEqual(10);
    for (const { step } of inPanel) expect(listOf(step.reveal)).toContain(PADLOCK);
  });

  // Touch layouts never show the panel (the tooth quick-pick replaces it), so the
  // padlock would lock the arches for a step with nothing to point at.
  test("steps inside the Components panel are for a mouse only", () => {
    for (const { topic, step } of ANCHORED.filter(({ step }) => inComponentsPanel(step))) {
      expect([topic.id, step.media]).toEqual([topic.id, MOUSE]);
    }
  });

  test("removing a component shows right-click to a mouse and the eraser to touch", () => {
    const cards = walkthroughFor(TOPIC_BY_ID.get("remove-component"));
    expect(cards.find((card) => /right-click/.test(card.text)).media).toBe(MOUSE);
    expect(cardFor("remove-component", "#removeComponentModeBtn").media).toBe("(pointer: coarse)");
  });

  // Opening the tab downloads every extra STL — the load that has run iPhones out
  // of memory — so a walkthrough must never set it off, nor have the user do it.
  test("no step opens the Extra 3D tab, and the steps on it only point at it", () => {
    expect(ANCHORED.filter(({ step }) => listOf(step.reveal).includes("#previewTabExtras"))).toEqual([]);
    const onTab = ANCHORED.filter(({ step }) => listOf(step.selector).includes("#previewTabExtras"));
    expect(onTab.length).toBeGreaterThan(0);
    for (const { step } of onTab) expect(step.info).toBe(true);
  });

  // The app sidebar is closed whenever the help panel is open — it is the same
  // menu the panel was launched from.
  test("every sidebar item opens the footer menu first", () => {
    const sidebarSteps = ANCHORED.filter(({ step }) => /^#sidebar/.test(listOf(step.selector)[0]));
    expect(sidebarSteps.length).toBeGreaterThan(5);
    for (const { step } of sidebarSteps) expect(listOf(step.reveal)).toContain("#footerMenuBtn");
  });
});

// "Show me" is done on the page: the user presses each lit control and the walk
// moves on, so what counts as pressing it is part of the data.
describe("Show me is done on the page", () => {
  const PLACING = ["clasps", "bars", "major-connector", "plates"];
  const LOCKED = `${PADLOCK}.is-locked`;

  // "How do I place a clasp" stopped at the item list; it now ends on the arch,
  // where the clasp is actually put on a tooth.
  test.each([
    ["clasps", ".clasp-suggestion-group"],
    ["plates", ".plate-suggestion-visual"],
  ])("%s ends by clicking one of the marks the pick lights on the arch", (id, marks) => {
    const last = walkthroughFor(TOPIC_BY_ID.get(id)).at(-1);
    expect(last.selector).toBe(".jaw-combined-canvas");
    expect(last.advanceOn).toBe(marks);
    // With the marks cleared by a stray click, the walk goes back to the list.
    expect(last.requires).toBe(marks);
  });

  test("a bar is placed on a lit tooth, and its card says why none may be lit", () => {
    const last = walkthroughFor(TOPIC_BY_ID.get("bars")).at(-1);
    expect(last.advanceOn).toBe(".tooth-bar-suggestible");
    expect(last.requires).toBeUndefined();
    expect(last.text).toMatch(/mesh/);
  });

  // Pressing the padlock with the arches locked would unlock them.
  test.each(PLACING)("%s starts at the padlock, left out once the arches are locked", (id) => {
    const [first] = walkthroughFor(TOPIC_BY_ID.get(id));
    expect(first.selector).toBe(PADLOCK);
    expect(first.skipIf).toBe(LOCKED);
  });

  test("no step presses the padlock while it is locked", () => {
    const onPadlock = ANCHORED.filter(({ step }) => step.selector === PADLOCK && !step.info);
    expect(onPadlock.length).toBeGreaterThan(5);
    for (const { topic, step } of onPadlock) expect([topic.id, step.skipIf]).toEqual([topic.id, LOCKED]);
  });

  // The quick-pick replaces the Components panel on touch.
  test.each(PLACING)("%s picks from the tooth quick-pick on touch", (id) => {
    const cards = walkthroughFor(TOPIC_BY_ID.get(id));
    const onTouch = cards.find((card) => card.media === "(pointer: coarse)");
    expect(onTouch.selector).toBe(".jaw-combined-canvas");
    expect(onTouch.advanceOn).toBe(".tooth:not(.is-missing)");
  });

  test("an item list moves on for a pick from it, not a click beside one", () => {
    const lists = ANCHORED.filter(({ step }) => /^#componentItems/.test(listOf(step.selector)[0]));
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const { step } of lists) expect(step.advanceOn).toBe(".component-item");
  });

  // The pencils, status pill, download and bin inside a row have jobs of their own.
  test("picking a case is a click on its row, not the buttons in it", () => {
    const rows = ANCHORED.filter(({ step }) => listOf(step.selector).includes(".cm-table tbody tr"));
    expect(rows.length).toBeGreaterThan(10);
    for (const { step } of rows) expect(step.advanceOn).toBe(".cm-row");
  });

  test("removing a component is a right-click, then a pick from the list it opens", () => {
    const cards = walkthroughFor(TOPIC_BY_ID.get("remove-component"));
    const rightClick = cards.find((card) => card.rightClick);
    expect(rightClick.media).toBe(MOUSE);
    const list = cards.find((card) => /\.remove-component-item-btn/.test(card.advanceOn || ""));
    expect(list.follows).toBe(true);
    // Its Cancel counts as well — the way out of a list with nothing to remove.
    expect(list.advanceOn).toMatch(/#removeComponentDialogCancel/);
    expect(cards.indexOf(rightClick)).toBeLessThan(cards.indexOf(list));
  });

  // A walk is lost with the page it runs on.
  test("a step that would leave the page before the walk is over only points", () => {
    const due = walkthroughFor(TOPIC_BY_ID.get("due-date"));
    expect(due[0].selector).toBe(".start-case-button");
    expect(due[0].info).toBe(true);
  });

  test("steps for typing keep their Next, and no step is both", () => {
    expect(cardFor("create-case", "#createCaseForm .cc-form-grid").next).toBe(true);
    expect(cardFor("case-chat", "#chat-input-area").next).toBe(true);
    for (const { topic, step } of ANCHORED) expect([topic.id, step.next && step.info]).not.toEqual([topic.id, true]);
  });
});

// A step whose control no longer resolves is dropped from the walkthrough without
// a word, and a topic that loses them all loses its Show me. This catches the
// rename that would cause it. What counts as using a control is checked too — a
// renamed mark would leave the walk waiting on a click that never counts.
describe("step selectors still exist in the source", () => {
  const selectors = [
    ...new Set(
      ANCHORED.flatMap(({ step }) =>
        [
          ...listOf(step.selector),
          ...listOf(step.reveal),
          step.dismiss,
          ...listOf(step.skipIf),
          ...listOf(step.requires),
          ...String(step.advanceOn || "").split(","),
        ].map((s) => s && s.trim())
      ).filter(Boolean)
    ),
  ];

  test("there are selectors to check", () => {
    expect(selectors.length).toBeGreaterThan(40);
  });

  test.each(selectors)("%s is defined somewhere in the app", (selector) => {
    expect(undefinedSelectorParts(selector)).toEqual([]);
  });
});
