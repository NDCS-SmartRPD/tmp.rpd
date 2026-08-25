import * as THREE from "three";

const basePath = window.location.hostname.includes("github.io") ? "/.tmp-test-web" : "";
const wireframeOverlays = new Set();

const style = document.createElement("style");
style.textContent = `
  /* Holds the round expand toggle plus one small icon per ACTIVE component —
     the "hidden" state now, replacing what used to be just the bare toggle
     with empty space around it. Hides as one unit while the full panel is
     open (see .hidden below), same corner the panel itself opens from. A
     column of two lines: the toggle on its own, the icon row below (capped,
     so it doesn't sprawl across the canvas) — inactive components have no
     icon here at all, only the toggle re-opens the full list for those. */
  .component-panel-mini {
    position: absolute;
    left: 16px;
    top: 16px;
    z-index: 1003;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    pointer-events: auto;
  }

  .component-panel-mini.hidden {
    display: none;
  }

  .component-panel-mini-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .component-panel-toggle {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    /* A visible chip, not just a bare white-on-transparent icon — the icon is
       white (inverted) so it needs its own backing to read against a light
       canvas, same glass as the panel it opens. */
    background: rgba(56, 58, 64, 0.55);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    backdrop-filter: blur(16px) saturate(140%);
    color: #ffffff;
    font: 700 13px Arial, sans-serif;
    cursor: pointer;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    pointer-events: auto;
    transition: opacity 0.15s, filter 0.15s, transform 0.15s;
  }

  .component-panel-toggle:hover {
    filter: brightness(1.15);
    transform: scale(1.06);
  }

  /* One quick per-component visibility toggle, shown alongside the round
     expand button whenever the full menu is hidden — icon-only (the
     component's own row icon), toggling that component on/off without
     reopening the full list. A component the case doesn't actually have
     (an empty slot, say) gets no icon at all (see .is-absent) — but one
     that exists and is just switched off still gets an icon, dimmed with a
     slash, and clicking it turns it back on right there. */
  .component-mini-eye {
    position: relative;
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 10px;
    background-color: rgba(56, 58, 64, 0.55);
    background-position: center;
    background-repeat: no-repeat;
    background-size: 18px 18px;
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    backdrop-filter: blur(16px) saturate(140%);
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition: opacity 0.15s, filter 0.15s;
  }

  .component-mini-eye:hover {
    filter: brightness(1.15);
  }

  .component-mini-eye.is-absent {
    display: none;
  }

  .component-mini-eye.hidden-state {
    opacity: 0.55;
  }

  .component-mini-eye-slash {
    display: none;
    position: absolute;
    left: 50%;
    top: 50%;
    width: 26px;
    height: 1.5px;
    background: #ef9a9a;
    transform: translate(-50%, -50%) rotate(-38deg);
    border-radius: 999px;
  }

  .component-mini-eye.hidden-state .component-mini-eye-slash {
    display: block;
  }

  .component-panel {
    position: absolute;
    left: 16px;
    top: 16px;
    transform-origin: top left;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    width: min(268px, calc(100vw - 290px));
    max-height: min(300px, calc(100% - 32px));
    overflow: hidden;
    padding: 4px 0 2px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    background: rgba(56, 58, 64, 0.55);
    display: flex;
    flex-direction: column;
    width: min(268px, calc(100vw - 290px));
    max-height: min(300px, calc(100% - 32px));
    overflow: hidden;
    padding: 4px 0 2px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    background: rgba(56, 58, 64, 0.55);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    backdrop-filter: blur(16px) saturate(140%);
    color: #ffffff;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    font-family: "Montserrat", Arial, sans-serif;
    color: #ffffff;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    font-family: "Montserrat", Arial, sans-serif;
    pointer-events: auto;
    opacity: 1;
    transform: scaleY(1);
    transition: opacity 0.16s ease, transform 0.16s ease;
  }

  /* Closes by collapsing upward into the toggle button (anchored at the
     panel's own top-left corner via transform-origin above) at every screen
     size — same behaviour on phone/tablet as desktop now, replacing the old
     "slide the whole panel off to the right" tablet/phone treatment. */
  .component-panel.hidden {
    opacity: 0;
    transform: scaleY(0);
    pointer-events: none;
  }

  /* Invisible full-screen click-catcher behind the open panel, at every screen
     size — lets a tap/click anywhere else on the canvas close the popup, the
     way a dropdown normally would. No dimming: the panel is a small top-left
     popup now, not a sidebar, so darkening the whole canvas behind it would
     read as its own (wrong) UI state. */
  .component-panel-backdrop {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 1001;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: default;
  }

  .component-panel-backdrop:not(.hidden) {
    display: block;
  }

  /* "Show / Hide" bar: a chevron that folds the list away, plus the close X. */
  .component-panel-header {
    flex: 0 0 auto;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 7px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    padding: 6px 10px 7px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  }

  .component-panel-collapse {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    background: transparent;
  .component-panel-collapse {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    transition: transform 0.18s ease;
    transition: transform 0.18s ease;
  }

  .component-panel-collapse::before {
    content: "";
    display: block;
    width: 7px;
    height: 7px;
    margin: 3px auto 0;
    border-left: 2px solid currentColor;
    border-top: 2px solid currentColor;
    transform: rotate(45deg);
  }

  .component-panel.is-collapsed .component-panel-collapse {
    transform: rotate(180deg);
  }

  .component-panel-title {
    flex: 1 1 auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  .component-panel-collapse::before {
    content: "";
    display: block;
    width: 7px;
    height: 7px;
    margin: 3px auto 0;
    border-left: 2px solid currentColor;
    border-top: 2px solid currentColor;
    transform: rotate(45deg);
  }

  .component-panel.is-collapsed .component-panel-collapse {
    transform: rotate(180deg);
  }

  .component-panel-title {
    flex: 1 1 auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .component-panel-close {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.12);
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    border: 0;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  .component-panel-close:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  /* The rotation-lock button (resetButton.js) is moved into this header — see
     createComponentPanel. Its own rules size it for the black toolbar
     (var(--toolbar-btn-size), 46-58px); this overrides that down to match the
     header's other controls. The extra class in the selector outweighs
     resetButton.js's bare #lock-rotation-button on specificity, so this wins
     regardless of which <style> tag landed in <head> first. */
  .component-panel-header #lock-rotation-button {
    order: 0;
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
  }

  .component-panel-header #lock-icon {
    width: 15px;
    height: 15px;
    margin-bottom: 0;
  }

  .component-row.unavailable {
    opacity: 0.45;
    opacity: 0.45;
  }

  .component-row.unavailable button,
  .component-row.unavailable input {
    cursor: not-allowed;
  }

  /* min-height:0 lets a flex child scroll instead of growing past max-height.
     NOT grid: align-content:stretch compresses rows and clips their name band. */
  /* min-height:0 lets a flex child scroll instead of growing past max-height.
     NOT grid: align-content:stretch compresses rows and clips their name band. */
  .component-panel-body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
  }

  .component-panel-body::-webkit-scrollbar {
    width: 6px;
  }

  .component-panel-body::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.3);
  }

  .component-panel.is-collapsed .component-panel-body,
  .component-panel.is-collapsed .component-panel-footer {
    display: none;
  }

  /* One tinted block per object. --row-tint comes from the object's own
     material colour, so a row reads as the thing it drives. */
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.35) transparent;
  }

  .component-panel-body::-webkit-scrollbar {
    width: 6px;
  }

  .component-panel-body::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.3);
  }

  .component-panel.is-collapsed .component-panel-body,
  .component-panel.is-collapsed .component-panel-footer {
    display: none;
  }

  /* One tinted block per object. --row-tint comes from the object's own
     material colour, so a row reads as the thing it drives. */
  .component-row {
    --row-tint: #5f6070;
    flex: 0 0 auto;
    --row-tint: #5f6070;
    flex: 0 0 auto;
    display: grid;
    gap: 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--row-tint);
  }

  .component-row-rail {
    display: flex;
    gap: 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--row-tint);
  }

  .component-row-rail {
    display: flex;
    align-items: center;
    padding: 4px 7px;
    background: rgba(255, 255, 255, 0.18);
    padding: 4px 7px;
    background: rgba(255, 255, 255, 0.18);
  }

  .component-row-band {
  .component-row-band {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    gap: 6px;
    padding: 5px 7px;
  }

  .component-row-icon {
    width: 18px;
    height: 18px;
    width: 18px;
    height: 18px;
    object-fit: contain;
  }

  .component-row-title {
    overflow: hidden;
    color: #ffffff;
    font-size: 11px;
    font-size: 11px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }

  .component-row-buttons {
    display: flex;
    flex-direction: row;
    gap: 4px;
    gap: 4px;
    align-items: center;
  }

  /* Pill rail whose fill is painted by the track background from --fill (set
     on input), so it reads at a glance without a visible thumb. */
  /* Pill rail whose fill is painted by the track background from --fill (set
     on input), so it reads at a glance without a visible thumb. */
  .component-opacity-control {
    -webkit-appearance: none;
    appearance: none;
    -webkit-appearance: none;
    appearance: none;
    min-width: 0;
    width: 100%;
    height: 12px;
    margin: 0;
    padding: 0;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    border-radius: 999px;
    background:
      linear-gradient(#e08a5f, #e08a5f) left center / var(--fill, 100%) 100% no-repeat,
      #2f2f33;
    cursor: pointer;
  }

  .component-opacity-control::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 3px;
    height: 9px;
    border: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
  }

  .component-opacity-control::-moz-range-thumb {
    width: 3px;
    height: 9px;
    border: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
  }

  .component-opacity-control::-moz-range-track {
    background: transparent;
  }

  /* "Hide All" / "Show All" — the list-wide switch, under a divider. */
  .component-panel-footer {
    flex: 0 0 auto;
    padding: 6px 10px 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }

  .component-panel-showhide {
    width: 100%;
    padding: 1px 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .component-panel-showhide:hover {
    text-decoration: underline;
  }

  /* Bare icons on the tinted band — no plate, matching the reference. */
    height: 12px;
    margin: 0;
    padding: 0;
    border: 1.5px solid rgba(0, 0, 0, 0.7);
    border-radius: 999px;
    background:
      linear-gradient(#e08a5f, #e08a5f) left center / var(--fill, 100%) 100% no-repeat,
      #2f2f33;
    cursor: pointer;
  }

  .component-opacity-control::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 3px;
    height: 9px;
    border: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
  }

  .component-opacity-control::-moz-range-thumb {
    width: 3px;
    height: 9px;
    border: 0;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.85);
  }

  .component-opacity-control::-moz-range-track {
    background: transparent;
  }

  /* "Hide All" / "Show All" — the list-wide switch, under a divider. */
  .component-panel-footer {
    flex: 0 0 auto;
    padding: 6px 10px 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }

  .component-panel-showhide {
    width: 100%;
    padding: 1px 0;
    border: 0;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
  }

  .component-panel-showhide:hover {
    text-decoration: underline;
  }

  /* Bare icons on the tinted band — no plate, matching the reference. */
  .component-eye-button,
  .component-analysis-button,
  .component-polyline-button,
  .component-polyline-button,
  .component-web-button {
    position: relative;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    background: transparent;
    background-position: center;
    background-repeat: no-repeat;
    background-size: 16px 16px;
    background-size: 16px 16px;
    color: transparent;
    cursor: pointer;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
  }

  .component-eye-button {
    background-size: 19px 11px;
    background-size: 19px 11px;
  }

  .component-eye-button.hidden-state {
    opacity: 0.75;
    opacity: 0.75;
  }

  .component-eye-button.hidden-state .component-eye-slash {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 17px;
    height: 1.5px;
    width: 17px;
    height: 1.5px;
    background: #ef9a9a;
    transform: translate(-50%, -50%) rotate(-38deg);
    border-radius: 999px;
  }

  .component-analysis-button.active,
  .component-polyline-button.vpm-active {
    background-color: rgba(56, 189, 248, 0.85);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55);
  }

  .component-polyline-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* A slot's first undercut switch waits on the case scan download — pulse until it lands. */
  .component-analysis-button.is-busy {
    opacity: 0.6;
    cursor: progress;
    animation: component-analysis-busy 1s ease-in-out infinite;
  }

  @keyframes component-analysis-busy {
    50% { opacity: 1; }
  .component-analysis-button.active,
  .component-polyline-button.vpm-active {
    background-color: rgba(56, 189, 248, 0.85);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55);
  }

  .component-polyline-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* A slot's first undercut switch waits on the case scan download — pulse until it lands. */
  .component-analysis-button.is-busy {
    opacity: 0.6;
    cursor: progress;
    animation: component-analysis-busy 1s ease-in-out infinite;
  }

  @keyframes component-analysis-busy {
    50% { opacity: 1; }
  }

  .component-web-button::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 16px;
    height: 10px;
    width: 16px;
    height: 10px;
    border: 1.5px solid rgba(255, 255, 255, 0.92);
    border-radius: 999px;
    transform: translate(-50%, -50%);
    box-sizing: border-box;
  }

  .component-web-button::after {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 16px;
    height: 10px;
    width: 16px;
    height: 10px;
    transform: translate(-50%, -50%);
    background:
      linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)) center / 1.2px 10px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)) center / 16px 1.2px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.78)) left 4px top / 16px 1.2px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.78)) left top 3px / 1.2px 10px no-repeat;
      linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)) center / 1.2px 10px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)) center / 16px 1.2px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.78)) left 4px top / 16px 1.2px no-repeat,
      linear-gradient(rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.78)) left top 3px / 1.2px 10px no-repeat;
    opacity: 0.95;
  }

  .component-web-button.active {
    background-color: rgba(0, 0, 0, 0.45);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.45);
    background-color: rgba(0, 0, 0, 0.45);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.45);
  }

  .component-web-button.has-icon {
    background-size: 18px 12px;
    background-size: 18px 12px;
  }

  .component-web-button.has-icon::before,
  .component-web-button.has-icon::after {
    display: none;
  }

  /* Transient explanation for why an undercut toggle didn't turn on (missing
     insertion angle, stale survey, etc.) — otherwise the button just quietly
     reverts with no feedback. Centered at the bottom so it never competes
     with the (left-anchored) legend or (top-left) mini strip/panel. */
  .component-panel-note {
    position: absolute;
    left: 50%;
    bottom: 16px;
    z-index: 1004;
    max-width: min(280px, calc(100vw - 32px));
    padding: 10px 14px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 12px;
    background: rgba(56, 58, 64, 0.92);
    color: #ffffff;
    font: 600 12px "Montserrat", Arial, sans-serif;
    line-height: 1.4;
    text-align: center;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    opacity: 0;
    transform: translate(-50%, 6px);
    transition: opacity 0.18s ease, transform 0.18s ease;
    pointer-events: none;
  }

  .component-panel-note.visible {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  /* Undercut colour key, shown only while an undercut view is on. Palette
     matches preview3D.js's colorForSurveyingValue byte-for-byte. */
  .viewer-undercut-legend {
    position: absolute;
    left: 16px;
    bottom: 16px;
    z-index: 1002;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px 10px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 14px;
    background: rgba(56, 58, 64, 0.55);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    backdrop-filter: blur(16px) saturate(140%);
    color: #ffffff;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34);
    font-family: "Montserrat", Arial, sans-serif;
    pointer-events: none;
  }

  .viewer-undercut-legend.hidden {
    display: none;
  }
  .viewer-undercut-legend.hidden {
    display: none;
  }

  .viewer-undercut-legend-title {
    font-size: 11px;
    font-weight: 700;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }

  .viewer-undercut-legend-scale {
    display: flex;
    gap: 2px;
  }

  .viewer-undercut-legend-scale span {
    width: 30px;
    height: 10px;
    border-radius: 2px;
  }

  .viewer-undercut-legend-labels {
    display: flex;
    gap: 2px;
  }

  .viewer-undercut-legend-labels span {
    width: 30px;
    color: rgba(255, 255, 255, 0.85);
    font-size: 9px;
    text-align: center;
  }

  /* #viewer-right-nav becomes a full-width bottom bar at both breakpoints
     below, so the legend must clear its height rather than sit at bottom:0. */
  @media (min-width: 769px) and (max-width: 1024px) {
    .viewer-undercut-legend {
      bottom: calc(86px + env(safe-area-inset-bottom, 0px));
    }
  }

  @media (max-width: 768px) {
    .viewer-undercut-legend {
      left: 12px;
      bottom: calc(86px + env(safe-area-inset-bottom, 0px));
      padding: 6px 8px 8px;
    }

    .viewer-undercut-legend-scale span,
    .viewer-undercut-legend-labels span {
      width: 24px;
    }
  }

  @media (max-width: 640px), (max-height: 720px) {
    .component-panel-toggle {
      width: 48px;
      height: 48px;
    }

    .component-panel {
      left: 16px;
      top: 16px;
      width: min(260px, calc(100vw - 280px));
      max-height: min(260px, calc(100% - 32px));
    }
  }

  @media (max-width: 1024px) {
    .component-panel {
      left: 16px;
      top: 16px;
      bottom: auto;
      max-width: calc(100vw - 20px);
    }

    .component-panel-body {
      gap: 6px;
      padding: 8px 10px;
    }
  }

  @media (max-width: 768px) {
    .component-panel-toggle {
      width: 56px;
      height: 56px;
    }

    .component-panel {
      top: 16px;
      bottom: auto;
      width: min(300px, calc(100vw - 20px));
      max-height: min(300px, calc(100% - 32px));
    }
  }

  @media (max-width: 768px) {
    .component-panel-mini {
      left: 12px;
      top: 12px;
      gap: 6px;
    }

    .component-panel-mini-icons {
      /* "Try not to take too much screen space, maybe 30% of the mobile top
         left space" — caps the icon row's footprint; it wraps to more rows
         rather than growing wider once it hits this. */
      max-width: 34vw;
      gap: 6px;
    }

    .component-panel-toggle {
      width: 52px;
      height: 52px;
    }

    .component-mini-eye {
      width: 30px;
      height: 30px;
      background-size: 16px 16px;
    }

    .component-panel {
      top: 12px;
      left: 12px;
      bottom: auto;
      width: min(280px, calc(100vw - 24px));
      max-height: min(280px, calc(100% - 24px));
    }
  }

`;
document.head.appendChild(style);

