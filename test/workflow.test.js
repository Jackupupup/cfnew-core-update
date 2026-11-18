import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { WRANGLER_VERSION } from "../src/constants.js";

const root = path.resolve(import.meta.dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

describe("workflow and repository guards", () => {
  it("keeps the workflow least-privilege, pinned, and gated", () => {
    const yaml = read(".github/workflows/core-update.yml");
    assert.match(yaml, /cron: "17 \*\/6 \* \* \*"/);
    assert.match(yaml, /permissions:\n {2}contents: read/);
    assert.match(yaml, /persist-credentials: false/);
    assert.match(yaml, /cancel-in-progress: false/);
    assert.match(yaml, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
    assert.match(yaml, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
    assert.match(yaml, /ubuntu-latest/);
    assert.match(yaml, /node scripts\/update-core\.mjs run/);
    assert.match(yaml, /AUTO_UPDATE_ENABLED/);
    assert.match(yaml, /mode == 'dry-run'/);
    assert.match(yaml, /mode == 'deploy'/);
    assert.equal(yaml.includes("pull_request_target"), false);
    assert.equal(yaml.includes("set -x"), false);
    assert.equal(yaml.includes("contents: write"), false);
    assert.equal(yaml.includes("npx"), false);
    assert.equal(yaml.includes("wrangler.toml"), false);
    assert.equal(yaml.includes("project create"), false);
    assert.equal(WRANGLER_VERSION, "4.164.0");
    const lines = yaml.split("\n");
    let job = "";
    for (const line of lines) {
      const jobMatch = /^ {2}([a-z-]+):$/.exec(line);
      if (jobMatch) job = jobMatch[1];
      if (line.includes("secrets.")) {
        assert.match(line, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
        assert.ok(job === "dry-run" || job === "deploy");
      }
    }
    const inputs = yaml.split("workflow_dispatch:")[1].split("jobs:")[0];
    const inputKeys = [...inputs.matchAll(/^ {6}([a-z_]+):$/gm)].map((match) => match[1]);
    assert.deepEqual(inputKeys, ["mode"]);
  });

  it("does not hardcode secret routes or mutable deploy inputs", () => {
    const files = [
      "README.md",
      "package.json",
      ".github/workflows/core-update.yml",
      "scripts/update-core.mjs",
      ...fs.readdirSync(path.join(root, "src")).map((name) => path.join("src", name)),
      ...fs.readdirSync(path.join(root, "docs")).map((name) => path.join("docs", name)),
    ];
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const file of files) {
      const text = read(file);
      assert.equal(uuid.test(text), false, file);
      assert.equal(text.includes("set -x"), false, file);
      assert.equal(text.includes("shell: true"), false, file);
    }
    for (const file of ["src/gate.js", "src/release.js", "src/target.js", "src/prepare.js", "src/zip-extract.js"]) {
      assert.equal(read(file).includes("process.env"), false, file);
    }
    const readme = read("README.md");
    assert.match(readme, /^# cfnew-core-update/);
    assert.match(readme, /Automatic verified cfnew core updates for an existing Cloudflare Pages project/);
    assert.equal(fs.existsSync(path.join(root, "wrangler.toml")), false);
    assert.equal(fs.existsSync(path.join(root, "wrangler.json")), false);
    assert.equal(fs.existsSync(path.join(root, "wrangler.jsonc")), false);
  });
});
