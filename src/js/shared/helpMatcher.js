// Question → topic matching for the help assistant. Pure functions only, so the
// whole ranking path is unit testable; helpBot.js owns the panel.

import { HELP_TOPICS, TOPIC_BY_ID, stepText } from "./helpTopics.js";

// Dropped before scoring: common in questions, useless for discriminating.
const STOPWORDS = new Set([
  "a", "about", "an", "and", "any", "are", "as", "at", "be", "but", "by", "can",
  "do", "does", "for", "from", "get", "have", "how", "i", "if", "in", "into",
  "is", "it", "its", "me", "my", "of", "on", "or", "please", "should", "so",
  "some", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "up", "use", "want", "was", "way", "we", "what", "when",
  "where", "which", "while", "who", "why", "will", "with", "would", "you",
  "your",
]);

// Applied to BOTH the question and every topic's index so the two meet at the
// same form. Lets "make a new patient" reach the create-case topic.
const SYNONYMS = new Map(Object.entries({
  make: "create", new: "create", begin: "create", setup: "create",
  patient: "case", job: "case", cases: "case",
  photo: "image", pic: "image", picture: "image", pictures: "image", photos: "image",
  images: "image", thumbnail: "image", thumbnails: "image",
  remove: "delete", erase: "delete", destroy: "delete", trash: "delete", bin: "delete",
  denture: "design", rpd: "design", framework: "design", partial: "design",
  pw: "password", pwd: "password", passcode: "password",
  colour: "color", colours: "color", colors: "color",
  teeth: "tooth",
  clasps: "clasp", bars: "bar", plates: "plate", rests: "rest", notes: "note",
  notifications: "notification", alerts: "notification", alert: "notification",
  users: "user", accounts: "account", admins: "admin", administrator: "admin",
  files: "file", scans: "scan", models: "model", steps: "step",
  find: "search", searching: "search", locate: "search",
  modify: "edit", rename: "edit",
  sharing: "share", saving: "save", saved: "save",
  broken: "error", failing: "error", fails: "error", failed: "error",
  cant: "cannot", doesnt: "not", isnt: "not", wont: "not",
}));

// Score below which an answer is treated as a guess: the panel then says it is
// unsure and offers the nearest topics instead of asserting one.
export const MIN_SCORE = 4;

// Awarded when a question matches one of a topic's `phrases` outright.
const PHRASE_BONUS = 5;

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w));
}

// Replacing the word rather than keeping both forms is what stops one query
// word from scoring twice against the same topic.
export function canonicalize(tokens) {
  return [...new Set(tokens.map((token) => SYNONYMS.get(token) || token))];
}

export function queryTokens(text) {
  return canonicalize(tokenize(text));
}

// Every word a topic can be matched on, bucketed by how much a hit is worth.
function topicIndex(topic) {
  if (!topic.__index) {
    Object.defineProperty(topic, "__index", {
      value: {
        keywords: new Set(canonicalize((topic.keywords || []).map((k) => normalize(k)))),
        title: new Set(canonicalize(tokenize(topic.title))),
        body: new Set(canonicalize(tokenize([topic.answer, ...(topic.steps || []).map(stepText)].join(" ")))),
      },
      enumerable: false,
    });
  }
  return topic.__index;
}

// Weighted token overlap plus two boosts: an exact phrase the topic claims, and
// the page the user is on — how "how do I save" resolves per-page.
export function scoreTopic(tokens, topic, { pageId = null } = {}, rawQuery = "") {
  const index = topicIndex(topic);
  let score = 0;

  for (const token of tokens) {
    if (index.keywords.has(token)) score += 3;
    else if (index.title.has(token)) score += 2;
    else if (index.body.has(token)) score += 1;
  }

  // Padded so containment matches whole words ("thing" must not claim it from
  // "nothing is loading"); a partial match earns a proportional share.
  const normalizedQuery = normalize(rawQuery);
  if (normalizedQuery) {
    const queryWords = normalizedQuery.split(" ");
    const paddedQuery = ` ${normalizedQuery} `;
    let bonus = 0;
    for (const phrase of topic.phrases || []) {
      const normalizedPhrase = normalize(phrase);
      if (!normalizedPhrase) continue;
      const paddedPhrase = ` ${normalizedPhrase} `;
      if (paddedQuery.includes(paddedPhrase)) {
        bonus = PHRASE_BONUS;
        break;
      }
      // One word is a keyword, not a phrasing — no partial credit for it.
      if (queryWords.length > 1 && paddedPhrase.includes(paddedQuery)) {
        const coverage = queryWords.length / normalizedPhrase.split(" ").length;
        bonus = Math.max(bonus, PHRASE_BONUS * coverage);
      }
    }
    score += bonus;
  }

  if (score > 0 && pageId && topic.page === pageId) score *= 1.5;
  return score;
}

// Ranked matches for a question. Ties break on topic order so the ranking is
// stable between calls.
export function findMatches(question, topics = HELP_TOPICS, { pageId = null, limit = 4 } = {}) {
  const tokens = queryTokens(question);
  if (!tokens.length) return [];
  return topics
    .map((topic, order) => ({ topic, order, score: scoreTopic(tokens, topic, { pageId }, question) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ topic, score }) => ({ topic, score }));
}

// Resolve a topic's `related` ids to topics, skipping any that no longer exist.
export function relatedTopics(topic, byId = TOPIC_BY_ID) {
  return (topic?.related || []).map((id) => byId.get(id)).filter(Boolean);
}

// Starter chips: what's on this page first, then generally useful topics.
export function suggestionsFor(pageId, topics = HELP_TOPICS, limit = 4) {
  const onPage = topics.filter((t) => t.page === pageId);
  const global = topics.filter((t) => t.page === null);
  return [...onPage, ...global].slice(0, limit);
}

// Async on purpose: a provider registered via setAnswerProvider() has the same
// contract. `topic` is null below MIN_SCORE, leaving `alternates` the near misses.
export async function localProvider(question, { pageId = null, topics = HELP_TOPICS } = {}) {
  const matches = findMatches(question, topics, { pageId, limit: 4 });
  if (!matches.length) {
    return { confident: false, topic: null, alternates: suggestionsFor(pageId, topics, 3) };
  }
  const [best, ...rest] = matches;
  if (best.score < MIN_SCORE) {
    return { confident: false, topic: null, alternates: matches.slice(0, 3).map((m) => m.topic) };
  }
  return { confident: true, topic: best.topic, alternates: rest.map((m) => m.topic).slice(0, 3) };
}