function removeWireframeOverlay(mesh) {
  const overlay = mesh.userData?.componentWireframeOverlay;
  if (!overlay) return;
  mesh.remove(overlay);
  overlay.geometry?.dispose?.();
  overlay.material?.dispose?.();
  wireframeOverlays.delete(overlay);
  delete mesh.userData.componentWireframeOverlay;
}

function clearAllWireframeOverlays() {
  Array.from(wireframeOverlays).forEach((overlay) => {
    const parent = overlay.parent;
    if (parent?.isMesh) {
      removeWireframeOverlay(parent);
    } else {
      overlay.geometry?.dispose?.();
      overlay.material?.dispose?.();
      wireframeOverlays.delete(overlay);
    }
  });
}

function applyWireframeOverlay(mesh) {
  removeWireframeOverlay(mesh);
  if (!mesh.isMesh || !mesh.userData.componentWireframeEnabled) return;

  const geometry = new THREE.WireframeGeometry(mesh.geometry);
  const material = new THREE.LineBasicMaterial({
    color: "#000000",
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const overlay = new THREE.LineSegments(geometry, material);
  overlay.name = `${mesh.name || "mesh"}-wireframe-overlay`;
  overlay.renderOrder = 999;
  overlay.userData.overlayType = "component-wireframe-overlay";
  mesh.add(overlay);
  mesh.userData.componentWireframeOverlay = overlay;
  wireframeOverlays.add(overlay);
}

function refreshWireframeOverlay(mesh) {
  if (mesh.userData?.componentWireframeEnabled) {
    applyWireframeOverlay(mesh);
  }
}

function setMeshGroupVisible(meshes, isVisible) {
  meshes.forEach((mesh) => {
    mesh.visible = isVisible;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      material.transparent = (material.opacity ?? 1) < 1;
      material.depthTest = true;
      material.depthWrite = (material.opacity ?? 1) >= 0.95;
      material.needsUpdate = true;
    });
  });
}

