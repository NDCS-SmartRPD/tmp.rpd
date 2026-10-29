export const meshFileKind = (filename) => {
  const match = String(filename || "").match(/\.(stl|ply)$/i);
  return match ? match[1].toLowerCase() : null;
};

export const isSupportedMeshFile = (filename) => meshFileKind(filename) !== null;

export const binaryStringToArrayBuffer = (value) => {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i);
  return bytes.buffer;
};

export const geometryToBinaryStl = (geometry) => {
  const position = geometry?.attributes?.position;
  const index = geometry?.index;
  if (!position?.count) throw new Error("Mesh does not contain vertices.");
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  if (!triangleCount) throw new Error("Mesh does not contain triangles.");

  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  const vertex = (offset) => {
    const i = index ? index.getX(offset) : offset;
    return [position.getX(i), position.getY(i), position.getZ(i)];
  };
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = vertex(triangle * 3);
    const b = vertex(triangle * 3 + 1);
    const c = vertex(triangle * 3 + 2);
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const value of [nx, ny, nz, ...a, ...b, ...c]) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return buffer;
};

// Jaw API and DLL endpoints consume STL records. PLY is accepted at the UI boundary,
// then normalized once so every downstream survey/occlusion path keeps its existing contract.
export async function normalizeJawMeshFile(file, PLYLoader) {
  const kind = meshFileKind(file?.name);
  if (kind === "stl") return file;
  if (kind !== "ply") throw new Error("Only .stl and .ply files are supported.");
  if (!PLYLoader) throw new Error("PLY loader is unavailable.");

  const geometry = new PLYLoader().parse(await file.arrayBuffer());
  try {
    const bytes = geometryToBinaryStl(geometry);
    const filename = file.name.replace(/\.ply$/i, ".stl");
    return new File([bytes], filename, { type: "model/stl" });
  } finally {
    geometry?.dispose?.();
  }
}
