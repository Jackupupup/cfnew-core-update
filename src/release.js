import { UpdateError } from "./errors.js";
import { LATEST_RELEASE_URL, LIMITS, PAGES_ZIP_NAME, SUMS_NAME } from "./constants.js";

const TAG = /^v[0-9A-Za-z][0-9A-Za-z._-]{0,40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function releaseApiUrl(id) {
  assertId(id, "release-id");
  return `https://api.github.com/repos/byJoey/cfnew/releases/${id}`;
}

export function assetApiUrl(id) {
  assertId(id, "asset-id");
  return `https://api.github.com/repos/byJoey/cfnew/releases/assets/${id}`;
}

export function selectPinnedRelease(latest, confirmed) {
  assertStable(latest);
  assertStable(confirmed);
  if (latest.id !== confirmed.id) throw new UpdateError("release-id-mismatch");
  if (latest.tag_name !== confirmed.tag_name) throw new UpdateError("release-tag-mismatch");
  const assets = pickAssets(confirmed);
  return {
    id: confirmed.id,
    tag: confirmed.tag_name,
    pages: assets.pages,
    sums: assets.sums,
  };
}

function assertStable(release) {
  if (!release || typeof release !== "object") throw new UpdateError("release-shape");
  if (release.draft !== false) throw new UpdateError("draft");
  if (release.prerelease !== false) throw new UpdateError("prerelease");
  assertId(release.id, "release-id");
  if (typeof release.tag_name !== "string" || !TAG.test(release.tag_name)) {
    throw new UpdateError("tag");
  }
}

function pickAssets(release) {
  if (!Array.isArray(release.assets)) throw new UpdateError("assets");
  return {
    pages: oneAsset(release.assets, PAGES_ZIP_NAME),
    sums: oneAsset(release.assets, SUMS_NAME),
  };
}

function oneAsset(assets, name) {
  const matches = assets.filter((asset) => asset && asset.name === name);
  if (matches.length !== 1) throw new UpdateError("asset-name");
  const asset = matches[0];
  assertId(asset.id, "asset-id");
  if (asset.state !== "uploaded") throw new UpdateError("asset-state");
  if (
    typeof asset.size !== "number" ||
    !Number.isInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > LIMITS.maxDownloadBytes
  ) {
    throw new UpdateError("asset-size");
  }
  if (typeof asset.digest !== "string" || !DIGEST.test(asset.digest)) {
    throw new UpdateError("asset-digest");
  }
  return {
    id: asset.id,
    name,
    size: asset.size,
    sha256: asset.digest.slice("sha256:".length),
  };
}

function assertId(id, code) {
  if (!Number.isInteger(id) || id <= 0 || id > Number.MAX_SAFE_INTEGER) {
    throw new UpdateError(code);
  }
}

export { LATEST_RELEASE_URL, LIMITS };
