import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyGenerationError } from "../../../src/domain/services/generation-error-handler";

describe("classifyGenerationError", () => {
  it("classifies YAML validation failure", () => {
    const result = classifyGenerationError(
      "Generated manifest has invalid YAML: mapping values are not allowed here",
    );
    assert.equal(result.code, "yaml_validation_failed");
    assert.match(result.message, /malformed YAML|shorten description|Retry/);
  });

  it("classifies no_yaml_extracted when manifest not valid", () => {
    const result = classifyGenerationError(
      "The response did not contain a valid manifest structure",
    );
    assert.equal(result.code, "no_yaml_extracted");
  });

  it("classifies inference_failed for generic errors", () => {
    const result = classifyGenerationError("Something went wrong");
    assert.equal(result.code, "inference_failed");
    assert.equal(result.message, "Something went wrong");
  });

  it("classifies inference_failed for timeout errors", () => {
    const result = classifyGenerationError("LLM request timed out");
    assert.equal(result.code, "inference_failed");
  });

  it("preserves original message for yaml_validation_failed", () => {
    const result = classifyGenerationError(
      "Generated manifest has invalid YAML: could not find expected ':'",
    );
    assert.notEqual(result.message, "Generated manifest has invalid YAML:");
  });

  it("returns inference_failed for empty error", () => {
    const result = classifyGenerationError("");
    assert.equal(result.code, "inference_failed");
  });
});
