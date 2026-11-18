import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { UpdateError } from "./errors.js";
import { HEALTH_URL, LIMITS, WRANGLER_VERSION } from "./constants.js";
import { deploymentsUrl, liveMatches, summarizeDeployments } from "./checkpoint.js";
import { evaluateHealth } from "./health.js";
import { readBodyLimited } from "./http.js";
import { buildWranglerInvocation, scrubEnv } from "./target.js";

export async function inspectLiveRelease(accountId, token, expected, fetchImpl) {
  if (typeof token !== "string" || token.length < 20 || typeof accountId !== "string" || accountId.length === 0) {
    return { matched: false, reason: "credentials-absent" };
  }
  const response = await fetchImpl(deploymentsUrl(accountId), {
    redirect: "manual",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) throw new UpdateError("redirect");
  if (response.status !== 200) throw new UpdateError("checkpoint-status");
  const raw = await readBodyLimited(response, LIMITS.maxReleaseJsonBytes);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new UpdateError("checkpoint-json");
  }
  return liveMatches(summarizeDeployments(parsed), expected);
}

export async function checkRootOnce(fetchImpl) {
  const response = await fetchImpl(HEALTH_URL, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await readBodyLimited(response, 64);
  return evaluateHealth({
    status: response.status,
    body,
    contentType: response.headers.get("content-type") || "",
    location: response.headers.get("location"),
  });
}

export async function checkRootWithRetry(fetchImpl, attempts = 5, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let last = { ok: false, reason: "status", status: 0 };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      last = await checkRootOnce(fetchImpl);
    } catch {
      last = { ok: false, reason: "status", status: 0 };
    }
    if (last.ok) return last;
    if (attempt + 1 < attempts) await sleep(3_000);
  }
  return last;
}

export async function installWrangler(prefix, execFileImpl) {
  await execFileImpl("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--prefix",
    prefix,
    `wrangler@${WRANGLER_VERSION}`,
  ]);
  const pkgPath = path.join(prefix, "node_modules", "wrangler", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (pkg.name !== "wrangler" || pkg.version !== WRANGLER_VERSION) throw new UpdateError("wrangler-version");
  const bin = path.join(prefix, "node_modules", ".bin", "wrangler");
  if (!fs.existsSync(bin)) throw new UpdateError("wrangler-bin");
  return bin;
}

export async function runWrangler(prepared, { bin, env, spawnImpl }) {
  const invocation = buildWranglerInvocation(prepared.uploadDir, prepared.checkpoint);
  if (invocation.shell !== false) throw new UpdateError("unsafe-command");
  const childEnv = scrubEnv(env);
  const output = await spawnImpl(bin, invocation.args, {
    cwd: invocation.cwd,
    env: childEnv,
    shell: false,
  });
  if (!output || output.code !== 0) throw new UpdateError("wrangler-exit");
}

export function spawnCollected(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const take = (bucket, chunk) => {
      total += chunk.length;
      if (total > LIMITS.maxLogBytes) {
        child.kill("SIGTERM");
        fail(new UpdateError("log-limit"));
        return;
      }
      bucket.push(chunk);
    };
    child.stdout.on("data", (chunk) => take(stdout, chunk));
    child.stderr.on("data", (chunk) => take(stderr, chunk));
    child.on("error", () => fail(new UpdateError("wrangler-exit")));
    child.on("close", (code) => {
      succeed({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