function setMeshGroupOpacity(meshes, opacity) {
  meshes.forEach((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => {
      if (!material) return;
      material.opacity = opacity;
      material.transparent = opacity < 1;
      material.depthWrite = opacity >= 0.95;
      material.needsUpdate = true;
    });
  });
}

function getMeshGroupOpacity(meshes) {
  const firstMaterial = meshes
    .flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]))
    .find(Boolean);
  return firstMaterial?.opacity ?? 1;
}

function areAnyVisible(meshes) {
  return meshes.some((mesh) => mesh.visible);
}

function applyJawMaterial(meshes, materialArray, index) {
  meshes.forEach((mesh) => {
    const meshMaterials = materialArray[mesh.name];
    if (!meshMaterials || !meshMaterials[index]) return;
    mesh.geometry = meshMaterials[index];
    mesh.geometry.needsUpdate = true;
    refreshWireframeOverlay(mesh);
  });
}

// A row is tinted with the colour of the thing it drives. Overlay rows have no
// material to read, so they fall back to a neutral lavender.
const ROW_TINT_FALLBACK = "#5f6070";

function getGroupTint(group) {
  const material = group.meshes
    ?.flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]))
    // A vertexColors material (what the case jaws use) has a white multiplier
    // for its own colour, which would tint the row white and swallow its label.
    .find((entry) => entry?.color && !entry.vertexColors);
  if (!material) return ROW_TINT_FALLBACK;
  // Keep every tint dark enough for white content to read on it.
  const color = material.color.clone();
  const hsl = color.getHSL({ h: 0, s: 0, l: 0 });
  color.setHSL(hsl.h, Math.max(hsl.s, 0.14), Math.min(Math.max(hsl.l, 0.3), 0.46));
  return `#${color.getHexString()}`;
}

