// Case KPIs (src/pages/case_kpis.html) — KpiTable.tsx from the "Create User
// Profile Dashboard" prototype. The numbers come from shared/kpiMetrics.js;
// this file renders them. The prototype's admin view needs an organisation-wide
// case list, so only the personal ("My view") metrics are shown.

import { TREND_PERIODS, kpiRows, unreadCaseIdsOf } from "../shared/kpiMetrics.js";
import { fetchMyAlerts, loadMyCases } from "../shared/myCases.js";
import { toast } from "../shared/toast.js";
import { h, markUpdated, plural, requireUser, setText, setupPageChrome } from "../shared/userPages.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Sparkline teal, validated with the dataviz checks: unlike --primary (2.7:1)
// it clears 3:1 on white, which a 2px line needs.
const SPARK_COLOR = "#2c9a82";
// The prototype's tone dots, a quiet hint of which metrics to watch; the
// Category column carries the grouping in text.
const TONE_COLORS = { neutral: "#94a3b8", good: "#10b981", warn: "#f59e0b", bad: "#f43f5e" };
const HIGHLIGHTS = ["all", "needsAction", "overdue", "unread"];

const state = {
  cases: [],
  load: { stale: false, pending: 0 },
  alerts: { status: "loading", unreadCaseIds: null, unreadCount: 0 },
  pinned: new Set(),
  days: 7,
  group: "All",
  query: "",
};

// The case list's pins (caseManagement.js pinnedStorageKey), kept per device.
function readPinned(uuid) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`pinnedCases:${uuid}`) || "[]").map(String));
  } catch {
    return new Set();
  }
}

// False while the value is still loading or has no source yet.
function ready(k) {
  if (k.unavailable) return false;
  if (k.needsDetails && state.load.pending) return false;
  if (k.needsAlerts && state.alerts.status !== "ok") return false;
  return true;
}

const fmt = (n) => n.toLocaleString("en-US");

function display(k) {
  if (ready(k)) return fmt(k.value);
  const loading = (k.needsDetails && state.load.pending) || (k.needsAlerts && state.alerts.status === "loading");
  return loading ? "…" : "—";
}

const faint = (text) => h("span", { class: "up-faint" }, text);

function trendLabel(k) {
  const unit = state.days === 1 ? "days" : state.days === 7 ? "weeks" : "30-day periods";
  return `${k.label}, last ${TREND_PERIODS} ${unit}: ${k.trend.join(", ")}`;
}

