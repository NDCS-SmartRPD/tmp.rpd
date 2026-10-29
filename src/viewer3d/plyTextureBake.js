import * as THREE from "three";
import { meshGroupToPly } from "./plyExport.js";
import { isSupportedMeshFile, meshFileKind } from "./meshFileSupport.js";

const srgbToLinear = (value) => value <= 0.04045
  ? value / 12.92
  : Math.pow((value + 0.055) / 1.055, 2.4);

export function applyTextureToGeometry(geometry, pixels, width, height) {
  const uv = geometry.getAttribute("uv");
  if (!uv || uv.count !== geometry.getAttribute("position")?.count) {
    throw new Error("PLY does not contain per-face texture coordinates.");
  }

  const colors = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i += 1) {
    const x = Math.max(0, Math.min(width - 1, uv.getX(i) * (width - 1)));
    const y = Math.max(0, Math.min(height - 1, (1 - uv.getY(i)) * (height - 1)));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = x - x0;
    const ty = y - y0;
    for (let channel = 0; channel < 3; channel += 1) {
      const at = (px, py) => pixels[(py * width + px) * 4 + channel];
      const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
      const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
      colors[i * 3 + channel] = srgbToLinear((top * (1 - ty) + bottom * ty) / 255);
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const textureNameFromPly = (bytes) => {
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, Math.min(bytes.length, 16384)));
  return header.match(/^comment\s+TextureFile\s+(.+)$/mi)?.[1]?.trim() || "";
};

const imagePixels = async (file) => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
  };
};

export async function prepareMeshUpload(files, PLYLoader) {
  const selected = Array.from(files || []);
  const meshFile = selected.find((file) => isSupportedMeshFile(file.name));
  if (!meshFile) return { file: null, baked: false, textureMissing: false };
  if (meshFileKind(meshFile.name) !== "ply") {
    return { file: meshFile, baked: false, textureMissing: false };
  }

  const bytes = new Uint8Array(await meshFile.arrayBuffer());
  const geometry = new PLYLoader().parse(bytes.buffer);
  if (geometry.getAttribute("color")) {
    geometry.dispose();
    return { file: meshFile, baked: false, textureMissing: false };
  }

  const textureName = textureNameFromPly(bytes);
  const texture = selected.find((file) => file.name.toLowerCase() === textureName.toLowerCase());
  if (!texture) {
    geometry.dispose();
    return { file: meshFile, baked: false, textureMissing: Boolean(textureName) };
  }

  const image = await imagePixels(texture);
  applyTextureToGeometry(geometry, image.pixels, image.width, image.height);
  const mesh = new THREE.Mesh(geometry);
  const bakedBytes = meshGroupToPly([mesh]);
  geometry.dispose();
  return {
    file: new File([bakedBytes], meshFile.name, { type: "application/octet-stream" }),
    baked: true,
    textureMissing: false,
  };
}
