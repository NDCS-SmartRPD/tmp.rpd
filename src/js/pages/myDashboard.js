// My Dashboard (src/pages/my_dashboard.html) — App.tsx from the "Create User
// Profile Dashboard" prototype, computed from the signed-in user's case list.
// Uploaded scans, third-party files and per-slot counts have no endpoint yet
// and stay "—" in the markup.

import {
  caseStats,
  createdInPreviousWindow,
  createdSeries,
  createdWithin,
  designStateCounts,
  isOwnedBy,
  recentCases,
} from "../shared/caseStats.js";
import { loadMyCases } from "../shared/myCases.js";
import { toast } from "../shared/toast.js";
import {
  STAGES,
  h,
  markUpdated,
  monthLabel,
  plural,
  renderDonut,
  renderRecentCases,
  requireUser,
  roleLabel,
  setText,
  setupPageChrome,
  shortDate,
  userInitials,
} from "../shared/userPages.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Chart colors in the brand teal (tokens.css), validated with the dataviz
// palette checks: --primary for the single-series columns (its 2.7:1 contrast
// is covered by the table view), and a light → dark teal ramp for the ordered
// 2D states.
const COLUMN_COLOR = "#3bae95";
const DESIGN_RAMP = [
  ["not_started", "Not started", "#5ec0a8"],
  ["pending", "Pending", "#3bae95"],
  ["in_progress", "In progress", "#25735f"],
  ["done", "Done", "#164a3e"],
];

const state = { cases: [], load: { stale: false, pending: 0 } };

function filters() {
  const period = document.getElementById("dbPeriod").value;
  return { days: period === "all" ? null : Number(period), scope: document.getElementById("dbScope").value };
}

function inScope(c, scope, username) {
  if (scope === "owned") return isOwnedBy(c, username);
  if (scope === "shared") return !isOwnedBy(c, username);
  return true;
}

// 0 and a rounded top value; the midpoint too when it's a whole number.
function axisTicks(max) {
  let top = Math.max(1, max);
  if (top > 5) {
    const pow = 10 ** Math.floor(Math.log10(top));
    top = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((v) => v >= max);
  }
  return Number.isInteger(top / 2) ? [0, top / 2, top] : [0, top];
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Single-series columns: ≤24px wide, 4px rounded tops square on the baseline,
// hairline grid, a hover tooltip on a full-height hit area per bucket, and a
// table view underneath so no value depends on hovering.
function renderCreatedChart(host, buckets, monthly) {
  const W = 400, H = 190, left = 26, right = 6, top = 10, axisBand = 24;
  const plotW = W - left - right, plotH = H - top - axisBand, base = top + plotH;
  const ticks = axisTicks(Math.max(0, ...buckets.map((b) => b.count)));
  const yMax = ticks.at(-1);
  const slot = plotW / buckets.length;
  const barW = Math.min(24, Math.max(2, slot - 2));
  const label = (b) => (monthly ? monthLabel(b.start) : shortDate(b.start));

  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "up-chart-svg", role: "img", "aria-label": `Cases created per ${monthly ? "month" : "day"}` });
  for (const t of ticks) {
    const y = base - (t / yMax) * plotH;
    chart.append(svg("line", { x1: left, x2: W - right, y1: y, y2: y, class: "up-chart-grid" }));
    const tl = svg("text", { x: left - 5, y: y + 4, class: "up-chart-tick", "text-anchor": "end" });
    tl.textContent = String(t);
    chart.append(tl);
  }
  const tip = h("div", { class: "up-tooltip", role: "status" });
  buckets.forEach((b, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const barH = (b.count / yMax) * plotH;
    if (barH > 0) {
      const r = Math.min(4, barW / 2, barH);
      const y = base - barH;
      chart.append(
        svg("path", {
          d: `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${base} Z`,
          fill: COLUMN_COLOR,
        })
      );
    }
    const hit = svg("rect", { x: left + i * slot, y: top, width: slot, height: plotH, class: "up-chart-hit" });
    hit.addEventListener("pointerenter", () => {
      tip.textContent = `${label(b)}: ${plural(b.count, "case")}`;
      tip.style.left = `${((x + barW / 2) / W) * 100}%`;
      tip.style.top = `${((base - barH) / H) * 100}%`;
      tip.classList.add("is-visible");
    });
    hit.addEventListener("pointerleave", () => tip.classList.remove("is-visible"));
    chart.append(hit);
  });
  const last = buckets.length - 1;
  for (const i of [...new Set([0, Math.floor(last / 2), last])]) {
    const xl = svg("text", {
      x: left + i * slot + slot / 2,
      y: H - 6,
      class: "up-chart-tick",
      "text-anchor": i === 0 ? "start" : i === last ? "end" : "middle",
    });
    xl.textContent = label(buckets[i]);
    chart.append(xl);
  }
  chart.append(svg("line", { x1: left, x2: W - right, y1: base, y2: base, class: "up-chart-axis" }));
  host.replaceChildren(chart, tip);

  document.getElementById("dbCreatedTable").replaceChildren(
    ...buckets.map((b) => h("tr", {}, h("td", {}, label(b)), h("td", { class: "up-num" }, String(b.count))))
  );
}

