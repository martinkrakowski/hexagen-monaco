import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("CloudModelSettingsView", () => {
  it("should export CloudModelSettingsView component", async () => {
    const { CloudModelSettingsView } =
      await import("../CloudModelSettingsView");
    assert.strictEqual(typeof CloudModelSettingsView, "function");
  });

  it("should export component types correctly", async () => {
    const module = await import("../types");
    assert.strictEqual(typeof module, "object");
    assert(module.CloudModelSettingsViewProps !== undefined);
  });

  it("should compose all required hooks and components", async () => {
    const hooks = await import("../hooks");
    assert.strictEqual(typeof hooks.useCloudModelSettings, "function");
    assert.strictEqual(typeof hooks.useCloudConnectivity, "function");
    assert.strictEqual(typeof hooks.useSettingsValidation, "function");
  });

  it("should export all UI components", async () => {
    const components = await import("../components");
    assert.strictEqual(typeof components.CloudSettingsHeader, "function");
    assert.strictEqual(typeof components.ModelSelectionDropdown, "function");
    assert.strictEqual(typeof components.ApiKeyInput, "function");
    assert.strictEqual(typeof components.SettingsForm, "function");
    assert.strictEqual(typeof components.ConnectionStatus, "function");
    assert.strictEqual(typeof components.ActionButtons, "function");
  });

  it("should have utility functions available", async () => {
    const utils = await import("../utils/withTimeout");
    assert.strictEqual(typeof utils.withTimeout, "function");
  });

  it("should have correct index barrel exports", async () => {
    const barrel = await import("../index");
    assert.strictEqual(typeof barrel.CloudModelSettingsView, "function");
    assert.strictEqual(typeof barrel.useCloudModelSettings, "function");
    assert.strictEqual(typeof barrel.useCloudConnectivity, "function");
    assert.strictEqual(typeof barrel.useSettingsValidation, "function");
  });
});
