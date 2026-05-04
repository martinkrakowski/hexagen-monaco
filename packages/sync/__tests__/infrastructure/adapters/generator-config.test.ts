import { describe, it } from "node:test";
import assert from "node:assert";
import { FakeGeneratorConfigPort } from "../../doubles/ports/generator-config.fake.js";
import {
  type BootstrapStep,
  type InvariantConfig,
  type InvariantPriority,
  type FailureMode,
} from "@hexagen/sync";

describe("generator config", () => {
  it("should return empty defaults for bootstrap sequence and invariants", async () => {
    const defaultFake = new FakeGeneratorConfigPort();
    const defaultBootstrap = await defaultFake.getBootstrapSequence();
    assert.deepStrictEqual(
      defaultBootstrap,
      { success: true, value: [] },
      "Default bootstrap sequence should be empty",
    );

    const defaultInvariants = await defaultFake.getAllInvariants();
    assert.deepStrictEqual(
      defaultInvariants,
      { success: true, value: [] },
      "Default invariants list should be empty",
    );
  });

  it("should return correct default failure behaviors", async () => {
    const defaultFake = new FakeGeneratorConfigPort();
    const defaultFailureCritical = await defaultFake.getFailureBehavior(
      "critical" as InvariantPriority,
    );
    const defaultFailureHigh = await defaultFake.getFailureBehavior(
      "high" as InvariantPriority,
    );
    const defaultFailureMedium = await defaultFake.getFailureBehavior(
      "medium" as InvariantPriority,
    );
    assert.strictEqual(
      defaultFailureCritical,
      "abort-and-cleanup",
      "Critical failure behavior should be abort-and-cleanup",
    );
    assert.strictEqual(
      defaultFailureHigh,
      "abort",
      "High failure behavior should be abort",
    );
    assert.strictEqual(
      defaultFailureMedium,
      "warn-and-continue",
      "Medium failure behavior should be warn-and-continue",
    );
  });

  it("should return custom bootstrap sequence, invariants, and failure behavior", async () => {
    const customFake = new FakeGeneratorConfigPort();

    const customBootstrap: BootstrapStep[] = [
      { name: "load-ownership-map", priority: "high", failure: "abort" },
    ];
    customFake.setBootstrapSequence(customBootstrap);

    const customInvariants: InvariantConfig[] = [
      {
        name: "test-double-parity",
        description: "All fakes must match port signatures",
        priority: "medium",
        enforcement: "bootstrap",
        failure: "warn-and-continue",
      },
    ];
    customFake.setInvariants(customInvariants);

    const customFailure: FailureMode = "abort-and-cleanup";
    customFake.setFailureMode("critical" as InvariantPriority, customFailure);

    const fetchedBootstrap = await customFake.getBootstrapSequence();
    assert.deepStrictEqual(
      fetchedBootstrap,
      { success: true, value: customBootstrap },
      "Custom bootstrap sequence should be returned",
    );

    const fetchedInvariants = await customFake.getAllInvariants();
    assert.deepStrictEqual(
      fetchedInvariants,
      { success: true, value: customInvariants },
      "Custom invariants list should be returned",
    );

    const fetchedCritical = await customFake.getFailureBehavior(
      "critical" as InvariantPriority,
    );
    assert.strictEqual(
      fetchedCritical,
      customFailure,
      "Custom critical failure behavior should be applied",
    );
  });
});
