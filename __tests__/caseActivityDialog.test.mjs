/** @jest-environment jsdom */

import { jest } from "@jest/globals";

test("opens the selected case from a menu that stops click propagation", async () => {
  document.body.innerHTML = `
    <div id="caseDropdown"><button data-case-activity><span>Case Activity</span></button></div>`;
  document.getElementById("caseDropdown").addEventListener("click", event => event.stopPropagation());
  window.selectedCaseId = 42;
  localStorage.setItem("loggedInUser", JSON.stringify({ uuid: "user" }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ events: [], nextCursor: null }),
  });

  await import("../src/js/pages/caseActivity.js");
  document.querySelector("[data-case-activity] span").click();

  expect(document.querySelector("dialog").open).toBe(true);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)[1]).toEqual({ caseIntID: 42, before: null });
});
