import { REPOSITORY } from "./constants.js";

export function decide(input) {
  const eventName = input?.eventName ?? "";
  const mode = input?.mode ?? "";
  const autoUpdateEnabled = input?.autoUpdateEnabled ?? "";
  const repository = input?.repository ?? "";
  if (repository !== REPOSITORY) return { action: "refuse", reason: "repository" };
  if (eventName === "pull_request_target") return { action: "refuse", reason: "pull_request_target" };
  if (eventName === "pull_request" || eventName === "push") {
    return { action: "check-only", reason: eventName, skipIfApplied: false };
  }
  if (eventName === "schedule") {
    if (autoUpdateEnabled === "true") {
      return { action: "deploy", reason: "schedule", skipIfApplied: true, manual: false };
    }
    return { action: "skip-gated", reason: "auto-update-disabled", skipIfApplied: false };
  }
  if (eventName === "workflow_dispatch") {
    if (mode === "dry-run") {
      return { action: "dry-run", reason: "dispatch-dry-run", skipIfApplied: false, manual: true };
    }
    if (mode === "deploy") {
      return { action: "deploy", reason: "dispatch-deploy", skipIfApplied: false, manual: true };
    }
    return { action: "refuse", reason: "mode" };
  }
  return { action: "refuse", reason: "event" };
}
