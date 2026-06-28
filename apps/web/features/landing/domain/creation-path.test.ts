import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  CREATION_PATH_OPTIONS,
  CREATION_STEPS,
  type CreationPathId,
  IMPORT_SUB_OPTIONS,
  type ImportSubOptionId,
  detectInputMode,
} from "./creation-path.js";

describe("creation-path domain", () => {
  describe("CREATION_PATH_OPTIONS", () => {
    it("has exactly 3 options", () => {
      assert.strictEqual(CREATION_PATH_OPTIONS.length, 3);
    });

    it("has unique ids", () => {
      const ids = CREATION_PATH_OPTIONS.map((o) => o.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("covers all CreationPathId values", () => {
      const expected: CreationPathId[] = ["blank", "import", "ai"];
      const actual = CREATION_PATH_OPTIONS.map((o) => o.id);
      assert.deepStrictEqual(actual.sort(), expected.sort());
    });

    it("has exactly one recommended option", () => {
      const recommended = CREATION_PATH_OPTIONS.filter((o) => o.isRecommended);
      assert.strictEqual(recommended.length, 1);
      assert.strictEqual(recommended[0].id, "ai");
    });

    it("each option has a non-empty label and description", () => {
      for (const option of CREATION_PATH_OPTIONS) {
        assert.ok(option.label.length > 0, `Empty label for ${option.id}`);
        assert.ok(
          option.description.length > 0,
          `Empty description for ${option.id}`,
        );
      }
    });

    it("each option has a valid colorTheme", () => {
      const validThemes = ["success", "info", "primary"];
      for (const option of CREATION_PATH_OPTIONS) {
        assert.ok(
          validThemes.includes(option.colorTheme),
          `Invalid colorTheme for ${option.id}: ${option.colorTheme}`,
        );
      }
    });
  });

  describe("IMPORT_SUB_OPTIONS", () => {
    it("has exactly 2 sub-options", () => {
      assert.strictEqual(IMPORT_SUB_OPTIONS.length, 2);
    });

    it("has unique ids", () => {
      const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("covers all ImportSubOptionId values", () => {
      const expected: ImportSubOptionId[] = ["spec", "github"];
      const actual = IMPORT_SUB_OPTIONS.map((o) => o.id);
      assert.deepStrictEqual(actual.sort(), expected.sort());
    });

    it("each sub-option has a non-empty label and description", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        assert.ok(option.label.length > 0, `Empty label for ${option.id}`);
        assert.ok(
          option.description.length > 0,
          `Empty description for ${option.id}`,
        );
      }
    });

    it("each sub-option has a non-empty href", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        assert.ok(option.href.length > 0, `Empty href for ${option.id}`);
      }
    });

    it("github sub-option is marked as coming-soon", () => {
      const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
      assert.ok(github);
      assert.strictEqual(github!.status, "coming-soon");
    });

    it("manifest and spec sub-options are available", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        if (option.id === "github") continue;
        assert.strictEqual(
          option.status,
          "available",
          `${option.id} should be available`,
        );
      }
    });
  });

  describe("detectInputMode", () => {
    it("detects manifest from .yaml extension", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo", "manifest.yaml"),
        "manifest",
      );
    });

    it("detects manifest from .yml extension", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo", "manifest.yml"),
        "manifest",
      );
    });

    it("detects structured-config from .json extension", () => {
      assert.strictEqual(
        detectInputMode('{"workspace": {}}', "config.json"),
        "structured-config",
      );
    });

    it("detects structured-config from YAML file starting with JSON object", () => {
      assert.strictEqual(
        detectInputMode('{"contexts": []}', "config.yaml"),
        "structured-config",
      );
    });

    it("returns unknown for malformed JSON in .yaml file", () => {
      assert.strictEqual(
        detectInputMode("{invalid json}", "config.yaml"),
        "unknown",
      );
    });

    it("detects structured-config from content starting with { without extension", () => {
      assert.strictEqual(
        detectInputMode('{"contexts": []}'),
        "structured-config",
      );
    });

    it("detects structured-config from content starting with [ without extension", () => {
      assert.strictEqual(detectInputMode("[]"), "structured-config");
    });

    it("detects manifest from content with YAML key-value pattern", () => {
      assert.strictEqual(
        detectInputMode("workspace:\n  name: foo"),
        "manifest",
      );
    });

    it("returns unknown for ambiguous content", () => {
      assert.strictEqual(detectInputMode("just some text"), "unknown");
    });

    it("returns unknown for invalid JSON starting with {", () => {
      assert.strictEqual(detectInputMode("{invalid json}"), "unknown");
    });

    it("detects structured-config from content starting with [ with valid JSON", () => {
      assert.strictEqual(
        detectInputMode('[{"name": "ctx"}]'),
        "structured-config",
      );
    });
  });

  describe("CREATION_STEPS", () => {
    it("has exactly 3 steps", () => {
      assert.strictEqual(CREATION_STEPS.length, 3);
    });

    it("steps are numbered 1 through 3", () => {
      const steps = CREATION_STEPS.map((s) => s.step);
      assert.deepStrictEqual(steps, [1, 2, 3]);
    });

    it("each step has a non-empty label", () => {
      for (const step of CREATION_STEPS) {
        assert.ok(step.label.length > 0, `Empty label for step ${step.step}`);
      }
    });
  });
});
