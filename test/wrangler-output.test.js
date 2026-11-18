import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { WRANGLER_VERSION } from "../src/constants.js";
import { HEALTH_URL } from "../src/health.js";
import { spawnCollected } from "../src/live.js";
import { sha256 } from "../src/checksums.js";
import { LATEST_RELEASE_URL, assetApiUrl, releaseApiUrl } from "../src/release.js";
import { UpdateError } from "../src/errors.js";
import { makeZip } from "../testing/zip-fixture.js";
import { main, reportFailure } from "../scripts/update-core.mjs";

const SECRET = "canary-plain-secret-zebra";
const repo = "Jackupupup/cfnew-core-update";

function responseFor(body, status = 200, headers = {}) {
  const encoded = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const table = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name) => table.get(String(name).toLowerCase()) ?? null },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoded };
          },
          async cancel() {},
        };
      },
    },
  };
}

function releaseFetch() {
  const worker = Buffer.from("export default {}\n");
  const zip = makeZip([{ name: "_worker.js", data: worker, method: 0 }]);
  const workerHash = sha256(worker);
  const zipHash = sha256(zip);
  const sums = Buffer.from(`${zipHash}  Pages.zip\n${workerHash}  _worker.js\n`);
  const release = {
    id: 416271394,
    tag_name: "v2026.10.17.2",
    draft: false,
    prerelease: false,
    assets: [
      { id: 31, name: "Pages.zip", state: "uploaded", size: zip.length, digest: `sha256:${zipHash}` },
      { id: 32, name: "SHA256SUMS.txt", state: "uploaded", size: sums.length, digest: `sha256:${sha256(sums)}` },
    ],
  };
  return async (url) => {
    const href = String(url instanceof URL ? url.href : url);
    if (href === LATEST_RELEASE_URL || href === releaseApiUrl(416271394)) {
      return responseFor(JSON.stringify(release), 200, { "content-type": "application/json" });
    }
    if (href === assetApiUrl(31)) return responseFor(zip, 200, { "content-length": String(zip.length) });
    if (href === assetApiUrl(32)) return responseFor(sums, 200, { "content-length": String(sums.length) });
    if (href === HEALTH_URL) return responseFor("hello", 200, { "content-type": "text/plain; charset=utf-8" });
    throw new Error("unexpected-url");
  };
}

function installImpl() {
  return async (_command, args) => {
    const prefix = args[args.indexOf("--prefix") + 1];
    fs.mkdirSync(path.join(prefix, "node_modules", "wrangler"), { recursive: true });
    fs.mkdirSync(path.join(prefix, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(
      path.join(prefix, "node_modules", "wrangler", "package.json"),
      JSON.stringify({ name: "wrangler", version: WRANGLER_VERSION }),
    );
    fs.writeFileSync(path.join(prefix, "node_modules", ".bin", "wrangler"), "");
    return { stdout: SECRET, stderr: SECRET };
  };
}

function childSpawn(exitCode) {
  return (_bin, _args, options) =>
    spawnCollected(
      process.execPath,
      ["-e", `process.stdout.write(${JSON.stringify(SECRET)}); process.stderr.write(${JSON.stringify(SECRET)}); process.exit(${exitCode});`],
      options,
    );
}

async function capture(fn) {
  const lines = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => lines.push(args.map(String).join(" "));
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function dumped(err) {
  if (!err) return "";
  return Object.getOwnPropertyNames(err)
    .map((name) => `${name}=${err[name]}`)
    .join("\n");
}

describe("wrangler output is not logged", () => {
  it("omits child stdout and stderr after a successful deploy", async () => {
    const { value, lines } = await capture(() =>
      main(
        { EVENT_NAME: "workflow_dispatch", DISPATCH_MODE: "deploy", GITHUB_REPOSITORY: repo },
        releaseFetch(),
        { spawnImpl: childSpawn(0), execFileImpl: installImpl() },
      ),
    );
    const rendered = `${lines.join("\n")}\n${JSON.stringify(value)}`;
    assert.equal(value.ok, true);
    assert.equal(value.proceeded, true);
    assert.equal(rendered.includes(SECRET), false);
  });

  it("omits child stdout and stderr when wrangler exits non-zero", async () => {
    let thrown;
    const { lines } = await capture(async () => {
      try {
        await main(
          { EVENT_NAME: "workflow_dispatch", DISPATCH_MODE: "deploy", GITHUB_REPOSITORY: repo },
          releaseFetch(),
          { spawnImpl: childSpawn(1), execFileImpl: installImpl() },
        );
      } catch (err) {
        thrown = err;
        reportFailure(err);
      }
    });
    const rendered = `${lines.join("\n")}\n${dumped(thrown)}`;
    assert.equal(thrown instanceof UpdateError, true);
    assert.equal(thrown.code, "wrangler-exit");
    assert.equal(rendered.includes(SECRET), false);
    assert.equal(lines.at(-1), JSON.stringify({ ok: false, reason: "wrangler-exit" }));
  });

  it("prints an allowlisted reason when the error object itself carries the child text", async () => {
    const err = new UpdateError("wrangler-exit");
    err.log = SECRET;
    err.message = SECRET;
    const { lines } = await capture(async () => {
      reportFailure(err);
    });
    assert.equal(lines.join("\n").includes(SECRET), false);
    assert.deepEqual(lines, [JSON.stringify({ ok: false, reason: "wrangler-exit" })]);
    const unknown = new Error(SECRET);
    unknown.code = SECRET;
    unknown.log = SECRET;
    const second = await capture(async () => {
      reportFailure(unknown);
    });
    assert.equal(second.lines.join("\n").includes(SECRET), false);
    assert.deepEqual(second.lines, [JSON.stringify({ ok: false, reason: "failed" })]);
  });
});
