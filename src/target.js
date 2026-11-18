import fs from "node:fs";
import path from "node:path";
import { UpdateError } from "./errors.js";
import {
  BRANCH,
  COMPATIBILITY_DATE,
  KV_BINDING,
  KV_NAMESPACE_NAME,
  LIMITS,
  PROJECT_NAME,
  WRANGLER_CONFIG_NAMES,
  WORKER_NAME,
} from "./constants.js";

const FORBIDDEN = ["project create", "secret", " kv", "delete", "--config", "download config", "wrangler.toml"];

export function buildWranglerInvocation(uploadDir, commitMessage) {
  const resolved = assertUploadReady(uploadDir);
  if (typeof commitMessage !== "string" || commitMessage.length === 0 || commitMessage.length > LIMITS.maxCheckpointBytes) {
    throw new UpdateError("checkpoint");
  }
  if (/[\r\n\0]/.test(commitMessage) || !commitMessage.startsWith("cfnew-core ")) {
    throw new UpdateError("checkpoint");
  }
  const args = [
    "pages",
    "deploy",
    resolved,
    `--project-name=${PROJECT_NAME}`,
    `--branch=${BRANCH}`,
    "--commit-dirty=true",
    "--no-bundle",
    `--commit-message=${commitMessage}`,
  ];
  const joined = args.join(" ");
  if (joined.includes(COMPATIBILITY_DATE) || joined.includes(KV_NAMESPACE_NAME) || joined.includes(` ${KV_BINDING} `)) {
    throw new UpdateError("unsafe-command");
  }
  for (const token of FORBIDDEN) {
    if (joined.toLowerCase().includes(token)) throw new UpdateError("unsafe-command");
  }
  return { command: "wrangler", args, cwd: resolved, shell: false };
}

export function materializeWorker(dir, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > LIMITS.maxUncompressedBytes) {
    throw new UpdateError("upload-contents");
  }
  const resolved = fs.realpathSync(dir);
  assertParentsSafe(resolved);
  if (fs.readdirSync(resolved).length !== 0) throw new UpdateError("upload-contents");
  const filePath = path.join(resolved, WORKER_NAME);
  const fd = fs.openSync(filePath, "wx", 0o644);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length) {
    throw new UpdateError("upload-contents");
  }
  return resolved;
}

export function assertUploadReady(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) throw new UpdateError("upload-path");
  const resolved = fs.realpathSync(dir);
  assertParentsSafe(resolved);
  const entries = fs.readdirSync(resolved);
  if (entries.length !== 1 || entries[0] !== WORKER_NAME) throw new UpdateError("upload-contents");
  const filePath = path.join(resolved, WORKER_NAME);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UpdateError("upload-contents");
  if (stat.size <= 0 || stat.size > LIMITS.maxUncompressedBytes) throw new UpdateError("upload-contents");
  return resolved;
}

export function assertParentsSafe(start) {
  let current = fs.realpathSync(start);
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    if (fs.existsSync(path.join(current, ".git"))) throw new UpdateError("git-in-tree");
    for (const name of WRANGLER_CONFIG_NAMES) {
      if (fs.existsSync(path.join(current, name))) throw new UpdateError("config-in-tree");
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function scrubEnv(source) {
  const env = { ...source };
  for (const key of [
    "ACTIONS_STEP_DEBUG",
    "RUNNER_DEBUG",
    "NODE_DEBUG",
    "WRANGLER_LOG_PATH",
    "WRANGLER_OUTPUT_FILE_PATH",
    "WRANGLER_OUTPUT_FILE_DIRECTORY",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
    "CLOUDFLARE_API_BASE_URL",
    "CLOUDFLARE_API_HEADERS",
    "CLOUDFLARE_ENV",
    "CF_API_KEY",
    "CF_API_TOKEN",
    "CF_EMAIL",
    "CF_ACCOUNT_ID",
    "CF_API_BASE_URL",
  ]) {
    delete env[key];
  }
  env.WRANGLER_LOG = "warn";
  env.WRANGLER_LOG_SANITIZE = "true";
  env.WRANGLER_SEND_METRICS = "false";
  env.WRANGLER_SEND_ERROR_REPORTS = "false";
  env.CI = "true";
  env.FORCE_COLOR = "0";
  return env;
}
