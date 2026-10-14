// View Profile (src/pages/profile.html) — MyProfile.tsx from the "Create User
// Profile Dashboard" prototype, filled with what the app actually has: the
// session (username, email, account type, uuid), the device's time zone, the case list,
// collaborators and notifications.

import { caseStats } from "../shared/caseStats.js";
import { fetchMyAlerts, loadMyCases } from "../shared/myCases.js";
import { toast } from "../shared/toast.js";
import { getCollaborators, initialsFor } from "../shared/userSuggest.js";
import {
  h,
  markUpdated,
  plural,
  renderActivity,
  renderStageMeters,
  requireUser,
  roleLabel,
  setText,
  setupPageChrome,
  userInitials,
} from "../shared/userPages.js";

function timeZoneText() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = new Intl.DateTimeFormat("en-US", { timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return `${offset ? `${offset} · ` : ""}${zone} (this device)`;
}

function renderDetails(user) {
  const copyBtn = h(
    "button",
    { type: "button", class: "up-icon-btn", "aria-label": "Copy user ID", title: "Copy user ID" },
    h("i", { class: "fa fa-copy", "aria-hidden": "true" })
  );
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(user.uuid);
      toast.success("User ID copied.");
    } catch {
      toast.error("Couldn't copy — select the ID and copy it instead.");
    }
  });
  const field = (label, ...value) => h("div", {}, h("dt", {}, label), h("dd", {}, ...value));
  document.getElementById("pfDetails").replaceChildren(
    field("Username", user.username || "—"),
    field("Account type", roleLabel(user)),
    field("Email", user.email || "—"),
    // No role (dentist, technician, …) is stored for users yet.
    field("Role", "—"),
    field("User ID", h("span", { class: "up-mono" }, user.uuid), copyBtn),
    field("Time zone", timeZoneText())
  );
}

function renderCollaborators() {
  const people = getCollaborators();
  setText("pfCollabCount", people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}` : "");
  const list = document.getElementById("pfCollaborators");
  if (!people.length) {
    list.replaceChildren(h("li", { class: "up-empty" }, "No collaborators yet. People you share cases with appear here."));
    return 0;
  }
  list.replaceChildren(
    ...people.slice(0, 6).map((p) =>
      h(
        "li",
        { class: "up-person" },
        h("span", { class: "up-initials-md", "aria-hidden": "true" }, initialsFor(p.name)),
        h(
          "span",
          { class: "up-person-text" },
          h("span", { class: "up-person-name" }, p.name),
          h("span", { class: "up-person-meta" }, plural(p.shared, "shared case"))
        )
      )
    )
  );
  return people.length;
}

function renderCases(user, collaborators, cases, { stale, pending }) {
  const stats = caseStats(cases, user.username);
  setText(
    "pfSummary",
    [roleLabel(user), user.email, plural(stats.total, "case"), plural(collaborators, "collaborator")].filter(Boolean).join(" · ")
  );
  // Status-based counts are only final once every case has its details.
  setText("pf2dDesigns", pending ? "…" : String(stats.designs2d));
  setText("pf3dDesigns", pending ? "…" : String(stats.designs3d));
  setText("pfTotal", plural(stats.total, "case"));
  renderStageMeters(document.getElementById("pfStageMeters"), stats);

  const unset = stats.unset - pending;
  const notes = ["Needs action is part of Preparation."];
  if (unset > 0) notes.push(`${plural(unset, "case")} ${unset === 1 ? "has" : "have"} no status yet.`);
  if (pending) notes.push(`Loading details for ${plural(pending, "case")}…`);
  if (stale) notes.push("Couldn't reach the server — showing your last saved case list.");
  setText("pfCaseNote", notes.join(" "));
  markUpdated();
}

async function init(user) {
  setupPageChrome(user);
  setText("pfInitials", userInitials(user));
  setText("pfName", user.username || "—");
  renderDetails(user);
  const collaborators = renderCollaborators();

  const { cases } = await loadMyCases({
    onUpdate: (list, state) => renderCases(user, collaborators, list, state),
  });

  const activity = document.getElementById("pfActivity");
  try {
    renderActivity(activity, await fetchMyAlerts(cases), cases);
  } catch (err) {
    console.warn("[profile] notifications unavailable", err);
    activity.replaceChildren(h("li", { class: "up-empty" }, "Notifications couldn't load right now."));
  }
}

const user = requireUser();
if (user) init(user);
