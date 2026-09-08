import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  TEMPLATE_CONFIG_FILE,
  configState,
  emptyConfig,
  isInstalled,
} from "../../src/domain/template-config.js";
import type {
  TemplateConfig,
  TemplateInstallRecord,
} from "../../src/domain/template-config.js";

/**
 * Pins for the template config record vocabulary: the empty shape, membership,
 * and the empty/populated classification the store adapters build on. Whether
 * a record exists at all (`absent`) is decided by the source, not here.
 */

const RECORD: TemplateInstallRecord = {
  installedAt: "2026-01-01T00:00:00.000Z",
  version: "1.2.3",
  answers: {},
  generatedFiles: [],
};

const POPULATED: TemplateConfig = {
  schemaVersion: "1",
  templates: { "ci-github-actions": RECORD },
};

describe("emptyConfig", () => {
  it(`returns schemaVersion "1" with no templates, saved as ${TEMPLATE_CONFIG_FILE}`, () => {
    assert.deepStrictEqual(emptyConfig(), {
      schemaVersion: "1",
      templates: {},
    });
  });
});

describe("isInstalled", () => {
  it("is true for a template id the record lists", () => {
    assert.equal(isInstalled(POPULATED, "ci-github-actions"), true);
  });

  it("is false for a template id the record does not list", () => {
    assert.equal(isInstalled(POPULATED, "agents-md"), false);
  });

  it("is false for any id when the config is empty", () => {
    assert.equal(isInstalled(emptyConfig(), "ci-github-actions"), false);
  });
});

describe("configState", () => {
  it("classifies a config with no templates as empty", () => {
    assert.deepStrictEqual(configState(emptyConfig()), { state: "empty" });
  });

  it("classifies a config with entries as populated, carrying the config", () => {
    assert.deepStrictEqual(configState(POPULATED), {
      state: "populated",
      config: POPULATED,
    });
  });
});
