import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { UpdateError } from "../src/errors.js";
import { decide } from "../src/gate.js";
import { checkRootWithRetry, inspectLiveRelease, installWrangler, runWrangler, spawnCollected } from "../src/live.js";
import { prepareRelease } from "../src/prepare.js";
import { execute } from "../src/runner.js";

const CONTROL_KEYS = ["EVENT_NAME", "DISPATCH_MODE", "AUTO_UPDATE_ENABLED", "GITHUB_REPOSITORY"];

export function controlFromEnv(env) {
  return {
    eventName: env.EVENT_NAME || "",
    mode: env.DISPATCH_MODE || "",
    autoUpdateEnabled: env.AUTO_UPDATE_ENABLED || "",
    repository: env.GITHUB_REPOSITORY || "",
  };
}

const FAILURE_REASONS = new Set([
  "account-id",
  "asset-digest",
  "asset-name",
  "asset-size",
  "asset-state",
  "assets",
  "checksum",
  "checkpoint",
  "checkpoint-json",
  "checkpoint-shape",
  "checkpoint-status",
  "config-in-tree",
  "crc",
  "directory",
  "download-host",
  "download-size",
  "download-status",
  "draft",
  "failed",
  "git-in-tree",
  "inflate",
  "log-limit",
  "prerelease",
  "ratio-limit",
  "redirect",
  "release-id",
  "release-id-mismatch",
  "release-json",
  "release-shape",
  "release-tag-mismatch",
  "size-limit",
  "sums-shape",
  "symlink",
  "tag",
  "too-many-entries",
  "unexpected-entry",
  "unsafe-command",
  "unsafe-name",
  "upload-contents",
  "upload-path",
  "wrangler-bin",
  "wrangler-exit",
  "wrangler-install",
  "wrangler-version",
  "zip-central",
  "zip-eocd",
  "zip-extra",
  "zip-flags",
  "zip-local",
  "zip-method",
  "zip-shape",
  "zip-size",
  "zip-version",
  "zip64",
]);

export function reportFailure(err) {
  const code = err instanceof UpdateError && FAILURE_REASONS.has(err.code) ? err.code : "failed";
  console.error(JSON.stringify({ ok: false, reason: code }));
}

export async function main(env = process.env, fetchImpl = globalThis.fetch, hooks = {}) {
  const spawnImpl = hooks.spawnImpl ?? spawnCollected;
  const execFileImpl = hooks.execFileImpl ?? execFileAsync;
  const decision = decide(controlFromEnv(env));
  let uploadDir = "";
  try {
    const result = await execute(decision, {
      prepare: async () => {
        uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cfnew-upload-"));
        try {
          return await prepareRelease({ fetchImpl, destDir: uploadDir });
        } catch (err) {
          await fs.promises.rm(uploadDir, { recursive: true, force: true });
          uploadDir = "";
          throw err;
        }
      },
      inspectLive: (prepared) =>
        inspectLiveRelease(env.CLOUDFLARE_ACCOUNT_ID || "", env.CLOUDFLARE_API_TOKEN || "", prepared.checkpoint, fetchImpl),
      health: () => checkRootWithRetry(fetchImpl),
      deploy: async (prepared) => {
        const prefix = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cfnew-wrangler-"));
        try {
          const bin = await installWrangler(prefix, execFileImpl);
          await runWrangler(prepared, { bin, env, spawnImpl });
        } finally {
          await fs.promises.rm(prefix, { recursive: true, force: true });
        }
      },
    });
    const publicResult = {
    ok: result.ok,
    action: result.action,
    reason: result.reason || "",
    proceeded: result.proceeded === true,
    skipped: result.skipped === true,
    tag: result.tag || "",
    releaseId: result.releaseId || 0,
    liveMatched: result.liveMatched === true,
    liveReason: result.liveReason || "",
      health: result.health || "",
    };
    console.log(JSON.stringify(publicResult));
    if (!result.ok && result.reason === "healthcheck-failed") {
      console.error(
        "Health check failed. In the Cloudflare dashboard, roll back cfnew-backup to the previous deployment. Do not delete KV data or change project settings."
      );
    }
    return publicResult;
  } finally {
    if (uploadDir) await fs.promises.rm(uploadDir, { recursive: true, force: true });
  }
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { shell: false, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      if (err) {
        reject(new UpdateError("wrangler-install"));
        return;
      }
      resolve();
    });
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main()
    .then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      reportFailure(err);
      process.exitCode = 1;
    });
}

export { CONTROL_KEYS };
