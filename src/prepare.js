import { UpdateError } from "./errors.js";
import { LIMITS, LATEST_RELEASE_URL, PAGES_ZIP_NAME, WORKER_NAME } from "./constants.js";
import { assertSha256, digestsAgree, parseSha256Sums } from "./checksums.js";
import { formatCheckpoint } from "./checkpoint.js";
import { downloadBounded } from "./http.js";
import { assetApiUrl, releaseApiUrl, selectPinnedRelease } from "./release.js";
import { materializeWorker } from "./target.js";
import { readWorkerFromZip } from "./zip-extract.js";

const GITHUB_HEADERS = Object.freeze({
  Accept: "application/vnd.github+json",
  "User-Agent": "cfnew-core-update",
  "X-GitHub-Api-Version": "2022-11-28",
});

export async function prepareRelease({ fetchImpl, destDir }) {
  const latest = await getJson(LATEST_RELEASE_URL, fetchImpl);
  if (!Number.isInteger(latest?.id)) throw new UpdateError("release-id");
  const confirmed = await getJson(releaseApiUrl(latest.id), fetchImpl);
  const pinned = selectPinnedRelease(latest, confirmed);
  const sumsBytes = await downloadAsset(pinned.sums, fetchImpl);
  const zipBytes = await downloadAsset(pinned.pages, fetchImpl);
  assertSha256(sumsBytes, pinned.sums.sha256);
  assertSha256(zipBytes, pinned.pages.sha256);
  const sums = parseSha256Sums(sumsBytes.toString("utf8"));
  if (!digestsAgree(pinned.pages.sha256, sums[PAGES_ZIP_NAME])) throw new UpdateError("checksum");
  const worker = await readWorkerFromZip(zipBytes);
  assertSha256(worker, sums[WORKER_NAME]);
  const uploadDir = materializeWorker(destDir, worker);
  const checkpoint = formatCheckpoint({
    tag: pinned.tag,
    releaseId: pinned.id,
    pagesSha256: pinned.pages.sha256,
  });
  return {
    tag: pinned.tag,
    releaseId: pinned.id,
    pagesSha256: pinned.pages.sha256,
    workerSha256: sums[WORKER_NAME],
    checkpoint,
    uploadDir,
  };
}

async function downloadAsset(asset, fetchImpl) {
  let bytes;
  try {
    bytes = await downloadBounded(assetApiUrl(asset.id), {
      fetchImpl,
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "cfnew-core-update",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      maxBytes: LIMITS.maxDownloadBytes,
    });
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError("download-status");
  }
  if (bytes.length !== asset.size) throw new UpdateError("asset-size");
  return bytes;
}

async function getJson(url, fetchImpl) {
  let bytes;
  try {
    bytes = await downloadBounded(url, {
      fetchImpl,
      headers: GITHUB_HEADERS,
      maxBytes: LIMITS.maxReleaseJsonBytes,
    });
  } catch (err) {
    if (err instanceof UpdateError) throw err;
    throw new UpdateError("release-json");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new UpdateError("release-json");
  }
}
