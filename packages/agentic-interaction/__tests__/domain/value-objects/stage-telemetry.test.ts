import { test, describe } from "vitest";
import * as assert from "node:assert/strict";
import {
  EMPTY_STAGE_SUMMARY,
  formatModelChip,
  modelNameFromResponseMetadata,
  normalizeModelName,
  stageSummary,
} from "../../../src/domain/value-objects/stage-telemetry";

describe("formatModelChip", () => {
  test("renders a single-model chip", () => {
    assert.strictEqual(
      formatModelChip({ modelName: "mercury-2" }),
      "[mercury-2]",
    );
  });

  test("renders a draft/refiner cascade chip", () => {
    assert.strictEqual(
      formatModelChip({ modelName: "mercury-2", refinerModelName: "gpt-4o" }),
      "[mercury-2 / gpt-4o]",
    );
  });

  test("normalizes the served id so it reads the same as the alias", () => {
    // Stage 3 reported "mercury-2" while Stages 4/6 reported
    // "inception/mercury-2-prod-h100" for the SAME model — both must chip alike.
    assert.strictEqual(
      formatModelChip({ modelName: "inception/mercury-2-prod-h100" }),
      "[mercury-2]",
    );
    assert.strictEqual(
      formatModelChip({ modelName: "mercury-2" }),
      "[mercury-2]",
    );
    assert.strictEqual(
      formatModelChip({ modelName: "openai/gpt-4o" }),
      "[gpt-4o]",
    );
  });

  test("returns null when no model was resolved", () => {
    assert.strictEqual(formatModelChip({}), null);
    assert.strictEqual(formatModelChip({ modelName: undefined }), null);
    // Empty string is "not resolved", not a chip.
    assert.strictEqual(formatModelChip({ modelName: "" }), null);
  });

  test("a refiner without a draft model renders no chip", () => {
    // Can't happen in practice (the refiner only runs after a successful
    // draft) but the formatter must not emit a half-empty chip.
    assert.strictEqual(formatModelChip({ refinerModelName: "gpt-4o" }), null);
  });
});

describe("modelNameFromResponseMetadata", () => {
  test("extracts the model recorded by the cloud adapters", () => {
    assert.strictEqual(
      modelNameFromResponseMetadata({
        provider: "inception",
        model: "mercury-2",
      }),
      "mercury-2",
    );
  });

  test("returns undefined for absent or foreign metadata", () => {
    assert.strictEqual(modelNameFromResponseMetadata(undefined), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({}), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({ model: 42 }), undefined);
    assert.strictEqual(modelNameFromResponseMetadata({ model: "" }), undefined);
  });
});

describe("normalizeModelName", () => {
  test("strips a provider prefix", () => {
    assert.strictEqual(normalizeModelName("openai/gpt-4o"), "gpt-4o");
  });

  test("strips a provider prefix AND a -prod- deployment suffix", () => {
    assert.strictEqual(
      normalizeModelName("inception/mercury-2-prod-h100"),
      "mercury-2",
    );
    assert.strictEqual(normalizeModelName("mercury-2-prod-h100"), "mercury-2");
  });

  test("leaves a bare alias unchanged", () => {
    assert.strictEqual(normalizeModelName("mercury-2"), "mercury-2");
    assert.strictEqual(normalizeModelName("gpt-4o"), "gpt-4o");
  });
});

describe("stageSummary", () => {
  test("interpolates counts into the author's literal text", () => {
    assert.strictEqual(
      stageSummary`Classified ${3} accepted, ${1} rejected`,
      "Classified 3 accepted, 1 rejected",
    );
  });

  test("renders a template with no slots", () => {
    assert.strictEqual(
      stageSummary`Repair edits emitted`,
      "Repair edits emitted",
    );
    assert.strictEqual(EMPTY_STAGE_SUMMARY, "");
  });

  test("composes a fragment built by the same builder", () => {
    // The composition escape hatch: pluralisation and optional suffixes stay
    // expressible without anyone reaching for a raw `string`.
    const findings = stageSummary`${7} findings`;
    assert.strictEqual(
      stageSummary`Repair edits emitted (${findings} targeted)`,
      "Repair edits emitted (7 findings targeted)",
    );
  });

  test("renders booleans", () => {
    assert.strictEqual(stageSummary`cached=${true}`, "cached=true");
  });

  test("rejects a `string` slot at COMPILE time — this is the whole guard", () => {
    // The privacy defect this type exists to prevent was literally
    // an interpolation of `intent` into the summary, where `intent` is the
    // model's restatement of the user's prompt. The runtime cannot detect
    // that; the type system can, and `packages/**` typechecks its tests
    // (`typecheck:test`), so the negative case is asserted HERE and
    // `tsc -p tsconfig.test.json --noEmit` is the assertion runner.
    const userPrompt: string = "build me a CRM for dentists";
    // @ts-expect-error - `string` is not an accepted stageSummary slot.
    const leaked = stageSummary`Normalized intent: ${userPrompt}`;
    // The runtime value is still a string; only the type rejected it. Touch
    // it so the binding is used and the @ts-expect-error is the only error.
    assert.ok(typeof leaked === "string");
  });
});