// A row is tinted with the colour of the thing it drives. Overlay rows have no
// material to read, so they fall back to a neutral lavender.
const ROW_TINT_FALLBACK = "#5f6070";

function getGroupTint(group) {
  const material = group.meshes
    ?.flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]))
    // A vertexColors material (what the case jaws use) has a white multiplier
    // for its own colour, which would tint the row white and swallow its label.
    .find((entry) => entry?.color && !entry.vertexColors);
  if (!material) return ROW_TINT_FALLBACK;
  // Keep every tint dark enough for white content to read on it.
  const color = material.color.clone();
  const hsl = color.getHSL({ h: 0, s: 0, l: 0 });
  color.setHSL(hsl.h, Math.max(hsl.s, 0.14), Math.min(Math.max(hsl.l, 0.3), 0.46));
  return `#${color.getHexString()}`;
}

function createComponentPanel(groups) {
  removeVisibilityAndTransparencyControls();

  const toggle = document.createElement("button");
  toggle.id = "component-panel-toggle";
  toggle.className = "component-panel-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Show/Hide");
  toggle.title = "Show/Hide";
  toggle.setAttribute("aria-expanded", "false");
  // Eye/visibility icon, not the case's own "Objects" cube — this button's job
  // is showing/hiding components, so it reads as that action at a glance.
  // Persists top-left at every screen size (see the toggle rules above).
  toggle.innerHTML = `<img src="${basePath}/assets/visible.png" alt="Show/Hide" style="width:32px;height:32px;object-fit:contain;display:block;margin:auto;pointer-events:none;filter:brightness(0) invert(1);">`;

  // Holds the toggle plus one mini eye per component — see openPanel/closePanel
  // below, which show/hide this whole thing opposite the full panel.
  const miniWrap = document.createElement("div");
  miniWrap.id = "component-panel-mini";
  miniWrap.className = "component-panel-mini";

  miniWrap.appendChild(toggle);

  // One mini eye per ACTIVE (visible) component goes here — inactive/hidden
  // ones are omitted rather than shown dimmed, so the collapsed strip only
  // ever shows what's actually on screen. Appended as each row is built
  // below; each button's own display is then gated by isVisible in sync().
  const miniIcons = document.createElement("div");
  miniIcons.className = "component-panel-mini-icons";
  miniWrap.appendChild(miniIcons);

  const panel = document.createElement("div");
  panel.id = "component-panel";
  panel.className = "component-panel hidden";

  const header = document.createElement("div");
  header.className = "component-panel-header";

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "component-panel-collapse";
  collapseButton.title = "Collapse";
  collapseButton.setAttribute("aria-label", "Collapse the object list");
  collapseButton.setAttribute("aria-expanded", "true");

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "component-panel-collapse";
  collapseButton.title = "Collapse";
  collapseButton.setAttribute("aria-label", "Collapse the object list");
  collapseButton.setAttribute("aria-expanded", "true");

  const title = document.createElement("button");
  title.type = "button";
  title.className = "component-panel-title";
  title.textContent = "Show / Hide";
  title.title = "Collapse the object list";
  title.textContent = "Show / Hide";
  title.title = "Collapse the object list";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "component-panel-close";
  closeButton.textContent = "\u00d7";
  closeButton.title = "Close objects";
  closeButton.setAttribute("aria-label", "Close objects");

  header.appendChild(collapseButton);
  header.appendChild(collapseButton);
  header.appendChild(title);

  // The rotation-lock button lives in the black mobile/tablet toolbar's own
  // DOM (built once by resetButton.js, whose closure holds the locked/unlocked
  // state) — move that same node in here rather than recreate it, so its click
  // handler and state survive every rebuild of this panel. Sized for the
  // header via the .component-panel-header #lock-rotation-button override
  // above, which beats resetButton.js's own (toolbar) sizing on specificity.
  const lockButton = document.getElementById("lock-rotation-button");
  if (lockButton) header.appendChild(lockButton);

  header.appendChild(closeButton);

  const body = document.createElement("div");
  body.className = "component-panel-body";

  // List-wide switch, below the rows.
  const footer = document.createElement("div");
  footer.className = "component-panel-footer";
  const showHideAllButton = document.createElement("button");
  showHideAllButton.type = "button";
  showHideAllButton.className = "component-panel-showhide";
  footer.appendChild(showHideAllButton);


  // List-wide switch, below the rows.
  const footer = document.createElement("div");
  footer.className = "component-panel-footer";
  const showHideAllButton = document.createElement("button");
  showHideAllButton.type = "button";
  showHideAllButton.className = "component-panel-showhide";
  footer.appendChild(showHideAllButton);

  const rowControllers = [];
  let polylinePanelRegistered = false;
  // Set once the legend is mounted, below — read fresh each sync so the
  // panel-construction order above doesn't matter.
  let undercutLegend = null;
  let componentNote = null;

  const areAllGroupsVisible = () =>
    groups.every((g) => g.hasContent?.() === false || (g.getVisible?.() ?? true));

  const syncShowHideButton = () => {
    const allVisible = areAllGroupsVisible();
    showHideAllButton.textContent = allVisible ? "Hide All" : "Show All";
    showHideAllButton.title = allVisible
      ? "Hide all objects"
      : "Show all available objects";
  };

  // Unavailable rows sink to the bottom, so nobody scrolls past dead rows.
  // Array#sort is stable, so rows sharing a state keep their relative order.
  const reorderRows = () => {
    [...rowControllers]
      .sort((a, b) => Number(b.hasContent()) - Number(a.hasContent()))
      .forEach(({ row }) => body.appendChild(row));
  };

  // The legend is one shared key for the whole panel — it shows once ANY row's
  // undercut view is on, and hides again once none are, rather than per-row.
  const syncUndercutLegend = () => {
    if (!undercutLegend) return;
    const anyUndercutOn = groups.some((group) => group.getMode?.() === "undercut");
    undercutLegend.classList.toggle("hidden", !anyUndercutOn);
  };

  const syncAllRows = () => {
    rowControllers.forEach((controller) => controller.sync());
    reorderRows();
    reorderRows();
    syncShowHideButton();
    syncUndercutLegend();
    syncUndercutLegend();
  };

  showHideAllButton.addEventListener("click", () => {
    const allVisible = areAllGroupsVisible();
  showHideAllButton.addEventListener("click", () => {
    const allVisible = areAllGroupsVisible();
    groups.forEach((group) => {
      if (group.hasContent?.() === false) return;
      group.setVisible?.(!allVisible);
    });
    syncAllRows();
  });

  const toggleCollapsed = () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    collapseButton.title = collapsed ? "Expand" : "Collapse";
  };
  collapseButton.addEventListener("click", toggleCollapsed);
  title.addEventListener("click", toggleCollapsed);

  const toggleCollapsed = () => {
    const collapsed = panel.classList.toggle("is-collapsed");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
    collapseButton.title = collapsed ? "Expand" : "Collapse";
  };
  collapseButton.addEventListener("click", toggleCollapsed);
  title.addEventListener("click", toggleCollapsed);

  groups.forEach((group) => {
    const row = document.createElement("div");
    row.className = "component-row";
    row.style.setProperty("--row-tint", getGroupTint(group));
    row.style.setProperty("--row-tint", getGroupTint(group));

    const band = document.createElement("div");
    band.className = "component-row-band";
    const band = document.createElement("div");
    band.className = "component-row-band";

    if (group.iconPath) {
      const rowIcon = document.createElement("img");
      rowIcon.className = "component-row-icon";
      rowIcon.src = group.iconPath;
      rowIcon.alt = "";
      rowIcon.setAttribute("aria-hidden", "true");
      band.appendChild(rowIcon);
    } else {
      band.appendChild(document.createElement("span"));
      band.appendChild(rowIcon);
    } else {
      band.appendChild(document.createElement("span"));
    }

    const rowTitle = document.createElement("div");
    rowTitle.className = "component-row-title";
    rowTitle.textContent = group.label;
    rowTitle.title = group.label; // labels ellipsize at this width
    band.appendChild(rowTitle);
    rowTitle.title = group.label; // labels ellipsize at this width
    band.appendChild(rowTitle);

    const buttonsRow = document.createElement("div");
    buttonsRow.className = "component-row-buttons";

    const visibilityButton = document.createElement("button");
    visibilityButton.type = "button";
    visibilityButton.className = "component-eye-button";
    visibilityButton.style.backgroundImage = `url(${basePath}/assets/Icon_Show.png)`;
    visibilityButton.title = `Toggle ${group.label} visibility`;
    visibilityButton.setAttribute("aria-label", `Toggle ${group.label} visibility`);

    const visibilitySlash = document.createElement("span");
    visibilitySlash.className = "component-eye-slash";
    visibilityButton.appendChild(visibilitySlash);

    visibilityButton.addEventListener("click", () => {
      group.setVisible?.(!(group.getVisible?.() ?? true));
      syncAllRows();
    });

    buttonsRow.appendChild(visibilityButton);

    // The mini strip's copy of this same toggle — same action, shown instead
    // of the full row whenever the menu is collapsed. Icon-only (the row's
    // own icon), so it still reads as "which component" with no label.
    // Present whenever the component itself is (see .is-absent in sync()
    // below) — a component that's just switched off still gets an icon here,
    // dimmed, and clicking it turns it back on.
    const miniButton = document.createElement("button");
    miniButton.type = "button";
    miniButton.className = "component-mini-eye";
    if (group.iconPath) miniButton.style.backgroundImage = `url(${group.iconPath})`;
    miniButton.title = `Toggle ${group.label} visibility`;
    miniButton.setAttribute("aria-label", `Toggle ${group.label} visibility`);
    const miniSlash = document.createElement("span");
    miniSlash.className = "component-mini-eye-slash";
    miniButton.appendChild(miniSlash);
    miniButton.addEventListener("click", () => {
      group.setVisible?.(!(group.getVisible?.() ?? true));
      syncAllRows();
    });
    miniIcons.appendChild(miniButton);

    let undercutButton = null;
    let occlusionButton = null;
    // Slot rows offer undercut only (borrowed from the case jaw); the case's own jaws
    // offer both analyses.
    if (group.supportsAnalysis || group.supportsUndercut) {
    // Slot rows offer undercut only (borrowed from the case jaw); the case's own jaws
    // offer both analyses.
    if (group.supportsAnalysis || group.supportsUndercut) {
      undercutButton = document.createElement("button");
      undercutButton.type = "button";
      undercutButton.className = "component-analysis-button";
      undercutButton.style.backgroundImage = `url(${basePath}/assets/Undercut.png)`;
      undercutButton.title = `${group.label} undercut`;
      undercutButton.addEventListener("click", () => {
        const next = group.getMode?.() === "undercut" ? "normal" : "undercut";
        // A slot's first switch fetches the case scan, so setMode may be async — mark the
        // button busy until it settles, then resync from whatever mode was really applied.
        const result = group.setMode?.(next);
        if (result && typeof result.then === "function") {
          undercutButton.disabled = true;
          undercutButton.classList.add("is-busy");
          result
            .then((appliedMode) => {
              // Turning ON didn't take — say why, instead of the button just
              // quietly reverting with no explanation.
              if (next === "undercut" && appliedMode !== "undercut") {
                const reason = group.getUndercutUnavailableReason?.();
                componentNote?.show(reason || `Couldn't turn on undercut for ${group.label}.`);
              }
            })
            .catch((error) => console.warn("Undercut switch failed:", error))
            .finally(() => {
              undercutButton.disabled = false;
              undercutButton.classList.remove("is-busy");
              syncAllRows();
            });
        }
        syncAllRows();
      });
    }
    if (group.supportsAnalysis) {
      occlusionButton = document.createElement("button");
      occlusionButton.type = "button";
      occlusionButton.className = "component-analysis-button";
      occlusionButton.style.backgroundImage = `url(${basePath}/assets/Occlusion.png)`;
      occlusionButton.title = `${group.label} occlusion`;
      occlusionButton.addEventListener("click", () => {
        group.setMode?.(group.getMode?.() === "occlusion" ? "normal" : "occlusion");
        syncAllRows();
      });
    }
    }

    if (undercutButton) buttonsRow.appendChild(undercutButton);
    if (occlusionButton) buttonsRow.appendChild(occlusionButton);

    // The polyline rows carry the opener for the polyline panel — it has no
    // button of its own in the nav.
    let polylineButton = null;
    if (group.opensPolylinePanel) {
      polylineButton = document.createElement("button");
      polylineButton.type = "button";
      polylineButton.className = "component-polyline-button";
      polylineButton.style.backgroundImage = `url(${basePath}/assets/Icon_Hide_SkeletalPrev.png)`;
      polylineButton.title = "Polyline components";
      polylineButton.setAttribute("aria-label", "Polyline components");
      polylineButton.addEventListener("click", () => {
        const controller = window.polylinePanelController;
        if (!controller) return;
        if (window.viewerPanelManager) {
          window.viewerPanelManager.toggle("polylines-panel");
          return;
        }
        if (controller.isOpen()) controller.close();
        else controller.open();
      });
      buttonsRow.appendChild(polylineButton);

      // Both jaw rows open the same panel; the first one registered is the
      // button the panel manager highlights.
      const controller = window.polylinePanelController;
      if (controller && !polylinePanelRegistered) {
        polylinePanelRegistered = true;
        window.viewerPanelManager?.register(
          "polylines-panel",
          polylineButton,
          controller.open,
          controller.close
        );
      }
    if (undercutButton) buttonsRow.appendChild(undercutButton);
    if (occlusionButton) buttonsRow.appendChild(occlusionButton);

    // The polyline rows carry the opener for the polyline panel — it has no
    // button of its own in the nav.
    let polylineButton = null;
    if (group.opensPolylinePanel) {
      polylineButton = document.createElement("button");
      polylineButton.type = "button";
      polylineButton.className = "component-polyline-button";
      polylineButton.style.backgroundImage = `url(${basePath}/assets/Icon_Hide_SkeletalPrev.png)`;
      polylineButton.title = "Polyline components";
      polylineButton.setAttribute("aria-label", "Polyline components");
      polylineButton.addEventListener("click", () => {
        const controller = window.polylinePanelController;
        if (!controller) return;
        if (window.viewerPanelManager) {
          window.viewerPanelManager.toggle("polylines-panel");
          return;
        }
        if (controller.isOpen()) controller.close();
        else controller.open();
      });
      buttonsRow.appendChild(polylineButton);

      // Both jaw rows open the same panel; the first one registered is the
      // button the panel manager highlights.
      const controller = window.polylinePanelController;
      if (controller && !polylinePanelRegistered) {
        polylinePanelRegistered = true;
        window.viewerPanelManager?.register(
          "polylines-panel",
          polylineButton,
          controller.open,
          controller.close
        );
      }
    }

    let webButton = null;
    if (group.type === "mesh") {
      webButton = document.createElement("button");
      webButton.type = "button";
      webButton.className = "component-web-button";
      if (group.vertexIconPath) {
        webButton.classList.add("has-icon");
        webButton.style.backgroundImage = `url(${group.vertexIconPath})`;
      }
      webButton.title = `${group.label} vertices`;
      webButton.setAttribute("aria-label", `${group.label} vertices`);
      webButton.addEventListener("click", () => {
        const nextEnabled = !group.meshes?.some((mesh) => mesh.userData.componentWireframeEnabled);
        group.meshes?.forEach((mesh) => {
          mesh.userData.componentWireframeEnabled = nextEnabled;
          if (nextEnabled) applyWireframeOverlay(mesh);
          else removeWireframeOverlay(mesh);
        });
        syncAllRows();
      });
      buttonsRow.appendChild(webButton);
    }

    band.appendChild(buttonsRow);
    band.appendChild(buttonsRow);

    // Opacity rail, above the name band.
    const rail = document.createElement("div");
    rail.className = "component-row-rail";

    // Opacity rail, above the name band.
    const rail = document.createElement("div");
    rail.className = "component-row-rail";

    const opacitySlider = document.createElement("input");
    opacitySlider.type = "range";
    opacitySlider.className = "component-opacity-control";
    opacitySlider.min = "0";
    opacitySlider.max = "100";
    opacitySlider.value = "100";
    opacitySlider.title = `${group.label} opacity`;
    opacitySlider.setAttribute("aria-label", `${group.label} opacity`);
    opacitySlider.setAttribute("aria-label", `${group.label} opacity`);

    opacitySlider.addEventListener("input", () => {
      // Only this row while dragging: syncAllRows() re-appends every row and made
      // the slider stiff. Opacity can't reorder, so the resync waits for drag end.
      // Only this row while dragging: syncAllRows() re-appends every row and made
      // the slider stiff. Opacity can't reorder, so the resync waits for drag end.
      group.setOpacity?.(Number(opacitySlider.value) / 100);
      opacitySlider.style.setProperty("--fill", `${opacitySlider.value}%`);
      rail.dataset.opacity = opacitySlider.value;
    });

    opacitySlider.addEventListener("change", () => {
      opacitySlider.style.setProperty("--fill", `${opacitySlider.value}%`);
      rail.dataset.opacity = opacitySlider.value;
    });

    opacitySlider.addEventListener("change", () => {
      syncAllRows();
    });

    rail.appendChild(opacitySlider);
    rail.appendChild(opacitySlider);

    row.appendChild(rail);
    row.appendChild(band);
    row.appendChild(rail);
    row.appendChild(band);
    body.appendChild(row);

    rowControllers.push({
      row,
      // A component can become available (or not) after the panel was built,
      // so read this fresh on each reorder rather than caching at creation.
      hasContent: () => group.hasContent?.() ?? true,
      row,
      // A component can become available (or not) after the panel was built,
      // so read this fresh on each reorder rather than caching at creation.
      hasContent: () => group.hasContent?.() ?? true,
      sync: () => {
        const hasContent = group.hasContent?.() ?? true;
        const isVisible = hasContent && (group.getVisible?.() ?? true);
        row.classList.toggle("unavailable", !hasContent);
        visibilityButton.classList.toggle("hidden-state", !isVisible);
        visibilityButton.disabled = !hasContent;
        visibilityButton.setAttribute("aria-pressed", String(isVisible));
        visibilityButton.title = hasContent
          ? `${isVisible ? "Hide" : "Show"} ${group.label}`
          : `${group.label} unavailable`;
        // Present whenever the component is (not when it's just switched off
        // — see .is-absent) — dimmed and re-clickable to turn back on.
        miniButton.classList.toggle("is-absent", !hasContent);
        miniButton.classList.toggle("hidden-state", !isVisible);
        miniButton.title = hasContent
          ? `${isVisible ? "Hide" : "Show"} ${group.label}`
          : `${group.label} unavailable`;
        const opacityValue = Math.round((group.getOpacity?.() ?? 1) * 100);
        opacitySlider.value = String(opacityValue);
        opacitySlider.disabled = !hasContent;
        // Paints the filled portion of the rail.
        opacitySlider.style.setProperty("--fill", `${opacityValue}%`);
        rail.dataset.opacity = String(opacityValue);
        if (polylineButton) polylineButton.disabled = !hasContent;
        // Paints the filled portion of the rail.
        opacitySlider.style.setProperty("--fill", `${opacityValue}%`);
        rail.dataset.opacity = String(opacityValue);
        if (polylineButton) polylineButton.disabled = !hasContent;
        const mode = group.getMode?.() || "normal";
        undercutButton?.classList.toggle("active", mode === "undercut");
        occlusionButton?.classList.toggle("active", mode === "occlusion");
        webButton?.classList.toggle(
          "active",
          Boolean(group.meshes?.some((mesh) => mesh.userData.componentWireframeEnabled))
        );
      },
    });
  });

  toggle.addEventListener("click", () => {
    if (window.viewerPanelManager) {
      window.viewerPanelManager.toggle("objects-panel");
    } else {
      openPanel();
      openPanel();
    }
  });

  closeButton.addEventListener("click", () => {
    if (window.viewerPanelManager) {
      window.viewerPanelManager.close("objects-panel");
    } else {
      closePanel();
    }
  });

  // Invisible click-catcher so tapping anywhere else on the canvas closes the
  // panel, same as a dropdown — see the .component-panel-backdrop rule above.
  const backdrop = document.createElement("div");
  backdrop.id = "component-panel-backdrop";
  backdrop.className = "component-panel-backdrop hidden";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.addEventListener("click", () => {
    if (window.viewerPanelManager) window.viewerPanelManager.close("objects-panel");
    else closePanel();
  });

  // The panel takes the mini strip's own corner while open, so only one of
  // the two is ever on screen — the mini strip (toggle + per-component
  // icons) reappears once the panel collapses, instead of the corner going
  // empty the way it used to when only the bare toggle lived there.
  const openPanel = () => {
    panel.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    miniWrap.classList.add("hidden");
    toggle.setAttribute("aria-expanded", "true");
    window.dispatchEvent(new CustomEvent("viewerobjectspanelchange", { detail: { open: true } }));
  };
  const closePanel = () => {
    panel.classList.add("hidden");
    backdrop.classList.add("hidden");
    miniWrap.classList.remove("hidden");
    toggle.setAttribute("aria-expanded", "false");
    window.dispatchEvent(new CustomEvent("viewerobjectspanelchange", { detail: { open: false } }));
  };

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(footer);
  // Objects sits in the canvas's own top-left corner, not in the right nav.
  panel.appendChild(footer);
  // Objects sits in the canvas's own top-left corner, not in the right nav.
  const panelHost =
    document.getElementById("container3D") ||
    window.getViewerRightNav?.()?.parentElement ||
    window.getViewerRightNav?.()?.parentElement ||
    document.body;
  panelHost.appendChild(backdrop);
  panelHost.appendChild(miniWrap);
  panelHost.appendChild(panel);
  // Bottom-left of the same host, so it never fights the (top-left) objects
  // panel or the (right-side) polyline panel for space.
  undercutLegend = createUndercutLegend(panelHost);
  componentNote = createComponentNote(panelHost);
  window.viewerPanelManager?.register("objects-panel", toggle, openPanel, closePanel);
  window.syncComponentPanelRows = syncAllRows;
  syncAllRows();
  syncShowHideButton();

  // Open on load, since the objects list is the viewer's primary control —
  // except on tablet/phone, where the popup would cover meaningful screen
  // real estate every time on a small viewport.
  const opensOnLoad = !window.matchMedia("(max-width: 1024px)").matches;
  if (opensOnLoad) {
    if (window.viewerPanelManager) window.viewerPanelManager.open("objects-panel");
    else openPanel();
  }
}

function removeVisibilityAndTransparencyControls() {
  clearAllWireframeOverlays();
  const panel = document.getElementById("component-panel");
  // The rotation-lock button (built once in resetButton.js, its state living in
  // that closure) is adopted into the panel header below — rescue it before the
  // panel is torn down, or the next rebuild's re-adopt finds nothing in the
  // document to move and the button is gone for the rest of the session.
  const lockButton = document.getElementById("lock-rotation-button");
  if (lockButton && panel?.contains(lockButton)) {
    document.body.appendChild(lockButton);
  }
  document.getElementById("component-panel-backdrop")?.remove();
  panel?.remove();
  // Removes the toggle and every mini per-component eye with it — they're
  // both children of this wrapper.
  document.getElementById("component-panel-mini")?.remove();
  document.getElementById("viewer-undercut-legend")?.remove();
  document.getElementById("component-panel-note")?.remove();
}

// Built once per panel; the undercut button's click handler calls .show()
// when a toggle-on attempt didn't actually turn undercut on, so the user
// gets an explanation instead of the button just quietly reverting.
function createComponentNote(panelHost) {
  const note = document.createElement("div");
  note.id = "component-panel-note";
  note.className = "component-panel-note";
  note.setAttribute("role", "status");
  panelHost.appendChild(note);

  let hideTimer = null;
  return {
    show(message) {
      note.textContent = message;
      note.classList.add("visible");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => note.classList.remove("visible"), 4500);
    },
  };
}

