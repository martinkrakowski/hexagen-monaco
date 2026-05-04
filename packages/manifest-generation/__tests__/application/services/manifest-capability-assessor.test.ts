import { describe, it } from "node:test";
import assert from "node:assert";
import { assessModelCapability } from "../../../src/application/services/manifest-capability-assessor.service";
import { DomainModelId } from "@hexagen/local-llm";

describe("assessModelCapability", () => {
  it("returns capable when no model is loaded", () => {
    const result = assessModelCapability(null, false);
    assert.equal(result.isCapable, true);
  });

  it("returns capable when model is natively capable", () => {
    const capableModel = DomainModelId.QWEN_CODER_3B;
    const result = assessModelCapability(capableModel, false);
    assert.equal(result.isCapable, true);
  });

  it("returns not capable when model lacks capability and no override", () => {
    const incapableModel = DomainModelId.GEMMA_2_2B;
    const result = assessModelCapability(incapableModel, false);
    assert.equal(result.isCapable, false);
  });

  it("allows override for incapable model", () => {
    const incapableModel = DomainModelId.GEMMA_2_2B;
    const result = assessModelCapability(incapableModel, true);
    assert.equal(result.isCapable, true);
  });

  it("provides meaningful reason for no-model case", () => {
    const result = assessModelCapability(null, false);
    assert.match(result.reason, /No model loaded/);
  });

  it("provides meaningful reason for native capability", () => {
    const result = assessModelCapability(DomainModelId.QWEN_CODER_3B, false);
    assert.match(result.reason, /natively supports/);
  });

  it("provides meaningful reason for override", () => {
    const result = assessModelCapability(DomainModelId.GEMMA_2_2B, true);
    assert.match(result.reason, /Override enabled/);
  });
});
