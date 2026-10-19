// Rendering shared by the profile and dashboard pages (src/pages/profile.html,
// src/pages/my_dashboard.html), which follow the "Create User Profile
// Dashboard" Figma Make prototype. Server values only ever reach the DOM as text.

import { getLoggedInUser } from "./api.js";
import { statusLabel } from "./apiLog.js";
import { setupAppSidebar } from "./appSidebar.js";
import { toast } from "./toast.js";
import { timestampToMs, toDayMidnight } from "./timestamps.js";
import { DESIGN_STATE_LABELS, caseOwner, designState, isOwnedBy, stageOf } from "./caseStats.js";
import { caseIntIdOf } from "./caseEnrichment.js";
import { initialsFor } from "./userSuggest.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SVG_NS = "http://www.w3.org/2000/svg";

// Stage colors are the case list's stat-card accents (.cm-stat-filter-*),
// validated together as a categorical set; used by the profile's stage meters
// and activity dots, and the KPI page's status rows.
export const STAGES = [
  { key: "preparation", label: "Preparation", color: "#d97706" },
  { key: "delivery", label: "Production", color: "#2563eb" },
  { key: "completed", label: "Completed", color: "#16a34a" },
];
export const NEEDS_ACTION_COLOR = "#f59e0b";
const INVITE_COLOR = "#25735f"; // --primary-strong

// Element builder: h("p", { class: "x" }, "text", child, …).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// No session means no data to show: send the visitor to sign in.
export function requireUser() {
  const user = getLoggedInUser();
  if (!user?.uuid) {
    window.location.replace("../../index.html");
    return null;
  }
  return user;
}

export function roleLabel(user) {
  return Number(user?.isAdmin) === 1 ? "Administrator" : "User";
}

export function userInitials(user) {
  return initialsFor(user?.username || user?.email || "");
}

// Fixed three-letter months: some locales' short form for September is "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Oct 2026".
export function monthLabel(ts) {
  const d = new Date(timestampToMs(ts));
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "12 Oct", with the year when it isn't this year (or when asked for).
export function shortDate(ts, now = Date.now(), { withYear = false } = {}) {
  const ms = timestampToMs(ts);
  if (ms == null) return "—";
  const d = new Date(ms);
  const year = withYear || d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

// "Today, 4:12 PM" / "Yesterday, 11:03 AM" / "10 Oct, 2:47 PM".
export function whenText(ts, now = Date.now()) {
  const ms = timestampToMs(ts);
  if (ms == null) return "";
  const time = new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = toDayMidnight(ms);
  const today = toDayMidnight(now);
  if (day === today) return `Today, ${time}`;
  if (day === today - DAY_MS) return `Yesterday, ${time}`;
  return `${shortDate(ms, now)}, ${time}`;
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Top bar menu (the app sidebar) and avatar initials, and every "Change
// password" button.
export function setupPageChrome(user) {
  setupAppSidebar({ triggerId: "appbarMenuBtn" });
  setText("appbarAvatar", userInitials(user));
  document.querySelectorAll("[data-change-password]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const { openChangePassword } = await import("./changePassword.js");
        openChangePassword();
      } catch (err) {
        console.error("[userPages] change password failed to load:", err);
        toast.error("Change password is unavailable right now.");
      }
    })
  );
}

export function markUpdated(now = Date.now()) {
  const time = new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  setText("lastUpdated", `${shortDate(now, now, { withYear: true })}, ${time}`);
}

const faint = (text) => h("span", { class: "up-dash-cell" }, text);
const designCell = (c, step) => {
  if (!("new_status" in c)) return faint("…");
  const label = DESIGN_STATE_LABELS[designState(c.new_status, step)];
  return label === "—" ? faint("—") : label;
};

// Case · Owner · Created · 2D design · 3D design, newest first.
export function renderRecentCases(tbody, cases, username) {
  if (!cases.length) {
    tbody.replaceChildren(h("tr", {}, h("td", { colspan: "5", class: "up-empty" }, "No cases yet.")));
    return;
  }
  tbody.replaceChildren(
    ...cases.map((c) =>
      h(
        "tr",
        {},
        h("td", { class: "up-table-case" }, c.case_id || `Case ${caseIntIdOf(c)}`),
        h("td", {}, isOwnedBy(c, username) ? "You" : caseOwner(c) || "—"),
        h("td", {}, shortDate(c.creation_date)),
        h("td", {}, designCell(c, "2d")),
        h("td", {}, designCell(c, "3d"))
      )
    )
  );
}

