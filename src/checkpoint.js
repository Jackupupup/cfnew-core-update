import { UpdateError } from "./errors.js";
import { LIMITS, PROJECT_NAME } from "./constants.js";

const ACCOUNT = /^[a-f0-9]{32}$/;
const CHECKPOINT =
  /^cfnew-core tag=(v[0-9A-Za-z][0-9A-Za-z._-]{0,40}) release=([1-9][0-9]{0,15}) pages=([a-f0-9]{64})$/;

export function formatCheckpoint({ tag, releaseId, pagesSha256 }) {
  const message = `cfnew-core tag=${tag} release=${releaseId} pages=${pagesSha256}`;
  if (Buffer.byteLength(message) > LIMITS.maxCheckpointBytes || !CHECKPOINT.test(message)) {
    throw new UpdateError("checkpoint");
  }
  return message;
}

export function deploymentsUrl(accountId) {
  if (!ACCOUNT.test(accountId)) throw new UpdateError("account-id");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${PROJECT_NAME}/deployments?per_page=10`;
}

export function summarizeDeployments(payload) {
  if (!payload || payload.success !== true || !Array.isArray(payload.result)) {
    throw new UpdateError("checkpoint-shape");
  }
  return payload.result.map((item) => {
    const metadata =
      item &&
      item.deployment_trigger &&
      typeof item.deployment_trigger === "object" &&
      item.deployment_trigger.metadata &&
      typeof item.deployment_trigger.metadata === "object"
        ? item.deployment_trigger.metadata
        : {};
    const stage =
      item &&
      item.latest_stage &&
      (item.latest_stage.status === "success" || item.latest_stage.status === "failure")
        ? item.latest_stage.status
        : "";
    return {
      environment: item && (item.environment === "production" || item.environment === "preview") ? item.environment : "",
      createdOn: item && typeof item.created_on === "string" ? item.created_on.slice(0, 40) : "",
      stage,
      commitMessage: typeof metadata.commit_message === "string" ? metadata.commit_message.slice(0, 400) : "",
    };
  });
}

export function liveMatches(rows, expected) {
  if (!Array.isArray(rows) || !CHECKPOINT.test(expected)) {
    return { matched: false, reason: "checkpoint-shape" };
  }
  const production = rows.filter((row) => row && row.environment === "production");
  if (production.length === 0) return { matched: false, reason: "no-production-deployment" };
  production.sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));
  const latest = production[0];
  if (latest.stage !== "success") return { matched: false, reason: "latest-not-success" };
  if (latest.commitMessage !== expected) return { matched: false, reason: "checkpoint-differs" };
  return { matched: true, reason: "checkpoint" };
}
