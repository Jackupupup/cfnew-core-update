import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpdateError } from "../src/errors.js";
import { LATEST_RELEASE_URL, assetApiUrl, releaseApiUrl, selectPinnedRelease } from "../src/release.js";

const DIGEST = `sha256:${"ab".repeat(32)}`;

function asset(overrides) {
  return {
    id: 11,
    name: "Pages.zip",
    state: "uploaded",
    size: 100,
    digest: DIGEST,
    browser_download_url: "https://evil.example/Pages.zip",
    ...overrides,
  };
}

function release(overrides = {}) {
  return {
    id: 416271394,
    tag_name: "v2026.10.17.2",
    draft: false,
    prerelease: false,
    assets: [
      asset({}),
      asset({ id: 12, name: "SHA256SUMS.txt", size: 153, digest: `sha256:${"cd".repeat(32)}` }),
      asset({ id: 13, name: "_worker.js", size: 50 }),
    ],
    ...overrides,
  };
}

describe("release selection", () => {
  it("pins the stable release id and ignores mutable download URLs", () => {
    const selected = selectPinnedRelease(release(), release());
    assert.equal(selected.id, 416271394);
    assert.equal(selected.tag, "v2026.10.17.2");
    assert.equal(selected.pages.id, 11);
    assert.equal(selected.sums.id, 12);
    assert.equal(JSON.stringify(selected).includes("evil.example"), false);
    assert.equal(assetApiUrl(selected.pages.id), "https://api.github.com/repos/byJoey/cfnew/releases/assets/11");
    assert.equal(releaseApiUrl(selected.id), "https://api.github.com/repos/byJoey/cfnew/releases/416271394");
    assert.equal(LATEST_RELEASE_URL, "https://api.github.com/repos/byJoey/cfnew/releases/latest");
  });

  it("rejects drafts, prereleases, mismatched ids, and bad assets", () => {
    const cases = [
      [release({ draft: true }), release(), "draft"],
      [release(), release({ prerelease: true }), "prerelease"],
      [release(), release({ id: 9 }), "release-id-mismatch"],
      [release(), release({ tag_name: "v1;rm -rf" }), "tag"],
      [release({ assets: [asset({ name: "Pages.zip" })] }), release({ assets: [asset({ name: "Pages.zip" })] }), "asset-name"],
      [release(), release({ assets: release().assets.map((item) => (item.name === "Pages.zip" ? { ...item, state: "starter" } : item)) }), "asset-state"],
      [release(), release({ assets: release().assets.map((item) => (item.name === "Pages.zip" ? { ...item, digest: "md5:abcd" } : item)) }), "asset-digest"],
    ];
    for (const [latest, confirmed, code] of cases) {
      assert.throws(() => selectPinnedRelease(latest, confirmed), (err) => err instanceof UpdateError && err.code === code);
    }
  });
});