// "+12.5% ▲ vs prev. 30 days", as on the prototype's KPI cards.
function renderDelta(id, current, previous, days) {
  const el = document.getElementById(id);
  if (days == null) {
    el.replaceChildren(h("span", { class: "up-faint" }, "All time"));
    return;
  }
  const vs = h("span", { class: "up-faint" }, ` vs prev. ${days} days`);
  const diff = current - previous;
  if (diff === 0) {
    el.replaceChildren("No change", vs);
    return;
  }
  const text = previous ? `${diff > 0 ? "+" : ""}${((diff / previous) * 100).toFixed(1)}%` : `+${diff}`;
  el.replaceChildren(text, " ", h("span", { class: diff > 0 ? "is-up" : "is-down" }, diff > 0 ? "▲" : "▼"), vs);
}

function render(user) {
  const { days, scope } = filters();
  const scoped = state.cases.filter((c) => inScope(c, scope, user.username));
  const inPeriod = scoped.filter((c) => createdWithin(c, days));
  const previous = days == null ? [] : scoped.filter((c) => createdInPreviousWindow(c, days));
  const stats = caseStats(inPeriod, user.username);
  const prevStats = caseStats(previous, user.username);
  const loading = state.load.pending > 0;

  setText("db2d", loading ? "…" : String(stats.designs2d));
  setText("db3d", loading ? "…" : String(stats.designs3d));
  renderDelta("db2dDelta", stats.designs2d, prevStats.designs2d, days);
  renderDelta("db3dDelta", stats.designs3d, prevStats.designs3d, days);

  const monthly = days == null;
  setText("dbCreatedSub", monthly ? "Per month" : `Last ${days} days`);
  setText("dbCreatedUnit", monthly ? "Month" : "Day");
  renderCreatedChart(document.getElementById("dbCreatedChart"), createdSeries(scoped, days), monthly);

  renderDonut(
    document.getElementById("dbStageDonut"),
    STAGES.map((s) => ({ label: s.label, count: stats[s.key], color: s.color }))
  );
  const notes = [];
  if (stats.needsAction) notes.push(`${plural(stats.needsAction, "case")} in Preparation need${stats.needsAction === 1 ? "s" : ""} action.`);
  if (stats.unset) notes.push(`${plural(stats.unset, "case")} without a status ${stats.unset === 1 ? "isn't" : "aren't"} shown.`);
  setText("dbStageNote", notes.join(" "));

  const design = designStateCounts(inPeriod, "2d");
  renderDonut(
    document.getElementById("dbDesignDonut"),
    DESIGN_RAMP.map(([key, label, color]) => ({ label, count: design[key], color }))
  );

  renderRecentCases(document.getElementById("dbRecentCases"), recentCases(scoped, 5), user.username);
  markUpdated();
}

async function init(user) {
  setupPageChrome(user);
  setText("dbInitials", userInitials(user));
  setText("dbName", user.username || "—");
  setText("dbRole", [roleLabel(user), user.email].filter(Boolean).join(" · "));
  for (const id of ["dbPeriod", "dbScope"]) {
    document.getElementById(id).addEventListener("change", () => render(user));
  }
  let warnedStale = false;
  await loadMyCases({
    onUpdate: (cases, load) => {
      state.cases = cases;
      state.load = load;
      render(user);
      if (load.stale && !warnedStale) {
        warnedStale = true;
        toast.warning("Couldn't reach the server — showing your last saved case list.");
      }
    },
  });
}

const user = requireUser();
if (user) init(user);
