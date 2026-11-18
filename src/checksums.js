import { createHash, timingSafeEqual } from "node:crypto";
import { UpdateError } from "./errors.js";
import { PAGES_ZIP_NAME, SUMS_NAME, WORKER_NAME } from "./constants.js";

const HEX = /^[a-f0-9]{64}$/;
const LINE =
  /^([a-f0-9]{64})  (Pages\.zip|_worker\.js)$/;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function safeEqualHex(actual, expected) {
  if (!HEX.test(actual) || !HEX.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function assertSha256(bytes, expectedHex) {
  if (!HEX.test(expectedHex)) throw new UpdateError("checksum");
  const actual = sha256(bytes);
  if (!safeEqualHex(actual, expectedHex)) throw new UpdateError("checksum");
  return actual;
}

export function parseSha256Sums(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 4096) {
    throw new UpdateError("sums-shape");
  }
  if (text.includes("\r") || text.includes("\0")) throw new UpdateError("sums-shape");
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (body.length === 0 || body.includes("\n\n")) throw new UpdateError("sums-shape");
  const lines = body.split("\n");
  if (lines.length !== 2) throw new UpdateError("sums-shape");
  const found = new Map();
  for (const line of lines) {
    const match = LINE.exec(line);
    if (!match) throw new UpdateError("sums-shape");
    if (found.has(match[2])) throw new UpdateError("sums-shape");
    found.set(match[2], match[1]);
  }
  if (!found.has(PAGES_ZIP_NAME) || !found.has(WORKER_NAME)) {
    throw new UpdateError("sums-shape");
  }
  return {
    [PAGES_ZIP_NAME]: found.get(PAGES_ZIP_NAME),
    [WORKER_NAME]: found.get(WORKER_NAME),
  };
}

export function digestsAgree(assetHex, sumsHex) {
  return safeEqualHex(assetHex, sumsHex);
}

export { SUMS_NAME };
