import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { sha256 } from "../src/checksums.js";
import { assetApiUrl, releaseApiUrl, LATEST_RELEASE_URL } from "../src/release.js";
import { decide } from "../src/gate.js";
import { evaluateHealth } from "../src/health.js";
import { downloadBounded } from "../src/http.js";
import { prepareRelease } from "../src/prepare.js";
import { redact } from "../src/sanitize.js";
import { execute } from "../src/runner.js";
import { makeZip } from "../testing/zip-fixture.js";
import { main } from "../scripts/update-core.mjs";

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

describe("runner", () => {
  it("dry-run and gated runs do not deploy; manual deploy repeats the same release", async () => {
    const prepared = { tag: "v2026.10.17.2", releaseId: 1, checkpoint: "cfnew-core tag=v1 release=1 pages=" + "ab".repeat(32) };
    let deploys = 0;
    const deps = {
      prepare: async () => prepared,
      inspectLive: async () => ({ matched: true, reason: "checkpoint" }),
      health: async () => ({ ok: true }),
      deploy: async () => {
        deploys += 1;
      },
    };
    const dry = await execute(decide({ eventName: "workflow_dispatch", mode: "dry-run", repository: repo }), deps);
    assert.equal(dry.proceeded, false);
    assert.equal(dry.liveMatched, true);
    assert.equal(deploys, 0);
    const manual = await execute(decide({ eventName: "workflow_dispatch", mode: "deploy", repository: repo, autoUpdateEnabled: "false" }), deps);
    assert.equal(manual.proceeded, true);
    assert.equal(deploys, 1);
    const scheduled = await execute(decide({ eventName: "schedule", autoUpdateEnabled: "true", repository: repo }), deps);
    assert.equal(scheduled.skipped, true);
    assert.equal(deploys, 1);
    const missed = await execute(decide({ eventName: "schedule", autoUpdateEnabled: "true", repository: repo }), {
      ...deps,
      inspectLive: async () => {
        throw new Error("supersecretvalue");
      },
    });
    assert.equal(missed.proceeded, true);
    assert.equal(JSON.stringify(missed).includes("supersecretvalue"), false);
    assert.equal(deploys, 2);
    const gated = await execute(decide({ eventName: "schedule", autoUpdateEnabled: "false", repository: repo }), deps);
    assert.equal(gated.action, "skip-gated");
    assert.equal(deploys, 2);
  });

  it("prepares a release from pinned asset ids and writes only _worker.js", async () => {
    const worker = Buffer.from("export default { fetch(){ return new Response('hello'); } }\n");
    const zip = makeZip([{ name: "_worker.js", data: worker, method: 8 }]);
    const workerHash = sha256(worker);
    const zipHash = sha256(zip);
    const sums = Buffer.from(`${zipHash}  Pages.zip\n${workerHash}  _worker.js\n`);
    const sumsHash = sha256(sums);
    const release = {
      id: 416271394,
      tag_name: "v2026.10.17.2",
      draft: false,
      prerelease: false,
      assets: [
        { id: 21, name: "Pages.zip", state: "uploaded", size: zip.length, digest: `sha256:${zipHash}`, browser_download_url: "https://evil.example/Pages.zip" },
        { id: 22, name: "SHA256SUMS.txt", state: "uploaded", size: sums.length, digest: `sha256:${sumsHash}` },
      ],
    };
    const seen = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      seen.push(href);
      if (href === LATEST_RELEASE_URL || href === releaseApiUrl(416271394)) return responseFor(JSON.stringify(release), 200, { "content-type": "application/json" });
      if (href === assetApiUrl(21)) return responseFor(zip, 200, { "content-length": String(zip.length) });
      if (href === assetApiUrl(22)) return responseFor(sums, 200, { "content-length": String(sums.length) });
      throw new Error(`unexpected ${href}`);
    };
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "cfnew-prepare-"));
    const prepared = await prepareRelease({ fetchImpl, destDir: dest });
    assert.deepEqual(fs.readdirSync(dest), ["_worker.js"]);
    assert.equal(fs.readFileSync(path.join(dest, "_worker.js")).equals(worker), true);
    assert.equal(prepared.checkpoint.includes("release=416271394"), true);
    assert.equal(seen.some((url) => url.includes("evil.example")), false);
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it("does not follow a release download off GitHub", async () => {
    await assert.rejects(
      downloadBounded("https://api.github.com/repos/byJoey/cfnew/releases/assets/1", {
        fetchImpl: async () => responseFor("go", 302, { location: "https://evil.example/file" }),
        maxBytes: 100,
      }),
      (err) => err.code === "download-host",
    );
  });

  it("checks the public root and redacts secrets", () => {
    assert.deepEqual(evaluateHealth({ status: 200, body: Buffer.from("hello"), contentType: "text/plain; charset=utf-8" }), { ok: true, status: 200 });
    assert.equal(evaluateHealth({ status: 200, body: Buffer.from("hello\n"), contentType: "text/plain" }).ok, false);
    assert.equal(evaluateHealth({ status: 302, body: Buffer.from("hello"), location: "https://example.invalid/secret" }).reason, "redirect");
    const account = "0123456789abcdef0123456789abcdef";
    const token = "cfut_example_token_value";
    const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const redacted = redact(`Bearer ${token} account ${account} path /${uuid}/sub https://cfnew-backup.pages.dev/ https://api.github.com/repos/byJoey/cfnew/releases/latest?token=${token}`, [token]);
    assert.equal(redacted.includes(token), false);
    assert.equal(redacted.includes(account), false);
    assert.equal(redacted.includes(uuid), false);
    assert.equal(redacted.includes("https://cfnew-backup.pages.dev/"), true);
    assert.equal(redacted.includes("releases/latest"), true);
    assert.equal(redacted.includes("?token="), false);
  });

  it("keeps a disabled schedule off the network", async () => {
    const result = await main(
      {
        EVENT_NAME: "schedule",
        AUTO_UPDATE_ENABLED: "false",
        GITHUB_REPOSITORY: repo,
        CLOUDFLARE_API_TOKEN: "should-not-be-read",
      },
      async () => {
        throw new Error("network");
      },
    );
    assert.equal(result.action, "skip-gated");
    assert.equal(result.ok, true);
  });
});

describe("cli process", () => {
  it("exits successfully for a gated schedule", async () => {
    const child = spawn(process.execPath, ["scripts/update-core.mjs"], {
      env: {
        ...process.env,
        EVENT_NAME: "schedule",
        AUTO_UPDATE_ENABLED: "",
        GITHUB_REPOSITORY: repo,
      },
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).action, "skip-gated");
  });
});
