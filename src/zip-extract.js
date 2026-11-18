import { createInflateRaw } from "node:zlib";
import { UpdateError } from "./errors.js";
import { LIMITS, WORKER_NAME } from "./constants.js";
import { crc32 } from "./crc32.js";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

export async function readWorkerFromZip(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new UpdateError("zip-shape");
  if (bytes.length === 0 || bytes.length > LIMITS.maxDownloadBytes) {
    throw new UpdateError("zip-size");
  }
  const eocd = findEocd(bytes);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  const commentLength = bytes.readUInt16LE(eocd + 20);
  if (commentLength !== 0 || eocd + 22 !== bytes.length) throw new UpdateError("zip-eocd");
  if (bytes.readUInt16LE(eocd + 4) !== 0 || bytes.readUInt16LE(eocd + 6) !== 0) {
    throw new UpdateError("zip64");
  }
  if (bytes.readUInt16LE(eocd + 8) !== entryCount) throw new UpdateError("zip-eocd");
  if (entryCount === 0) throw new UpdateError("unexpected-entry");
  if (entryCount > LIMITS.maxEntries) throw new UpdateError("too-many-entries");
  if (cdOffset + cdSize !== eocd) throw new UpdateError("zip-eocd");
  if (eocd >= 20 && bytes.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) {
    throw new UpdateError("zip64");
  }

  const entries = readCentralDirectory(bytes, cdOffset, cdSize, entryCount);
  if (entries.length !== 1) throw new UpdateError("unexpected-entry");
  const entry = entries[0];
  if (entry.name !== WORKER_NAME) throw new UpdateError("unexpected-entry");
  const data = await inflateEntry(bytes, entry);
  if (crc32(data) !== entry.crc) throw new UpdateError("crc");
  return data;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22);
  for (let offset = min; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD && offset + 22 === bytes.length) return offset;
    if (offset === 0) break;
  }
  throw new UpdateError("zip-eocd");
}

function readCentralDirectory(bytes, offset, size, count) {
  const entries = [];
  let cursor = offset;
  const end = offset + size;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end) throw new UpdateError("zip-central");
    if (bytes.readUInt32LE(cursor) !== CENTRAL) throw new UpdateError("zip-central");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttr = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const versionNeeded = bytes.readUInt16LE(cursor + 6);
    if (cursor + 46 + nameLength + extraLength + commentLength > end) {
      throw new UpdateError("zip-central");
    }
    if (commentLength !== 0) throw new UpdateError("zip-central");
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    assertNoZip64Extra(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength));
    classifyEntry({ name, flags, method, compressedSize, uncompressedSize, externalAttr, versionNeeded });
    entries.push({
      name,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) throw new UpdateError("zip-central");
  return entries;
}

function classifyEntry(entry) {
  if (entry.flags !== 0) throw new UpdateError("zip-flags");
  if (entry.method !== 0 && entry.method !== 8) throw new UpdateError("zip-method");
  if (entry.versionNeeded !== 10 && entry.versionNeeded !== 20) throw new UpdateError("zip-version");
  if (entry.name !== WORKER_NAME) throw new UpdateError(unsafeName(entry.name) ? "unsafe-name" : "unexpected-entry");
  if (
    entry.compressedSize <= 0 ||
    entry.compressedSize > LIMITS.maxCompressedBytes ||
    entry.uncompressedSize <= 0 ||
    entry.uncompressedSize > LIMITS.maxUncompressedBytes
  ) {
    throw new UpdateError("size-limit");
  }
  if (entry.method === 0 && entry.compressedSize !== entry.uncompressedSize) {
    throw new UpdateError("size-limit");
  }
  if (entry.uncompressedSize / entry.compressedSize > LIMITS.maxRatio) {
    throw new UpdateError("ratio-limit");
  }
  const mode = entry.externalAttr >>> 16;
  const kind = mode & S_IFMT;
  if (kind === S_IFLNK) throw new UpdateError("symlink");
  if (kind === S_IFDIR || (entry.externalAttr & 0x10) !== 0) throw new UpdateError("directory");
  if (kind !== 0 && kind !== S_IFREG) throw new UpdateError("symlink");
}

function unsafeName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) return true;
  if (name.includes("\0") || name.includes("\\") || name.includes(":")) return true;
  if (name.startsWith("/") || name.includes("..") || name.endsWith("/")) return true;
  return false;
}

function decodeName(bytes) {
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) throw new UpdateError("unsafe-name");
  }
  return bytes.toString("ascii");
}

function assertNoZip64Extra(extra) {
  let offset = 0;
  while (offset + 4 <= extra.length) {
    const id = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    if (id === 0x0001) throw new UpdateError("zip64");
    offset += 4 + size;
    if (offset > extra.length) throw new UpdateError("zip-extra");
  }
  if (offset !== extra.length) throw new UpdateError("zip-extra");
}

async function inflateEntry(bytes, entry) {
  if (entry.localOffset + 30 > bytes.length) throw new UpdateError("zip-local");
  if (bytes.readUInt32LE(entry.localOffset) !== LOCAL) throw new UpdateError("zip-local");
  const flags = bytes.readUInt16LE(entry.localOffset + 6);
  const method = bytes.readUInt16LE(entry.localOffset + 8);
  const crc = bytes.readUInt32LE(entry.localOffset + 14);
  const compressedSize = bytes.readUInt32LE(entry.localOffset + 18);
  const uncompressedSize = bytes.readUInt32LE(entry.localOffset + 22);
  const nameLength = bytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localOffset + 28);
  if (
    flags !== entry.flags ||
    method !== entry.method ||
    crc !== entry.crc ||
    compressedSize !== entry.compressedSize ||
    uncompressedSize !== entry.uncompressedSize
  ) {
    throw new UpdateError("zip-local");
  }
  const nameStart = entry.localOffset + 30;
  const nameEnd = nameStart + nameLength;
  const dataStart = nameEnd + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (nameEnd > bytes.length || dataEnd > bytes.length) throw new UpdateError("zip-local");
  const name = decodeName(bytes.subarray(nameStart, nameEnd));
  if (name !== entry.name) throw new UpdateError("zip-local");
  assertNoZip64Extra(bytes.subarray(nameEnd, dataStart));
  const compressed = bytes.subarray(dataStart, dataEnd);
  const output =
    method === 0 ? Buffer.from(compressed) : await inflateLimited(compressed, entry.uncompressedSize);
  if (output.length !== entry.uncompressedSize) throw new UpdateError("size-limit");
  return output;
}

function inflateLimited(compressed, limit) {
  return new Promise((resolve, reject) => {
    const inflator = createInflateRaw();
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (code) => {
      if (settled) return;
      settled = true;
      inflator.destroy();
      reject(new UpdateError(code));
    };
    inflator.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        fail("size-limit");
        return;
      }
      chunks.push(chunk);
    });
    inflator.on("error", () => fail("inflate"));
    inflator.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
    inflator.end(compressed);
  });
}
