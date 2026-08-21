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
    it("has exactly 4 sub-options", () => {
      assert.strictEqual(IMPORT_SUB_OPTIONS.length, 4);
    });

    it("has unique ids", () => {
      const ids = IMPORT_SUB_OPTIONS.map((o) => o.id);
      assert.strictEqual(new Set(ids).size, ids.length);
    });

    it("covers all ImportSubOptionId values", () => {
      const expected: ImportSubOptionId[] = [
        "spec",
        "scan",
        "artifacts",
        "github",
      ];
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

    it("artifacts sub-option is coming-soon and routes through the name step", () => {
      const artifacts = IMPORT_SUB_OPTIONS.find((o) => o.id === "artifacts");
      assert.ok(artifacts);
      assert.strictEqual(artifacts.status, "coming-soon");
      assert.strictEqual(artifacts.href, "/projects/new/name?path=artifacts");
    });

    it("github sub-option is marked as coming-soon", () => {
      const github = IMPORT_SUB_OPTIONS.find((o) => o.id === "github");
      assert.ok(github);
      assert.strictEqual(github!.status, "coming-soon");
    });

    it("scan sub-option is available and routes through the name step", () => {
      const scan = IMPORT_SUB_OPTIONS.find((o) => o.id === "scan");
      assert.ok(scan);
      assert.strictEqual(scan.status, "available");
      assert.strictEqual(scan.href, "/projects/new/name?path=scan");
    });

    // `github` and `artifacts` are deliberately still "coming-soon": neither
    // destination is mounted yet (`/projects/new/import/github` currently
    // redirects, and `/projects/new/import/artifacts` does not exist until
    // BF-3.3). Marking either available would publish a link to a redirect or
    // a 404. Each flips to "available" in the packet that mounts its route.
    const NOT_YET_ROUTED = new Set(["github", "artifacts"]);

    it("every sub-option with a mounted route is available", () => {
      for (const option of IMPORT_SUB_OPTIONS) {
        if (NOT_YET_ROUTED.has(option.id)) continue;
        assert.strictEqual(
          option.status,
          "available",
          `${option.id} should be available`,
        );
      }
    });

    it("sub-options without a mounted route are marked coming-soon", () => {
      // Guards the other direction: if a route lands and the status is not
      // flipped, or a status is flipped before its route exists, one of these
      // two tests fails rather than both silently agreeing.
      for (const id of NOT_YET_ROUTED) {
        const option = IMPORT_SUB_OPTIONS.find((o) => o.id === id);
        assert.ok(option, `${id} should exist in IMPORT_SUB_OPTIONS`);
        assert.strictEqual(
          option.status,
          "coming-soon",
          `${id} has no mounted route yet, so it must be coming-soon`,
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
