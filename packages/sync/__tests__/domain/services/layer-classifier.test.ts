import { describe, it } from "vitest";
import * as assert from "node:assert/strict";
import {
  determineLayer,
  determinePackageName,
} from "../../../src/domain/services/layer-classifier.js";
import type { Layer } from "../../../src/domain/services/impact-analysis.types.js";

describe("layer-classifier", () => {
  it("classifies based on layout config", () => {
    const layer: Layer = determineLayer("src/special/my-file.ts", {
      layers: ["special"],
    });
    assert.equal(layer, "special");
  });

  it("treats a configured custom layer as a valid Layer value", () => {
    const layer: Layer = determineLayer("packages/billing/src/core/entity.ts", {
      layers: ["core", "services"],
    });
    assert.equal(layer, "core");
  });

  it("ignores files based on config", () => {
    const layer = determineLayer("src/domain/ignored-file.ts", {
      ignore: ["ignored-file"],
    });
    assert.equal(layer, "ignored");
  });

  it("names a tools/ workspace from the relative path", () => {
    assert.equal(
      determinePackageName("tools/arch-linter/src/cli.ts"),
      "arch-linter",
    );
  });
});
