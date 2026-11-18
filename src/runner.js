import { UpdateError } from "./errors.js";

export async function execute(decision, deps) {
  if (!decision || decision.action === "refuse") {
    return { ok: false, action: "refuse", reason: decision?.reason || "event", proceeded: false };
  }
  if (decision.action === "skip-gated" || decision.action === "check-only") {
    return { ok: true, action: decision.action, reason: decision.reason, proceeded: false };
  }
  const prepared = await deps.prepare();
  if (decision.action === "dry-run") {
    const live = await safeInspect(deps, prepared);
    const health = await deps.health();
    return {
      ok: health.ok === true,
      action: "dry-run",
      proceeded: false,
      tag: prepared.tag,
      releaseId: prepared.releaseId,
      liveMatched: live.matched === true,
      liveReason: live.reason,
      health: health.ok ? "ok" : health.reason,
    };
  }
  if (decision.action !== "deploy") {
    return { ok: false, action: "refuse", reason: "action", proceeded: false };
  }
  if (decision.skipIfApplied) {
    const live = await safeInspect(deps, prepared);
    if (live.matched === true) {
      return {
        ok: true,
        action: "deploy",
        proceeded: false,
        skipped: true,
        reason: "already-applied",
        tag: prepared.tag,
        releaseId: prepared.releaseId,
      };
    }
  }
  await deps.deploy(prepared);
  const health = await deps.health();
  if (!health.ok) {
    return {
      ok: false,
      action: "deploy",
      proceeded: true,
      reason: "healthcheck-failed",
      health: health.reason,
      tag: prepared.tag,
      releaseId: prepared.releaseId,
    };
  }
  return {
    ok: true,
    action: "deploy",
    proceeded: true,
    tag: prepared.tag,
    releaseId: prepared.releaseId,
    health: "ok",
  };
}

async function safeInspect(deps, prepared) {
  try {
    return await deps.inspectLive(prepared);
  } catch (err) {
    const reason = err instanceof UpdateError ? err.code : "checkpoint-unreadable";
    return { matched: false, reason };
  }
}
