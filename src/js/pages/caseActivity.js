import { apiPost, getLoggedInUser } from "../shared/api.js";
import { lol } from "../shared/crypt.js";
import { toast } from "../shared/toast.js";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const outcomes = {
  succeeded: "Succeeded",
  reported: "Reported",
  failed: "Failed",
  unknown: "Unconfirmed",
};

function appendText(parent, tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderEntry(list, event) {
  const entry = appendText(list, "li", "ca-entry", "");
  const main = appendText(entry, "div", "ca-entry-main", "");
  appendText(main, "h3", "ca-action", event.action);
  const jaw = event.jaw === "upper" ? "Upper jaw" : event.jaw === "lower" ? "Lower jaw" : null;
  const source = event.source === "browser" ? "Browser reported" : "Server recorded";
  appendText(main, "p", "ca-meta", [event.actorLabel, jaw, source].filter(Boolean).join(" · "));

  const comparison = event.unchanged ? "Saved again without changes" :
    event.unchanged === false && event.action === "Save 2D design" ? "New or changed design" : null;
  const people = event.involvedUsers.map(({ label, relationship }) => `${relationship}: ${label}`);
  const details = [comparison, ...(event.changedFields || []), ...people].filter(Boolean);
  if (details.length) appendText(main, "p", "ca-details", details.join(" · "));
  if (event.previousVector && event.savedVector) {
    const vector = values => `(${values.map(value => value ?? "unset").join(", ")})`;
    appendText(main, "p", "ca-vector", `X/Y/Z ${vector(event.previousVector)} → ${vector(event.savedVector)}`);
  }

  const summary = appendText(entry, "div", "ca-entry-summary", "");
  const badge = appendText(summary, "span", "ca-badge", outcomes[event.outcome] || "Unconfirmed");
  badge.dataset.outcome = event.outcome;
  const date = new Date(event.occurredAt);
  if (Number.isFinite(date.getTime())) {
    const time = appendText(summary, "time", "ca-time", dateTime.format(date));
    time.dateTime = event.occurredAt;
  }
}

async function openActivity(trigger) {
  const encryptedId = new URLSearchParams(location.search).get("id");
  const caseIntID = Number(window.selectedCaseId || (encryptedId && lol(encryptedId)));
  if (!Number.isSafeInteger(caseIntID) || caseIntID < 1) {
    toast.warning("Please select a case first.");
    return;
  }
  if (!getLoggedInUser()?.uuid) {
    toast.warning("Sign in to view case activity.");
    return;
  }

  const dialog = document.createElement("dialog");
  dialog.className = "case-activity";
  dialog.setAttribute("aria-labelledby", "caseActivityTitle");
  dialog.setAttribute("aria-describedby", "caseActivityDescription");
  dialog.innerHTML = `
    <header class="ca-header">
      <span class="ca-header-icon" aria-hidden="true"><i class="fa fa-list"></i></span>
      <div>
        <p class="ca-case">Case #${caseIntID}</p>
        <h2 id="caseActivityTitle">Case Activity</h2>
        <p id="caseActivityDescription">Case actions, most recent first</p>
      </div>
      <form method="dialog">
        <button class="ca-close" aria-label="Close case activity" autofocus>×</button>
      </form>
    </header>
    <div class="ca-body">
      <ol class="ca-list" role="list" aria-label="Activity entries"></ol>
      <p class="ca-status" role="status" hidden></p>
      <button class="ca-more" type="button" hidden>Load older activity</button>
    </div>`;
  const status = dialog.querySelector("[role=status]");
  const list = dialog.querySelector("ol");
  const more = dialog.querySelector("button[type=button]");
  let before = null;

  function showStatus(message) {
    status.hidden = !message;
    status.textContent = message;
  }

  async function load() {
    const moveFocus = document.activeElement === more;
    const firstNewIndex = list.children.length;
    more.disabled = true;
    showStatus("Loading activity…");
    try {
      const page = await apiPost("case/activity/get", { caseIntID, before });
      if (!dialog.open) return;
      for (const event of page.events) renderEntry(list, event);
      before = page.nextCursor;
      more.textContent = "Load older activity";
      more.hidden = !before;
      showStatus(list.children.length ? "" : "No activity has been recorded for this case.");
      const firstNewEntry = list.children[firstNewIndex];
      if (moveFocus && firstNewEntry) {
        firstNewEntry.tabIndex = -1;
        firstNewEntry.focus();
      } else if (moveFocus && more.hidden) {
        dialog.querySelector(".ca-close").focus();
      }
    } catch (error) {
      if (error.status === 403) {
        list.replaceChildren();
        more.hidden = true;
        showStatus("You do not have access to this case activity.");
        if (moveFocus) dialog.querySelector(".ca-close").focus();
      } else {
        showStatus("Case activity could not be loaded.");
        more.textContent = "Try again";
        more.hidden = false;
      }
    } finally {
      more.disabled = false;
    }
  }

  more.addEventListener("click", load);
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    const fallback = trigger.closest("#caseDropdown") ? ".dropdown-toggle" : "#footerMenuBtn";
    (trigger.getClientRects().length ? trigger : document.querySelector(fallback))?.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  await load();
}

document.querySelectorAll("[data-case-activity]").forEach(trigger => {
  trigger.addEventListener("click", () => {
    if (!document.querySelector("dialog.case-activity[open]")) void openActivity(trigger);
  });
});
