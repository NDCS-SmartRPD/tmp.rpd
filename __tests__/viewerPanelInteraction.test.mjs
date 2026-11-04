import fs from "node:fs";

const viewer = fs.readFileSync("src/viewer3d/index.js", "utf8");
const controls = fs.readFileSync("src/viewer3d/newControls.js", "utf8");

describe("desktop viewer objects panel interaction", () => {
  test("right-drag closes the panel and still reaches the rotation controls", () => {
    const pointerBinding = viewer.slice(
      viewer.indexOf('domElement.addEventListener("pointerdown"'),
      viewer.indexOf("const releasePointer")
    );
    const backdropStyle = controls.slice(
      controls.indexOf(".component-panel-backdrop {"),
      controls.indexOf(".component-panel-backdrop:not(.hidden)")
    );

    expect(pointerBinding).toContain('event.button !== 2');
    expect(pointerBinding).toContain('viewerPanelManager?.close("objects-panel")');
    expect(pointerBinding).not.toContain("stopPropagation");
    expect(pointerBinding).not.toContain("stopImmediatePropagation");
    expect(backdropStyle).toContain("pointer-events: none");
    expect(viewer).toContain('domElement.addEventListener("click", () => {');
  });

  test("renders canonical 3Shape slot PLY heatmaps like the 2D Extra 3D tab", () => {
    const slotRenderer = viewer.slice(
      viewer.indexOf("async function addDesignSlotMesh"),
      viewer.indexOf("// ---- Undercut heatmap on the uploaded jaw slots")
    );
    expect(viewer).toContain("applyCanonical3ShapeTexture");
    expect(viewer).toContain("classifyPlyHeatmap");
    expect(slotRenderer).toContain('plyFormat === "canonical-3shape"');
    expect(slotRenderer).toContain("await applyCanonical3ShapeTexture(geometry, sourceBytes)");
    expect(slotRenderer).toContain("mesh.userData.undercutGeometry = geometry");
    expect(viewer.match(/await addDesignSlotMesh\(/g)).toHaveLength(2);
  });
});
