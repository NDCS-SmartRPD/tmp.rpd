import * as THREE from "three";
import { MACHINE_ID } from "../js/shared/api.js";

const ARTIFICIAL_TOOTH_ENDPOINTS = [
  "/toothPlacementData/get",
];

function getLoggedInUuid() {
  try {
    const user = JSON.parse(localStorage.getItem("loggedInUser") || "null");
    return user?.uuid || "";
  } catch {
    return "";
  }
}

function createAuthData(caseIntID) {
  return {
    machine_id: MACHINE_ID,
    uuid: getLoggedInUuid(),
    caseIntID,
  };
}

// [Decoder 1] Decode raw MessagePack bytes/base64 from ToothPlacementData.data.
const messagePackTextDecoder = new TextDecoder("utf-8");

export function toUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(Number(entry)))) {
    return new Uint8Array(value.map(Number));
  }
  if (typeof value === "string") {
    const text = value.trim();
    const base64Text = text.includes(",") ? text.split(",").pop() : text;
    try {
      const binary = atob(base64Text);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    } catch {
      return new TextEncoder().encode(text);
    }
  }
  return null;
}

export function decodeMessagePack(value) {
  const bytes = toUint8Array(value);
  if (!bytes?.length) return null;

  let offset = 0;
  const ensure = (length) => {
    if (offset + length > bytes.length) {
      throw new Error("MessagePack payload ended unexpectedly.");
    }
  };
  const readU8 = () => {
    ensure(1);
    return bytes[offset++];
  };
  const read = (length) => {
    ensure(length);
    const slice = bytes.slice(offset, offset + length);
    offset += length;
    return slice;
  };
  const readU16 = () => {
    const data = read(2);
    return (data[0] << 8) | data[1];
  };
  const readU32 = () => {
    const data = read(4);
    return data[0] * 0x1000000 + ((data[1] << 16) | (data[2] << 8) | data[3]);
  };
  const readI8 = () => {
    const parsed = readU8();
    return parsed > 0x7f ? parsed - 0x100 : parsed;
  };
  const readI16 = () => {
    const parsed = readU16();
    return parsed > 0x7fff ? parsed - 0x10000 : parsed;
  };
  const readI32 = () => {
    const parsed = readU32();
    return parsed > 0x7fffffff ? parsed - 0x100000000 : parsed;
  };
  const readNumber64 = (signed) => {
    const data = read(8);
    let parsed = 0n;
    for (const byte of data) parsed = (parsed << 8n) + BigInt(byte);
    if (signed && parsed & (1n << 63n)) parsed -= 1n << 64n;
    const number = Number(parsed);
    return Number.isSafeInteger(number) ? number : parsed.toString();
  };
  const readFloat32 = () => {
    const data = read(4);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(0, false);
  };
  const readFloat64 = () => {
    const data = read(8);
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(0, false);
  };
  const readString = (length) => messagePackTextDecoder.decode(read(length));
  const readArray = (length) => {
    const array = [];
    for (let index = 0; index < length; index += 1) array.push(parse());
    return array;
  };
  const readMap = (length) => {
    const object = {};
    for (let index = 0; index < length; index += 1) {
      object[String(parse())] = parse();
    }
    return object;
  };
  const skipExt = (length) => {
    readU8();
    return { __messagePackExt: true, data: Array.from(read(length)) };
  };

  function parse() {
    const prefix = readU8();
    if (prefix <= 0x7f) return prefix;
    if (prefix >= 0xe0) return prefix - 0x100;
    if ((prefix & 0xe0) === 0xa0) return readString(prefix & 0x1f);
    if ((prefix & 0xf0) === 0x90) return readArray(prefix & 0x0f);
    if ((prefix & 0xf0) === 0x80) return readMap(prefix & 0x0f);

    switch (prefix) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return Array.from(read(readU8()));
      case 0xc5: return Array.from(read(readU16()));
      case 0xc6: return Array.from(read(readU32()));
      case 0xc7: return skipExt(readU8());
      case 0xc8: return skipExt(readU16());
      case 0xc9: return skipExt(readU32());
      case 0xca: return readFloat32();
      case 0xcb: return readFloat64();
      case 0xcc: return readU8();
      case 0xcd: return readU16();
      case 0xce: return readU32();
      case 0xcf: return readNumber64(false);
      case 0xd0: return readI8();
      case 0xd1: return readI16();
      case 0xd2: return readI32();
      case 0xd3: return readNumber64(true);
      case 0xd4: return skipExt(1);
      case 0xd5: return skipExt(2);
      case 0xd6: return skipExt(4);
      case 0xd7: return skipExt(8);
      case 0xd8: return skipExt(16);
      case 0xd9: return readString(readU8());
      case 0xda: return readString(readU16());
      case 0xdb: return readString(readU32());
      case 0xdc: return readArray(readU16());
      case 0xdd: return readArray(readU32());
      case 0xde: return readMap(readU16());
      case 0xdf: return readMap(readU32());
      default:
        throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)}.`);
    }
  }

  const result = parse();
  if (offset !== bytes.length) {
    throw new Error("MessagePack payload has unread trailing bytes.");
  }
  return result;
}

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 4 &&
    value.every((entry) => Number.isInteger(Number(entry)) && Number(entry) >= 0 && Number(entry) <= 255)
  );
}

function looksLikeByteArray(value) {
  if (!Array.isArray(value) || value.length < 4) return false;
  const sampleLength = Math.min(value.length, 256);
  for (let index = 0; index < sampleLength; index += 1) {
    const entry = Number(value[index]);
    if (!Number.isInteger(entry) || entry < 0 || entry > 255) return false;
  }
  return true;
}

function unwrapSerializedBuffer(candidate) {
  if (Array.isArray(candidate) && candidate.length === 1 && looksLikeByteArray(candidate[0])) {
    return candidate[0];
  }
  return candidate;
}

function decodeSerializedWrapper(candidate) {
  if (Array.isArray(candidate) && candidate.length === 1 && looksLikeByteArray(candidate[0])) {
    return maybeDecodeNestedMessagePack(candidate[0]) || candidate[0];
  }
  if (looksLikeByteArray(candidate)) {
    return maybeDecodeNestedMessagePack(candidate) || candidate;
  }
  return candidate;
}

function maybeDecodeNestedMessagePack(value) {
  if (!isByteArray(value) && typeof value !== "string") return null;
  if (typeof value === "string" && !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim())) return null;

  try {
    const decoded = decodeMessagePack(value);
    if (decoded && typeof decoded === "object") return decoded;
  } catch {
    // Not every byte/string field is a nested MessagePack object.
  }
  return null;
}

export function expandSerializedBuffers(candidate, seen = new Set(), depth = 0) {
  if (!candidate || typeof candidate !== "object" || depth > 8) return candidate;
  if (seen.has(candidate)) return candidate;
  seen.add(candidate);

  if (Array.isArray(candidate)) {
    const decoded = maybeDecodeNestedMessagePack(candidate);
    if (decoded) return expandSerializedBuffers(decoded, seen, depth + 1);
    return candidate.map((entry) => expandSerializedBuffers(entry, seen, depth + 1));
  }

  const expanded = { ...candidate };
  Object.entries(candidate).forEach(([key, value]) => {
    expanded[key] = expandSerializedBuffers(value, seen, depth + 1);

    const shouldTryDecode =
      /buffer|bytes|data|serialized|mesh|surface|transform|landmark/i.test(key) ||
      isByteArray(value);
    if (!shouldTryDecode) return;

    const decoded = maybeDecodeNestedMessagePack(value);
    if (decoded) {
      expanded[`${key}_decoded`] = expandSerializedBuffers(decoded, seen, depth + 1);
    }
  });

  return expanded;
}

function disposeObject3D(object) {
  if (!object) return;
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material?.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

export function normalizeJawKey(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("upper_jaw") || text.includes("upper") || text.includes("maxillary") || text === "2") {
    return "upper";
  }
  if (text.includes("lower_jaw") || text.includes("lower") || text.includes("mandibular") || text === "1") {
    return "lower";
  }
  return null;
}

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  );
}

function toNumericArray(value) {
  if (!Array.isArray(value)) return null;
  const numbers = value.map(Number);
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function toPointObject(value) {
  if (typeof value === "string") {
    try {
      return toPointObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (Array.isArray(value) && value.length >= 3) {
    if (isByteArray(value)) return null;
    const [x, y, z] = value.map(Number);
    return { x, y, z };
  }

  if (value && typeof value === "object") {
    if (isByteArray(value)) return null;
    const x = Number(value.x ?? value.X ?? value.pos_x ?? value.position_x ?? value[0]);
    const y = Number(value.y ?? value.Y ?? value.pos_y ?? value.position_y ?? value[1]);
    const z = Number(value.z ?? value.Z ?? value.pos_z ?? value.position_z ?? value[2]);
    if ([x, y, z].every(Number.isFinite)) return { x, y, z };
  }

  return null;
}

export function toQuaternionObject(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return toQuaternionObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (Array.isArray(value) && value.length >= 4) {
    if (isByteArray(value)) return null;
    const [x, y, z, w] = value.map(Number);
    return [x, y, z, w].every(Number.isFinite) ? { x, y, z, w } : null;
  }

  if (value && typeof value === "object") {
    if (isByteArray(value)) return null;
    const x = Number(value.x ?? value.X ?? value[0]);
    const y = Number(value.y ?? value.Y ?? value[1]);
    const z = Number(value.z ?? value.Z ?? value[2]);
    const w = Number(value.w ?? value.W ?? value[3]);
    return [x, y, z, w].every(Number.isFinite) ? { x, y, z, w } : null;
  }

  return null;
}

function getKeyedVector(candidate, key) {
  return toPointObject(keyedValue(candidate, key));
}

function pointMagnitude(point) {
  if (!isValidPoint(point)) return 0;
  return Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z);
}

function looksLikeModelPosition(point) {
  return isValidPoint(point) && pointMagnitude(point) > 2;
}

export function toDataView(candidate) {
  const bytes = toUint8Array(candidate);
  if (!bytes?.length) return null;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readFloat64LE(view, offset) {
  if (!view || offset + 7 >= view.byteLength) return NaN;
  return view.getFloat64(offset, true);
}

export function readFloat32LE(view, offset) {
  if (!view || offset + 3 >= view.byteLength) return NaN;
  return view.getFloat32(offset, true);
}

export function readVector3Float64LE(view, offset) {
  const point = {
    x: readFloat64LE(view, offset),
    y: readFloat64LE(view, offset + 8),
    z: readFloat64LE(view, offset + 16),
  };
  return isValidPoint(point) && [point.x, point.y, point.z].every((value) => Math.abs(value) < 10000)
    ? point
    : null;
}

function getCerealPayloadOffset(bytes) {
  if (!looksLikeByteArray(bytes)) return null;
  const archiveText = "serialization::archive";
  const archiveCodes = Array.from(archiveText).map((char) => char.charCodeAt(0));
  for (let index = 0; index + archiveCodes.length < bytes.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < archiveCodes.length; offset += 1) {
      if (bytes[index + offset] !== archiveCodes[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index + archiveCodes.length + 15;
  }
  return null;
}

function extractBinaryTransformSummary(candidate) {
  const bytes = unwrapSerializedBuffer(candidate);
  if (!looksLikeByteArray(bytes) || bytes.length < 120) return null;

  const view = toDataView(bytes);
  const preferredOffset = getCerealPayloadOffset(bytes);
  const offsets = preferredOffset ? [preferredOffset] : [];
  for (let offset = 0; offset + 99 < bytes.length; offset += 1) {
    if (!offsets.includes(offset)) offsets.push(offset);
  }

  let best = null;
  for (const offset of offsets) {
    if (offset + 99 >= bytes.length) continue;
    const buccalDirection = readVector3Float64LE(view, offset);
    const mesialDistalLine = readVector3Float64LE(view, offset + 24);
    const buccalPoint = readVector3Float64LE(view, offset + 48);
    const gingivalPoint = readVector3Float64LE(view, offset + 72);
    const mesialDistalSizing = readFloat32LE(view, offset + 96);
    if (!buccalDirection || !mesialDistalLine || !buccalPoint || !gingivalPoint) continue;

    const directionScore =
      pointMagnitude(buccalDirection) > 0.25 &&
      pointMagnitude(buccalDirection) < 1.75 &&
      pointMagnitude(mesialDistalLine) > 0.25 &&
      pointMagnitude(mesialDistalLine) < 1.75
        ? 4
        : 0;
    const positionScore =
      pointMagnitude(buccalPoint) > 2 && pointMagnitude(gingivalPoint) > 2 ? 4 : 0;
    const sizingScore =
      Number.isFinite(mesialDistalSizing) && mesialDistalSizing >= 0 && mesialDistalSizing < 100 ? 1 : 0;
    const score = directionScore + positionScore + sizingScore + (offset === preferredOffset ? 2 : 0);

    if (score > (best?.score ?? -1)) {
      best = {
        score,
        offset,
        buccalDirection,
        mesialDistalLine,
        buccalPoint,
        gingivalPoint,
        mesialDistalSizing: Number.isFinite(mesialDistalSizing) ? mesialDistalSizing : null,
      };
    }
  }

  if (!best || best.score < 6) return null;
  const { score, ...summary } = best;
  return summary;
}

function getPointBounds(points) {
  if (!points?.length) return null;
  return points.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      minY: Math.min(acc.minY, point.y),
      minZ: Math.min(acc.minZ, point.z),
      maxX: Math.max(acc.maxX, point.x),
      maxY: Math.max(acc.maxY, point.y),
      maxZ: Math.max(acc.maxZ, point.z),
    }),
    {
      minX: Infinity,
      minY: Infinity,
      minZ: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    }
  );
}

function getPointBoundsCenter(points) {
  const bounds = getPointBounds(points);
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
}

function looksLikeMeshBounds(points) {
  if (!points?.length) return false;
  const box = getPointBounds(points);
  const spans = [
    box.maxX - box.minX,
    box.maxY - box.minY,
    box.maxZ - box.minZ,
  ];
  return spans.every((span) => Number.isFinite(span)) && spans.some((span) => span > 0.25);
}

function extractFloatTripletsFromBytes(candidate) {
  const bytes = toUint8Array(candidate);
  if (!bytes || bytes.length < 12) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const best = { points: [], score: 0 };

  for (let offset = 0; offset < Math.min(32, bytes.length - 12); offset += 4) {
    const points = [];
    for (let cursor = offset; cursor + 11 < bytes.length; cursor += 12) {
      const point = {
        x: view.getFloat32(cursor, true),
        y: view.getFloat32(cursor + 4, true),
        z: view.getFloat32(cursor + 8, true),
      };
      if (!isValidPoint(point) || [point.x, point.y, point.z].some((coord) => Math.abs(coord) > 10000)) {
        if (points.length >= 12) break;
        points.length = 0;
        continue;
      }
      points.push(point);
    }

    const score = looksLikeMeshBounds(points) ? points.length : 0;
    if (score > best.score) {
      best.points = points;
      best.score = score;
    }
  }

  return best.score >= 12 ? best.points : [];
}

function decodeBinarySurfaceMesh(candidate) {
  const bytes = unwrapSerializedBuffer(candidate);
  if (!looksLikeByteArray(bytes) || bytes.length < 64) return null;
  const view = toDataView(bytes);
  const version = view.getInt32(0, true);
  const pointCount = view.getInt32(4, true);
  const faceCount = view.getInt32(8, true);
  const vertexOffset = 12;
  const indexOffset = vertexOffset + pointCount * 3 * 8;
  const indexCount = faceCount * 3;

  if (
    version < 0 ||
    version > 10 ||
    pointCount <= 0 ||
    faceCount <= 0 ||
    pointCount > 1000000 ||
    faceCount > 1000000 ||
    indexOffset + indexCount * 4 > bytes.length
  ) {
    return null;
  }

  const vertices = [];
  for (let index = 0; index < pointCount; index += 1) {
    const offset = vertexOffset + index * 24;
    const point = {
      x: readFloat64LE(view, offset),
      y: readFloat64LE(view, offset + 8),
      z: readFloat64LE(view, offset + 16),
    };
    if (!isValidPoint(point) || [point.x, point.y, point.z].some((coord) => Math.abs(coord) > 100000)) {
      return null;
    }
    vertices.push(point);
  }

  const indices = [];
  for (let index = 0; index < indexCount; index += 1) {
    const value = view.getInt32(indexOffset + index * 4, true);
    if (value < 0 || value >= pointCount) return null;
    indices.push(value);
  }

  return {
    vertices,
    indices,
    source: "api-surface-mesh-binary",
    pointSize: pointCount,
    faceSize: faceCount,
    bounds: getPointBounds(vertices),
    center: getPointBoundsCenter(vertices),
    binaryLayout: {
      version,
      vertexOffset,
      indexOffset,
      bytes: bytes.length,
    },
  };
}

function extractPointArray(candidate) {
  if (!candidate) return [];
  if (typeof candidate === "string") {
    try {
      return extractPointArray(JSON.parse(candidate));
    } catch {
      return [];
    }
  }
  if (Array.isArray(candidate)) {
    return candidate.map(toPointObject).filter(isValidPoint);
  }
  if (typeof candidate !== "object") return [];

  const keys = ["points", "vertices", "coordinates", "coords", "positions", "data", "json"];
  for (const key of keys) {
    const points = extractPointArray(candidate[key]);
    if (points.length) return points;
  }
  return [];
}

// [Decoder 2] Map Unity MessagePack numeric keys to StageDataManager/ToothCraftData fields.
function keyedValue(candidate, key) {
  if (!candidate) return undefined;
  if (Array.isArray(candidate)) return candidate[key];
  if (typeof candidate === "object") return candidate[key] ?? candidate[String(key)];
  return undefined;
}

function mapUnityDictionary(candidate) {
  if (!candidate) return {};
  if (Array.isArray(candidate)) {
    return Object.fromEntries(
      candidate
        .map((value, index) => [index, value])
        .filter(([, value]) => value !== undefined && value !== null)
    );
  }
  if (typeof candidate === "object") return candidate;
  return {};
}

function mapToothCraftData(candidate) {
  if (!candidate) return null;
  const mapped = {
    toothData_: mapUnityDictionary(keyedValue(candidate, 0)),
    toothSurfaceMeshData_: mapUnityDictionary(keyedValue(candidate, 1)),
    toothLandmarkInterfaceData_: mapUnityDictionary(keyedValue(candidate, 2)),
    toothTransformInterfaceData_: mapUnityDictionary(keyedValue(candidate, 3)),
    initialToothSurfaceMeshData_: mapUnityDictionary(keyedValue(candidate, 4)),
    initialToothLandmarkInterfaceData_: mapUnityDictionary(keyedValue(candidate, 5)),
    initialToothTransformInterfaceData_: mapUnityDictionary(keyedValue(candidate, 6)),
    rawMessagePack: candidate,
  };
  mapped.teeth = createToothRecordsFromCraftMaps(mapped);
  return mapped;
}

function mapGuideLinesData(candidate) {
  if (!candidate) return null;
  return {
    buccalLineEditorData_: keyedValue(candidate, 0),
    gingivalLineEditorData_: keyedValue(candidate, 1),
    rawMessagePack: candidate,
  };
}

function mapStageDataManager(candidate) {
  if (!candidate) return null;
  return {
    ToothSelectionData_: keyedValue(candidate, 0),
    guideLinesDataUpperJaw_: mapGuideLinesData(keyedValue(candidate, 1)),
    toothCraftDataUpperJaw_: mapToothCraftData(keyedValue(candidate, 3)),
    guideLinesDataLowerJaw_: mapGuideLinesData(keyedValue(candidate, 4)),
    toothCraftDataLowerJaw_: mapToothCraftData(keyedValue(candidate, 5)),
    rawMessagePack: candidate,
  };
}

function findToothPlacementPayload(candidate, seen = new Set()) {
  if (!candidate) return null;
  if (looksLikeByteArray(candidate) || typeof candidate === "string") return candidate;
  if (typeof candidate !== "object" || seen.has(candidate)) return null;
  seen.add(candidate);

  const directPayload =
    candidate.data ??
    candidate.Data ??
    candidate.toothPlacementData ??
    candidate.tooth_placement_data;
  if (directPayload) return directPayload;

  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      const payload = findToothPlacementPayload(entry, seen);
      if (payload) return payload;
    }
    return null;
  }

  for (const value of Object.values(candidate)) {
    const payload = findToothPlacementPayload(value, seen);
    if (payload) return payload;
  }
  return null;
}

function decodeToothPlacementData(rawResponse) {
  const payload = findToothPlacementPayload(rawResponse);
  if (!payload) return null;

  try {
    const decoded = decodeMessagePack(payload);
    return mapStageDataManager(decoded);
  } catch (error) {
    console.warn("[artificial teeth] Unable to decode ToothPlacementData.data.", error);
    return null;
  }
}

function decodeArtificialToothText(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const detectionPattern =
    /artificial\s*teeth|denture\s*teeth|replacement\s*teeth|tooth|teeth|jaw|position/i;

  try {
    const decoded = atob(value.trim());
    if (detectionPattern.test(decoded)) return decoded;
  } catch {
    // Keep going: the payload may already be plain text.
  }

  return detectionPattern.test(value) ? value : "";
}

function getToothIndex(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (
    looksLikeByteArray(candidate) ||
    (Array.isArray(candidate) && candidate.length === 1 && looksLikeByteArray(candidate[0]))
  ) {
    return null;
  }
  const value =
    candidate.tooth ??
    candidate.tooth_id ??
    candidate.toothId ??
    candidate.toothIndex ??
    candidate.tooth_index ??
    candidate.index ??
    candidate.id ??
    candidate.number ??
    candidate.name ??
    keyedValue(candidate, 0);
  if (
    value === undefined ||
    value === null ||
    typeof value === "object" ||
    looksLikeByteArray(value)
  ) {
    return null;
  }
  return String(value);
}

function getToothPosition(candidate) {
  if (!candidate || typeof candidate !== "object") return null;

  const direct = toPointObject(candidate);
  if (looksLikeModelPosition(direct)) return direct;

  for (const key of ["position", "pos", "translation", "localPosition", "center", "origin", "location"]) {
    const point = toPointObject(candidate[key]);
    if (looksLikeModelPosition(point)) return point;
  }

  return null;
}

function getToothScale(candidate) {
  const binaryTransform = extractBinaryTransformSummary(candidate);
  if (
    binaryTransform?.mesialDistalSizing &&
    binaryTransform.mesialDistalSizing > 0 &&
    binaryTransform.mesialDistalSizing < 100
  ) {
    const value = Math.max(0.65, Math.min(2.4, binaryTransform.mesialDistalSizing / 4));
    return { x: value, y: value, z: value };
  }

  if (!candidate || typeof candidate !== "object") return null;
  const sizing = Number(
    candidate.mesial_distal_sizing ??
      candidate.mesialDistalSizing ??
      keyedValue(candidate, 4)
  );
  if (Number.isFinite(sizing) && sizing > 0 && sizing < 1000) {
    return { x: sizing, y: sizing, z: sizing };
  }

  const point = toPointObject(
    candidate.scale ??
      candidate.localScale ??
      candidate.localScale_ ??
      candidate.meshLocalScale ??
      candidate.meshLocalScale_ ??
      candidate.size ??
      candidate.dimensions
  );
  if (isValidPoint(point)) return point;

  for (const key of [12, 9, 2, 3, 4, 5, 6]) {
    const keyed = getKeyedVector(candidate, key);
    if (isValidPoint(keyed) && [keyed.x, keyed.y, keyed.z].every((value) => value > 0 && value < 1000)) {
      return keyed;
    }
  }

  const x = Number(candidate.scaleX ?? candidate.scale_x ?? candidate.width);
  const y = Number(candidate.scaleY ?? candidate.scale_y ?? candidate.height);
  const z = Number(candidate.scaleZ ?? candidate.scale_z ?? candidate.depth);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function getToothRotation(candidate) {
  const binaryTransform = extractBinaryTransformSummary(candidate);
  if (isValidPoint(binaryTransform?.buccalDirection) && isValidPoint(binaryTransform?.mesialDistalLine)) {
    return {
      x: Math.atan2(binaryTransform.buccalDirection.y, binaryTransform.buccalDirection.z),
      y: Math.atan2(binaryTransform.buccalDirection.x, binaryTransform.buccalDirection.z),
      z: Math.atan2(binaryTransform.mesialDistalLine.y, binaryTransform.mesialDistalLine.x),
    };
  }

  if (!candidate || typeof candidate !== "object") return null;
  const buccalDirection = toPointObject(candidate.buccal_direction ?? candidate.buccalDirection);
  const mesialDistalLine = toPointObject(candidate.mesial_distal_line ?? candidate.mesialDistalLine);
  if (isValidPoint(buccalDirection) && isValidPoint(mesialDistalLine)) {
    return {
      x: Math.atan2(buccalDirection.y, buccalDirection.z),
      y: Math.atan2(buccalDirection.x, buccalDirection.z),
      z: Math.atan2(mesialDistalLine.y, mesialDistalLine.x),
    };
  }

  const keyedBuccalDirection = getKeyedVector(candidate, 0);
  const keyedMesialDistalLine = getKeyedVector(candidate, 1);
  if (isValidPoint(keyedBuccalDirection) && isValidPoint(keyedMesialDistalLine)) {
    return {
      x: Math.atan2(keyedBuccalDirection.y, keyedBuccalDirection.z),
      y: Math.atan2(keyedBuccalDirection.x, keyedBuccalDirection.z),
      z: Math.atan2(keyedMesialDistalLine.y, keyedMesialDistalLine.x),
    };
  }

  const point = toPointObject(
    candidate.rotation ??
      candidate.euler ??
      candidate.eulerAngles ??
      candidate.localEulerAngles ??
      candidate.localRotation ??
      candidate.localRotation_ ??
      candidate.meshLocalRotation ??
      candidate.meshLocalRotation_ ??
      candidate.rot
  );
  if (isValidPoint(point)) return point;

  const directQuaternion = toQuaternionObject(
    candidate.rotation ??
      candidate.quaternion ??
      candidate.localRotation ??
      candidate.localRotation_ ??
      candidate.meshLocalRotation ??
      candidate.meshLocalRotation_
  );
  if (directQuaternion) return directQuaternion;

  for (const key of [11, 8, 1, 2, 3, 4, 5]) {
    const keyedQuaternion = toQuaternionObject(keyedValue(candidate, key));
    if (keyedQuaternion) return keyedQuaternion;
    const keyed = getKeyedVector(candidate, key);
    if (isValidPoint(keyed)) return keyed;
  }

  const x = Number(candidate.rotationX ?? candidate.rot_x ?? candidate.rx);
  const y = Number(candidate.rotationY ?? candidate.rot_y ?? candidate.ry);
  const z = Number(candidate.rotationZ ?? candidate.rot_z ?? candidate.rz);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function getToothTransformSummary(candidate) {
  const binaryTransform = extractBinaryTransformSummary(candidate);
  if (binaryTransform) return binaryTransform;

  if (!candidate || typeof candidate !== "object") return null;
  const transform = {
    buccalDirection:
      toPointObject(candidate.buccal_direction ?? candidate.buccalDirection) ??
      getKeyedVector(candidate, 0),
    mesialDistalLine:
      toPointObject(candidate.mesial_distal_line ?? candidate.mesialDistalLine) ??
      getKeyedVector(candidate, 1),
    buccalPoint:
      toPointObject(candidate.buccal_point ?? candidate.buccalPoint) ??
      getKeyedVector(candidate, 2),
    gingivalPoint:
      toPointObject(candidate.gingival_point ?? candidate.gingivalPoint) ??
      getKeyedVector(candidate, 3),
    mesialDistalSizing: Number(
      candidate.mesial_distal_sizing ??
        candidate.mesialDistalSizing ??
        keyedValue(candidate, 4)
    ),
  };

  return isValidPoint(transform.buccalDirection) && isValidPoint(transform.mesialDistalLine)
    ? transform
    : null;
}

function parseToothIndices(candidate, expectedLength = null, vertexCount = null) {
  if (isByteArray(candidate)) {
    const bytes = toUint8Array(candidate);
    if (!bytes?.length) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const indices = [];
    if (bytes.length % 4 === 0) {
      for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
        const value = view.getInt32(offset, true);
        if (value < 0 || value > 10000000) return null;
        indices.push(value);
      }
      return normalizeToothIndices(indices, expectedLength, vertexCount);
    }
    if (bytes.length % 2 === 0) {
      for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
        indices.push(view.getUint16(offset, true));
      }
      return normalizeToothIndices(indices, expectedLength, vertexCount);
    }
  }
  if (!Array.isArray(candidate)) return null;
  let indices = null;
  if (candidate.every((entry) => Number.isInteger(Number(entry)))) {
    indices = candidate.map(Number);
  }
  if (!indices && candidate.every((entry) => Array.isArray(entry))) {
    const flattened = candidate.flatMap((entry) => entry.map(Number));
    indices = flattened.every(Number.isInteger) ? flattened : null;
  }
  return normalizeToothIndices(indices, expectedLength, vertexCount);
}

function normalizeToothIndices(indices, expectedLength = null, vertexCount = null) {
  if (!indices?.length || indices.length < 3) return null;
  const trimmed = expectedLength && indices.length >= expectedLength
    ? indices.slice(0, expectedLength)
    : indices;
  if (vertexCount && trimmed.some((index) => index < 0 || index >= vertexCount)) return null;
  return trimmed.length >= 3 ? trimmed : null;
}

function extractVertexArray(candidate, expectedCount = null) {
  if (!Array.isArray(candidate)) return extractPointArray(candidate);
  if (isByteArray(candidate)) {
    const points = extractFloatTripletsFromBytes(candidate);
    return expectedCount && points.length >= expectedCount ? points.slice(0, expectedCount) : points;
  }
  if (candidate.every((entry) => typeof entry === "number")) {
    const points = [];
    for (let index = 0; index + 2 < candidate.length; index += 3) {
      const point = toPointObject(candidate.slice(index, index + 3));
      if (isValidPoint(point)) points.push(point);
    }
    return expectedCount && points.length >= expectedCount ? points.slice(0, expectedCount) : points;
  }
  const points = extractPointArray(candidate);
  return expectedCount && points.length >= expectedCount ? points.slice(0, expectedCount) : points;
}

function getToothGeometryData(candidate) {
  const binarySurfaceMesh = decodeBinarySurfaceMesh(candidate);
  if (binarySurfaceMesh) return binarySurfaceMesh;

  candidate = decodeSerializedWrapper(candidate);
  if (looksLikeByteArray(candidate)) return null;
  if (!candidate || typeof candidate !== "object") return null;
  const wrappedBinarySurfaceMesh = decodeBinarySurfaceMesh(
    candidate.data_ ??
      candidate.data ??
      candidate.Data ??
      keyedValue(candidate, 0)
  );
  if (wrappedBinarySurfaceMesh) return wrappedBinarySurfaceMesh;
  if (candidate.geometry && candidate.geometry !== candidate) {
    const nestedGeometry = getToothGeometryData(candidate.geometry);
    if (nestedGeometry) return nestedGeometry;
  }
  const pointSize = Number(
    candidate.point_size ??
      candidate.pointSize ??
      candidate.vertexCount ??
      candidate.verticesCount ??
      keyedValue(candidate, 0)
  );
  const faceSize = Number(
    candidate.face_size ??
      candidate.faceSize ??
      candidate.faceCount ??
      candidate.triangleCount ??
      keyedValue(candidate, 2)
  );
  const expectedPointCount = Number.isInteger(pointSize) && pointSize > 0 ? pointSize : null;
  const expectedFaceCount = Number.isInteger(faceSize) && faceSize > 0 ? faceSize : null;
  const expectedIndexCount = expectedFaceCount ? expectedFaceCount * 3 : null;

  const vertexCandidates = [
    candidate.meshVertices_,
    candidate.meshVertices,
    keyedValue(candidate, 4),
    candidate.points,
    candidate.point_data,
    candidate.pointData,
    candidate.pointBuffer,
    candidate.point_buffer,
    candidate.pointsBuffer,
    candidate.points_buffer,
    keyedValue(candidate, 1),
    candidate.vertices,
    candidate.positions,
    candidate.vertexData,
    candidate.meshVertices,
    candidate.vertices_,
    candidate.vertex_buffer,
    candidate.vertexBuffer,
    keyedValue(candidate, 0),
  ];
  let points = [];
  for (const vertexCandidate of vertexCandidates) {
    points = extractVertexArray(vertexCandidate, expectedPointCount);
    if (points.length >= 12 && looksLikeMeshBounds(points)) break;
  }
  if (points.length < 12 || !looksLikeMeshBounds(points)) return null;

  const indexCandidates = [
    candidate.meshTriangles_,
    candidate.meshTriangles,
    keyedValue(candidate, 5),
    candidate.face_index,
    candidate.faceIndex,
    candidate.indices,
    candidate.triangles,
    candidate.faces,
    candidate.faceData,
    candidate.faceBuffer,
    candidate.face_buffer,
    candidate.index_data,
    candidate.indexData,
    candidate.meshIndices,
    candidate.triangles_,
    candidate.indexBuffer,
    keyedValue(candidate, 3),
    keyedValue(candidate, 2),
  ];
  let indices = null;
  for (const indexCandidate of indexCandidates) {
    indices = parseToothIndices(indexCandidate, expectedIndexCount, points.length);
    if (indices?.length >= 3) break;
  }

  return {
    vertices: points,
    indices,
    source: "api-mesh-vertices",
    pointSize: expectedPointCount,
    faceSize: expectedFaceCount,
    bounds: getPointBounds(points),
    center: getPointBoundsCenter(points),
  };
}

// [Decoder 3] Synthesize tooth records by merging metadata, transform, and surface dictionaries.
function addNestedValues(candidate, output, seen = new Set(), depth = 0) {
  if (!candidate || typeof candidate !== "object" || depth > 5 || seen.has(candidate)) {
    return;
  }
  const decoded = decodeSerializedWrapper(candidate);
  if (decoded !== candidate) {
    addNestedValues(decoded, output, seen, depth + 1);
    return;
  }
  if (looksLikeByteArray(candidate)) return;
  seen.add(candidate);
  output.push(candidate);

  const values = Array.isArray(candidate) ? candidate : Object.values(candidate);
  values.forEach((value) => addNestedValues(value, output, seen, depth + 1));
}

function getDeepToothRotation(...sources) {
  for (const source of sources) {
    const direct = getToothRotation(source);
    if (isValidPoint(direct)) return direct;
  }
  return null;
}

function getDeepToothScale(...sources) {
  for (const source of sources) {
    const direct = getToothScale(source);
    if (isValidPoint(direct)) return direct;
  }
  return null;
}

function getDeepToothTransform(...sources) {
  for (const source of sources) {
    const direct = getToothTransformSummary(source);
    if (direct) return direct;
  }

  const nested = [];
  sources.forEach((source) => addNestedValues(source, nested));
  for (const candidate of nested) {
    const transform = getToothTransformSummary(candidate);
    if (transform) return transform;
  }
  return null;
}

function getDeepToothGeometry(...sources) {
  for (const source of sources) {
    const direct = getToothGeometryData(source);
    if (direct) return direct;
  }

  const nested = [];
  sources.forEach((source) => addNestedValues(source, nested));
  for (const candidate of nested) {
    const geometry = getToothGeometryData(candidate);
    if (geometry) return geometry;
  }
  return null;
}

function getUnityToothDataPosition(toothData) {
  if (!toothData || typeof toothData !== "object" || looksLikeByteArray(toothData)) {
    return null;
  }

  // Unity ToothData layout: fields 7 and 10 are the saved tooth placement.
  // Fields 9 and 12 are scale/direction-like vectors and must not be used as positions.
  for (const key of [7, 10]) {
    const point = getKeyedVector(toothData, key);
    if (looksLikeModelPosition(point)) {
      return point;
    }
  }

  return getToothPosition(toothData);
}

function createToothRecordsFromCraftMaps(craftData) {
  if (!craftData) return [];
  const keys = new Set();
  [
    craftData.toothData_,
    craftData.toothSurfaceMeshData_,
    craftData.toothTransformInterfaceData_,
    craftData.initialToothSurfaceMeshData_,
    craftData.initialToothTransformInterfaceData_,
  ].forEach((dict) => {
    Object.keys(dict || {}).forEach((key) => keys.add(key));
  });

  return Array.from(keys).flatMap((key) => {
    const canonicalToothIndex = String(key);
    const toothData = craftData.toothData_?.[key];
    const transformData =
      craftData.toothTransformInterfaceData_?.[key] ??
      craftData.initialToothTransformInterfaceData_?.[key];
    const surfaceData =
      craftData.toothSurfaceMeshData_?.[key] ??
      craftData.initialToothSurfaceMeshData_?.[key];
    const toothGeometry = getDeepToothGeometry(toothData);
    const surfaceGeometry = getDeepToothGeometry(surfaceData);
    const shouldPreferSurfaceGeometry = Boolean(
      surfaceGeometry?.indices?.length >= 3
    );
    const geometry = shouldPreferSurfaceGeometry
      ? surfaceGeometry
      : toothGeometry ?? surfaceGeometry;
    if (!geometry) return [];

    const transform = getDeepToothTransform(transformData, toothData);
    const toothDataPosition = shouldPreferSurfaceGeometry
      ? null
      : toothGeometry
        ? getUnityToothDataPosition(toothData)
        : null;
    const apiMeshCenter = getPointBoundsCenter(geometry.vertices);
    const position = toothDataPosition ??
      (looksLikeModelPosition(apiMeshCenter) ? apiMeshCenter : null);
    const source = {
      toothData,
      transformData,
      surfaceData,
      craftKey: canonicalToothIndex,
      toothDataIndex: getToothIndex(toothData),
      databaseMappedDirect: true,
      geometryFromToothData: Boolean(toothGeometry) && !shouldPreferSurfaceGeometry,
      geometryFromSurfaceMesh: Boolean(surfaceGeometry) && (!toothGeometry || shouldPreferSurfaceGeometry),
      preferredSurfaceGeometry: shouldPreferSurfaceGeometry,
      positionFromToothDataWorld: Boolean(toothDataPosition) && position === toothDataPosition,
      positionFromUnityToothDataField: Boolean(toothDataPosition) && position === toothDataPosition
        ? 7
        : null,
      positionFromApiMeshCenter: Boolean(apiMeshCenter) && position === apiMeshCenter,
      positionSpace: position === toothDataPosition ? "unity-world" : "jaw-local",
      transformLandmarksUsedForPlacement: false,
      guidelineUsedForPlacement: false,
    };

    if (!position) return [];

    return [{
      toothIndex: canonicalToothIndex,
      position: position || { x: 0, y: 0, z: 0 },
      transform,
      rotation: toothGeometry
        ? getDeepToothRotation(toothData, transformData)
        : getDeepToothRotation(transformData, toothData),
      scale: toothGeometry
        ? getDeepToothScale(toothData)
        : geometry
          ? null
          : getDeepToothScale(transformData, toothData),
      geometry,
      source,
    }];
  });
}

function describeValueShape(value, depth = 0) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) {
    if (isByteArray(value)) return `byte[${value.length}]`;
    const numeric = toNumericArray(value);
    if (numeric) return `number[${value.length}]`;
    return `array[${value.length}]`;
  }
  if (typeof value !== "object") return typeof value;
  const keys = Object.keys(value);
  if (depth > 1) return `object{${keys.slice(0, 8).join(",")}}`;
  return Object.fromEntries(
    keys.slice(0, 8).map((key) => [key, describeValueShape(value[key], depth + 1)])
  );
}

function previewSerializableValue(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (looksLikeByteArray(value)) return `[bytes:${value.length}]`;
  if (depth > 3) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";

  if (Array.isArray(value)) {
    return value.slice(0, 4).map((entry) => previewSerializableValue(entry, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 10)
      .map(([key, entry]) => [key, previewSerializableValue(entry, depth + 1, seen)])
  );
}

function getWrappedByteLength(value) {
  if (!value) return 0;
  if (looksLikeByteArray(value)) return value.length;
  if (Array.isArray(value) && value.length === 1 && looksLikeByteArray(value[0])) {
    return value[0].length;
  }
  if (typeof value === "object") {
    const wrapped =
      value.data_ ??
      value.data ??
      value.Data ??
      keyedValue(value, 0);
    return getWrappedByteLength(wrapped);
  }
  return 0;
}

function summarizeSurfaceMeshDecode(key, currentSurfaceData, initialSurfaceData) {
  const currentGeometry = getDeepToothGeometry(currentSurfaceData);
  const initialGeometry = getDeepToothGeometry(initialSurfaceData);
  const geometry = currentGeometry ?? initialGeometry;
  return {
    key,
    hasCurrentSurfaceEntry: currentSurfaceData !== undefined && currentSurfaceData !== null,
    hasInitialSurfaceEntry: initialSurfaceData !== undefined && initialSurfaceData !== null,
    currentByteLength: getWrappedByteLength(currentSurfaceData),
    initialByteLength: getWrappedByteLength(initialSurfaceData),
    decoded: Boolean(geometry),
    decodedFrom: currentGeometry ? "current" : initialGeometry ? "initial" : null,
    source: geometry?.source ?? null,
    vertices: geometry?.vertices?.length ?? 0,
    indices: geometry?.indices?.length ?? 0,
    currentShape: describeValueShape(currentSurfaceData),
    initialShape: describeValueShape(initialSurfaceData),
  };
}

function summarizeCraftSurfaceDecode(craftData) {
  if (!craftData) return [];
  const keys = new Set();
  [
    craftData.toothData_,
    craftData.toothSurfaceMeshData_,
    craftData.initialToothSurfaceMeshData_,
  ].forEach((dict) => {
    Object.keys(dict || {}).forEach((key) => keys.add(key));
  });
  return Array.from(keys)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => ({
      ...summarizeSurfaceMeshDecode(
        key,
        craftData.toothSurfaceMeshData_?.[key],
        craftData.initialToothSurfaceMeshData_?.[key]
      ),
      hasToothData: craftData.toothData_?.[key] !== undefined && craftData.toothData_?.[key] !== null,
      inRenderedTeeth: (craftData.teeth || []).some((tooth) => String(tooth.toothIndex) === String(key)),
    }));
}

function summarizeCraftData(craftData) {
  if (!craftData) return null;
  const dictNames = [
    "toothData_",
    "toothSurfaceMeshData_",
    "toothLandmarkInterfaceData_",
    "toothTransformInterfaceData_",
    "initialToothSurfaceMeshData_",
    "initialToothLandmarkInterfaceData_",
    "initialToothTransformInterfaceData_",
  ];
  return Object.fromEntries(
    dictNames.map((name) => {
      const dict = craftData[name] || {};
      const keys = Object.keys(dict);
      return [
        name,
        {
          count: keys.length,
          keys: keys.slice(0, 12),
          firstShape: keys.length ? describeValueShape(dict[keys[0]]) : null,
        },
      ];
    })
  );
}

function summarizeDecodedStageData(decodedStageData) {
  return {
    upper: summarizeCraftData(decodedStageData?.toothCraftDataUpperJaw_),
    lower: summarizeCraftData(decodedStageData?.toothCraftDataLowerJaw_),
    surfaceDecode: {
      upper: summarizeCraftSurfaceDecode(decodedStageData?.toothCraftDataUpperJaw_),
      lower: summarizeCraftSurfaceDecode(decodedStageData?.toothCraftDataLowerJaw_),
    },
  };
}

function summarizeToothRenderData(toothByJaw) {
  const summarizeJaw = (teeth = []) => ({
    total: teeth.length,
    toothIndices: teeth.map((tooth) => tooth.toothIndex).filter((index) => index !== undefined && index !== null),
    apiMesh: teeth.filter((tooth) => tooth.geometry?.vertices?.length >= 3).length,
    withoutMesh: teeth.filter((tooth) => !tooth.geometry?.vertices?.length).length,
    vertices: teeth.reduce((sum, tooth) => sum + (tooth.geometry?.vertices?.length ?? 0), 0),
    indexed: teeth.filter((tooth) => tooth.geometry?.indices?.length >= 3).length,
    firstApiMesh: teeth.find((tooth) => tooth.geometry?.vertices?.length >= 3)
      ? {
          toothIndex: teeth.find((tooth) => tooth.geometry?.vertices?.length >= 3)?.toothIndex,
          vertexCount: teeth.find((tooth) => tooth.geometry?.vertices?.length >= 3)?.geometry?.vertices?.length,
          indexCount: teeth.find((tooth) => tooth.geometry?.vertices?.length >= 3)?.geometry?.indices?.length ?? 0,
          center: getPointBoundsCenter(teeth.find((tooth) => tooth.geometry?.vertices?.length >= 3)?.geometry?.vertices),
        }
      : null,
  });
  return {
    upper: summarizeJaw(toothByJaw.upper),
    lower: summarizeJaw(toothByJaw.lower),
  };
}

function distanceBetweenPoints(a, b) {
  if (!isValidPoint(a) || !isValidPoint(b)) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function extractPointSets(candidate, output = [], seen = new Set(), depth = 0) {
  if (!candidate || depth > 8) return output;
  if (typeof candidate === "object") {
    if (seen.has(candidate)) return output;
    seen.add(candidate);
  }

  const points = extractPointArray(candidate);
  if (points.length >= 6 && looksLikeMeshBounds(points)) {
    output.push(points);
  }

  if (Array.isArray(candidate)) {
    if (!isByteArray(candidate)) {
      candidate.forEach((entry) => extractPointSets(entry, output, seen, depth + 1));
    }
    return output;
  }

  if (typeof candidate === "object") {
    Object.values(candidate).forEach((value) => extractPointSets(value, output, seen, depth + 1));
  }
  return output;
}

function extractFirstNestedPoint(candidate, seen = new Set(), depth = 0) {
  if (!candidate || depth > 6) return null;
  const direct = toPointObject(candidate);
  if (isValidPoint(direct)) return direct;
  if (typeof candidate !== "object" || looksLikeByteArray(candidate)) return null;
  if (seen.has(candidate)) return null;
  seen.add(candidate);

  const decoded = decodeSerializedWrapper(candidate);
  if (decoded !== candidate) {
    const decodedPoint = extractFirstNestedPoint(decoded, seen, depth + 1);
    if (decodedPoint) return decodedPoint;
  }

  const preferredKeys = [
    "position",
    "Position",
    "point",
    "Point",
    "controlPoint",
    "control_point",
    "coordinate",
    "coordinates",
    "data",
    "Data",
    "0",
  ];
  for (const key of preferredKeys) {
    const value = candidate[key];
    const point = extractFirstNestedPoint(value, seen, depth + 1);
    if (point) return point;
  }

  const values = Array.isArray(candidate) ? candidate : Object.values(candidate);
  for (const value of values) {
    const point = extractFirstNestedPoint(value, seen, depth + 1);
    if (point) return point;
  }
  return null;
}

function extractGuidelinePointSets(candidate, output = [], seen = new Set(), depth = 0) {
  if (!candidate || depth > 8) return output;
  if (typeof candidate === "object") {
    if (seen.has(candidate)) return output;
    seen.add(candidate);
  }

  const decoded = decodeSerializedWrapper(candidate);
  if (decoded !== candidate) {
    return extractGuidelinePointSets(decoded, output, seen, depth + 1);
  }

  const points = extractPointArray(candidate);
  if (points.length >= 2 && looksLikeMeshBounds(points)) {
    output.push(points);
  }

  if (Array.isArray(candidate)) {
    const nestedPoints = candidate
      .map((entry) => extractFirstNestedPoint(entry))
      .filter(isValidPoint);
    if (nestedPoints.length >= 2 && looksLikeMeshBounds(nestedPoints)) {
      output.push(nestedPoints);
    }

    if (!isByteArray(candidate)) {
      candidate.forEach((entry) => extractGuidelinePointSets(entry, output, seen, depth + 1));
    }
    return output;
  }

  if (typeof candidate === "object") {
    Object.values(candidate).forEach((value) =>
      extractGuidelinePointSets(value, output, seen, depth + 1)
    );
  }
  return output;
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distanceBetweenPoints(points[index - 1], points[index]);
  }
  return length;
}

function createToothRecord(candidate, jawHint = null) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;

  const position = getToothPosition(candidate);
  const geometry = getToothGeometryData(candidate);
  if (!position && !geometry) return null;

  return {
    arch:
      normalizeJawKey(
        candidate.jaw ??
          candidate.jaw_type ??
          candidate.jawType ??
          candidate.arch ??
          candidate.type ??
          candidate.name
      ) || jawHint,
    toothIndex: getToothIndex(candidate),
    position: position || { x: 0, y: 0, z: 0 },
    rotation: getToothRotation(candidate),
    scale: getToothScale(candidate),
    geometry,
    source: candidate,
  };
}

function parseToothText(value, jawHint = null) {
  const text = decodeArtificialToothText(value);
  if (!text) return [];

  const records = [];
  const numberPattern = /[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  let currentJaw = jawHint;
  let currentToothIndex = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    const jawMatch = line.match(/\b(upper|lower|maxillary|mandibular)\b/i);
    if (jawMatch) currentJaw = normalizeJawKey(jawMatch[1]);

    const toothMatch = line.match(/\b(?:tooth|index|id|number)\s*[:=]\s*([-\w]+)/i);
    if (toothMatch) currentToothIndex = toothMatch[1];

    if (!/^[\s+\-.0-9eE,;|]+$/.test(line)) return;
    const numbers = line.match(numberPattern)?.map(Number) || [];
    const hasSentinel = numbers.some((coord) => !Number.isFinite(coord) || Math.abs(coord + 9e91) < 1e80);
    if (numbers.length < 3 || hasSentinel) return;

    const coords = numbers.slice(-3);
    records.push({
      arch: currentJaw,
      toothIndex: currentToothIndex || (numbers.length >= 4 ? String(numbers[0]) : null),
      position: { x: coords[0], y: coords[1], z: coords[2] },
      rotation: null,
      scale: null,
      geometry: null,
      source: line,
    });
  });

  return records.slice(0, 64);
}

function extractToothRecords(candidate, jawHint = null, seen = new Set()) {
  if (!candidate) return [];
  if (seen.has(candidate)) return [];
  if (typeof candidate === "object") seen.add(candidate);

  if (typeof candidate === "string") {
    const textRecords = parseToothText(candidate, jawHint);
    if (textRecords.length) return textRecords;
    try {
      return extractToothRecords(JSON.parse(candidate), jawHint, seen);
    } catch {
      return [];
    }
  }

  if (Array.isArray(candidate)) {
    if (candidate.every((entry) => typeof entry === "number")) return [];
    return candidate.flatMap((entry) => extractToothRecords(entry, jawHint, seen));
  }

  if (typeof candidate !== "object") return [];

  if (candidate.toothCraftDataUpperJaw_ || candidate.toothCraftDataLowerJaw_) {
    return [
      ...(candidate.toothCraftDataUpperJaw_?.teeth || []).map((tooth) => ({
        ...tooth,
        arch: "upper",
      })),
      ...(candidate.toothCraftDataLowerJaw_?.teeth || []).map((tooth) => ({
        ...tooth,
        arch: "lower",
      })),
    ];
  }

  if (
    Array.isArray(candidate.teeth) &&
    (
      candidate.toothData_ ||
      candidate.toothSurfaceMeshData_ ||
      candidate.initialToothSurfaceMeshData_
    )
  ) {
    return candidate.teeth.map((tooth) => ({
      ...tooth,
      arch: tooth.arch || jawHint,
    }));
  }

  const inferredJaw =
    normalizeJawKey(
      candidate.jaw ??
        candidate.jaw_type ??
        candidate.jawType ??
        candidate.arch ??
        candidate.type ??
        candidate.name
    ) || jawHint;
  const directRecord = createToothRecord(candidate, inferredJaw);
  if (directRecord) return [directRecord];

  const nestedKeys = [
    "artificialTeeth",
    "artificial_teeth",
    "dentureTeeth",
    "denture_teeth",
    "replacementTeeth",
    "replacement_teeth",
    "teeth",
    "tooth",
    "toothData_",
    "toothData",
    "toothCraftDataUpperJaw_",
    "toothCraftDataLowerJaw_",
    "upper",
    "lower",
    "upperJaw",
    "lowerJaw",
    "upper_jaw",
    "lower_jaw",
    "data",
    "json",
  ];

  const nestedRecords = nestedKeys.flatMap((key) => {
    if (!(key in candidate)) return [];
    const nextJaw = key.toLowerCase().includes("upper")
      ? "upper"
      : key.toLowerCase().includes("lower")
        ? "lower"
        : inferredJaw;
    return extractToothRecords(candidate[key], nextJaw, seen);
  });

  if (nestedRecords.length) return nestedRecords;

  return Object.entries(candidate).flatMap(([key, value]) => {
    if (!value || typeof value !== "object") return [];
    if (!/^\d+$|tooth|teeth|jaw|upper|lower/i.test(key) && !inferredJaw) return [];
    return extractToothRecords(value, inferredJaw, seen);
  });
}

function getToothTemplate(toothIndex) {
  const digits = String(toothIndex || "").match(/\d+/)?.[0];
  if (!digits) return "premolar";
  const value = Number(digits);
  const normalized = value >= 0 && value <= 15 ? value : ((value % 10) + 10) % 10;
  if (normalized === 7 || normalized === 8) return "central-incisor";
  if (normalized === 6 || normalized === 9) return "lateral-incisor";
  if (normalized === 5 || normalized === 10) return "canine";
  if (normalized === 4 || normalized === 11 || normalized === 3 || normalized === 12) return "premolar";
  return "molar";
}

function getClinicalToothDimensions(template) {
  return {
    "central-incisor": { x: 8.4, y: 10.5, z: 6.3 },
    "lateral-incisor": { x: 7.0, y: 9.4, z: 5.8 },
    canine: { x: 8.0, y: 11.2, z: 7.2 },
    premolar: { x: 7.4, y: 7.8, z: 8.4 },
    molar: { x: 10.2, y: 7.4, z: 10.1 },
  }[template] || { x: 8.0, y: 8.5, z: 8.0 };
}

function getStableProceduralScale(rawScale, template) {
  if (!rawScale || !isValidPoint(rawScale)) return new THREE.Vector3(1, 1, 1);
  const values = [rawScale.x, rawScale.y, rawScale.z].map((value) => Math.abs(Number(value)));
  if (!values.every(Number.isFinite)) return new THREE.Vector3(1, 1, 1);
  const maxValue = Math.max(...values);

  if (maxValue > 3) {
    const clinical = getClinicalToothDimensions(template);
    return new THREE.Vector3(
      THREE.MathUtils.clamp(values[0] / clinical.x, 0.78, 1.22),
      THREE.MathUtils.clamp(values[1] / clinical.y, 0.84, 1.2),
      THREE.MathUtils.clamp(values[2] / clinical.z, 0.78, 1.2)
    );
  }

  return new THREE.Vector3(
    THREE.MathUtils.clamp(values[0], 0.78, 1.22),
    THREE.MathUtils.clamp(values[1], 0.84, 1.2),
    THREE.MathUtils.clamp(values[2], 0.78, 1.2)
  );
}

const ARTIFICIAL_TEETH_DATABASE_PLACEMENT_ONLY = true;
const ARTIFICIAL_TOOTH_SHADER_DEPTH_BIAS = 0.00018;
const ARTIFICIAL_GUIDELINE_RENDER_ORDER_BASE = 32;
const LOG_ARTIFICIAL_TEETH_AUTO_AUDIT_TO_CONSOLE = false;
const LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE = false;
const ARTIFICIAL_TEETH_RENDER_RULE_VERSION = "surfaceMesh-apiMeshCenter-v2";

export function createArtificialTeethRenderer({
  scene,
  parentObject,
  camera = null,
  apiClient,
  onStatus = null,
  onPerformance = null,
}) {
  const group = new THREE.Group();
  group.name = "artificial-tooth-overlay-group";
  scene.add(group);
  let lastNormalizedTeeth = { upper: [], lower: [] };
  let referenceMode = "jaw-local";
  localStorage.removeItem("artificialTeethReferenceMode");

  const jawVisibility = new Map([
    ["upper", true],
    ["lower", true],
  ]);
  const jawOpacity = new Map([
    ["upper", 1],
    ["lower", 1],
  ]);
  const material = new THREE.MeshStandardMaterial({
    color: 0xeef36a,
    emissive: 0x5a6100,
    emissiveIntensity: 0.28,
    roughness: 0.26,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: false,
    opacity: 1,
    depthTest: true,
    depthWrite: true,
    polygonOffset: false,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: 0,
  });
  // Each arch gets its own instances: the two are configured alike but are
  // mutated independently as guidelines are shown and hidden.
  const makeGuidelineMaterials = () => ({
    buccal: new THREE.MeshBasicMaterial({
      color: 0xff9f1c,
      transparent: true,
      opacity: 0.72,
      depthTest: true,
      depthWrite: false,
    }),
    gingival: new THREE.MeshBasicMaterial({
      color: 0x38d6ff,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
    }),
  });
  const guidelineVisualMaterials = {
    upper: makeGuidelineMaterials(),
    lower: makeGuidelineMaterials(),
  };
  const setStatus = (label, progress = 0.1, autoHide = false) => {
    if (typeof onStatus === "function") {
      onStatus(label, progress, autoHide);
    }
  };
  const recordPerformance = (stage, durationMs, details = {}) => {
    if (typeof onPerformance === "function") {
      onPerformance(stage, durationMs, details);
    }
  };

  // Slot STLs carry the same jaw_type but are NOT case jaws: the case's OFF upper
  // is flipped 180° on load and a raw upload isn't, so the arch lands wrong.
  const isCaseJawMesh = (child) => !child.userData?.isDesignSlot;

  const getJawMesh = (jawType) => {
    const jawText = jawType.toLowerCase();
    return parentObject.children.find((child) => {
      if (!isCaseJawMesh(child)) return false;
      const type = String(child.userData?.jaw_type || child.name || "").toLowerCase();
      return type.includes(jawText);
    });
  };

  const applyJawTransform = (target, jawType) => {
    const jawMesh = getJawMesh(jawType);
    if (!jawMesh) return;
    jawMesh.updateMatrixWorld(true);
    target.parent?.updateMatrixWorld(true);

    const parentInverse = target.parent
      ? new THREE.Matrix4().copy(target.parent.matrixWorld).invert()
      : new THREE.Matrix4().identity();
    const localJawMatrix = new THREE.Matrix4().multiplyMatrices(
      parentInverse,
      jawMesh.matrixWorld
    );
    localJawMatrix.decompose(target.position, target.quaternion, target.scale);
    target.updateMatrix();
    target.updateMatrixWorld(true);
  };

  const syncJawGroupTransforms = () => {
    group.children.forEach((child) => {
      if (child.userData?.overlayType !== "artificial-teeth") return;
      const arch = child.userData?.arch;
      if (arch === "upper" || arch === "lower") {
        applyJawTransform(child, arch);
      }
    });
  };

  const attachRootGroup = () => {
    if (group.parent !== scene) {
      group.parent?.remove(group);
      scene.add(group);
    }
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
  };

  const worldToJawLocalPoint = (jawType, point) => {
    const jawMesh = getJawMesh(jawType);
    if (!jawMesh || !isValidPoint(point)) return point;
    jawMesh.updateMatrixWorld(true);
    const vector = new THREE.Vector3(point.x, point.y, point.z);
    jawMesh.worldToLocal(vector);
    return { x: vector.x, y: vector.y, z: vector.z };
  };

  const getClosestJawSurfacePoint = (jawType, point, coordinateSpace = referenceMode) => {
    const jawMesh = getJawMesh(jawType);
    const position = jawMesh?.geometry?.attributes?.position;
    if (!position || !isValidPoint(point)) return null;

    jawMesh.updateMatrixWorld(true);
    let bestPoint = null;
    let bestDistanceSq = Infinity;
    const stride = Math.max(1, Math.floor(position.count / 25000));
    const candidateVector = new THREE.Vector3();

    for (let index = 0; index < position.count; index += stride) {
      candidateVector.set(
        position.getX(index),
        position.getY(index),
        position.getZ(index)
      );
      if (coordinateSpace === "scene-world") {
        jawMesh.localToWorld(candidateVector);
      }
      const dx = point.x - candidateVector.x;
      const dy = point.y - candidateVector.y;
      const dz = point.z - candidateVector.z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestPoint = { x: candidateVector.x, y: candidateVector.y, z: candidateVector.z };
      }
    }

    return bestPoint;
  };

  const getJawSurfaceDistanceInSpace = (jawType, point, coordinateSpace) => {
    const surfacePoint = getClosestJawSurfacePoint(jawType, point, coordinateSpace);
    return surfacePoint ? distanceBetweenPoints(point, surfacePoint) : Infinity;
  };

  const detectArtificialToothCoordinateSpace = (tooth, jawType) => {
    if (!isValidPoint(tooth.position)) return "jaw-local";
    const localDistance = getJawSurfaceDistanceInSpace(jawType, tooth.position, "jaw-local");
    const worldDistance = getJawSurfaceDistanceInSpace(jawType, tooth.position, "scene-world");
    const coordinateSpace =
      Number.isFinite(worldDistance) &&
      (!Number.isFinite(localDistance) || worldDistance + 0.35 < localDistance * 0.72)
        ? "scene-world"
        : "jaw-local";

    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE && coordinateSpace === "scene-world") {
      console.log("[artificial teeth] detected scene-world tooth position", {
        arch: jawType,
        toothIndex: tooth.toothIndex,
        localDistance: Number(localDistance.toFixed(3)),
        worldDistance: Number(worldDistance.toFixed(3)),
      });
    }

    return coordinateSpace;
  };

  const normalizeDatabaseToothReferenceSpace = (tooth, jawType) => {
    if (!isValidPoint(tooth.position)) return tooth;
    const detectedPositionSpace = detectArtificialToothCoordinateSpace(tooth, jawType);
    if (detectedPositionSpace !== "scene-world") {
      return {
        ...tooth,
        source: {
          ...tooth.source,
          positionSpace: tooth.source?.positionSpace || "jaw-local",
          detectedPositionSpace,
        },
      };
    }

    return {
      ...tooth,
      position: worldToJawLocalPoint(jawType, tooth.position),
      source: {
        ...tooth.source,
        positionSpace: "jaw-local",
        detectedPositionSpace,
        toothDataWorldToJawLocal: true,
      },
    };
  };

  const isJawVisible = (arch) => jawVisibility.get(arch) ?? true;
  const getJawOpacity = (arch) => jawOpacity.get(arch) ?? 1;

  const applyArtificialTeethOpacity = (object, opacity) => {
    object.traverse((child) => {
      if (!child.material) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((materialEntry) => {
        if (!materialEntry) return;
        materialEntry.opacity = opacity;
        materialEntry.transparent = opacity < 1;
        materialEntry.depthWrite = opacity >= 0.95;
        materialEntry.needsUpdate = true;
      });
    });
  };

  const syncVisibility = () => {
    group.visible = true;
    group.children.forEach((child) => {
      const arch = child.userData?.arch;
      child.visible = arch ? isJawVisible(arch) : true;
      if (arch) {
        applyArtificialTeethOpacity(child, getJawOpacity(arch));
      }
    });
  };

  const reveal = () => {
    jawVisibility.set("upper", true);
    jawVisibility.set("lower", true);
    group.visible = true;
    group.traverse((child) => {
      if (
        child.userData?.overlayType === "artificial-teeth" ||
        child.userData?.overlayType === "artificial-tooth" ||
        child.userData?.overlayType === "artificial-teeth-guideline"
      ) {
        child.visible = true;
      }
    });
    syncVisibility();
  };

  const syncToJawMeshes = () => {
    syncJawGroupTransforms();
    syncVisibility();
  };

  const updateCameraVisibility = syncToJawMeshes;

  const clear = () => {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject3D(child);
    }
    window.syncComponentPanelRows?.();
  };

  const normalizeResponse = (rawResponse) => {
    const normalized = { upper: [], lower: [] };
    const decodedStageData = decodeToothPlacementData(rawResponse);
    const records = extractToothRecords(decodedStageData || rawResponse);
    let skippedUnknownJaw = 0;

    records.forEach((record) => {
      const arch = record.arch;
      if (arch !== "upper" && arch !== "lower") {
        skippedUnknownJaw += 1;
        return;
      }
      if (!isValidPoint(record.position)) return;
      if (!record.geometry?.vertices?.length) return;
      normalized[arch].push({ ...record, arch });
    });

    if (skippedUnknownJaw) {
      console.warn(
        `[artificial teeth] Skipped ${skippedUnknownJaw} tooth record(s) without database upper/lower jaw.`
      );
    }

    if (decodedStageData) {
      normalized.guidelines = {
        upper: decodedStageData.guideLinesDataUpperJaw_,
        lower: decodedStageData.guideLinesDataLowerJaw_,
      };
      window.lastDecodedToothPlacementData = decodedStageData;
      window.lastDecodedToothPlacementSummary = summarizeDecodedStageData(decodedStageData);
      if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
        console.log("[artificial teeth] decoded ToothPlacementData", {
          upperCraftTeeth: decodedStageData.toothCraftDataUpperJaw_?.teeth?.length ?? 0,
          lowerCraftTeeth: decodedStageData.toothCraftDataLowerJaw_?.teeth?.length ?? 0,
          extractedRecords: records.length,
          summary: window.lastDecodedToothPlacementSummary,
        });
      }
    }

    return normalized;
  };

  const createGeometry = (tooth) => {
    if (tooth.geometry?.vertices?.length >= 3) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(tooth.geometry.vertices.length * 3);
      const sourceCenter = getPointBoundsCenter(tooth.geometry.vertices) || { x: 0, y: 0, z: 0 };
      const useAbsoluteGeometryCenter = looksLikeModelPosition(sourceCenter);
      tooth.geometry.vertices.forEach((point, index) => {
        positions[index * 3] = useAbsoluteGeometryCenter ? point.x - sourceCenter.x : point.x;
        positions[index * 3 + 1] = useAbsoluteGeometryCenter ? point.y - sourceCenter.y : point.y;
        positions[index * 3 + 2] = useAbsoluteGeometryCenter ? point.z - sourceCenter.z : point.z;
      });
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      if (tooth.geometry.indices?.length >= 3) {
        const shouldFlipNativeSurfaceWinding = tooth.geometry.source === "api-surface-mesh-binary";
        const indices = shouldFlipNativeSurfaceWinding
          ? tooth.geometry.indices.flatMap((_, index, source) => {
              if (index % 3 !== 0 || index + 2 >= source.length) return [];
              return [source[index + 2], source[index + 1], source[index]];
            })
          : tooth.geometry.indices;
        geometry.setIndex(indices);
      } else if (tooth.geometry.vertices.length % 3 !== 0) {
        console.warn("[artificial teeth] API mesh vertices had no triangle indices", {
          toothIndex: tooth.toothIndex,
          vertices: tooth.geometry.vertices.length,
        });
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.userData = {
        ...geometry.userData,
        sourceCenter: useAbsoluteGeometryCenter ? sourceCenter : null,
        artificialToothGeometrySource: "api-mesh-vertices",
        vertexCount: tooth.geometry.vertices.length,
        indexCount: tooth.geometry.indices?.length ?? 0,
        triangleWinding: tooth.geometry.source === "api-surface-mesh-binary"
          ? "flipped-from-native-surface-mesh"
          : "as-saved",
      };
      return geometry;
    }

    console.warn("[artificial teeth] skipped tooth without processed API mesh geometry", {
      toothIndex: tooth.toothIndex,
      arch: tooth.arch,
    });
    return null;
  };

  const applyArtificialToothFlip = (mesh, jawType, options = {}) => {
    const includeBaseOrientation = options.includeBaseOrientation !== false;
    if (includeBaseOrientation) {
      if (jawType === "upper" || jawType === "lower") {
        mesh.rotateZ(Math.PI);
      }
      mesh.rotateX(Math.PI);
    }
    mesh.userData.artificialTeethOrientation = includeBaseOrientation
      ? `${jawType}-api-base-rotate-z-180-invert-up-down-180`
      : `${jawType}-api-surface-native`;
  };

  const preserveArtificialToothOrientation = (mesh) => {
    mesh.userData.autoOrientationFlip = {
      applied: false,
      disabled: true,
      reason: "api-orientation-preserved",
    };
  };

  const applyToothTransform = (mesh, tooth, jawType) => {
    const geometryCenter = mesh.geometry?.userData?.sourceCenter;
    const usesAbsoluteApiMesh = looksLikeModelPosition(geometryCenter);
    const hasExplicitPlacement =
      tooth.source?.positionFromToothDataWorld ||
      tooth.source?.positionFromApiMeshCenter ||
      tooth.source?.toothDataWorldToJawLocal;
    const position =
      ARTIFICIAL_TEETH_DATABASE_PLACEMENT_ONLY
        ? tooth.position
        : usesAbsoluteApiMesh && !hasExplicitPlacement
          ? geometryCenter
          : tooth.position;
    mesh.position.set(
      position.x,
      position.y,
      position.z
    );
    if (tooth.source?.geometryFromSurfaceMesh) {
      mesh.userData.transformMode = "api-surface-mesh-native-orientation";
      applyArtificialToothFlip(mesh, jawType, {
        includeBaseOrientation: false,
      });
      preserveArtificialToothOrientation(mesh);
      return;
    }
    if (usesAbsoluteApiMesh && !hasExplicitPlacement) {
      mesh.userData.transformMode = "api-mesh-vertices-in-place";
      applyArtificialToothFlip(mesh, jawType);
      preserveArtificialToothOrientation(mesh);
      return;
    } else if (usesAbsoluteApiMesh) {
      mesh.userData.transformMode = "api-mesh-centered-on-seated-position";
    }

    if (tooth.rotation?.w !== undefined) {
      mesh.quaternion.set(
        tooth.rotation.x,
        tooth.rotation.y,
        tooth.rotation.z,
        tooth.rotation.w
      ).normalize();
      mesh.userData.transformMode = "unity-tooth-data-quaternion";
    } else if (tooth.rotation) {
      const values = [tooth.rotation.x, tooth.rotation.y, tooth.rotation.z];
      const useDegrees = values.some((value) => Math.abs(value) > Math.PI * 2);
      mesh.rotation.set(
        useDegrees ? THREE.MathUtils.degToRad(tooth.rotation.x) : tooth.rotation.x,
        useDegrees ? THREE.MathUtils.degToRad(tooth.rotation.y) : tooth.rotation.y,
        useDegrees ? THREE.MathUtils.degToRad(tooth.rotation.z) : tooth.rotation.z
      );
    }
    applyArtificialToothFlip(mesh, jawType);
    preserveArtificialToothOrientation(mesh);
    if (tooth.scale) {
      if (tooth.source?.geometryFromSurfaceMesh) {
        mesh.userData.scaleMode = "native-surface-mesh";
        return;
      }

      const hasApiSizing =
        Number.isFinite(tooth.transform?.mesialDistalSizing) &&
        tooth.transform.mesialDistalSizing > 0;
      const template = getToothTemplate(tooth.toothIndex);
      const clinicalWidthByTemplate = getClinicalToothDimensions(template).x;
      const basisScale = hasApiSizing
        ? Math.max(0.68, Math.min(1.35, tooth.transform.mesialDistalSizing / clinicalWidthByTemplate))
        : null;
      const scale = tooth.source?.geometryFromToothData
        ? new THREE.Vector3(tooth.scale.x, tooth.scale.y, tooth.scale.z)
        : hasApiSizing
          ? new THREE.Vector3(
              basisScale,
              THREE.MathUtils.lerp(1, basisScale, 0.28),
              THREE.MathUtils.lerp(1, basisScale, 0.45)
            )
          : getStableProceduralScale(tooth.scale, template);
      mesh.scale.multiply(scale);
      mesh.userData.scaleMode = tooth.source?.geometryFromToothData
        ? "unity-tooth-data-scale"
        : hasApiSizing
          ? "api-mesial-distal-sizing"
          : "stable-api-scale";
    }
  };

  const applyArtificialToothDepthShader = (meshMaterial) => {
    meshMaterial.polygonOffset = true;
    meshMaterial.polygonOffsetFactor = -2;
    meshMaterial.polygonOffsetUnits = -2;
    meshMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        gl_Position.z -= ${ARTIFICIAL_TOOTH_SHADER_DEPTH_BIAS.toFixed(8)} * gl_Position.w;`
      );
    };
    meshMaterial.userData = {
      ...meshMaterial.userData,
      artificialToothDepthShader: true,
      artificialToothShaderDepthBias: ARTIFICIAL_TOOTH_SHADER_DEPTH_BIAS,
    };
  };

  const createMesh = (jawType, tooth, toothIndex) => {
    const geometry = createGeometry(tooth);
    if (!geometry) return null;
    const meshMaterial = material.clone();
    meshMaterial.transparent = false;
    meshMaterial.opacity = 1;
    meshMaterial.depthTest = true;
    meshMaterial.depthWrite = true;
    applyArtificialToothDepthShader(meshMaterial);
    meshMaterial.needsUpdate = true;
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.name = `${jawType}-artificial-tooth-${tooth.toothIndex ?? toothIndex}`;
    mesh.renderOrder = 30;
    mesh.userData = {
      overlayType: "artificial-tooth",
      selectable: true,
      arch: jawType,
      toothIndex: tooth.toothIndex ?? toothIndex,
      toothTemplate: tooth.toothTemplate ?? geometry.userData?.toothTemplate,
      source: tooth.source,
      geometrySource: geometry.userData?.artificialToothGeometrySource,
      vertexCount: geometry.userData?.vertexCount,
      indexCount: geometry.userData?.indexCount,
    };
    applyToothTransform(mesh, tooth, jawType);
    return mesh;
  };

  const getClosestRenderedToothSurfaceSample = (mesh, jawType) => {
    const position = mesh.geometry?.attributes?.position;
    if (!position?.count) return null;

    mesh.updateMatrixWorld(true);
    let closest = null;
    const vertex = new THREE.Vector3();
    const stride = Math.max(1, Math.floor(position.count / 96));

    for (let index = 0; index < position.count; index += stride) {
      vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const surfacePoint = getClosestJawSurfacePoint(
        jawType,
        { x: vertex.x, y: vertex.y, z: vertex.z },
        "scene-world"
      );
      if (!surfacePoint) continue;

      const surfaceVector = new THREE.Vector3(surfacePoint.x, surfacePoint.y, surfacePoint.z);
      const distance = vertex.distanceTo(surfaceVector);
      if (!closest || distance < closest.distance) {
        closest = {
          distance,
          vertex: vertex.clone(),
          surface: surfaceVector,
        };
      }
    }

    return closest;
  };

  const getGuidelineEditorPointSets = (lineData) =>
    extractGuidelinePointSets(lineData)
      .filter((points) => points.length >= 2 && looksLikeMeshBounds(points))
      .sort((a, b) => polylineLength(b) - polylineLength(a));

  const getMedianFiniteValue = (values) => {
    const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!finiteValues.length) return Infinity;
    return finiteValues[Math.floor(finiteValues.length / 2)];
  };

  const detectGuidelinePointSetCoordinateSpace = (jawType, points) => {
    if (!points?.length) return "jaw-local";
    const stride = Math.max(1, Math.floor(points.length / 24));
    const sampledPoints = points.filter((_, index) => index % stride === 0).slice(0, 32);
    const localDistances = sampledPoints.map((point) =>
      getJawSurfaceDistanceInSpace(jawType, point, "jaw-local")
    );
    const worldDistances = sampledPoints.map((point) =>
      getJawSurfaceDistanceInSpace(jawType, point, "scene-world")
    );
    const localMedian = getMedianFiniteValue(localDistances);
    const worldMedian = getMedianFiniteValue(worldDistances);
    return Number.isFinite(worldMedian) && worldMedian + 0.35 < localMedian * 0.72
      ? "scene-world"
      : "jaw-local";
  };

  const normalizeGuidelineVisualPoints = (jawType, points) => {
    const coordinateSpace = detectGuidelinePointSetCoordinateSpace(jawType, points);
    if (coordinateSpace !== "scene-world") {
      return { points, coordinateSpace };
    }
    return {
      points: points.map((point) => worldToJawLocalPoint(jawType, point)),
      coordinateSpace,
    };
  };

  const createGuidelineVisualLine = (jawType, lineType, points, index) => {
    if (!points?.length || points.length < 2) return null;
    const normalized = normalizeGuidelineVisualPoints(jawType, points);
    const vectors = normalized.points.map((point) => new THREE.Vector3(point.x, point.y, point.z));
    const curve = vectors.length > 2
      ? new THREE.CatmullRomCurve3(vectors, false, "centripetal", 0.25)
      : new THREE.LineCurve3(vectors[0], vectors[1]);
    const geometry = new THREE.TubeGeometry(
      curve,
      Math.max(1, points.length * 2),
      lineType === "buccal" ? 0.34 : 0.28,
      8,
      false
    );
    const line = new THREE.Mesh(
      geometry,
      guidelineVisualMaterials[jawType][lineType].clone()
    );
    line.name = `${jawType}-artificial-teeth-${lineType}-guideline-${index}`;
    line.renderOrder = ARTIFICIAL_GUIDELINE_RENDER_ORDER_BASE + index;
    line.userData = {
      overlayType: "artificial-teeth-guideline",
      arch: jawType,
      source: lineType,
      visualAidOnly: true,
      pointCount: points.length,
      pointSetIndex: index,
      coordinateSpace: normalized.coordinateSpace,
    };
    return line;
  };

  const getGuidelineDistanceSummary = (jawType, points, coordinateSpace) => {
    const distances = (points || [])
      .filter(isValidPoint)
      .map((point) => getJawSurfaceDistanceInSpace(jawType, point, coordinateSpace))
      .filter(Number.isFinite);
    return getDistanceStats(distances);
  };

  const createGuidelineVisualGroup = (jawType, guideData) => {
    if (!guideData) return null;
    const guidelineGroup = new THREE.Group();
    guidelineGroup.name = `${jawType}-artificial-teeth-guidelines`;
    guidelineGroup.userData = {
      overlayType: "artificial-teeth-guideline",
      arch: jawType,
      source: "toothPlacementData",
      visualAidOnly: true,
    };

    [
      ["buccalLineEditorData_", "buccal"],
      ["gingivalLineEditorData_", "gingival"],
    ].forEach(([key, lineType]) => {
      getGuidelineEditorPointSets(guideData[key]).forEach((points, index) => {
        const line = createGuidelineVisualLine(jawType, lineType, points, index);
        if (line) guidelineGroup.add(line);
      });
    });

    return guidelineGroup.children.length ? guidelineGroup : null;
  };

  const summarizeGuidelinePointSets = (arch, guideData) => {
    const fields = [
      ["buccalLineEditorData_", "buccal"],
      ["gingivalLineEditorData_", "gingival"],
    ];
    return fields.map(([key, label]) => {
      const rawLineData = guideData?.[key];
      const unwrappedLineData = decodeSerializedWrapper(rawLineData);
      const pointSets = getGuidelineEditorPointSets(guideData?.[key]);
      return {
        arch,
        line: label,
        sets: pointSets.length,
        lengths: pointSets.map((points) => points.length).join(","),
        longest: pointSets[0]?.length ?? 0,
        length: pointSets[0] ? Number(polylineLength(pointSets[0]).toFixed(3)) : null,
        shape: describeValueShape(rawLineData),
        unwrappedShape: describeValueShape(unwrappedLineData),
        rawPreview: previewSerializableValue(rawLineData),
        unwrappedPreview: previewSerializableValue(unwrappedLineData),
      };
    });
  };

  const auditArtificialTeethGuidelines = () => {
    const decoded = window.lastDecodedToothPlacementData;
    const rows = [
      ...summarizeGuidelinePointSets("upper", decoded?.guideLinesDataUpperJaw_),
      ...summarizeGuidelinePointSets("lower", decoded?.guideLinesDataLowerJaw_),
    ];
    const rendered = [];
    group.traverse((child) => {
      if (child.userData?.overlayType === "artificial-teeth-guideline") {
        rendered.push({
          name: child.name,
          arch: child.userData.arch,
          source: child.userData.source,
          coordinateSpace: child.userData.coordinateSpace || null,
          pointCount: child.userData.pointCount ?? null,
          pointSetIndex: child.userData.pointSetIndex ?? null,
          children: child.children?.length ?? 0,
          visible: child.visible,
        });
      }
    });
    const report = { decoded: rows, rendered };
    window.lastArtificialTeethGuidelineAudit = report;
    console.table(rows);
    console.table(rendered);
    return report;
  };

  const auditArtificialTeethGuidelineAlignment = () => {
    const startedAt = performance.now();
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const decoded = window.lastDecodedToothPlacementData;
    const rows = [];

    const jawLocalPointsToWorld = (jawType, points) => {
      const jawMesh = getJawMesh(jawType);
      if (!jawMesh) return [];
      jawMesh.updateMatrixWorld(true);
      return (points || []).filter(isValidPoint).map((point) => {
        const vector = new THREE.Vector3(point.x, point.y, point.z);
        jawMesh.localToWorld(vector);
        return { x: vector.x, y: vector.y, z: vector.z };
      });
    };

    [
      ["upper", decoded?.guideLinesDataUpperJaw_],
      ["lower", decoded?.guideLinesDataLowerJaw_],
    ].forEach(([arch, guideData]) => {
      [
        ["buccalLineEditorData_", "buccal"],
        ["gingivalLineEditorData_", "gingival"],
      ].forEach(([key, line]) => {
        getGuidelineEditorPointSets(guideData?.[key]).forEach((rawPoints, pointSetIndex) => {
          const chosenCoordinateSpace = detectGuidelinePointSetCoordinateSpace(arch, rawPoints);
          const jawLocalPoints = chosenCoordinateSpace === "scene-world"
            ? rawPoints.map((point) => worldToJawLocalPoint(arch, point))
            : rawPoints;
          const renderedWorldPoints = jawLocalPointsToWorld(arch, jawLocalPoints);
          const renderedWorldStats = getGuidelineDistanceSummary(
            arch,
            renderedWorldPoints,
            "scene-world"
          );
          rows.push({
            arch,
            line,
            pointSetIndex,
            pointCount: rawPoints.length,
            chosenCoordinateSpace,
            rawAsJawLocalMedian: getGuidelineDistanceSummary(arch, rawPoints, "jaw-local").median,
            rawAsSceneWorldMedian: getGuidelineDistanceSummary(arch, rawPoints, "scene-world").median,
            renderedWorldMedian: renderedWorldStats.median,
            renderedWorldMin: renderedWorldStats.min,
            renderedWorldMax: renderedWorldStats.max,
            tubeRadius: line === "buccal" ? 0.34 : 0.28,
            visualColor: line === "buccal" ? "orange" : "blue",
            visualAidOnly: true,
            affectsTeeth: false,
          });
        });
      });
    });

    rows.sort((a, b) =>
      `${a.arch}-${a.line}-${a.pointSetIndex}`.localeCompare(
        `${b.arch}-${b.line}-${b.pointSetIndex}`
      )
    );
    const auditMs = Number((performance.now() - startedAt).toFixed(2));
    window.lastArtificialTeethGuidelineAlignmentAudit = rows;
    window.lastArtificialTeethGuidelineAlignmentAuditMs = auditMs;
    console.table(rows);
    console.log("[artificial teeth] guideline alignment audit", {
      auditMs,
      rows: rows.length,
      loadTimeImpact: "manual audit only",
    });
    return rows;
  };

  let artificialTeethRenderTimerActive = false;
  let artificialTeethRenderStartedAt = 0;

  const renderData = (toothByJaw) => {
    artificialTeethRenderStartedAt = performance.now();
    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
      console.time("viewer: artificial teeth loading/rendering");
    }
    artificialTeethRenderTimerActive = true;
    lastNormalizedTeeth = toothByJaw;
    attachRootGroup();
    clear();
    window.lastArtificialTeethRenderSummary = summarizeToothRenderData(toothByJaw);
    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
      console.log("[artificial teeth] render summary", window.lastArtificialTeethRenderSummary);
    }
    jawVisibility.set("upper", true);
    jawVisibility.set("lower", true);
    const createdCounts = { upper: 0, lower: 0 };
    for (const jawType of ["upper", "lower"]) {
      const teeth = toothByJaw[jawType] || [];
      if (!teeth.length) continue;
      const renderTeeth = teeth.map((tooth) =>
        normalizeDatabaseToothReferenceSpace(tooth, jawType)
      );

      const jawGroup = new THREE.Group();
      jawGroup.name = `${jawType}-artificial-teeth`;
      jawGroup.userData = { overlayType: "artificial-teeth", arch: jawType };
      jawGroup.visible = isJawVisible(jawType);
      const guidelineVisualGroup = createGuidelineVisualGroup(
        jawType,
        toothByJaw.guidelines?.[jawType]
      );
      if (guidelineVisualGroup) jawGroup.add(guidelineVisualGroup);
      for (let index = 0; index < renderTeeth.length; index += 1) {
        const tooth = renderTeeth[index];
        const mesh = createMesh(jawType, tooth, index);
        if (mesh) {
          jawGroup.add(mesh);
          createdCounts[jawType] += 1;
        }
      }
      applyJawTransform(jawGroup, jawType);
      group.add(jawGroup);
    }
    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
      console.log("[artificial teeth] rendered meshes", createdCounts);
    }
    reveal();
    window.lastArtificialTeethRenderCounts = createdCounts;
    window.syncComponentPanelRows?.();
    auditArtificialTeeth({ logToConsole: LOG_ARTIFICIAL_TEETH_AUTO_AUDIT_TO_CONSOLE });
    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
      console.timeEnd("viewer: artificial teeth loading/rendering");
    }
    recordPerformance(
      "artificial teeth loading/rendering",
      performance.now() - artificialTeethRenderStartedAt,
      { upper: createdCounts.upper, lower: createdCounts.lower }
    );
    artificialTeethRenderTimerActive = false;
  };

  const getGuidelinePointCount = (guideData) =>
    extractPointSets(guideData).reduce((count, points) => count + points.length, 0);

  const getToothCenterDistanceStatsToJaw = (arch, teeth, jawMesh) => {
    if (!jawMesh || !teeth?.length) return { count: 0, median: null, max: null };
    const distances = teeth
      .map((tooth) => tooth.position)
      .filter(isValidPoint)
      .map((point) => {
        const surfacePoint = getClosestJawSurfacePoint(arch, point, "jaw-local");
        return surfacePoint ? distanceBetweenPoints(point, surfacePoint) : null;
      })
      .filter((distance) => distance !== null && Number.isFinite(distance));
    return getDistanceStats(distances);
  };

  const auditJawSourceMapping = () => {
    const decoded = window.lastDecodedToothPlacementData;
    const rows = ["upper", "lower"].map((arch) => {
      const craftData = arch === "upper"
        ? decoded?.toothCraftDataUpperJaw_
        : decoded?.toothCraftDataLowerJaw_;
      const guideData = arch === "upper"
        ? decoded?.guideLinesDataUpperJaw_
        : decoded?.guideLinesDataLowerJaw_;
      const jawMesh = getJawMesh(arch);
      const teeth = lastNormalizedTeeth?.[arch] || [];
      const oppositeArch = arch === "upper" ? "lower" : "upper";
      const oppositeJawMesh = getJawMesh(oppositeArch);
      const ownDistance = getToothCenterDistanceStatsToJaw(arch, teeth, jawMesh);
      const oppositeDistance = getToothCenterDistanceStatsToJaw(oppositeArch, teeth, oppositeJawMesh);

      return {
        arch,
        apiCraftField: arch === "upper" ? "toothCraftDataUpperJaw_" : "toothCraftDataLowerJaw_",
        apiGuidelineField: arch === "upper" ? "guideLinesDataUpperJaw_" : "guideLinesDataLowerJaw_",
        jawMesh: jawMesh?.name || jawMesh?.userData?.jaw_type || null,
        normalizedTeeth: teeth.length,
        craftTeeth: craftData?.teeth?.length ?? 0,
        craftIndices: (craftData?.teeth || []).map((tooth) => String(tooth.toothIndex)),
        guidelinePoints: getGuidelinePointCount(guideData),
        medianDistanceToOwnJaw: ownDistance.median,
        medianDistanceToOppositeJaw: oppositeDistance.median,
        closerToOwnJaw:
          ownDistance.median !== null &&
          (oppositeDistance.median === null || ownDistance.median <= oppositeDistance.median),
      };
    });
    console.table(rows.map((row) => ({
      arch: row.arch,
      apiCraftField: row.apiCraftField,
      apiGuidelineField: row.apiGuidelineField,
      jawMesh: row.jawMesh,
      normalizedTeeth: row.normalizedTeeth,
      craftTeeth: row.craftTeeth,
      guidelinePoints: row.guidelinePoints,
      medianDistanceToOwnJaw: row.medianDistanceToOwnJaw,
      medianDistanceToOppositeJaw: row.medianDistanceToOppositeJaw,
      closerToOwnJaw: row.closerToOwnJaw,
      craftIndices: row.craftIndices.join(","),
    })));
    window.lastArtificialTeethJawSourceAudit = rows;
    return rows;
  };

  const setJawVisibility = (arch, isVisible) => {
    if (arch !== "upper" && arch !== "lower") return;
    jawVisibility.set(arch, Boolean(isVisible));
    syncVisibility();
  };

  const setJawOpacity = (arch, opacity) => {
    if (arch !== "upper" && arch !== "lower") return;
    const normalizedOpacity = Math.max(0, Math.min(1, Number(opacity)));
    jawOpacity.set(arch, Number.isFinite(normalizedOpacity) ? normalizedOpacity : 1);
    syncVisibility();
  };

  const getJawVisibility = (arch) => isJawVisible(arch);

  const hasRenderedTeeth = () => {
    let count = 0;
    group.traverse((child) => {
      if (child.userData?.overlayType === "artificial-tooth") count += 1;
    });
    return count > 0;
  };

  const hasArtificialTeethJaw = (arch) => {
    let hasContent = false;
    group.traverse((child) => {
      if (
        child.userData?.overlayType === "artificial-tooth" &&
        child.userData?.arch === arch
      ) {
        hasContent = true;
      }
    });
    return hasContent;
  };

  const getArtificialToothMeshes = () => {
    const meshes = [];
    group.traverse((child) => {
      if (child.userData?.overlayType === "artificial-tooth" && child.isMesh) {
        meshes.push(child);
      }
    });
    return meshes;
  };

  const getDistanceStats = (values) => {
    const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!finiteValues.length) {
      return { count: 0, min: null, median: null, p90: null, max: null };
    }
    return {
      count: finiteValues.length,
      min: Number(finiteValues[0].toFixed(3)),
      median: Number(finiteValues[Math.floor(finiteValues.length / 2)].toFixed(3)),
      p90: Number(finiteValues[Math.floor(finiteValues.length * 0.9)].toFixed(3)),
      max: Number(finiteValues[finiteValues.length - 1].toFixed(3)),
    };
  };

  const getBoxSummary = (box) => {
    if (!box || box.isEmpty()) return null;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    return {
      center: {
        x: Number(center.x.toFixed(3)),
        y: Number(center.y.toFixed(3)),
        z: Number(center.z.toFixed(3)),
      },
      size: {
        x: Number(size.x.toFixed(3)),
        y: Number(size.y.toFixed(3)),
        z: Number(size.z.toFixed(3)),
      },
    };
  };

  const sortToothIndices = (indices) => [...new Set(indices)]
    .map((index) => String(index))
    .sort((a, b) => {
      const numericA = Number(a.match(/\d+/)?.[0]);
      const numericB = Number(b.match(/\d+/)?.[0]);
      if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
      return a.localeCompare(b);
    });

  const getDecodedCraftIndices = (arch) => {
    const craftData = arch === "upper"
      ? window.lastDecodedToothPlacementData?.toothCraftDataUpperJaw_
      : window.lastDecodedToothPlacementData?.toothCraftDataLowerJaw_;
    const fromTeeth = (craftData?.teeth || [])
      .map((tooth) => tooth.toothIndex)
      .filter((index) => index !== undefined && index !== null);
    if (fromTeeth.length) return sortToothIndices(fromTeeth);
    return sortToothIndices(Object.keys(craftData?.toothData_ || {}));
  };

  const getExpectedCraftIndices = (arch) => {
    const decoded = getDecodedCraftIndices(arch).map((index) => Number(String(index).match(/\d+/)?.[0]));
    const finite = decoded.filter(Number.isFinite);
    const usesZeroBased = finite.some((index) => index === 0) || finite.every((index) => index >= 0 && index <= 15);
    return usesZeroBased
      ? Array.from({ length: 16 }, (_, index) => String(index))
      : Array.from({ length: 16 }, (_, index) => String(index + 1));
  };

  const toVector3 = (point) => isValidPoint(point)
    ? new THREE.Vector3(point.x, point.y, point.z)
    : null;

  const getAngleDegrees = (a, b, ignoreDirection = false) => {
    const vectorA = toVector3(a);
    const vectorB = toVector3(b);
    if (!vectorA || !vectorB || vectorA.lengthSq() < 0.000001 || vectorB.lengthSq() < 0.000001) {
      return null;
    }
    vectorA.normalize();
    vectorB.normalize();
    const dot = THREE.MathUtils.clamp(vectorA.dot(vectorB), -1, 1);
    const comparableDot = ignoreDirection ? Math.abs(dot) : dot;
    return Number(THREE.MathUtils.radToDeg(Math.acos(comparableDot)).toFixed(2));
  };

  const getWorldAxis = (mesh, axis) => {
    const quaternion = new THREE.Quaternion();
    mesh.getWorldQuaternion(quaternion);
    return axis.clone().applyQuaternion(quaternion).normalize();
  };

  const getMeshWorldAxes = (mesh) => [
    getWorldAxis(mesh, new THREE.Vector3(1, 0, 0)),
    getWorldAxis(mesh, new THREE.Vector3(0, 1, 0)),
    getWorldAxis(mesh, new THREE.Vector3(0, 0, 1)),
  ];

  const getAxisAgreementAngle = (mesh, vector, ignoreDirection = true) => {
    const target = toVector3(vector);
    if (!target || target.lengthSq() < 0.000001) return null;
    target.normalize();
    const bestDot = getMeshWorldAxes(mesh).reduce((best, axis) => {
      const dot = axis.dot(target);
      return Math.max(best, ignoreDirection ? Math.abs(dot) : dot);
    }, -Infinity);
    if (!Number.isFinite(bestDot)) return null;
    return Number(
      THREE.MathUtils.radToDeg(
        Math.acos(THREE.MathUtils.clamp(bestDot, -1, 1))
      ).toFixed(2)
    );
  };

  const getMeshWorldCenter = (mesh) => {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return null;
    const center = new THREE.Vector3();
    box.getCenter(center);
    return center;
  };

  const getToothByIndex = (arch, toothIndex) => {
    const key = String(toothIndex);
    return (lastNormalizedTeeth?.[arch] || []).find(
      (tooth) => String(tooth.toothIndex) === key
    );
  };

  const getCraftKeys = (arch) => {
    const craftData = arch === "upper"
      ? window.lastDecodedToothPlacementData?.toothCraftDataUpperJaw_
      : window.lastDecodedToothPlacementData?.toothCraftDataLowerJaw_;
    const keys = new Set();
    (craftData?.teeth || []).forEach((tooth) => {
      if (tooth.toothIndex !== undefined && tooth.toothIndex !== null) {
        keys.add(String(tooth.toothIndex));
      }
    });
    [
      craftData?.toothData_,
      craftData?.toothSurfaceMeshData_,
      craftData?.toothTransformInterfaceData_,
      craftData?.initialToothSurfaceMeshData_,
      craftData?.initialToothTransformInterfaceData_,
    ].forEach((dict) => {
      Object.keys(dict || {}).forEach((key) => keys.add(String(key)));
    });
    return sortToothIndices(Array.from(keys));
  };

  const auditArtificialTeethApiMapping = () => {
    const startedAt = performance.now();
    group.updateMatrixWorld(true);
    const meshesByArchAndIndex = new Map();
    getArtificialToothMeshes().forEach((mesh) => {
      meshesByArchAndIndex.set(`${mesh.userData?.arch}:${mesh.userData?.toothIndex}`, mesh);
    });

    const rows = ["upper", "lower"].flatMap((arch) =>
      getCraftKeys(arch).map((toothIndex) => {
        const tooth = getToothByIndex(arch, toothIndex);
        const mesh = meshesByArchAndIndex.get(`${arch}:${toothIndex}`);
        const source = tooth?.source || {};
        const positionSource = source.positionFromToothDataWorld
          ? "toothData"
          : source.positionFromApiMeshCenter
            ? "apiMeshCenter"
              : null;
        const geometrySource = source.geometryFromSurfaceMesh
          ? "surfaceMesh"
          : source.geometryFromToothData
            ? "toothData"
            : null;
        return {
          arch,
          apiKey: toothIndex,
          normalized: Boolean(tooth),
          rendered: Boolean(mesh),
          renderedIndex: mesh?.userData?.toothIndex ?? null,
          toothDataIndex: source.toothDataIndex ?? null,
          geometrySource,
          positionSource,
          positionField: source.positionFromUnityToothDataField ?? null,
          directApiMapping: Boolean(source.databaseMappedDirect),
          transformLandmarksUsedForPlacement: Boolean(source.transformLandmarksUsedForPlacement),
          guidelineUsedForPlacement: Boolean(source.guidelineUsedForPlacement),
          autoFlip: mesh?.userData?.autoOrientationFlip?.applied
            ? mesh.userData.autoOrientationFlip.flip
            : null,
        };
      })
    );

    const auditMs = Number((performance.now() - startedAt).toFixed(2));
    window.lastArtificialTeethApiMappingAudit = rows;
    window.lastArtificialTeethApiMappingAuditMs = auditMs;
    console.table(rows);
    console.log("[artificial teeth] API mapping audit", {
      auditMs,
      rows: rows.length,
      missingNormalized: rows.filter((row) => !row.normalized).length,
      missingRendered: rows.filter((row) => row.normalized && !row.rendered).length,
      loadTimeImpact: "manual audit only",
    });
    return rows;
  };

  const auditArtificialTeethToothDataLayout = (arch = "upper") => {
    const craftData = arch === "upper"
      ? window.lastDecodedToothPlacementData?.toothCraftDataUpperJaw_
      : window.lastDecodedToothPlacementData?.toothCraftDataLowerJaw_;
    const rows = getCraftKeys(arch).flatMap((toothIndex) => {
      const toothData = craftData?.toothData_?.[toothIndex];
      const tooth = getToothByIndex(arch, toothIndex);
      if (!toothData || !tooth) return [];
      const meshCenter = getPointBoundsCenter(tooth.geometry?.vertices);
      const candidateKeys = [7, 9, 10, 12];
      return candidateKeys.flatMap((key) => {
        const point = toPointObject(toothData[key]);
        if (!isValidPoint(point)) return [];
        return [{
          arch,
          toothIndex,
          toothName: toothData[2] ?? null,
          field: key,
          value: {
            x: Number(point.x.toFixed(3)),
            y: Number(point.y.toFixed(3)),
            z: Number(point.z.toFixed(3)),
          },
          distanceToApiMeshCenter: isValidPoint(meshCenter)
            ? Number(distanceBetweenPoints(point, meshCenter).toFixed(3))
            : null,
          jawLocalSurfaceDistance: Number.isFinite(getJawSurfaceDistanceInSpace(arch, point, "jaw-local"))
            ? Number(getJawSurfaceDistanceInSpace(arch, point, "jaw-local").toFixed(3))
            : null,
          currentPositionSource: tooth.source?.positionFromToothDataWorld
            ? "toothData"
            : tooth.source?.positionFromApiMeshCenter
              ? "apiMeshCenter"
              : null,
          currentPositionDistance: isValidPoint(tooth.position)
            ? Number(distanceBetweenPoints(point, tooth.position).toFixed(3))
            : null,
        }];
      });
    });

    rows.sort((a, b) =>
      Number(a.toothIndex) - Number(b.toothIndex) ||
      a.field - b.field
    );
    window.lastArtificialTeethToothDataLayoutAudit = rows;
    console.table(rows);
    return rows;
  };

  const auditToothOrientation = (arch, mesh) => {
    const tooth = getToothByIndex(arch, mesh.userData?.toothIndex);
    const transform = tooth?.transform;
    if (!transform) {
      return {
        toothIndex: String(mesh.userData?.toothIndex),
        hasTransform: false,
        likelyAngleAligned: null,
      };
    }

    const mdAxis = getWorldAxis(mesh, new THREE.Vector3(1, 0, 0));
    const gingivalBuccalAxis = getWorldAxis(mesh, new THREE.Vector3(0, 1, 0));
    const depthAxis = getWorldAxis(mesh, new THREE.Vector3(0, 0, 1));
    const apiGingivalBuccal = {
      x: transform.buccalPoint?.x - transform.gingivalPoint?.x,
      y: transform.buccalPoint?.y - transform.gingivalPoint?.y,
      z: transform.buccalPoint?.z - transform.gingivalPoint?.z,
    };

    const mesialDistalAxisAngle = getAngleDegrees(mdAxis, transform.mesialDistalLine, true);
    const gingivalBuccalAxisAngle = getAngleDegrees(gingivalBuccalAxis, apiGingivalBuccal, true);
    const buccalDirectionalAngle = getAngleDegrees(depthAxis, transform.buccalDirection, false);
    const buccalAxisAngle = getAngleDegrees(depthAxis, transform.buccalDirection, true);
    const likelyAngleAligned = [mesialDistalAxisAngle, gingivalBuccalAxisAngle, buccalAxisAngle]
      .filter((value) => value !== null)
      .every((value) => value <= 35);

    return {
      toothIndex: String(mesh.userData?.toothIndex),
      hasTransform: true,
      transformMode: mesh.userData?.transformMode || null,
      autoOrientationFlip: mesh.userData?.autoOrientationFlip || null,
      mesialDistalAxisAngle,
      gingivalBuccalAxisAngle,
      buccalAxisAngle,
      buccalDirectionalAngle,
      likelyAngleAligned,
    };
  };

  const summarizeOrientationRows = (rows) => {
    const comparableRows = rows.filter((row) => row.hasTransform);
    const getStatsForKey = (key) => getDistanceStats(
      comparableRows
        .map((row) => row[key])
        .filter((value) => value !== null)
    );
    return {
      checked: comparableRows.length,
      likelyAligned: comparableRows.filter((row) => row.likelyAngleAligned).length,
      likelyMisaligned: comparableRows.filter((row) => row.likelyAngleAligned === false).length,
      mesialDistalAxisAngle: getStatsForKey("mesialDistalAxisAngle"),
      gingivalBuccalAxisAngle: getStatsForKey("gingivalBuccalAxisAngle"),
      buccalAxisAngle: getStatsForKey("buccalAxisAngle"),
      worst: comparableRows
        .map((row) => ({
          toothIndex: row.toothIndex,
          maxAxisAngle: Math.max(
            row.mesialDistalAxisAngle ?? 0,
            row.gingivalBuccalAxisAngle ?? 0,
            row.buccalAxisAngle ?? 0
          ),
          buccalDirectionalAngle: row.buccalDirectionalAngle,
          transformMode: row.transformMode,
          autoOrientationFlip: row.autoOrientationFlip,
        }))
        .sort((a, b) => b.maxAxisAngle - a.maxAxisAngle)
        .slice(0, 5),
    };
  };

  const auditPlacementAngles = (arch, archMeshes) => {
    const byIndex = new Map(
      archMeshes.map((mesh) => [String(mesh.userData?.toothIndex), mesh])
    );
    const ordered = sortToothIndices(Array.from(byIndex.keys()))
      .map((index) => byIndex.get(index))
      .filter(Boolean);

    const centers = new Map();
    ordered.forEach((mesh) => {
      const center = getMeshWorldCenter(mesh);
      if (center) centers.set(String(mesh.userData?.toothIndex), center);
    });

    const rows = ordered.map((mesh, orderedIndex) => {
      const toothIndex = String(mesh.userData?.toothIndex);
      const center = centers.get(toothIndex);
      const surfacePoint = center
        ? getClosestJawSurfacePoint(
            arch,
            { x: center.x, y: center.y, z: center.z },
            "scene-world"
          )
        : null;
      const surfaceOffset = surfacePoint && center
        ? {
            x: center.x - surfacePoint.x,
            y: center.y - surfacePoint.y,
            z: center.z - surfacePoint.z,
          }
        : null;

      const previousCenter = orderedIndex > 0
        ? centers.get(String(ordered[orderedIndex - 1].userData?.toothIndex))
        : null;
      const nextCenter = orderedIndex < ordered.length - 1
        ? centers.get(String(ordered[orderedIndex + 1].userData?.toothIndex))
        : null;
      const tangent = previousCenter && nextCenter
        ? {
            x: nextCenter.x - previousCenter.x,
            y: nextCenter.y - previousCenter.y,
            z: nextCenter.z - previousCenter.z,
          }
        : nextCenter && center
          ? {
              x: nextCenter.x - center.x,
              y: nextCenter.y - center.y,
              z: nextCenter.z - center.z,
            }
          : previousCenter && center
            ? {
                x: center.x - previousCenter.x,
                y: center.y - previousCenter.y,
                z: center.z - previousCenter.z,
              }
            : null;

      const surfaceNormalAxisAngle = getAxisAgreementAngle(mesh, surfaceOffset, true);
      const archTangentAxisAngle = getAxisAgreementAngle(mesh, tangent, true);
      const likelyPlacementAngleAligned =
        (surfaceNormalAxisAngle === null || surfaceNormalAxisAngle <= 35) &&
        (archTangentAxisAngle === null || archTangentAxisAngle <= 35);

      return {
        toothIndex,
        surfaceNormalAxisAngle,
        archTangentAxisAngle,
        likelyPlacementAngleAligned,
      };
    });

    return {
      checked: rows.length,
      likelyAligned: rows.filter((row) => row.likelyPlacementAngleAligned).length,
      likelyMisaligned: rows.filter((row) => row.likelyPlacementAngleAligned === false).length,
      surfaceNormalAxisAngle: getDistanceStats(
        rows.map((row) => row.surfaceNormalAxisAngle).filter((value) => value !== null)
      ),
      archTangentAxisAngle: getDistanceStats(
        rows.map((row) => row.archTangentAxisAngle).filter((value) => value !== null)
      ),
      worst: rows
        .map((row) => ({
          toothIndex: row.toothIndex,
          maxAngle: Math.max(row.surfaceNormalAxisAngle ?? 0, row.archTangentAxisAngle ?? 0),
          surfaceNormalAxisAngle: row.surfaceNormalAxisAngle,
          archTangentAxisAngle: row.archTangentAxisAngle,
        }))
        .sort((a, b) => b.maxAngle - a.maxAngle)
        .slice(0, 5),
      rows,
    };
  };

  const auditJawAlignment = (arch, meshes) => {
    const jawMesh = getJawMesh(arch);
    const archMeshes = meshes.filter((mesh) => mesh.userData?.arch === arch);
    const decodedIndices = getDecodedCraftIndices(arch);
    const normalizedIndices = sortToothIndices(
      (lastNormalizedTeeth?.[arch] || [])
        .map((tooth) => tooth.toothIndex)
        .filter((index) => index !== undefined && index !== null)
    );
    const renderedIndices = sortToothIndices(
      archMeshes
        .map((mesh) => mesh.userData?.toothIndex)
        .filter((index) => index !== undefined && index !== null)
    );
    const expectedIndices = getExpectedCraftIndices(arch);
    const missingFromDecoded = expectedIndices.filter((index) => !decodedIndices.includes(index));
    const missingFromRendered = decodedIndices.filter((index) => !renderedIndices.includes(index));
    const orientationRows = archMeshes.map((mesh) => auditToothOrientation(arch, mesh));
    const orientation = summarizeOrientationRows(orientationRows);
    const placementAngle = auditPlacementAngles(arch, archMeshes);
    const toothBox = new THREE.Box3();
    const jawBox = new THREE.Box3();
    const center = new THREE.Vector3();
    const distances = [];
    const surfaceRows = [];

    if (jawMesh) jawBox.setFromObject(jawMesh);
    archMeshes.forEach((mesh) => {
      mesh.updateMatrixWorld(true);
      const meshBox = new THREE.Box3().setFromObject(mesh);
      toothBox.union(meshBox);
      meshBox.getCenter(center);
      const surfacePoint = getClosestJawSurfacePoint(
        arch,
        { x: center.x, y: center.y, z: center.z },
        "scene-world"
      );
      if (surfacePoint) {
        const surfaceDistance = distanceBetweenPoints(center, surfacePoint);
        distances.push(surfaceDistance);
        surfaceRows.push({
          toothIndex: String(mesh.userData?.toothIndex),
          distance: Number(surfaceDistance.toFixed(3)),
          transformMode: mesh.userData?.transformMode || null,
          placementSource: mesh.userData?.source?.placementSource || null,
          jawSurfaceSnapSource: mesh.userData?.source?.jawSurfaceSnapSource || null,
          preSnapDistance: mesh.userData?.source?.jawSurfaceDistanceBeforeSnap ?? null,
          center: {
            x: Number(center.x.toFixed(3)),
            y: Number(center.y.toFixed(3)),
            z: Number(center.z.toFixed(3)),
          },
        });
      }
    });
    surfaceRows.sort((a, b) => b.distance - a.distance);

    const expandedJawBox = jawBox.clone();
    if (!expandedJawBox.isEmpty()) expandedJawBox.expandByScalar(25);
    const distanceStats = getDistanceStats(distances);
    const boundsOverlap = !toothBox.isEmpty() && !expandedJawBox.isEmpty()
      ? expandedJawBox.intersectsBox(toothBox)
      : false;
    const likelyAligned = archMeshes.length > 0 &&
      boundsOverlap &&
      distanceStats.count > 0 &&
      distanceStats.median !== null &&
      distanceStats.median <= 18 &&
      distanceStats.max <= 45;

    return {
      arch,
      decodedCraftTeeth:
        arch === "upper"
          ? window.lastDecodedToothPlacementData?.toothCraftDataUpperJaw_?.teeth?.length ?? 0
          : window.lastDecodedToothPlacementData?.toothCraftDataLowerJaw_?.teeth?.length ?? 0,
      normalizedTeeth: lastNormalizedTeeth?.[arch]?.length ?? 0,
      renderedMeshes: archMeshes.length,
      expectedIndices,
      decodedIndices,
      normalizedIndices,
      renderedIndices,
      missingFromDecoded,
      missingFromRendered,
      jawLoaded: Boolean(jawMesh),
      boundsOverlap,
      likelyAligned,
      surfaceDistance: distanceStats,
      surfaceRows,
      orientation,
      orientationRows,
      placementAngle,
      jawBounds: getBoxSummary(jawBox),
      toothBounds: getBoxSummary(toothBox),
    };
  };

  const auditArtificialTeeth = ({ logToConsole = true } = {}) => {
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const meshes = getArtificialToothMeshes();
    const decodedSummary = summarizeDecodedStageData(window.lastDecodedToothPlacementData);
    const renderSummary = summarizeToothRenderData(lastNormalizedTeeth);
    const jaws = ["upper", "lower"].map((arch) => auditJawAlignment(arch, meshes));
    const report = {
      fetch: window.lastArtificialTeethFetchAudit || null,
      decoded: decodedSummary,
      normalized: renderSummary,
      renderedMeshCount: meshes.length,
      hasRenderedTeeth: meshes.length > 0,
      referenceMode,
      jaws,
    };

    window.lastArtificialTeethAudit = report;
    if (!logToConsole) return report;
    console.log("[artificial teeth] strict audit", report);
    console.table(
      jaws.map((jaw) => ({
        arch: jaw.arch,
        decodedCraftTeeth: jaw.decodedCraftTeeth,
        normalizedTeeth: jaw.normalizedTeeth,
        renderedMeshes: jaw.renderedMeshes,
        decodedIndices: jaw.decodedIndices.join(","),
        renderedIndices: jaw.renderedIndices.join(","),
        missingFromDecoded: jaw.missingFromDecoded.join(","),
        missingFromRendered: jaw.missingFromRendered.join(","),
        jawLoaded: jaw.jawLoaded,
        boundsOverlap: jaw.boundsOverlap,
        medianSurfaceDistance: jaw.surfaceDistance.median,
        maxSurfaceDistance: jaw.surfaceDistance.max,
        worstSurfaceTooth: jaw.surfaceRows?.[0]?.toothIndex ?? null,
        worstSurfaceDistance: jaw.surfaceRows?.[0]?.distance ?? null,
        angleChecked: jaw.orientation.checked,
        angleMisaligned: jaw.orientation.likelyMisaligned,
        medianMDAngle: jaw.orientation.mesialDistalAxisAngle.median,
        medianGBAngle: jaw.orientation.gingivalBuccalAxisAngle.median,
        medianBuccalAngle: jaw.orientation.buccalAxisAngle.median,
        placementAngleChecked: jaw.placementAngle.checked,
        placementAngleMisaligned: jaw.placementAngle.likelyMisaligned,
        medianSurfaceNormalAngle: jaw.placementAngle.surfaceNormalAxisAngle.median,
        medianArchTangentAngle: jaw.placementAngle.archTangentAxisAngle.median,
        likelyAligned: jaw.likelyAligned,
      }))
    );
    return report;
  };

  const auditArtificialTeethDatabasePlacement = () => {
    const rows = [];
    ["upper", "lower"].forEach((arch) => {
      const teeth = lastNormalizedTeeth?.[arch] || [];
      teeth.forEach((tooth) => {
        if (!isValidPoint(tooth.position)) return;
        const localDistance = getJawSurfaceDistanceInSpace(arch, tooth.position, "jaw-local");
        const worldDistance = getJawSurfaceDistanceInSpace(arch, tooth.position, "scene-world");
        const normalized = normalizeDatabaseToothReferenceSpace(tooth, arch);
        const normalizedDistance = isValidPoint(normalized.position)
          ? getJawSurfaceDistanceInSpace(arch, normalized.position, "jaw-local")
          : Infinity;
        rows.push({
          arch,
          toothIndex: String(tooth.toothIndex),
          detectedPositionSpace: normalized.source?.detectedPositionSpace || null,
          dbAsJawLocalDistance: Number.isFinite(localDistance)
            ? Number(localDistance.toFixed(3))
            : null,
          dbAsSceneWorldDistance: Number.isFinite(worldDistance)
            ? Number(worldDistance.toFixed(3))
            : null,
          renderedJawLocalDistance: Number.isFinite(normalizedDistance)
            ? Number(normalizedDistance.toFixed(3))
            : null,
          dbPosition: {
            x: Number(tooth.position.x.toFixed(3)),
            y: Number(tooth.position.y.toFixed(3)),
            z: Number(tooth.position.z.toFixed(3)),
          },
          renderedJawLocalPosition: isValidPoint(normalized.position)
            ? {
                x: Number(normalized.position.x.toFixed(3)),
                y: Number(normalized.position.y.toFixed(3)),
                z: Number(normalized.position.z.toFixed(3)),
              }
            : null,
          geometryCenter: isValidPoint(getPointBoundsCenter(tooth.geometry?.vertices))
            ? {
                x: Number(getPointBoundsCenter(tooth.geometry.vertices).x.toFixed(3)),
                y: Number(getPointBoundsCenter(tooth.geometry.vertices).y.toFixed(3)),
                z: Number(getPointBoundsCenter(tooth.geometry.vertices).z.toFixed(3)),
              }
            : null,
          sourceFlags: Object.keys(tooth.source || {})
            .filter((key) => tooth.source?.[key] === true)
            .join(","),
        });
      });
    });

    rows.sort(
      (a, b) =>
        (b.renderedJawLocalDistance ?? -1) - (a.renderedJawLocalDistance ?? -1)
    );
    window.lastArtificialTeethDatabasePlacementAudit = rows;
    console.table(rows);
    return rows;
  };

  const auditArtificialTeethSurfaceClearance = () => {
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const rows = [];
    const vertex = new THREE.Vector3();

    getArtificialToothMeshes().forEach((mesh) => {
      const arch = mesh.userData?.arch;
      const position = mesh.geometry?.attributes?.position;
      if ((arch !== "upper" && arch !== "lower") || !position?.count) return;

      const distances = [];
      const stride = Math.max(1, Math.floor(position.count / 80));
      for (let index = 0; index < position.count; index += stride) {
        vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        const surfacePoint = getClosestJawSurfacePoint(
          arch,
          { x: vertex.x, y: vertex.y, z: vertex.z },
          "scene-world"
        );
        if (!surfacePoint) continue;
        distances.push(distanceBetweenPoints(vertex, surfacePoint));
      }

      const stats = getDistanceStats(distances);
      rows.push({
        arch,
        toothIndex: String(mesh.userData?.toothIndex),
        transformMode: mesh.userData?.transformMode || null,
        geometrySource: mesh.userData?.geometrySource || null,
        sampledVertices: distances.length,
        minSurfaceClearance: stats.min,
        medianSurfaceClearance: stats.median,
        p90SurfaceClearance: stats.p90,
        maxSurfaceClearance: stats.max,
        likelyFloating: stats.min !== null && stats.min > 2.5,
      });
    });

    rows.sort(
      (a, b) =>
        (b.minSurfaceClearance ?? -1) - (a.minSurfaceClearance ?? -1)
    );
    window.lastArtificialTeethSurfaceClearanceAudit = rows;
    console.table(rows);
    return rows;
  };

  const auditArtificialTeethSegment = (arch = "upper", toothIndices = ["0", "1", "2"]) => {
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const requested = new Set(toothIndices.map(String));
    const rows = getArtificialToothMeshes()
      .filter((mesh) => mesh.userData?.arch === arch && requested.has(String(mesh.userData?.toothIndex)))
      .map((mesh) => {
        const toothIndex = String(mesh.userData?.toothIndex);
        const tooth = getToothByIndex(arch, toothIndex);
        const center = getMeshWorldCenter(mesh);
        const closest = getClosestRenderedToothSurfaceSample(mesh, arch);
        return {
          arch,
          toothIndex,
          transformMode: mesh.userData?.transformMode || null,
          geometryFromSurfaceMesh: Boolean(mesh.userData?.source?.geometryFromSurfaceMesh),
          geometryFromToothData: Boolean(mesh.userData?.source?.geometryFromToothData),
          autoFlip: mesh.userData?.autoOrientationFlip?.applied
            ? mesh.userData.autoOrientationFlip.flip
            : null,
          currentMinClearance: closest ? Number(closest.distance.toFixed(3)) : null,
          center: center
            ? {
                x: Number(center.x.toFixed(3)),
                y: Number(center.y.toFixed(3)),
                z: Number(center.z.toFixed(3)),
              }
            : null,
          apiPosition: isValidPoint(tooth?.position)
            ? {
                x: Number(tooth.position.x.toFixed(3)),
                y: Number(tooth.position.y.toFixed(3)),
                z: Number(tooth.position.z.toFixed(3)),
              }
            : null,
          geometryCenter: isValidPoint(getPointBoundsCenter(tooth?.geometry?.vertices))
            ? {
                x: Number(getPointBoundsCenter(tooth.geometry.vertices).x.toFixed(3)),
                y: Number(getPointBoundsCenter(tooth.geometry.vertices).y.toFixed(3)),
                z: Number(getPointBoundsCenter(tooth.geometry.vertices).z.toFixed(3)),
              }
            : null,
        };
      })
      .sort((a, b) => Number(a.toothIndex) - Number(b.toothIndex));

    const spacingRows = rows.slice(1).map((row, index) => {
      const previous = rows[index];
      const from = previous.center;
      const to = row.center;
      return {
        from: previous.toothIndex,
        to: row.toothIndex,
        centerDistance: from && to
          ? Number(Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z).toFixed(3))
          : null,
        delta: from && to
          ? {
              x: Number((to.x - from.x).toFixed(3)),
              y: Number((to.y - from.y).toFixed(3)),
              z: Number((to.z - from.z).toFixed(3)),
            }
          : null,
      };
    });

    const report = { rows, spacingRows };
    window.lastArtificialTeethSegmentAudit = report;
    console.table(rows);
    console.table(spacingRows);
    return report;
  };

  const distancePointToSegment = (point, start, end) => {
    const segment = end.clone().sub(start);
    const lengthSq = segment.lengthSq();
    if (lengthSq < 0.000001) return point.distanceTo(start);
    const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    return point.distanceTo(start.clone().add(segment.multiplyScalar(t)));
  };

  const getGuidelineWorldSegments = (arch, lineType) => {
    const guideData = lastNormalizedTeeth?.guidelines?.[arch];
    if (!guideData) return [];
    const key = lineType === "buccal" ? "buccalLineEditorData_" : "gingivalLineEditorData_";
    const jawMesh = getJawMesh(arch);
    if (!jawMesh) return [];
    jawMesh.updateMatrixWorld(true);

    return getGuidelineEditorPointSets(guideData[key]).flatMap((rawPoints) => {
      const normalized = normalizeGuidelineVisualPoints(arch, rawPoints);
      const worldPoints = normalized.points
        .filter(isValidPoint)
        .map((point) =>
          jawMesh.localToWorld(new THREE.Vector3(point.x, point.y, point.z))
        );
      return worldPoints.slice(1).map((point, index) => ({
        start: worldPoints[index],
        end: point,
        coordinateSpace: normalized.coordinateSpace,
      }));
    });
  };

  const getNearestGuidelineDistance = (center, segments) => {
    if (!center || !segments.length) return null;
    const distances = segments.map(({ start, end }) =>
      distancePointToSegment(center, start, end)
    );
    return Number(Math.min(...distances).toFixed(3));
  };

  const auditArtificialTeethOutliers = (arch = "upper", toothIndices = null) => {
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const requested = toothIndices
      ? new Set(toothIndices.map(String))
      : null;
    const buccalSegments = getGuidelineWorldSegments(arch, "buccal");
    const gingivalSegments = getGuidelineWorldSegments(arch, "gingival");
    const meshes = getArtificialToothMeshes()
      .filter((mesh) =>
        mesh.userData?.arch === arch &&
        (!requested || requested.has(String(mesh.userData?.toothIndex)))
      )
      .sort((a, b) => Number(a.userData?.toothIndex) - Number(b.userData?.toothIndex));

    const centers = new Map();
    meshes.forEach((mesh) => {
      centers.set(String(mesh.userData?.toothIndex), getMeshWorldCenter(mesh));
    });

    const rows = meshes.map((mesh, index) => {
      const toothIndex = String(mesh.userData?.toothIndex);
      const tooth = getToothByIndex(arch, toothIndex);
      const source = tooth?.source || {};
      const geometryCenter = getPointBoundsCenter(tooth?.geometry?.vertices);
      const center = centers.get(toothIndex);
      const previousCenter = index > 0 ? centers.get(String(meshes[index - 1].userData?.toothIndex)) : null;
      const nextCenter = index < meshes.length - 1 ? centers.get(String(meshes[index + 1].userData?.toothIndex)) : null;
      const closest = getClosestRenderedToothSurfaceSample(mesh, arch);
      const centerJawDistance = center
        ? getJawSurfaceDistanceInSpace(arch, { x: center.x, y: center.y, z: center.z }, "scene-world")
        : Infinity;
      const positionSource = source.positionFromToothDataWorld
        ? "toothData"
        : source.positionFromApiMeshCenter
          ? "apiMeshCenter"
          : null;

      return {
        arch,
        toothIndex,
        geometrySource: source.geometryFromSurfaceMesh
          ? "surfaceMesh"
          : source.geometryFromToothData
            ? "toothData"
            : null,
        positionSource,
        positionField: source.positionFromUnityToothDataField ?? null,
        transformMode: mesh.userData?.transformMode || null,
        autoOrientationDisabled: Boolean(mesh.userData?.autoOrientationFlip?.disabled),
        minSurfaceClearance: closest ? Number(closest.distance.toFixed(3)) : null,
        centerJawDistance: Number.isFinite(centerJawDistance)
          ? Number(centerJawDistance.toFixed(3))
          : null,
        centerToBuccalGuideline: getNearestGuidelineDistance(center, buccalSegments),
        centerToGingivalGuideline: getNearestGuidelineDistance(center, gingivalSegments),
        previousCenterDistance: center && previousCenter
          ? Number(center.distanceTo(previousCenter).toFixed(3))
          : null,
        nextCenterDistance: center && nextCenter
          ? Number(center.distanceTo(nextCenter).toFixed(3))
          : null,
        apiPositionToGeometryCenter: isValidPoint(tooth?.position) && isValidPoint(geometryCenter)
          ? Number(distanceBetweenPoints(tooth.position, geometryCenter).toFixed(3))
          : null,
        meshLocalPosition: isValidPoint(mesh.position)
          ? {
              x: Number(mesh.position.x.toFixed(3)),
              y: Number(mesh.position.y.toFixed(3)),
              z: Number(mesh.position.z.toFixed(3)),
            }
          : null,
      };
    });

    window.lastArtificialTeethOutlierAudit = rows;
    console.table(rows);
    return rows;
  };

  const auditArtificialTeethJawOverlap = (arch = "lower", toothIndices = null) => {
    group.updateMatrixWorld(true);
    parentObject.updateMatrixWorld(true);
    const requested = toothIndices
      ? new Set(toothIndices.map(String))
      : null;
    const vertex = new THREE.Vector3();
    const rows = getArtificialToothMeshes()
      .filter((mesh) =>
        mesh.userData?.arch === arch &&
        (!requested || requested.has(String(mesh.userData?.toothIndex)))
      )
      .map((mesh) => {
        const position = mesh.geometry?.attributes?.position;
        if (!position?.count) return null;

        const distances = [];
        const stride = Math.max(1, Math.floor(position.count / 160));
        for (let index = 0; index < position.count; index += stride) {
          vertex.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
          const surfacePoint = getClosestJawSurfacePoint(
            arch,
            { x: vertex.x, y: vertex.y, z: vertex.z },
            "scene-world"
          );
          if (!surfacePoint) continue;
          distances.push(distanceBetweenPoints(vertex, surfacePoint));
        }

        const stats = getDistanceStats(distances);
        const closeSamples = distances.filter((distance) => distance <= 0.35).length;
        const nearSamples = distances.filter((distance) => distance <= 0.8).length;
        const sampled = distances.length || 1;
        const source = mesh.userData?.source || {};
        return {
          arch,
          toothIndex: String(mesh.userData?.toothIndex),
          geometrySource: source.geometryFromSurfaceMesh
            ? "surfaceMesh"
            : source.geometryFromToothData
              ? "toothData"
              : null,
          positionSource: source.positionFromToothDataWorld
            ? "toothData"
            : source.positionFromApiMeshCenter
              ? "apiMeshCenter"
              : null,
          transformMode: mesh.userData?.transformMode || null,
          sampledVertices: distances.length,
          minSurfaceDistance: stats.min,
          medianSurfaceDistance: stats.median,
          closeToJawPercent: Number(((closeSamples / sampled) * 100).toFixed(1)),
          nearJawPercent: Number(((nearSamples / sampled) * 100).toFixed(1)),
          likelyOverlappingScanTooth: closeSamples / sampled > 0.18 || nearSamples / sampled > 0.42,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        Number(b.likelyOverlappingScanTooth) - Number(a.likelyOverlappingScanTooth) ||
        b.closeToJawPercent - a.closeToJawPercent ||
        b.nearJawPercent - a.nearJawPercent
      );

    window.lastArtificialTeethJawOverlapAudit = rows;
    console.table(rows);
    return rows;
  };

  const postArtificialTeethJson = async (endpoint, payload) => {
    await apiClient.ensureSession();
    const response = await fetch(`${apiClient.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiClient.authHeaders() },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      if (response.status === 404 || response.status === 500) {
        console.warn("[artificial teeth] endpoint returned no usable payload", {
          endpoint,
          status: response.status,
        });
        return "stl";
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const postArtificialTeethDebug = async (endpoint, payload) => {
    const response = await fetch(`${apiClient.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiClient.authHeaders() },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      endpoint,
      status: response.status,
      ok: response.ok,
      payload,
      length: text.length,
      body: parsed,
      sample: text.slice(0, 500),
    };
  };

  const getToothPlacementData = async (caseIntID) => {
    const authPayload = [createAuthData(caseIntID)];
    return postArtificialTeethJson("/toothPlacementData/get", authPayload);
  };

  let pendingArtificialTeethFetch = null;

  const getArtificialTeethPayload = (caseIntID, endpoint) => {
    const authPayload = [createAuthData(caseIntID)];
    const alternatePayload = [
      authPayload[0],
      { case_id: caseIntID, caseIntID },
    ];
    return /toothPlacementData\/get$/i.test(endpoint)
      ? authPayload
      : alternatePayload;
  };

  const startArtificialTeethFetch = (caseIntID) => {
    if (
      pendingArtificialTeethFetch &&
      pendingArtificialTeethFetch.caseIntID === caseIntID
    ) {
      return pendingArtificialTeethFetch.promise;
    }

    const promise = (async () => {
      for (const endpoint of ARTIFICIAL_TOOTH_ENDPOINTS) {
        const payload = getArtificialTeethPayload(caseIntID, endpoint);
        const startedAt = performance.now();
        if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
          console.time("viewer: artificial teeth API fetching");
        }
        try {
          const response = await postArtificialTeethJson(endpoint, payload);
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth API fetching");
          }
          recordPerformance(
            "artificial teeth API fetching",
            performance.now() - startedAt,
            { endpoint, prefetched: true }
          );
          if (!response || response === "stl") continue;
          return { endpoint, response };
        } catch (error) {
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth API fetching");
          }
          recordPerformance(
            "artificial teeth API fetching",
            performance.now() - startedAt,
            { endpoint, status: "failed", prefetched: true }
          );
          console.warn("[artificial teeth] fetch failed", {
            endpoint,
            payloadShape: /toothPlacementData\/get$/i.test(endpoint)
              ? "auth-only"
              : "auth-with-case",
            error,
          });
        }
      }
      return null;
    })();

    pendingArtificialTeethFetch = { caseIntID, promise };
    return promise;
  };

  const prefetch = (caseIntID) => {
    startArtificialTeethFetch(caseIntID);
  };

  const debugToothPlacementData = async (caseIntID) => {
    const auth = createAuthData(caseIntID);
    const payloads = [
      { label: "auth-only", payload: [auth] },
      { label: "case_id", payload: [auth, { case_id: caseIntID }] },
      { label: "caseIntID", payload: [auth, { caseIntID }] },
      { label: "case_int_id", payload: [auth, { case_int_id: caseIntID }] },
      { label: "all-case-fields", payload: [auth, { case_id: caseIntID, caseIntID, case_int_id: caseIntID }] },
    ];

    const results = [];
    for (const entry of payloads) {
      try {
        const result = await postArtificialTeethDebug(
          "/toothPlacementData/get",
          entry.payload
        );
        results.push({ label: entry.label, ...result });
      } catch (error) {
        results.push({
          label: entry.label,
          endpoint: "/toothPlacementData/get",
          ok: false,
          error: error.message || String(error),
          payload: entry.payload,
        });
      }
    }

    console.table(
      results.map((result) => ({
        label: result.label,
        status: result.status ?? "ERR",
        ok: result.ok,
        length: result.length ?? 0,
        sample: result.sample ?? result.error ?? "",
      }))
    );
    window.lastToothPlacementDebugResults = results;
    return results;
  };

  const fetchAndRender = async (caseIntID) => {
    console.log("Artificial Teeth");
    setStatus("Loading artificial teeth", 0.12);
    window.lastArtificialTeethFetchAudit = {
      caseIntID,
      startedAt: new Date().toISOString(),
      endpoint: null,
      responseFetched: false,
      prefetched: Boolean(
        pendingArtificialTeethFetch &&
        pendingArtificialTeethFetch.caseIntID === caseIntID
      ),
      decoded: false,
      normalizedUpper: 0,
      normalizedLower: 0,
      rendered: false,
      error: null,
    };
    const prefetchedResult = pendingArtificialTeethFetch?.caseIntID === caseIntID
      ? await pendingArtificialTeethFetch.promise
      : null;

    for (const endpoint of ARTIFICIAL_TOOTH_ENDPOINTS) {
      let isArtificialTeethApiTimerActive = false;
      let isArtificialTeethNormalizeTimerActive = false;
      let artificialTeethApiStartedAt = 0;
      let artificialTeethNormalizeStartedAt = 0;
      try {
        setStatus(`Checking ${endpoint.replaceAll("/", " ")}`, 0.28);
        window.lastArtificialTeethFetchAudit.endpoint = endpoint;
        let response;
        if (prefetchedResult?.endpoint === endpoint) {
          response = prefetchedResult.response;
        } else {
          const payload = getArtificialTeethPayload(caseIntID, endpoint);
          artificialTeethApiStartedAt = performance.now();
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.time("viewer: artificial teeth API fetching");
          }
          isArtificialTeethApiTimerActive = true;
          response = await postArtificialTeethJson(endpoint, payload);
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth API fetching");
          }
          recordPerformance(
            "artificial teeth API fetching",
            performance.now() - artificialTeethApiStartedAt,
            { endpoint }
          );
          isArtificialTeethApiTimerActive = false;
        }
        if (!response || response === "stl") continue;
        window.lastArtificialTeethFetchAudit.responseFetched = true;

        artificialTeethNormalizeStartedAt = performance.now();
        if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
          console.time("viewer: artificial teeth data normalization");
        }
        isArtificialTeethNormalizeTimerActive = true;
        const normalized = normalizeResponse(response);
        if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
          console.timeEnd("viewer: artificial teeth data normalization");
        }
        recordPerformance(
          "artificial teeth data normalization",
          performance.now() - artificialTeethNormalizeStartedAt,
          { endpoint }
        );
        isArtificialTeethNormalizeTimerActive = false;
        const upperCount = normalized.upper.length;
        const lowerCount = normalized.lower.length;
        const totalCount = upperCount + lowerCount;
        window.lastArtificialTeethFetchAudit.decoded = Boolean(window.lastDecodedToothPlacementData);
        window.lastArtificialTeethFetchAudit.normalizedUpper = upperCount;
        window.lastArtificialTeethFetchAudit.normalizedLower = lowerCount;
        if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
          console.log("[artificial teeth] records", { endpoint, upper: upperCount, lower: lowerCount });
        }
        setStatus(`Decoded artificial teeth (${totalCount})`, totalCount ? 0.82 : 0.52);
        window.lastArtificialTeethResponse = response;
        window.lastArtificialTeethNormalized = normalized;

        if (!totalCount) continue;
        try {
          renderData(normalized);
        } catch (error) {
          if (artificialTeethRenderTimerActive) {
            if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
              console.timeEnd("viewer: artificial teeth loading/rendering");
            }
            recordPerformance(
              "artificial teeth loading/rendering",
              performance.now() - artificialTeethRenderStartedAt,
              { status: "failed" }
            );
            artificialTeethRenderTimerActive = false;
          }
          window.lastArtificialTeethFetchAudit.error = error.message || String(error);
          console.error("[artificial teeth] render failed after successful fetch", error);
          clear();
          auditArtificialTeeth({ logToConsole: LOG_ARTIFICIAL_TEETH_AUTO_AUDIT_TO_CONSOLE });
          setStatus("Artificial teeth render failed", 1, true);
          return;
        }
        window.lastArtificialTeethFetchAudit.rendered = hasRenderedTeeth();
        setStatus(`Artificial teeth ready (${totalCount})`, 1, true);
        return;
      } catch (error) {
        if (isArtificialTeethApiTimerActive) {
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth API fetching");
          }
          recordPerformance(
            "artificial teeth API fetching",
            performance.now() - artificialTeethApiStartedAt,
            { endpoint, status: "failed" }
          );
        }
        if (isArtificialTeethNormalizeTimerActive) {
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth data normalization");
          }
          recordPerformance(
            "artificial teeth data normalization",
            performance.now() - artificialTeethNormalizeStartedAt,
            { endpoint, status: "failed" }
          );
        }
        if (artificialTeethRenderTimerActive) {
          if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
            console.timeEnd("viewer: artificial teeth loading/rendering");
          }
          recordPerformance(
            "artificial teeth loading/rendering",
            performance.now() - artificialTeethRenderStartedAt,
            { status: "failed" }
          );
          artificialTeethRenderTimerActive = false;
        }
        window.lastArtificialTeethFetchAudit.error = error.message || String(error);
        console.warn("[artificial teeth] fetch failed", {
          endpoint,
          payloadShape: /toothPlacementData\/get$/i.test(endpoint)
            ? "auth-only"
            : "auth-with-case",
          error,
        });
      }
    }

    clear();
    window.lastArtificialTeethNormalized = { upper: [], lower: [] };
    if (LOG_ARTIFICIAL_TEETH_LOAD_DETAILS_TO_CONSOLE) {
      console.log("[artificial teeth] No processed artificial tooth mesh data returned; skipping tooth render.");
    }
    auditArtificialTeeth({ logToConsole: LOG_ARTIFICIAL_TEETH_AUTO_AUDIT_TO_CONSOLE });
    setStatus("No processed artificial teeth", 1, true);
  };

  window.getToothPlacementData = getToothPlacementData;
  window.debugToothPlacementData = debugToothPlacementData;
  window.prefetchArtificialTeeth = prefetch;
  window.fetchAndRenderArtificialTeeth = fetchAndRender;
  window.revealArtificialTeeth = reveal;
  window.updateArtificialTeethCameraVisibility = updateCameraVisibility;
  window.syncArtificialTeethToJaw = syncToJawMeshes;
  window.summarizeArtificialTeethData = () => {
    const summary = summarizeDecodedStageData(window.lastDecodedToothPlacementData);
    console.log("[artificial teeth] decoded summary", summary);
    return summary;
  };
  window.auditArtificialTeethSurfaceMeshes = () => {
    const summary = summarizeDecodedStageData(window.lastDecodedToothPlacementData);
    const rows = [
      ...(summary.surfaceDecode?.upper || []).map((row) => ({ arch: "upper", ...row })),
      ...(summary.surfaceDecode?.lower || []).map((row) => ({ arch: "lower", ...row })),
    ];
    console.table(
      rows.map((row) => ({
        arch: row.arch,
        key: row.key,
        hasToothData: row.hasToothData,
        inRenderedTeeth: row.inRenderedTeeth,
        decoded: row.decoded,
        decodedFrom: row.decodedFrom,
        source: row.source,
        vertices: row.vertices,
        indices: row.indices,
        currentByteLength: row.currentByteLength,
        initialByteLength: row.initialByteLength,
      }))
    );
    window.lastArtificialTeethSurfaceMeshAudit = rows;
    return rows;
  };
  window.auditArtificialTeeth = auditArtificialTeeth;
  window.auditArtificialTeethGuidelines = auditArtificialTeethGuidelines;
  window.auditArtificialTeethGuidelineAlignment = auditArtificialTeethGuidelineAlignment;
  window.auditArtificialTeethDatabasePlacement = auditArtificialTeethDatabasePlacement;
  window.auditArtificialTeethSurfaceClearance = auditArtificialTeethSurfaceClearance;
  window.auditArtificialTeethSegment = auditArtificialTeethSegment;
  window.auditArtificialTeethOutliers = auditArtificialTeethOutliers;
  window.auditArtificialTeethJawOverlap = auditArtificialTeethJawOverlap;
  window.auditArtificialTeethApiMapping = auditArtificialTeethApiMapping;
  window.auditArtificialTeethToothDataLayout = auditArtificialTeethToothDataLayout;
  window.auditArtificialTeethJawSources = auditJawSourceMapping;
  window.artificialTeethRenderRuleVersion = ARTIFICIAL_TEETH_RENDER_RULE_VERSION;
  window.hasRenderedArtificialTeeth = hasRenderedTeeth;
  window.hasArtificialTeethJaw = hasArtificialTeethJaw;
  window.clearArtificialTeeth = clear;
  window.setArtificialTeethJawVisibility = setJawVisibility;
  window.getArtificialTeethJawVisibility = getJawVisibility;
  window.setArtificialTeethJawOpacity = setJawOpacity;
  window.getArtificialTeethJawOpacity = getJawOpacity;

  return {
    clear,
    prefetch,
    fetchAndRender,
    getToothPlacementData,
    debugToothPlacementData,
    auditArtificialTeeth,
    auditArtificialTeethGuidelines,
    auditArtificialTeethGuidelineAlignment,
    auditArtificialTeethDatabasePlacement,
    auditArtificialTeethSurfaceClearance,
    auditArtificialTeethSegment,
    auditArtificialTeethOutliers,
    auditArtificialTeethJawOverlap,
    auditArtificialTeethApiMapping,
    auditArtificialTeethToothDataLayout,
    auditJawSourceMapping,
    reveal,
    hasRenderedTeeth,
    syncToJawMeshes,
    updateCameraVisibility,
    setJawVisibility,
    getJawVisibility,
    setJawOpacity,
    getJawOpacity,
  };
}
