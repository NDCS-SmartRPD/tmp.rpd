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
