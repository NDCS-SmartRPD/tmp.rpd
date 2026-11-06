import fs from "node:fs";

const viewer = fs.readFileSync("src/viewer3d/index.js", "utf8");
const controls = fs.readFileSync("src/viewer3d/newControls.js", "utf8");
const viewerPage = fs.readFileSync("src/pages/ThreeDViewer.html", "utf8");

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
    expect(slotRenderer).toContain("slotMaterial.vertexColors = false");
    expect(viewer.match(/await addDesignSlotMesh\(/g)).toHaveLength(2);
  });

  test("downloads original Extra 3D slot files and canonical JPG companions as one ZIP", () => {
    expect(viewerPage).toContain("vendor/jszip/jszip.min.js");
    expect(viewer).toContain("canonical3ShapeCompanion");
    expect(viewer).toContain('zip.file(`slot_${slot}/${safeName}`');
    expect(viewer).toContain('zip.file(`slot_${slot}/${companion.name}`');
    expect(viewer).toContain('id = "toolbar-extra-3d-download-button"');
    expect(controls).toContain('!group.key?.startsWith("design-slot-")');
  });
});