function spark(k) {
  const W = 80, H = 24, data = k.trend;
  const min = Math.min(...data), max = Math.max(...data);
  const y = (v) => (max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4));
  const points = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const label = trendLabel(k);
  const el = document.createElementNS(SVG_NS, "svg");
  for (const [a, v] of Object.entries({ width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: "up-spark", role: "img", "aria-label": label })) el.setAttribute(a, v);
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = label;
  const line = document.createElementNS(SVG_NS, "polyline");
  for (const [a, v] of Object.entries({ points, fill: "none", stroke: SPARK_COLOR, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" })) line.setAttribute(a, v);
  el.append(title, line);
  return el;
}

// "▲ 20.0%" vs the previous period; "+3" when the previous period had none.
function change(k) {
  if (k.previous == null || !ready(k)) return faint("—");
  const d = k.value - k.previous;
  if (d === 0) return faint("No change");
  const amount = k.previous ? `${Math.abs((d / k.previous) * 100).toFixed(1)}%` : `+${d}`;
  return h("span", { class: d > 0 ? "is-good" : "is-bad" }, `${d > 0 ? "▲" : "▼"} ${amount}`);
}

function share(k, all) {
  if (k.baseline) return faint("Baseline");
  if (!ready(k) || !all) return faint("—");
  const pct = Math.min(100, (k.value / all) * 100);
  return h(
    "div",
    { class: "up-share" },
    h("div", { class: "up-bar", "aria-hidden": "true" }, h("div", { style: { width: `${pct}%` } })),
    h("span", {}, `${pct.toFixed(1)}%`)
  );
}

function metricRow(k, all) {
  return h(
    "tr",
    {},
    h(
      "td",
      {},
      h(
        "div",
        { class: "up-kpi-metric" },
        h("span", { class: "up-dot", style: { background: TONE_COLORS[k.tone] }, "aria-hidden": "true" }),
        h("span", {}, k.label),
        k.device && h("span", { class: "up-tag", title: "Pins are saved in this browser" }, "This device"),
        k.unavailable && h("span", { class: "up-tag", title: "Needs a server total" }, "No data yet")
      )
    ),
    h("td", { class: "up-kpi-cat" }, k.group),
    h("td", { class: "up-num up-kpi-current" }, display(k)),
    h("td", { class: "up-num up-kpi-prev" }, k.previous != null && ready(k) ? fmt(k.previous) : "—"),
    h("td", { class: "up-num up-kpi-change" }, change(k)),
    h("td", {}, k.trend && ready(k) ? spark(k) : faint("—")),
    h("td", {}, share(k, all))
  );
}

// Tiles with history show the change; snapshot tiles show related context.
function highlightSub(k, byId) {
  if (!ready(k)) {
    const failed = k.needsAlerts && state.alerts.status === "error";
    return h("p", { class: "up-highlight-sub up-faint" }, failed ? "Notifications unavailable" : "Loading…");
  }
  if (k.previous != null) {
    const d = k.value - k.previous;
    const tone = d === 0 ? "up-faint" : d > 0 ? "is-good" : "is-bad";
    return h("p", { class: `up-highlight-sub ${tone}` }, d === 0 ? "No change" : `${d > 0 ? "+" : ""}${d} vs previous`);
  }
  const context = {
    needsAction: () => `of ${fmt(byId.preparation.value)} in preparation`,
    overdue: () => `${fmt(byId.dueToday.value)} due today`,
    unread: () => plural(state.alerts.unreadCount, "unread notification"),
  }[k.id];
  return h("p", { class: "up-highlight-sub" }, context ? context() : "");
}

function renderHighlights(byId) {
  document.getElementById("kpiHighlights").replaceChildren(
    ...HIGHLIGHTS.map((id) => {
      const k = byId[id];
      return h(
        "section",
        { class: "up-highlight" },
        h("p", { class: "up-highlight-label" }, k.label),
        h("div", { class: "up-highlight-row" }, h("span", { class: "up-highlight-value" }, display(k)), k.trend && ready(k) && spark(k)),
        highlightSub(k, byId)
      );
    })
  );
}

function renderTable(rows, all) {
  const q = state.query.trim().toLowerCase();
  const shown = rows.filter((k) => (state.group === "All" || k.group === state.group) && k.label.toLowerCase().includes(q));
  document.getElementById("kpiRows").replaceChildren(
    ...(shown.length
      ? shown.map((k) => metricRow(k, all))
      : [h("tr", {}, h("td", { colspan: "7", class: "up-empty up-kpi-none" }, "No metrics match your filters."))])
  );
}

function render(user) {
  const rows = kpiRows(state.cases, {
    username: user.username,
    days: state.days,
    pinnedIds: state.pinned,
    unreadCaseIds: state.alerts.unreadCaseIds,
  });
  const byId = Object.fromEntries(rows.map((k) => [k.id, k]));
  renderHighlights(byId);
  renderTable(rows, byId.all.value);
  setText("kpiStatus", state.load.pending ? `Loading status details for ${plural(state.load.pending, "case")}…` : "");
  const compared = state.days === 1 ? "today with yesterday" : `the last ${state.days} days with the ${state.days} days before`;
  setText(
    "kpiFoot",
    `Change compares ${compared}; red marks a fall. ` +
      "The server doesn't keep status history, so only the date-based metrics have a previous value and a trend. " +
      "Jaw counts need a server total, and pinned cases are the ones pinned in this browser."
  );
  markUpdated();
}

// Chips and the period switch are built once, so keyboard focus survives a re-render.
function setupControls(user) {
  const counts = new Map();
  for (const k of kpiRows([], { days: state.days })) counts.set(k.group, (counts.get(k.group) || 0) + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const chips = ["All", ...counts.keys()].map((g) =>
    h(
      "button",
      { type: "button", class: "up-chip", "data-group": g, "aria-pressed": String(g === state.group) },
      g,
      " ",
      h("span", {}, String(g === "All" ? total : counts.get(g)))
    )
  );
  const groupHost = document.getElementById("kpiGroups");
  groupHost.replaceChildren(...chips);
  groupHost.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-group]");
    if (!chip) return;
    state.group = chip.dataset.group;
    for (const c of chips) c.setAttribute("aria-pressed", String(c === chip));
    render(user);
  });

  const periodHost = document.getElementById("kpiPeriod");
  periodHost.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (!btn) return;
    state.days = Number(btn.dataset.days);
    for (const b of periodHost.querySelectorAll("[data-days]")) b.setAttribute("aria-pressed", String(b === btn));
    render(user);
  });

  document.getElementById("kpiSearch").addEventListener("input", (e) => {
    state.query = e.target.value;
    render(user);
  });
}

async function init(user) {
  setupPageChrome(user);
  state.pinned = readPinned(user.uuid);
  setupControls(user);

  let warnedStale = false;
  const { cases } = await loadMyCases({
    onUpdate: (list, load) => {
      state.cases = list;
      state.load = load;
      render(user);
      if (load.stale && !warnedStale) {
        warnedStale = true;
        toast.warning("Couldn't reach the server — showing your last saved case list.");
      }
    },
  });

  try {
    const alerts = await fetchMyAlerts(cases);
    state.alerts = {
      status: "ok",
      unreadCaseIds: unreadCaseIdsOf(alerts),
      unreadCount: alerts.filter((a) => Number(a.read_status) !== 1).length,
    };
  } catch (err) {
    console.warn("[caseKpis] notifications unavailable", err);
    state.alerts = { status: "error", unreadCaseIds: null, unreadCount: 0 };
  }
  render(user);
}

const user = requireUser();
if (user) init(user);
