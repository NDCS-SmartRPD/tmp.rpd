// My Dashboard (src/pages/my_dashboard.html), computed from the signed-in user's case list.
// The KPI tiles and the per-slot card count files, from shared/caseFiles.js:
// 2D designs are the jawstruct .txt files, SmartRPD 3D files the jaw STLs,
// extra slot 3D files the extra-slot STLs, and uploaded scans all STLs.

import { loadCaseFiles } from "../shared/caseFiles.js";
import { caseListHref } from "../shared/caseListFilter.js";
import {
  caseStats,
  createdInPreviousWindow,
  createdSeries,
  createdWithin,
  designStatusCounts,
  isOwnedBy,
  recentCases,
  slotLabel,
  slotStats,
} from "../shared/caseStats.js";
import { loadMyCases } from "../shared/myCases.js";
import { toast } from "../shared/toast.js";
import {
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
// Chart colors, validated with the dataviz palette checks: the brand teal
// (tokens.css --primary) for the single-series columns (its 2.7:1 contrast is
// covered by the table view), and one light → dark ramp per design step for its
// ordered states, so the two donuts read as different charts: teal for 2D, the
// reference blue (steps 400–700) for 3D.
const COLUMN_COLOR = "#3bae95";
// Each design donut counts cases by their current status, as the case list shows
// it ("2D design pending", "… drafted", "… approved"), so the numbers match it.
// A drafted design waits on the user, as the case list's Needs action says.
const DESIGN_LEGEND = [
  ["pending", "Pending"],
  ["drafted", "Drafted", "(needs action)"],
  ["approved", "Approved"],
];
// In DESIGN_LEGEND order.
const DESIGN_RAMPS = {
  "2d": ["#3bae95", "#25735f", "#164a3e"],
  "3d": ["#3987e5", "#1c5cab", "#0d366b"],
};

// filesRunning: the file check starts as soon as the case list is in.
const state = { cases: [], filesRunning: true };

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

// While the file check runs, or once the backend has refused part of it.
function uncheckedText(unchecked) {
  return state.filesRunning
    ? `Checking ${plural(unchecked, "case")}…`
    : `${plural(unchecked, "case")} not checked — reload to retry`;
}

// A file tile's total and change, shown only once every case in both periods
// has been checked.
function renderFileTile(id, key, stats, prevStats, days) {
  const unchecked = stats.filesPending + prevStats.filesPending;
  setText(id, unchecked ? "…" : String(stats[key]));
  if (!unchecked) {
    renderDelta(`${id}Delta`, stats[key], prevStats[key], days);
    return;
  }
  document.getElementById(`${id}Delta`).replaceChildren(h("span", { class: "up-faint" }, uncheckedText(unchecked)));
}

// One row per extra 3D slot, named as in the app, with its share of the
// period's extra slot 3D files.
function renderSlots(cases, unchecked) {
  const rows = slotStats(cases);
  const total = rows.reduce((n, r) => n + r.count, 0);
  document.getElementById("dbSlots").replaceChildren(
    ...rows.map((r) => {
      const label = slotLabel(r);
      const share = unchecked || !total ? 0 : (r.count / total) * 100;
      return h(
        "li",
        {},
        h("div", { class: "up-slot-head" }, h("span", {}, label), h("b", {}, unchecked ? "…" : String(r.count))),
        h(
          "div",
          { class: "up-bar", role: "img", "aria-label": unchecked ? `${label}: still counting` : `${label}: ${r.count} of ${plural(total, "file")}` },
          h("div", { style: { width: `${share}%` } })
        )
      );
    })
  );
  let note = "No extra slot 3D files for these filters.";
  if (unchecked) note = uncheckedText(unchecked);
  else if (total) note = `Each bar is the slot's share of ${plural(total, "extra slot 3D file")}.`;
  setText("dbSlotsNote", note);
}

// The case statuses a design donut counts, e.g. "2d_design_pending".
const designStatuses = (step) => DESIGN_LEGEND.map(([key]) => `${step}_design_${key}`);

// "View all" opens the case list filtered to exactly what each card counts:
// its statuses, the period (not for Recent cases, which ignores it) and the
// Cases filter.
function updateViewAllLinks(days, scope) {
  const links = {
    dbCreatedViewAll: { days },
    db2dViewAll: { days, statuses: designStatuses("2d") },
    db3dViewAll: { days, statuses: designStatuses("3d") },
    dbRecentViewAll: {},
  };
  for (const [id, filter] of Object.entries(links)) {
    document.getElementById(id)?.setAttribute("href", caseListHref({ scope, ...filter }));
  }
}

// Cases currently at the 2D or 3D design step's pending, drafted or approved status.
function renderDesignDonut(id, cases, step) {
  const counts = designStatusCounts(cases, step);
  renderDonut(
    document.getElementById(id),
    DESIGN_LEGEND.map(([key, label, note], i) => ({ label, note, count: counts[key], color: DESIGN_RAMPS[step][i] }))
  );
}

function render(user) {
  const { days, scope } = filters();
  const scoped = state.cases.filter((c) => inScope(c, scope, user.username));
  const inPeriod = scoped.filter((c) => createdWithin(c, days));
  const previous = days == null ? [] : scoped.filter((c) => createdInPreviousWindow(c, days));
  const stats = caseStats(inPeriod, user.username);
  const prevStats = caseStats(previous, user.username);

  renderFileTile("dbScans", "scans", stats, prevStats, days);
  renderFileTile("db2d", "designFiles", stats, prevStats, days);
  renderFileTile("db3d", "jawStls", stats, prevStats, days);
  renderFileTile("dbThird", "extraStls", stats, prevStats, days);
  renderSlots(inPeriod, stats.filesPending);

  const monthly = days == null;
  setText("dbCreatedSub", monthly ? "Per month" : `Last ${days} days`);
  setText("dbCreatedUnit", monthly ? "Month" : "Day");
  renderCreatedChart(document.getElementById("dbCreatedChart"), createdSeries(scoped, days), monthly);

  renderDesignDonut("db2dDesignDonut", inPeriod, "2d");
  renderDesignDonut("db3dDesignDonut", inPeriod, "3d");

  renderRecentCases(document.getElementById("dbRecentCases"), recentCases(scoped, 5), user.username);
  updateViewAllLinks(days, scope);
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
      render(user);
      if (load.stale && !warnedStale) {
        warnedStale = true;
        toast.warning("Couldn't reach the server — showing your last saved case list.");
      }
    },
  });
  // Newest first, so the shorter periods fill in first.
  await loadCaseFiles(recentCases(state.cases, Infinity), { onUpdate: () => render(user) });
  state.filesRunning = false;
  render(user);
}

const user = requireUser();
if (user) init(user);
