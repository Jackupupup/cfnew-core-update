import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSha256, parseSha256Sums, safeEqualHex, sha256 } from "../src/checksums.js";
import { UpdateError } from "../src/errors.js";

const PAGES = "d10345f660480c5b9d44b80e24fe77e094c98f7267285c616d76fed3946313c6";
const WORKER = "d05cb33eb57cfa271e521944bcaee6a836c30bad1b80160d25c61c5f6f12936a";
const OFFICIAL = `${PAGES}  Pages.zip\n${WORKER}  _worker.js\n`;

describe("checksums", () => {
  it("parses the official two-space SHA256SUMS layout", () => {
    assert.deepEqual(parseSha256Sums(OFFICIAL), {
      "Pages.zip": PAGES,
      "_worker.js": WORKER,
    });
  });

  it("accepts a missing final newline and either file order", () => {
    const parsed = parseSha256Sums(`${WORKER}  _worker.js\n${PAGES}  Pages.zip`);
    assert.equal(parsed["_worker.js"], WORKER);
  });

  it("rejects malformed sums", () => {
    for (const text of [
      `${PAGES} Pages.zip\n${WORKER}  _worker.js\n`,
      `${PAGES} *_worker.js\n${WORKER}  Pages.zip\n`,
      `${PAGES.toUpperCase()}  Pages.zip\n${WORKER}  _worker.js\n`,
      `${PAGES}  Pages.zip\n${WORKER}  _worker.js\n${WORKER}  extra.txt\n`,
      `${PAGES}  Pages.zip\r\n${WORKER}  _worker.js\n`,
      `${PAGES}  pages.zip\n${WORKER}  _worker.js\n`,
      "",
    ]) {
      assert.throws(() => parseSha256Sums(text), (err) => err instanceof UpdateError && err.code === "sums-shape");
    }
  });

  it("compares hashes in constant-length form and rejects mismatches", () => {
    const bytes = Buffer.from("hello");
    const digest = sha256(bytes);
    assert.equal(assertSha256(bytes, digest), digest);
    assert.equal(safeEqualHex(digest, digest), true);
    assert.equal(safeEqualHex(digest, `${"ab".repeat(32)}`), false);
    assert.equal(safeEqualHex("abcd", digest), false);
    assert.throws(() => assertSha256(bytes, WORKER), (err) => err.code === "checksum");
  });
});
