/** @jest-environment jsdom */
import { readShareToken, clearShareToken } from "../src/js/shared/shareSession.js";

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, "", "/src/pages/ThreeDViewer.html?id=case#share=token_123");
});

test("captures a fragment token and removes it from the address bar", () => {
  expect(readShareToken()).toBe("token_123");
  expect(window.location.hash).toBe("");
  expect(readShareToken()).toBe("token_123");
});

test("does not reuse a case token for another viewer URL", () => {
  readShareToken();
  history.replaceState(null, "", "/src/pages/ThreeDViewer.html?id=other");
  expect(readShareToken()).toBeNull();
});

test("clears the token", () => {
  readShareToken();
  clearShareToken();
  expect(readShareToken()).toBeNull();
});
