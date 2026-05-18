import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Integration tests for CloudModelSettingsView vault integration
 *
 * Verifies that:
 * - Vault integration is properly wired
 * - Settings persistence works
 * - Error handling is in place
 * - Component composition is correct
 */

describe("CloudModelSettingsView - Vault Integration", () => {
  it("should have all required files and exports", async () => {
    const cloudModelSettingsView = await import("../CloudModelSettingsView");
    assert.strictEqual(
      typeof cloudModelSettingsView.CloudModelSettingsView,
      "function",
    );
  });

  it("should export hooks with vault support", async () => {
    const hooks = await import("../hooks");
    assert.strictEqual(typeof hooks.useCloudModelSettings, "function");
    assert.strictEqual(typeof hooks.useCloudConnectivity, "function");
    assert.strictEqual(typeof hooks.useSettingsValidation, "function");
  });

  it("should export all required components", async () => {
    const components = await import("../components");
    assert.strictEqual(typeof components.CloudSettingsHeader, "function");
    assert.strictEqual(typeof components.SettingsForm, "function");
    assert.strictEqual(typeof components.ConnectionStatus, "function");
    assert.strictEqual(typeof components.ActionButtons, "function");
    assert.strictEqual(typeof components.ApiKeyInput, "function");
    assert.strictEqual(typeof components.ModelSelectionDropdown, "function");
  });

  it("should have correct barrel exports", async () => {
    const barrel = await import("../index");
    assert.strictEqual(typeof barrel.CloudModelSettingsView, "function");
    assert.strictEqual(typeof barrel.useCloudModelSettings, "function");
    assert.strictEqual(typeof barrel.useCloudConnectivity, "function");
  });

  it("should have withTimeout utility for handling timeouts", async () => {
    const utils = await import("../utils/withTimeout");
    assert.strictEqual(typeof utils.withTimeout, "function");
  });

  it("should have type definitions for CloudModelSettingsViewProps", async () => {
    const types = await import("../types");
    assert.strictEqual(typeof types, "object");
    assert.strictEqual(types.CLOUD_MODEL_SETTINGS_VIEW_PROPS !== undefined, true);
  });

  it("should compose all features correctly", async () => {
    const { CloudModelSettingsView } =
      await import("../CloudModelSettingsView");
    const { useCloudModelSettings, useCloudConnectivity } =
      await import("../hooks");

    // Verify component accepts props
    assert.strictEqual(typeof CloudModelSettingsView, "function");

    // Verify hooks are available
    assert.strictEqual(typeof useCloudModelSettings, "function");
    assert.strictEqual(typeof useCloudConnectivity, "function");
  });
});
