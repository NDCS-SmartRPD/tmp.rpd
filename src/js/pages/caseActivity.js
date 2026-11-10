import { apiPost, getLoggedInUser } from "../shared/api.js";
import { lol } from "../shared/crypt.js";

async function openActivity(trigger) {
  const encryptedId = new URLSearchParams(location.search).get("id");
  const caseIntID = Number(window.selectedCaseId || (encryptedId && lol(encryptedId)));
  if (!Number.isSafeInteger(caseIntID) || caseIntID < 1 || !getLoggedInUser()?.uuid) return;

  const dialog = document.createElement("dialog");
  dialog.className = "case-activity";
  dialog.style.cssText = "width:min(40rem,calc(100% - 2rem));max-height:80vh;padding:1.25rem;border:1px solid #8b9aa8;border-radius:.75rem";
  dialog.setAttribute("aria-labelledby", "caseActivityTitle");
  dialog.innerHTML = `
    <form method="dialog"><button aria-label="Close case activity">Close</button></form>
    <h2 id="caseActivityTitle">Case Activity</h2>
    <p role="status"></p>
    <ol></ol>
    <button type="button" hidden>Load older activity</button>`;
  const status = dialog.querySelector("[role=status]");
  const list = dialog.querySelector("ol");
  const more = dialog.querySelector("button[type=button]");
  let before = null;

  async function load() {
    more.disabled = true;
    status.textContent = "Loading activity…";
    try {
      const page = await apiPost("case/activity/get", { caseIntID, before });
      if (!dialog.open) return;
      for (const event of page.events) {
        const entry = document.createElement("li");
        const time = document.createElement("time");
        time.dateTime = event.occurredAt;
        time.textContent = new Date(event.occurredAt).toLocaleString();
        const people = event.involvedUsers.map(({ label, relationship }) => `${relationship}: ${label}`);
        const source = event.source === "browser" ? "Browser reported" : "Server recorded";
        const jaw = { upper: "Upper jaw", lower: "Lower jaw" }[event.jaw];
        const formatVector = vector => `(${vector.map(value => value ?? "unset").join(", ")})`;
        const angle = event.previousVector && event.savedVector
          ? `X/Y/Z ${formatVector(event.previousVector)} → ${formatVector(event.savedVector)}`
          : null;
        const comparison = event.unchanged ? "Saved again without changes" :
          event.unchanged === false && event.action === "Save 2D design" ? "New or changed design" : null;
        entry.textContent = [event.actorLabel, event.action, jaw, event.outcome, source, comparison, angle,
          ...(event.changedFields || []), ...people].filter(Boolean).join(" · ") + " · ";
        entry.style.marginBlock = ".75rem";
        entry.append(time);
        list.append(entry);
      }
      before = page.nextCursor;
      more.textContent = "Load older activity";
      more.hidden = !before;
      status.textContent = list.children.length ? "" : "No activity has been recorded for this case.";
    } catch (error) {
      if (error.status === 403) {
        list.replaceChildren();
        more.hidden = true;
        status.textContent = "You do not have access to this case activity.";
      } else {
        status.textContent = "Case activity could not be loaded.";
        more.textContent = "Try again";
        more.hidden = false;
      }
    } finally {
      more.disabled = false;
    }
  }

  more.addEventListener("click", load);
  dialog.addEventListener("close", () => {
    dialog.remove();
    trigger.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  await load();
}

document.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-case-activity]");
  if (!trigger || document.querySelector("dialog.case-activity[open]")) return;
  void openActivity(trigger);
});
