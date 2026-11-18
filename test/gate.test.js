import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/gate.js";

const repo = "Jackupupup/cfnew-core-update";

describe("schedule gate", () => {
  it("deploys on a schedule only when the variable is exactly true", () => {
    const enabled = decide({ eventName: "schedule", autoUpdateEnabled: "true", repository: repo, mode: "deploy" });
    assert.equal(enabled.action, "deploy");
    assert.equal(enabled.skipIfApplied, true);
    assert.equal(enabled.manual, false);
    for (const value of ["", "false", "False", "TRUE", "True", "1", "yes", " true", "true\n"]) {
      const gated = decide({ eventName: "schedule", autoUpdateEnabled: value, repository: repo });
      assert.equal(gated.action, "skip-gated", value);
    }
  });

  it("allows a manual deploy and a manual dry-run, and never deploys pull requests", () => {
    const manual = decide({ eventName: "workflow_dispatch", mode: "deploy", autoUpdateEnabled: "false", repository: repo });
    assert.equal(manual.action, "deploy");
    assert.equal(manual.skipIfApplied, false);
    const dry = decide({ eventName: "workflow_dispatch", mode: "dry-run", autoUpdateEnabled: "true", repository: repo });
    assert.equal(dry.action, "dry-run");
    assert.equal(decide({ eventName: "workflow_dispatch", mode: "ship", repository: repo }).action, "refuse");
    assert.equal(decide({ eventName: "pull_request", repository: repo, mode: "deploy" }).action, "check-only");
    assert.equal(decide({ eventName: "push", repository: repo }).action, "check-only");
    assert.equal(decide({ eventName: "pull_request_target", repository: repo, mode: "deploy" }).reason, "pull_request_target");
    assert.equal(decide({ eventName: "workflow_dispatch", mode: "deploy", repository: "attacker/fork" }).action, "refuse");
  });
});