// Undercut colour key, byte-for-byte the same palette as preview3D.js's
// colorForSurveyingValue/undercutBandHex — keep the two in sync.
const UNDERCUT_LEGEND_BANDS = [
  { hex: "#AA0003", label: ">0.75" },
  { hex: "#FE4600", label: "0.5-0.75" },
  { hex: "#FD8C00", label: "0.25-0.5" },
  { hex: "#FFD200", label: "<0.25" },
];

// Built once per panel (case view or design view); syncUndercutLegend below
// shows/hides it depending on whether any row's undercut view is on.
function createUndercutLegend(panelHost) {
  const legend = document.createElement("div");
  legend.id = "viewer-undercut-legend";
  legend.className = "viewer-undercut-legend hidden";

  const title = document.createElement("div");
  title.className = "viewer-undercut-legend-title";
  title.textContent = "Undercut (mm)";
  legend.appendChild(title);

  const scale = document.createElement("div");
  scale.className = "viewer-undercut-legend-scale";
  const labels = document.createElement("div");
  labels.className = "viewer-undercut-legend-labels";
  UNDERCUT_LEGEND_BANDS.forEach(({ hex, label }) => {
    const swatch = document.createElement("span");
    swatch.style.background = hex;
    scale.appendChild(swatch);

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labels.appendChild(labelEl);
  });
  legend.appendChild(scale);
  legend.appendChild(labels);

  panelHost.appendChild(legend);
  return legend;
}

