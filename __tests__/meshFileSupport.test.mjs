import { isSupportedMeshFile, meshFileKind } from "../src/viewer3d/meshFileSupport.js";

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
});
