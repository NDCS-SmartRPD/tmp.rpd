const TOOTH_COLOR = [208 / 255, 190 / 255, 141 / 255];

const linearToSrgbByte = (value) => Math.round(255 * Math.max(0, Math.min(1,
  value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055
)));

export function heatmapPlyFilename(filename, fallback = "jaw") {
  const leaf = String(filename || "").split(/[\\/]/).pop().trim();
  const safe = leaf.replace(/[<>:"|?*]+/g, "_");
  const stem = safe.replace(/\.[^.]+$/, "") || fallback;
  return `${stem}.ply`;
}

function surveyColor(value) {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return TOOTH_COLOR.map(linearToSrgbByte);
  if (v < 0.25) return [255, 210, 0];
  if (v < 0.5) return [253, 140, 0];
  if (v < 0.75) return [254, 70, 0];
  return [170, 0, 3];
}

export function savedSurveyDirection(caseData, jaw) {
  const prefix = jaw === "upper" ? "upper" : "lower";
  const values = ["x", "y", "z"].map((axis) =>
    Number(caseData?.[`${prefix}_insertion_angle_${axis}`])
  );
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [rawX, rawY, rawZ] = values;
  const [x, y, z] = jaw === "upper"
    ? [-rawX, -rawY, rawZ]
    : [rawX, rawY, -rawZ];
  const length = Math.hypot(x, y, z);
  if (length < 1e-4) return null;
  return [x, y, z].map((value) => Number((value / length).toFixed(8)));
}

function surveyingValues(response) {
  if (response?.surveying_values_base64) {
    const binary = atob(response.surveying_values_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  if (Array.isArray(response?.surveying_values)) return response.surveying_values;
  if (Array.isArray(response?.surveying_values_preview)) return response.surveying_values_preview;
  return [];
}

function parseOff(bytes) {
  const lines = new TextDecoder().decode(bytes)
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  if (lines[0]?.toUpperCase() !== "OFF") return null;
  const [vertexCount, faceCount] = lines[1].split(/\s+/).map(Number);
  const positions = [];
  for (let i = 0; i < vertexCount; i += 1) {
    positions.push(...lines[i + 2].split(/\s+/).slice(0, 3).map(Number));
  }
  const indices = [];
  for (let i = 0; i < faceCount; i += 1) {
    const face = lines[i + 2 + vertexCount].split(/\s+/).map(Number);
    for (let corner = 2; corner < face[0]; corner += 1) {
      indices.push(face[1], face[corner], face[corner + 1]);
    }
  }
  return { positions, indices };
}

function stlTrianglePositions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  if (84 + triangleCount * 50 === bytes.length) {
    const positions = [];
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      let offset = 84 + triangle * 50 + 12;
      for (let corner = 0; corner < 3; corner += 1) {
        positions.push(
          view.getFloat32(offset, true),
          view.getFloat32(offset + 4, true),
          view.getFloat32(offset + 8, true)
        );
        offset += 12;
      }
    }
    return positions;
  }
  const positions = [];
  for (const match of new TextDecoder().decode(bytes).matchAll(
    /vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi
  )) positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
  return positions;
}

function uniqueCount(positions, threshold) {
  const keys = new Set();
  for (let i = 0; i < positions.length; i += 3) {
    keys.add(`${Math.round(positions[i] / threshold)},${Math.round(positions[i + 1] / threshold)},${Math.round(positions[i + 2] / threshold)}`);
  }
  return keys.size;
}

function dedupeStl(positions, targetCount) {
  const outputThreshold = 1e-4;
  let backendThreshold = outputThreshold;
  if (targetCount && uniqueCount(positions, backendThreshold) !== targetCount) {
    let low = 1e-6;
    let high = 1e-1;
    let bestDifference = Infinity;
    for (let i = 0; i < 24; i += 1) {
      const candidate = Math.sqrt(low * high);
      const count = uniqueCount(positions, candidate);
      const difference = Math.abs(count - targetCount);
      if (difference < bestDifference) {
        backendThreshold = candidate;
        bestDifference = difference;
      }
      if (count > targetCount) low = candidate;
      else high = candidate;
    }
  }

  const vertices = [];
  const indices = [];
  const colorIndices = [];
  const outputVertices = new Map();
  const backendVertices = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const outputKey = `${Math.round(positions[i] / outputThreshold)},${Math.round(positions[i + 1] / outputThreshold)},${Math.round(positions[i + 2] / outputThreshold)}`;
    const backendKey = `${Math.round(positions[i] / backendThreshold)},${Math.round(positions[i + 1] / backendThreshold)},${Math.round(positions[i + 2] / backendThreshold)}`;
    let backendIndex = backendVertices.get(backendKey);
    if (backendIndex === undefined) {
      backendIndex = backendVertices.size;
      backendVertices.set(backendKey, backendIndex);
    }
    let index = outputVertices.get(outputKey);
    if (index === undefined) {
      index = vertices.length / 3;
      outputVertices.set(outputKey, index);
      vertices.push(positions[i], positions[i + 1], positions[i + 2]);
      colorIndices.push(backendIndex);
    }
    indices.push(index);
  }
  return { positions: vertices, indices, colorIndices };
}

function encodePly({ positions, indices, colorIndices }, values) {
  const vertexCount = positions.length / 3;
  const faceCount = Math.floor(indices.length / 3);
  const header = new TextEncoder().encode([
    "ply",
    "format binary_little_endian 1.0",
    "comment Generated by SmartRPD",
    `element vertex ${vertexCount}`,
    "property float x",
    "property float y",
    "property float z",
    "property uchar red",
    "property uchar green",
    "property uchar blue",
    `element face ${faceCount}`,
    "property list uchar int vertex_indices",
    "end_header",
    "",
  ].join("\n"));
  const output = new Uint8Array(header.length + vertexCount * 15 + faceCount * 13);
  output.set(header);
  const view = new DataView(output.buffer);
  let offset = header.length;
  for (let i = 0; i < vertexCount; i += 1) {
    view.setFloat32(offset, positions[i * 3], true);
    view.setFloat32(offset + 4, positions[i * 3 + 1], true);
    view.setFloat32(offset + 8, positions[i * 3 + 2], true);
    const color = surveyColor(values[colorIndices?.[i] ?? i]);
    output.set(color, offset + 12);
    offset += 15;
  }
  for (let i = 0; i < faceCount; i += 1) {
    output[offset] = 3;
    for (let corner = 0; corner < 3; corner += 1) {
      view.setInt32(offset + 1 + corner * 4, indices[i * 3 + corner], true);
    }
    offset += 13;
  }
  return output;
}

export function buildSurveyHeatmapPly(meshBytes, response) {
  const values = surveyingValues(response);
  if (!values.length) throw new Error("DLL response did not include surveying values");
  const off = meshBytes[0] === 0x4f && meshBytes[1] === 0x46 && meshBytes[2] === 0x46
    ? parseOff(meshBytes)
    : null;
  const mesh = off || dedupeStl(stlTrianglePositions(meshBytes), values.length);
  if (!mesh.positions.length || !mesh.indices.length) throw new Error("Jaw mesh could not be parsed");
  return encodePly(mesh, values);
}