// One row per design slot: icon, "Slot N: <name>", eye toggle and opacity.
// Slots the case has no upload for still get a row, disabled via hasContent.
function buildDesignSlotGroups(designSlots) {
  return designSlots.map((entry) => {
    const meshes = entry.mesh ? [entry.mesh] : [];
    return {
      key: `design-slot-${entry.slot}`,
      label: entry.label,
      type: "overlay",
      iconPath: entry.iconPath,
      meshes,
      supportsAnalysis: false, // uploads carry no occlusion data of their own
      // Read the mode off the mesh, never cached: the panel is rebuilt on every view
      // switch, and a cached mode comes back "normal" over a heatmapped slot.
      supportsUndercut: Boolean(entry.supportsUndercut) && meshes.length > 0,
      getMode: () => (entry.getUndercut?.() ? "undercut" : "normal"),
      // Async: the first switch pulls in the case's scan and heatmaps. Resolves to the mode
      // actually applied, so a slot that can't be matched to the jaw stays plain.
      setMode: async (mode) => {
        if (mode === "occlusion") return "normal";
        const applied = await entry.setUndercut?.(mode === "undercut");
        return applied ? "undercut" : "normal";
      },
      // Why the undercut toggle didn't turn on, when it didn't — shown by the
      // undercut button's click handler below.
      getUndercutUnavailableReason: () => entry.getUndercutUnavailableReason?.() ?? null,
      hasContent: () => meshes.length > 0,
      getVisible: () => areAnyVisible(meshes),
      setVisible: (isVisible) => setMeshGroupVisible(meshes, isVisible),
      getOpacity: () => getMeshGroupOpacity(meshes),
      setOpacity: (opacity) => setMeshGroupOpacity(meshes, opacity),
    };
  });
}

