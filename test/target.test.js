import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { COMPATIBILITY_DATE, KV_NAMESPACE_NAME, PROJECT_NAME } from "../src/constants.js";
import { UpdateError } from "../src/errors.js";
import { assertUploadReady, buildWranglerInvocation, materializeWorker, scrubEnv } from "../src/target.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cfnew-test-"));
}

describe("fixed target", () => {
  it("builds a folder deploy that cannot retarget the project or send config", () => {
    const dir = tempDir();
    materializeWorker(dir, Buffer.from("export default {}\n"));
    const invocation = buildWranglerInvocation(dir, "cfnew-core tag=v2026.10.17.2 release=416271394 pages=" + "ab".repeat(32));
    assert.equal(invocation.shell, false);
    assert.deepEqual(invocation.args.slice(0, 7), [
      "pages",
      "deploy",
      fs.realpathSync(dir),
      `--project-name=${PROJECT_NAME}`,
      "--branch=main",
      "--commit-dirty=true",
      "--no-bundle",
    ]);
    const joined = invocation.args.join(" ");
    assert.equal(joined.includes("--config"), false);
    assert.equal(joined.includes(COMPATIBILITY_DATE), false);
    assert.equal(joined.includes(KV_NAMESPACE_NAME), false);
    assert.equal(joined.includes("wrangler.toml"), false);
    assert.equal(fs.readdirSync(dir).join(","), "_worker.js");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects wrangler config, extra files, symlinks, and a checkout directory", () => {
    const dir = tempDir();
    const parent = tempDir();
    const insideRepo = fs.mkdtempSync(path.join(process.cwd(), "upload-test-"));
    try {
      materializeWorker(dir, Buffer.from("ok"));
      fs.writeFileSync(path.join(dir, "notes.txt"), "x\n");
      assert.throws(() => assertUploadReady(dir), (err) => err instanceof UpdateError && err.code === "upload-contents");
      fs.rmSync(path.join(dir, "notes.txt"));
      fs.writeFileSync(path.join(dir, "wrangler.toml"), "name = 'x'\n");
      assert.throws(() => assertUploadReady(dir), (err) => err.code === "config-in-tree");
      fs.rmSync(path.join(dir, "wrangler.toml"));
      fs.rmSync(path.join(dir, "_worker.js"));
      fs.symlinkSync("/etc/passwd", path.join(dir, "_worker.js"));
      assert.throws(() => assertUploadReady(dir), (err) => err.code === "upload-contents");

      fs.writeFileSync(path.join(parent, "wrangler.jsonc"), "{}\n");
      const child = path.join(parent, "upload");
      fs.mkdirSync(child);
      fs.writeFileSync(path.join(child, "_worker.js"), "ok");
      assert.throws(() => assertUploadReady(child), (err) => err.code === "config-in-tree");

      fs.writeFileSync(path.join(insideRepo, "_worker.js"), "ok");
      assert.throws(() => assertUploadReady(insideRepo), (err) => err.code === "git-in-tree");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(parent, { recursive: true, force: true });
      fs.rmSync(insideRepo, { recursive: true, force: true });
    }
  });

  it("scrubs debug and alternate API settings before Wrangler starts", () => {
    const env = scrubEnv({
      PATH: "/usr/bin",
      WRANGLER_LOG: "debug",
      ACTIONS_STEP_DEBUG: "true",
      CLOUDFLARE_API_BASE_URL: "https://example.invalid",
      CLOUDFLARE_API_TOKEN: "token-value",
      CLOUDFLARE_ACCOUNT_ID: "abc",
      CLOUDFLARE_API_KEY: "global-key",
    });
    assert.equal(env.WRANGLER_LOG, "warn");
    assert.equal(env.WRANGLER_LOG_SANITIZE, "true");
    assert.equal(env.WRANGLER_SEND_METRICS, "false");
    assert.equal(env.CI, "true");
    assert.equal(Object.hasOwn(env, "CLOUDFLARE_API_BASE_URL"), false);
    assert.equal(Object.hasOwn(env, "CLOUDFLARE_API_KEY"), false);
    assert.equal(Object.hasOwn(env, "ACTIONS_STEP_DEBUG"), false);
    assert.equal(env.CLOUDFLARE_API_TOKEN, "token-value");
    assert.equal(env.PATH, "/usr/bin");
  });
});
