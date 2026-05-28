import assert from "node:assert";
import { describe, it } from "node:test";
import { runQualityGate } from "../../src/application/use-cases/stage1-local-speculation.use-case.js";

// ---------------------------------------------------------------------------
// Quality Gate — direct unit tests
// ---------------------------------------------------------------------------

describe("runQualityGate — degenerate output", () => {
  it("fails on empty string", () => {
    const result = runQualityGate("");
    assert.strictEqual(result.passed, false);
  });

  it("fails on fewer than 5 words", () => {
    const result = runQualityGate("one two three four");
    assert.strictEqual(result.passed, false);
  });

  it("fails on exactly 4 words", () => {
    const result = runQualityGate("alpha beta gamma delta");
    assert.strictEqual(result.passed, false);
  });

  it("passes with exactly 5 words", () => {
    const result = runQualityGate("one two three four five");
    assert.strictEqual(result.passed, true);
  });
});

describe("runQualityGate — refusal patterns", () => {
  it("fails on 'I cannot' opener", () => {
    const result = runQualityGate(
      "I cannot help you with that request at this time.",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "refusal_detected");
  });

  it("fails on 'I'm unable' opener", () => {
    const result = runQualityGate(
      "I'm unable to assist with that particular question.",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "refusal_detected");
  });

  it("fails on 'As an AI' opener", () => {
    const result = runQualityGate(
      "As an AI language model, I must inform you that this is not possible.",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "refusal_detected");
  });

  it("fails on 'I apologize' opener", () => {
    const result = runQualityGate(
      "I apologize but I cannot provide that information to you.",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "refusal_detected");
  });

  it("fails on 'I'm sorry' opener", () => {
    const result = runQualityGate(
      "I'm sorry, but I cannot assist with that request.",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "refusal_detected");
  });

  it("passes when refusal phrase appears mid-sentence (not opener)", () => {
    const result = runQualityGate(
      "The function returns an error when I cannot find the file in the directory.",
    );
    assert.strictEqual(result.passed, true);
  });

  it("is case-insensitive for refusal patterns", () => {
    const result = runQualityGate(
      "I CANNOT process this request due to policy restrictions.",
    );
    assert.strictEqual(result.passed, false);
  });
});

describe("runQualityGate — repetitive output", () => {
  it("fails when same word repeated 10 times (100% repetition)", () => {
    const result = runQualityGate(
      "word word word word word word word word word word",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "repetitive_output");
  });

  it("fails when repetition ratio exceeds 80%", () => {
    // 9 'word' + 1 'other' = 90% repetition
    const result = runQualityGate(
      "word word word word word word word word word other",
    );
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.reason, "repetitive_output");
  });

  it("passes when repetition ratio is at or below 80%", () => {
    // 8 'word' + 2 'other' = 80% repetition — boundary: > 0.8 fails, = 0.8 passes
    const result = runQualityGate(
      "word word word word word word word word other other",
    );
    assert.strictEqual(result.passed, true);
  });
});

describe("runQualityGate — normal substantive text", () => {
  it("passes for a normal paragraph", () => {
    const result = runQualityGate(
      "The quick brown fox jumps over the lazy dog. This is a substantive response that covers the topic in detail.",
    );
    assert.strictEqual(result.passed, true);
  });

  it("passes for text with DRAFT_START and DRAFT_END markers", () => {
    const result = runQualityGate(
      "[DRAFT_START]\nHere is a detailed analysis of the problem. The solution involves three key steps: first, identify the root cause; second, apply the fix; third, verify the result.\n[DRAFT_END]",
    );
    assert.strictEqual(result.passed, true);
  });

  it("passes for a code-heavy response", () => {
    const result = runQualityGate(
      "function add(a, b) { return a + b; } This function takes two parameters and returns their sum.",
    );
    assert.strictEqual(result.passed, true);
  });
});
