import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CREATION_PATH_OPTIONS,
  CREATION_STEPS,
  type CreationPathId,
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
