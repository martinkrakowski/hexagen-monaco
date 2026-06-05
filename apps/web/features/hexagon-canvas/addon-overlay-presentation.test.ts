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
      `Provided by ${addOnName("docker")} — project-level platform concern`,
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
    assert.notEqual(project.style.borderColor, shared.style.borderColor);
  });
});
