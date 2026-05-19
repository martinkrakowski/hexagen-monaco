import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("UI Components", () => {
  it("should export CloudSettingsHeader", async () => {
    const { CloudSettingsHeader } = await import("../components");
    assert.strictEqual(typeof CloudSettingsHeader, "function");
  });

  it("should export ModelSelectionDropdown", async () => {
    const { ModelSelectionDropdown } = await import("../components");
    assert.strictEqual(typeof ModelSelectionDropdown, "function");
  });

  it("should export ApiKeyInput", async () => {
    const { ApiKeyInput } = await import("../components");
    assert.strictEqual(typeof ApiKeyInput, "function");
  });

  it("should export SettingsForm", async () => {
    const { SettingsForm } = await import("../components");
    assert.strictEqual(typeof SettingsForm, "function");
  });

  it("should export ConnectionStatus", async () => {
    const { ConnectionStatus } = await import("../components");
    assert.strictEqual(typeof ConnectionStatus, "function");
  });

  it("should export ActionButtons", async () => {
    const { ActionButtons } = await import("../components");
    assert.strictEqual(typeof ActionButtons, "function");
  });

  it("should have consistent component signatures", async () => {
    const components = await import("../components");
    const componentList = [
      "CloudSettingsHeader",
      "ModelSelectionDropdown",
      "ApiKeyInput",
      "SettingsForm",
      "ConnectionStatus",
      "ActionButtons",
    ];
    for (const name of componentList) {
      assert(
        typeof components[name as keyof typeof components] === "function",
        `${name} should be a function`,
      );
    }
  });
});
