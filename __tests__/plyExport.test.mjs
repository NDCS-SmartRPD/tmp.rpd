import { meshGroupToPly } from "../src/viewer3d/plyExport.js";

const attribute = (values, itemSize) => ({ array: new Float32Array(values), count: values.length / itemSize, itemSize });

function mesh({ color, index, matrixWorld } = {}) {
  return {
    isMesh: true,
    geometry: {
      attributes: {
        position: attribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
        ...(color ? { color: attribute(color, 3) } : {}),
      },
      index: index ? { array: new Uint16Array(index), count: index.length } : null,
    },
    matrixWorld: { elements: matrixWorld || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    updateWorldMatrix() {},
  };
}

const text = (bytes) => new TextDecoder().decode(bytes);

describe("meshGroupToPly", () => {
  test("exports indexed triangles and applies the rendered world transform", () => {
    const bytes = meshGroupToPly([
      mesh({ index: [0, 1, 2], matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1] }),
    ]);
    const ply = text(bytes);

    expect(ply).toContain("element vertex 3");
    expect(ply).toContain("element face 1");
    expect(ply).toContain("10 20 30");
    expect(ply).toContain("3 0 1 2");
  });

  test("writes undercut vertex colours as standard PLY RGB bytes", () => {
    const bytes = meshGroupToPly([
      mesh({ color: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
    ]);
    const ply = text(bytes);

    expect(ply).toContain("property uchar red");
    expect(ply).toContain("255 0 0");
    expect(ply).toContain("0 255 0");
    expect(ply).toContain("0 0 255");
  });

  test("converts three.js linear heatmap colours back to display RGB", () => {
    const bytes = meshGroupToPly([
      mesh({ color: [0.21404114, 0.21404114, 0.21404114, 1, 0, 0, 0, 1, 0] }),
    ]);

    expect(text(bytes)).toContain("128 128 128");
  });

  test("combines multiple rendered meshes with valid face offsets", () => {
    const bytes = meshGroupToPly([mesh(), mesh()]);
    const ply = text(bytes);

    expect(ply).toContain("element vertex 6");
    expect(ply).toContain("element face 2");
    expect(ply).toContain("3 3 4 5");
  });
});
