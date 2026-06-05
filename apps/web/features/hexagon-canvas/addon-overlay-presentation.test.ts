import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addOnHoverText,
  addOnName,
  capabilityLabel,
  addOnChipVisual,
} from "./addon-overlay-presentation";

describe("addon-overlay-presentation", () => {
  it("attributes a context-adapter with the add-on name + capability label", () => {
    assert.equal(
      addOnHoverText({
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        kind: "context-adapter",
      }),
      `Provided by ${addOnName("bullmq")} (messaging adapter)`,
    );
  });

  it("distinguishes no-host from a genuine project-level platform add-on", () => {
    assert.equal(
      addOnHoverText({
        addOnId: "bullmq",
        capability: "messaging.out-adapter",
        kind: "platform-zone",
        reason: "no-host",
      }),
      `${addOnName("bullmq")} selected — no context declares this messaging adapter yet`,
    );
    assert.equal(
      addOnHoverText({
        addOnId: "docker",
        capability: "platform.container",
        kind: "platform-zone",
        reason: "project",
      }),
      `Provided by ${addOnName("docker")} — container · project-level`,
    );
  });

  it("labels shared-kernel and no-compass-field distinctly", () => {
    assert.equal(
      addOnHoverText({
        addOnId: "shared-types",
        capability: "kernel.user-context",
        kind: "shared-kernel",
      }),
      `Provided by ${addOnName("shared-types")} — shared-kernel primitive`,
    );
    assert.equal(
      addOnHoverText({
        addOnId: "llm-adapter",
        capability: "llm.out-adapter",
        kind: "platform-zone",
        reason: "no-compass-field",
      }),
      `Provided by ${addOnName("llm-adapter")} — no dedicated compass slot (LLM adapter)`,
    );
  });

  it("falls back to the raw id / capability when unmapped", () => {
    assert.equal(capabilityLabel("mystery.cap"), "mystery.cap");
    assert.equal(
      addOnHoverText({
        addOnId: "unknown-xyz",
        capability: "mystery.cap",
        kind: "context-adapter",
      }),
      "Provided by unknown-xyz (mystery.cap)",
    );
  });

  it("gives each chip kind a distinct visual (the same helper the legend uses)", () => {
    const project = addOnChipVisual({
      kind: "platform-zone",
      reason: "project",
    });
    const shared = addOnChipVisual({ kind: "shared-kernel" });
    const noHost = addOnChipVisual({
      kind: "platform-zone",
      reason: "no-host",
    });
    assert.match(String(project.style.borderColor), /--addon-accent/);
    assert.match(String(shared.style.borderColor), /--shared-kernel-edge/);
    assert.match(noHost.className, /dashed/);
    // text colour is part of the variant contract (so the chip span must not
    // hard-code its own): no-host is muted, the others normal foreground.
    assert.match(noHost.className, /text-muted-foreground/);
    assert.match(project.className, /text-foreground/);
    assert.match(shared.className, /text-foreground/);
    assert.notEqual(project.style.borderColor, shared.style.borderColor);
  });

  it("labels the new agent capability for its no-compass-field hover (batch 3)", () => {
    assert.equal(
      capabilityLabel("agent.out-adapter"),
      "agent orchestration adapter",
    );
    assert.equal(
      addOnHoverText({
        addOnId: "langgraph",
        capability: "agent.out-adapter",
        kind: "platform-zone",
        reason: "no-compass-field",
      }),
      `Provided by ${addOnName("langgraph")} — no dedicated compass slot (agent orchestration adapter)`,
    );
  });

  it("surfaces the human-readable capability label (not the raw string) in the project hover", () => {
    // platform.ci must read "CI/CD pipeline", not "ci" / "platform.ci"
    assert.equal(
      addOnHoverText({
        addOnId: "ci-github-actions",
        capability: "platform.ci",
        kind: "platform-zone",
        reason: "project",
      }),
      `Provided by ${addOnName("ci-github-actions")} — CI/CD pipeline · project-level`,
    );
    // the compelling case: an auth provider's role, not just its vendor name
    assert.equal(
      addOnHoverText({
        addOnId: "clerk",
        capability: "platform.auth",
        kind: "platform-zone",
        reason: "project",
      }),
      `Provided by ${addOnName("clerk")} — auth · project-level`,
    );
  });
});
