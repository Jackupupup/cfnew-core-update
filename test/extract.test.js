import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";
import { UpdateError } from "../src/errors.js";
import { readWorkerFromZip } from "../src/zip-extract.js";
import { makeZip } from "../testing/zip-fixture.js";

const worker = Buffer.from("export default { fetch() { return new Response('hello'); } }\n");

function codeOf(zip) {
  return readWorkerFromZip(zip).then(
    () => "",
    (err) => (err instanceof UpdateError ? err.code : "other"),
  );
}

describe("safe extraction", () => {
  it("extracts one deflated or stored _worker.js", async () => {
    const deflated = await readWorkerFromZip(makeZip([{ name: "_worker.js", data: worker, method: 8 }]));
    const stored = await readWorkerFromZip(makeZip([{ name: "_worker.js", data: worker, method: 0 }]));
    assert.equal(deflated.equals(worker), true);
    assert.equal(stored.equals(worker), true);
  });

  it("rejects traversal, links, extra files, bombs, and bad metadata", async () => {
    const data = Buffer.alloc(5000, 0);
    const cases = [
      [makeZip([{ name: "../_worker.js", data: worker, method: 0 }]), "unsafe-name"],
      [makeZip([{ name: "/tmp/_worker.js", data: worker, method: 0 }]), "unsafe-name"],
      [makeZip([{ name: "..\\_worker.js", data: worker, method: 0 }]), "unsafe-name"],
      [makeZip([{ name: "_worker.js/", data: worker, method: 0 }]), "unsafe-name"],
      [makeZip([{ name: "subdir/_worker.js", data: worker, method: 0 }]), "unexpected-entry"],
      [makeZip([{ name: "wrangler.toml", data: Buffer.from("name='x'\n"), method: 0 }]), "unexpected-entry"],
      [
        makeZip([
          { name: "_worker.js", data: worker, method: 0 },
          { name: "wrangler.toml", data: Buffer.from("a=1\n"), method: 0 },
        ]),
        "unexpected-entry",
      ],
      [
        makeZip([{ name: "_worker.js", data: Buffer.from("elsewhere"), method: 0, externalAttr: 0o120777 << 16 }]),
        "symlink",
      ],
      [
        makeZip([{ name: "_worker.js", data: worker, method: 0, externalAttr: (0o100644 << 16) | 0x10 }]),
        "directory",
      ],
      [makeZip([{ name: "_worker.js", data: worker, method: 0, flags: 1 }]), "zip-flags"],
      [makeZip([{ name: "_worker.js", data: worker, method: 0, crc: 1 }]), "crc"],
      [makeZip([{ name: "_worker.js", data: worker, method: 8, versionNeeded: 45 }]), "zip-version"],
      [
        makeZip([{ name: "_worker.js", compressed: Buffer.alloc(32), uncompressedSize: 2_000_000, method: 8 }]),
        "size-limit",
      ],
      [
        makeZip([{ name: "_worker.js", compressed: Buffer.alloc(20, 1), uncompressedSize: 400_000, method: 8 }]),
        "ratio-limit",
      ],
      [
        makeZip([
          {
            name: "_worker.js",
            data,
            compressed: deflateRawSync(data),
            uncompressedSize: 10,
            method: 8,
          },
        ]),
        "size-limit",
      ],
      [makeZip(Array.from({ length: 9 }, () => ({ name: "_worker.js", data: Buffer.from("a"), method: 0 }))), "too-many-entries"],
      [Buffer.alloc(0), "zip-size"],
    ];
    for (const [zip, expected] of cases) {
      assert.equal(await codeOf(zip), expected);
    }
  });
});