function addVisibilityAndTransparencyControls(
  parentObject,
  name,
  materialArray,
  designSlots = []
) {
  // The design overlay replaces the case's meshes on screen, so the panel
  // lists the slots that are actually visible rather than the hidden jaws.
  if (designSlots.length) {
    createComponentPanel(buildDesignSlotGroups(designSlots));
    return;
  }

  const meshesByJaw = {
    upper: { jaw: [], surface: [] },
    lower: { jaw: [], surface: [] },
  };

  const getJawKey = (child) => {
    const nameText = String(child.name || "").toLowerCase();
    const jawTypeText = String(child.userData?.jaw_type || "").toLowerCase();
    if (nameText.includes("upper") || jawTypeText.includes("upper") || jawTypeText === "2") return "upper";
    if (nameText.includes("lower") || jawTypeText.includes("lower") || jawTypeText === "1") return "lower";
    return null;
  };

  parentObject.children.forEach((child) => {
    if (!child.isMesh) return;
    // Slot STLs stay parked hidden during case view. They carry a jaw_type, so
    // without this the jaw eye toggle would switch them back on over the case mesh.
    if (child.userData?.isDesignSlot) return;
    // Slot STLs stay parked hidden during case view. They carry a jaw_type, so
    // without this the jaw eye toggle would switch them back on over the case mesh.
    if (child.userData?.isDesignSlot) return;
    child.userData.baseGeometry = child.userData.baseGeometry || child.geometry;
    const jawKey = getJawKey(child);
    if (!jawKey) return;
    const bucket = child.name.toLowerCase().includes("surface") ? "surface" : "jaw";
    meshesByJaw[jawKey][bucket].push(child);
  });

  const groups = [];

  ["upper", "lower"].forEach((jawKey) => {
    const jawMeshes = meshesByJaw[jawKey].jaw;
    const surfaceMeshes = meshesByJaw[jawKey].surface;
    if (!jawMeshes.length && !surfaceMeshes.length) return;

    const titlePrefix = jawKey === "upper" ? "Upper" : "Lower";
    let currentMode = "normal";

    groups.push({
      key: `${jawKey}-jaw`,
      label: `${titlePrefix} jaw`,
      type: "mesh",
      iconPath: `${basePath}/assets/Icon_${titlePrefix}Jaw_Occlusal.png`,
      vertexIconPath: `${basePath}/assets/Icon_${jawKey}_jaw_vertice.png`,
      meshes: jawMeshes,
      supportsAnalysis: true,
      getVisible: () => areAnyVisible(jawMeshes),
      setVisible: (isVisible) => {
        setMeshGroupVisible(jawMeshes, isVisible);
        window.syncArtificialTeethToJaw?.();
      },
      getOpacity: () => getMeshGroupOpacity(jawMeshes),
      setOpacity: (opacity) => setMeshGroupOpacity(jawMeshes, opacity),
      getMode: () => currentMode,
      setMode: (mode) => {
        currentMode = mode;
        const indexByMode = { normal: 0, occlusion: 1, undercut: 2 };
        applyJawMaterial(jawMeshes, materialArray, indexByMode[mode] ?? 0);
      },
    });

    groups.push({
      key: `${jawKey}-surface`,
      label: `${titlePrefix} Mesh`,
      type: "mesh",
      iconPath: `${basePath}/assets/Icon_${titlePrefix}Jaw.png`,
      vertexIconPath: `${basePath}/assets/Icon_${jawKey}_mesh.png`,
      meshes: surfaceMeshes,
      supportsAnalysis: false,
      getVisible: () => areAnyVisible(surfaceMeshes),
      setVisible: (isVisible) => {
        setMeshGroupVisible(surfaceMeshes, isVisible);
        window.syncArtificialTeethToJaw?.();
      },
      getOpacity: () => getMeshGroupOpacity(surfaceMeshes),
      setOpacity: (opacity) => setMeshGroupOpacity(surfaceMeshes, opacity),
    });

    groups.push({
      key: `${jawKey}-polyline`,
      label: `${titlePrefix} polylines`,
      type: "overlay",
      iconPath: `${basePath}/assets/Icon_Hide_SkeletalPrev.png`,
      meshes: [],
      supportsAnalysis: false,
      opensPolylinePanel: true,
      opensPolylinePanel: true,
      hasContent: () => window.hasPolylineJawComponents?.(jawKey) ?? false,
      getVisible: () => window.getPolylineJawVisibility?.(jawKey) ?? true,
      setVisible: (isVisible) => window.setPolylineJawVisibility?.(jawKey, isVisible),
      getOpacity: () => window.getPolylineJawOpacity?.(jawKey) ?? 1,
      setOpacity: (opacity) => window.setPolylineJawOpacity?.(jawKey, opacity),
    });

    groups.push({
      key: `${jawKey}-artificial-teeth`,
      label: `${titlePrefix} artificial teeth`,
      type: "overlay",
      iconPath: `${basePath}/assets/Icon_ArtificialTeeth.png`,
      meshes: [],
      supportsAnalysis: false,
      hasContent: () => window.hasArtificialTeethJaw?.(jawKey) ?? false,
      getVisible: () => window.getArtificialTeethJawVisibility?.(jawKey) ?? true,
      setVisible: (isVisible) => window.setArtificialTeethJawVisibility?.(jawKey, isVisible),
      getOpacity: () => window.getArtificialTeethJawOpacity?.(jawKey) ?? 1,
      setOpacity: (opacity) => window.setArtificialTeethJawOpacity?.(jawKey, opacity),
    });
  });

  createComponentPanel(groups);
}

export { addVisibilityAndTransparencyControls, removeVisibilityAndTransparencyControls };
