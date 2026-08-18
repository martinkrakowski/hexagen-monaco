import { describe, it } from "vitest";
import * as assert from "node:assert/strict";
import { determineLayer } from "../../../src/domain/services/layer-classifier.js";

describe("layer-classifier", () => {
  it("classifies based on layout config", () => {
    const layer = determineLayer("src/special/my-file.ts", {
      layers: ["special"],
    });
    assert.equal(layer, "special");
  });

  it("ignores files based on config", () => {
    const layer = determineLayer("src/domain/ignored-file.ts", {
      ignore: ["ignored-file"],
    });
    assert.equal(layer, "ignored");
  });
});
