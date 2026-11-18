import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { UpdateError } from "../src/errors.js";
import { decide } from "../src/gate.js";
import { checkRootWithRetry, inspectLiveRelease, installWrangler, runWrangler, spawnCollected } from "../src/live.js";
import { prepareRelease } from "../src/prepare.js";
import { redact } from "../src/sanitize.js";
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

export async function main(env = process.env, fetchImpl = globalThis.fetch) {
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
          const bin = await installWrangler(prefix, execFileAsync);
          const deployed = await runWrangler(prepared, { bin, env, spawnImpl: spawnCollected });
          if (deployed.log) console.error(deployed.log);
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
    execFile(command, args, { shell: false, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const wrapped = new UpdateError("wrangler-install");
        wrapped.log = redact(`${stdout || ""}\n${stderr || ""}`, [
          process.env.CLOUDFLARE_API_TOKEN,
          process.env.CLOUDFLARE_ACCOUNT_ID,
        ]);
        reject(wrapped);
        return;
      }
      resolve({ stdout, stderr });
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
      const code = err instanceof UpdateError ? err.code : "failed";
      const log = err instanceof UpdateError && err.log ? err.log : "";
      console.error(JSON.stringify({ ok: false, reason: code }));
      if (log) console.error(log);
      process.exitCode = 1;
    });
}

export { CONTROL_KEYS };
