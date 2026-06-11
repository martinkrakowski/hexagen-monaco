import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import {
  useExecutionEngine,
  shouldWarnBeforeGenerate,
  effectivePreferLocal,
} from "../store/useExecutionEngine.ts";

describe("useExecutionEngine store", () => {
  beforeEach(() => {
    useExecutionEngine.setState({ engine: "auto" });
  });

  test("defaults to auto", () => {
    assert.strictEqual(useExecutionEngine.getState().engine, "auto");
  });

  test("setEngine persists the override in state", () => {
    useExecutionEngine.getState().setEngine("local");
    assert.strictEqual(useExecutionEngine.getState().engine, "local");

    useExecutionEngine.getState().setEngine("cloud");
    assert.strictEqual(useExecutionEngine.getState().engine, "cloud");
  });

  test("setEngine can return to auto", () => {
    useExecutionEngine.getState().setEngine("local");
    useExecutionEngine.getState().setEngine("auto");
    assert.strictEqual(useExecutionEngine.getState().engine, "auto");
  });

  test("store is configured for persistence under execution-engine-storage", () => {
    // zustand attaches the persist API when the middleware is wired in;
    // the storage name is what localStorage keys the override across visits.
    assert.strictEqual(
      useExecutionEngine.persist.getOptions().name,
      "execution-engine-storage",
    );
  });
});

describe("shouldWarnBeforeGenerate", () => {
  test("warns for the explicit local override", () => {
    assert.strictEqual(shouldWarnBeforeGenerate("local"), true);
  });

  test("does NOT warn for auto — even when auto will resolve to local", () => {
    // The dialog gates on the explicit override only; a user who never
    // touched the selector must not be interrupted (PR-3 spec).
    assert.strictEqual(shouldWarnBeforeGenerate("auto"), false);
  });

  test("does NOT warn for cloud", () => {
    assert.strictEqual(shouldWarnBeforeGenerate("cloud"), false);
  });
});

describe("effectivePreferLocal", () => {
  test("local forces preferLocal regardless of readiness", () => {
    assert.strictEqual(effectivePreferLocal("local", false), true);
    assert.strictEqual(effectivePreferLocal("local", true), true);
  });

  test("cloud forces preferLocal off regardless of readiness", () => {
    assert.strictEqual(effectivePreferLocal("cloud", false), false);
    assert.strictEqual(effectivePreferLocal("cloud", true), false);
  });

  test("auto defers to the readiness-derived value", () => {
    assert.strictEqual(effectivePreferLocal("auto", true), true);
    assert.strictEqual(effectivePreferLocal("auto", false), false);
  });
});
