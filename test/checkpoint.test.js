import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deploymentsUrl, formatCheckpoint, liveMatches, summarizeDeployments } from "../src/checkpoint.js";
import { PROJECT_NAME } from "../src/constants.js";

const secret = "11111111-2222-4333-8444-555555555555";
const account = "0123456789abcdef0123456789abcdef";
const expected = formatCheckpoint({
  tag: "v2026.10.17.2",
  releaseId: 416271394,
  pagesSha256: "d1".repeat(32),
});

describe("version checkpoint", () => {
  it("matches only the newest successful production checkpoint and drops secret fields", () => {
    const rows = summarizeDeployments({
      success: true,
      result: [
        {
          id: secret,
          environment: "production",
          created_on: "2026-11-01T00:00:00.000Z",
          latest_stage: { status: "success" },
          deployment_trigger: { metadata: { commit_message: expected, commit_hash: "abc" } },
          env_vars: { u: { value: secret } },
          aliases: [`https://${secret}.example`],
        },
        {
          environment: "preview",
          created_on: "2026-11-02T00:00:00.000Z",
          latest_stage: { status: "success" },
          deployment_trigger: { metadata: { commit_message: "other" } },
        },
      ],
    });
    assert.equal(JSON.stringify(rows).includes(secret), false);
    assert.equal(JSON.stringify(rows).includes("env_vars"), false);
    assert.deepEqual(liveMatches(rows, expected), { matched: true, reason: "checkpoint" });
    const url = deploymentsUrl(account);
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${PROJECT_NAME}/deployments?per_page=10`);
    assert.equal(url.includes("other-project"), false);
  });

  it("does not skip when the checkpoint is absent, failed, or different", () => {
    const base = {
      environment: "production",
      created_on: "2026-11-03T00:00:00.000Z",
      latest_stage: { status: "success" },
      deployment_trigger: { metadata: { commit_message: "manual upload" } },
    };
    assert.equal(liveMatches(summarizeDeployments({ success: true, result: [base] }), expected).reason, "checkpoint-differs");
    assert.equal(
      liveMatches(
        summarizeDeployments({
          success: true,
          result: [{ ...base, latest_stage: { status: "failure" }, deployment_trigger: { metadata: { commit_message: expected } } }],
        }),
        expected,
      ).reason,
      "latest-not-success",
    );
    assert.equal(liveMatches([], expected).reason, "no-production-deployment");
    const hidden = liveMatches(
      [{ environment: "production", createdOn: "2026-11-03T00:00:00.000Z", stage: "success", commitMessage: secret }],
      expected,
    );
    assert.equal(JSON.stringify(hidden).includes(secret), false);
  });
});
