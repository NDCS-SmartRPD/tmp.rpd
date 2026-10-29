import {
  isSupportedMeshFile,
  meshFileKind,
  normalizeJawMeshFile,
} from "../src/viewer3d/meshFileSupport.js";

describe("extra-slot mesh file support", () => {
  test.each([
    ["upper.stl", "stl"],
    ["upper.STL", "stl"],
    ["surveyed jaw.ply", "ply"],
    ["surveyed jaw.PLY", "ply"],
  ])("accepts %s", (filename, kind) => {
    expect(isSupportedMeshFile(filename)).toBe(true);
    expect(meshFileKind(filename)).toBe(kind);
  });

  test.each(["jaw.obj", "jaw.off", "jaw.ply.exe", ""])("rejects %s", (filename) => {
    expect(isSupportedMeshFile(filename)).toBe(false);
    expect(meshFileKind(filename)).toBe(null);
  });

  test("converts a PLY jaw into the binary STL contract used by the DLL", async () => {
    const position = {
      count: 3,
      getX: (i) => [0, 1, 0][i],
      getY: (i) => [0, 0, 1][i],
      getZ: () => 0,
    };
    const geometry = {
      attributes: { position },
      index: null,
      dispose: jest.fn(),
    };
    class FakePlyLoader {
      parse() { return geometry; }
    }
    const source = new File(["ply-data"], "upper.PLY");

    const result = await normalizeJawMeshFile(source, FakePlyLoader);

    expect(result.name).toBe("upper.stl");
    expect(result.size).toBe(134);
    const bytes = await result.arrayBuffer();
    expect(new DataView(bytes).getUint32(80, true)).toBe(1);
    expect(geometry.dispose).toHaveBeenCalled();
  });
});
