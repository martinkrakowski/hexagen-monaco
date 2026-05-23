import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConnectionHealthStateMachine,
  LocalModelStateMachine,
} from "../../src/domain/index.js";

describe("ConnectionHealthStateMachine", () => {
  it("should validate health states", () => {
    assert.strictEqual(
      ConnectionHealthStateMachine.isValidState("VALID"),
      true,
    );
    assert.strictEqual(
      ConnectionHealthStateMachine.isValidState("DEGRADED"),
      true,
    );
    assert.strictEqual(
      ConnectionHealthStateMachine.isValidState("UNAVAILABLE"),
      true,
    );
    assert.strictEqual(
      ConnectionHealthStateMachine.isValidState("UNVALIDATED"),
      true,
    );
    assert.strictEqual(
      ConnectionHealthStateMachine.isValidState("UNKNOWN"),
      false,
    );
  });

  it("should transition states correctly", () => {
    const r1 = ConnectionHealthStateMachine.transition(
      "UNVALIDATED",
      "VALIDATE_SUCCESS",
    );
    assert.strictEqual(r1.success, true);
    if (r1.success) {
      assert.strictEqual(r1.value, "VALID");
    }

    const r2 = ConnectionHealthStateMachine.transition(
      "VALID",
      "VALIDATE_DEGRADED",
    );
    assert.strictEqual(r2.success, true);
    if (r2.success) {
      assert.strictEqual(r2.value, "DEGRADED");
    }

    const r3 = ConnectionHealthStateMachine.transition(
      "DEGRADED",
      "VALIDATE_FAIL",
    );
    assert.strictEqual(r3.success, true);
    if (r3.success) {
      assert.strictEqual(r3.value, "UNAVAILABLE");
    }

    const r4 = ConnectionHealthStateMachine.transition("UNAVAILABLE", "RESET");
    assert.strictEqual(r4.success, true);
    if (r4.success) {
      assert.strictEqual(r4.value, "UNVALIDATED");
    }
  });

  it("should fail on invalid events", () => {
    const r = ConnectionHealthStateMachine.transition(
      "UNVALIDATED",
      "INVALID_EVENT" as unknown as "RESET",
    );
    assert.strictEqual(r.success, false);
  });
});

describe("LocalModelStateMachine", () => {
  it("should validate model states", () => {
    assert.strictEqual(
      LocalModelStateMachine.isValidState("NOT_DOWNLOADED"),
      true,
    );
    assert.strictEqual(
      LocalModelStateMachine.isValidState("DOWNLOADING"),
      true,
    );
    assert.strictEqual(LocalModelStateMachine.isValidState("DOWNLOADED"), true);
    assert.strictEqual(LocalModelStateMachine.isValidState("LOADING"), true);
    assert.strictEqual(LocalModelStateMachine.isValidState("ACTIVE"), true);
    assert.strictEqual(LocalModelStateMachine.isValidState("ERROR"), true);
    assert.strictEqual(LocalModelStateMachine.isValidState("UNKNOWN"), false);
  });

  it("should follow the standard lifecycle successfully", () => {
    // NOT_DOWNLOADED -> DOWNLOADING
    const r1 = LocalModelStateMachine.transition(
      "NOT_DOWNLOADED",
      "START_DOWNLOAD",
    );
    assert.strictEqual(r1.success, true);
    if (r1.success) assert.strictEqual(r1.value, "DOWNLOADING");

    // DOWNLOADING -> DOWNLOADED
    const r2 = LocalModelStateMachine.transition(
      "DOWNLOADING",
      "DOWNLOAD_SUCCESS",
    );
    assert.strictEqual(r2.success, true);
    if (r2.success) assert.strictEqual(r2.value, "DOWNLOADED");

    // DOWNLOADED -> LOADING
    const r3 = LocalModelStateMachine.transition("DOWNLOADED", "START_LOAD");
    assert.strictEqual(r3.success, true);
    if (r3.success) assert.strictEqual(r3.value, "LOADING");

    // LOADING -> ACTIVE
    const r4 = LocalModelStateMachine.transition("LOADING", "LOAD_SUCCESS");
    assert.strictEqual(r4.success, true);
    if (r4.success) assert.strictEqual(r4.value, "ACTIVE");

    // ACTIVE -> DOWNLOADED (UNLOAD)
    const r5 = LocalModelStateMachine.transition("ACTIVE", "UNLOAD");
    assert.strictEqual(r5.success, true);
    if (r5.success) assert.strictEqual(r5.value, "DOWNLOADED");
  });

  it("should handle error states and recovery", () => {
    // DOWNLOADING -> ERROR
    const r1 = LocalModelStateMachine.transition(
      "DOWNLOADING",
      "DOWNLOAD_FAIL",
    );
    assert.strictEqual(r1.success, true);
    if (r1.success) assert.strictEqual(r1.value, "ERROR");

    // ERROR -> RETRY_DOWNLOAD -> DOWNLOADING
    const r2 = LocalModelStateMachine.transition("ERROR", "RETRY_DOWNLOAD");
    assert.strictEqual(r2.success, true);
    if (r2.success) assert.strictEqual(r2.value, "DOWNLOADING");

    // LOADING -> ERROR
    const r3 = LocalModelStateMachine.transition("LOADING", "LOAD_FAIL");
    assert.strictEqual(r3.success, true);
    if (r3.success) assert.strictEqual(r3.value, "ERROR");

    // ERROR -> RETRY_LOAD -> LOADING
    const r4 = LocalModelStateMachine.transition("ERROR", "RETRY_LOAD");
    assert.strictEqual(r4.success, true);
    if (r4.success) assert.strictEqual(r4.value, "LOADING");

    // ACTIVE -> ERROR (CRASH)
    const r5 = LocalModelStateMachine.transition("ACTIVE", "CRASH");
    assert.strictEqual(r5.success, true);
    if (r5.success) assert.strictEqual(r5.value, "ERROR");

    // ERROR -> RESET -> NOT_DOWNLOADED
    const r6 = LocalModelStateMachine.transition("ERROR", "RESET");
    assert.strictEqual(r6.success, true);
    if (r6.success) assert.strictEqual(r6.value, "NOT_DOWNLOADED");
  });

  it("should block invalid transitions", () => {
    const r = LocalModelStateMachine.transition(
      "NOT_DOWNLOADED",
      "LOAD_SUCCESS",
    );
    assert.strictEqual(r.success, false);
  });
});