// Notifications as a dot-and-line timeline, in the bell's wording.
export function renderActivity(list, alerts, cases, limit = 5) {
  const names = new Map(cases.map((c) => [String(caseIntIdOf(c)), c.case_id]));
  const items = alerts.slice(0, limit).map((a) => {
    const caseName = names.get(String(a.case_int_id)) || `Case ${a.case_int_id}`;
    const hasStatus = a.new_status != null && a.new_status !== "";
    const stage = STAGES.find((s) => s.key === stageOf(a.new_status));
    const text = hasStatus
      ? `${a.from_user} updated ${caseName} to ${statusLabel(a.new_status)}`
      : `${a.from_user} invited you to ${caseName}`;
    return h(
      "li",
      { class: "up-activity-item" },
      h("span", { class: "up-dot", style: { background: hasStatus && stage ? stage.color : INVITE_COLOR }, "aria-hidden": "true" }),
      h("div", {}, h("p", { class: "up-activity-text" }, text), h("p", { class: "up-activity-time" }, whenText(a.create_date)))
    );
  });
  list.replaceChildren(...items);
  if (!items.length) list.replaceChildren(h("li", { class: "up-empty" }, "No notifications yet."));
}

// One labelled meter per stage (each bar = stage ÷ all cases), in the
// prototype's "Account" card style.
export function renderStageMeters(container, stats) {
  const rows = [
    { label: "Preparation", count: stats.preparation, color: STAGES[0].color },
    { label: "Needs action", count: stats.needsAction, color: NEEDS_ACTION_COLOR },
    { label: "Production", count: stats.delivery, color: STAGES[1].color },
    { label: "Completed", count: stats.completed, color: STAGES[2].color },
  ];
  container.replaceChildren(
    ...rows.map((r) =>
      h(
        "div",
        { class: "up-meter-row" },
        h(
          "div",
          { class: "up-meter-head" },
          h("span", { class: "up-dot", style: { background: r.color }, "aria-hidden": "true" }),
          h("span", {}, r.label),
          h("b", {}, String(r.count))
        ),
        h(
          "div",
          { class: "up-bar", role: "img", "aria-label": `${r.label}: ${r.count} of ${stats.total} cases` },
          h("div", { style: { width: `${stats.total ? (r.count / stats.total) * 100 : 0}%`, background: r.color } })
        )
      )
    )
  );
}

// Part-to-whole donut (≤ 6 segments, 2px surface gaps) with a legend that
// carries every count and share, so no value depends on hovering the ring.
// A segment's optional `note` follows its label and wraps as one piece.
export function renderDonut(host, segments) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  const r = 40;
  const C = 2 * Math.PI * r;
  const ring = svgEl("svg", { viewBox: "0 0 100 100", role: "img", "aria-label": segments.map((s) => `${s.label} ${s.count}`).join(", ") });
  if (!total) {
    ring.append(svgEl("circle", { cx: 50, cy: 50, r, fill: "none", "stroke-width": 16, class: "up-donut-empty" }));
  } else {
    const shown = segments.filter((s) => s.count > 0);
    const gap = shown.length > 1 ? 1.2 : 0; // ≈2px at the rendered size
    let offset = 0;
    for (const s of shown) {
      const len = (s.count / total) * C;
      const seg = svgEl("circle", {
        cx: 50,
        cy: 50,
        r,
        fill: "none",
        stroke: s.color,
        "stroke-width": 16,
        "stroke-dasharray": `${Math.max(len - gap, 0.5)} ${C - Math.max(len - gap, 0.5)}`,
        "stroke-dashoffset": -offset,
      });
      const tip = svgEl("title", {});
      tip.textContent = `${s.label}: ${s.count}`;
      seg.append(tip);
      ring.append(seg);
      offset += len;
    }
  }
  const legend = h(
    "ul",
    { class: "up-legend" },
    segments.map((s) =>
      h(
        "li",
        {},
        h("span", { class: "up-dot", style: { background: s.color }, "aria-hidden": "true" }),
        h("span", { class: "up-legend-label" }, s.label, s.note && [" ", h("span", { class: "up-legend-note" }, s.note)]),
        h("span", { class: "up-legend-count" }, String(s.count)),
        h("span", { class: "up-legend-share" }, total ? `${((s.count / total) * 100).toFixed(1)}%` : "—")
      )
    )
  );
  host.replaceChildren(ring, legend);
}
