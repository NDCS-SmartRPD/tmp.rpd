import * as THREE from "three";
import {
  applyTextureToGeometry,
  prepareMeshUpload,
} from "../src/viewer3d/plyTextureBake.js";

describe("applyTextureToGeometry", () => {
  test("samples flipped face UVs into linear vertex colours", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
      0, 1, 1, 1, 0, 0,
    ], 2));

    applyTextureToGeometry(geometry, new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]), 2, 2);

    const color = geometry.getAttribute("color");
    expect(Array.from(color.array)).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);
  });

  test("rejects a PLY geometry without per-corner texture coordinates", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    expect(() => applyTextureToGeometry(geometry, new Uint8ClampedArray(4), 1, 1))
      .toThrow("texture coordinates");
  });

  test("bakes the built-in 3Shape palette without a companion JPG", async () => {
    const ply = [
      "ply", "format ascii 1.0", "comment TextureFile scan.jpg", "comment provider 3Shape",
      "element vertex 3", "property float x", "property float y", "property float z",
      "element face 1", "property list uchar int vertex_indices",
      "property list uchar float texcoord", "end_header",
      "0 0 0", "1 0 0", "0 1 0", "3 0 1 2 6 0 1 1 1 0 0", "",
    ].join("\n");
    const bytes = new TextEncoder().encode(ply);
    const plyFile = { name: "scan.ply", arrayBuffer: async () => bytes.buffer };
    global.createImageBitmap = jest.fn(async () => ({ width: 1, height: 1, close() {} }));
    const context = {
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([255, 210, 0, 255]) }),
    };
    global.document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    };
    global.File = class {
      constructor(parts, name, options) {
        this.parts = parts;
        this.name = name;
        this.type = options.type;
      }
    };

    class FakePlyLoader {
      parse() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute([
          0, 0, 0, 1, 0, 0, 0, 1, 0,
        ], 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
          0, 1, 1, 1, 0, 0,
        ], 2));
        return geometry;
      }
    }
    const result = await prepareMeshUpload([plyFile], FakePlyLoader);

    expect(result.baked).toBe(true);
    expect(result.file.name).toBe("scan.ply");
    const output = new TextDecoder().decode(result.file.parts[0]);
    expect(output).toContain("property uchar red");
    expect(output).not.toContain("TextureFile");
  });
});
