export const REPOSITORY = "Jackupupup/cfnew-core-update";
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/byJoey/cfnew/releases/latest";
export const WRANGLER_VERSION = "4.164.0";
export const PROJECT_NAME = "cfnew-backup";
export const BRANCH = "main";
export const PUBLIC_HOST = "cfnew-backup.pages.dev";
export const HEALTH_URL = "https://cfnew-backup.pages.dev/";
export const COMPATIBILITY_DATE = "2026-01-20";
export const KV_BINDING = "C";
export const KV_NAMESPACE_NAME = "cfnew-backup-config";
export const AUTO_UPDATE_VARIABLE = "AUTO_UPDATE_ENABLED";
export const WORKER_NAME = "_worker.js";
export const PAGES_ZIP_NAME = "Pages.zip";
export const SUMS_NAME = "SHA256SUMS.txt";

export const LIMITS = Object.freeze({
  maxEntries: 8,
  maxCompressedBytes: 512 * 1024,
  maxUncompressedBytes: 1024 * 1024,
  maxRatio: 40,
  maxDownloadBytes: 512 * 1024,
  maxSumsBytes: 4096,
  maxReleaseJsonBytes: 1024 * 1024,
  maxCheckpointBytes: 300,
  maxLogBytes: 200 * 1024,
});

export const DOWNLOAD_HOSTS = Object.freeze([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export const WRANGLER_CONFIG_NAMES = Object.freeze([
  "wrangler.toml",
  "wrangler.json",
  "wrangler.jsonc",
]);
