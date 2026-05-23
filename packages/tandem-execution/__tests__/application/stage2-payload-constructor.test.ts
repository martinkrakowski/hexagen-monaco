import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Stage2PayloadConstructorUseCase } from "../../src/application/use-cases/stage2-payload-constructor.use-case.js";

const constructor = new Stage2PayloadConstructorUseCase();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

function makeWords(count: number, prefix = "word"): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(" ");
}

// ---------------------------------------------------------------------------
// Payload structure
// ---------------------------------------------------------------------------

describe("Stage2PayloadConstructorUseCase — payload structure", () => {
  it("matches the template exactly for a simple case", () => {
    const result = constructor.constructPayload({
      userPrompt: "Explain recursion",
      localDraft: "[DRAFT_START]\nRecursion is a technique.\n[DRAFT_END]",
      history: [],
      cloudContextLimit: 4096,
    });

    assert.strictEqual(result.success, true);
    const { payload } = result.value;

    assert.ok(payload.includes("[ORIGINAL_INSTRUCTION]"));
    assert.ok(payload.includes("Explain recursion"));
    assert.ok(payload.includes("[/ORIGINAL_INSTRUCTION]"));
    assert.ok(payload.includes("[CONVERSATION_HISTORY]"));
    assert.ok(payload.includes("[/CONVERSATION_HISTORY]"));
    assert.ok(payload.includes("[LOCAL_DRAFT]"));
    assert.ok(payload.includes("Recursion is a technique."));
    assert.ok(payload.includes("[/LOCAL_DRAFT]"));
    assert.ok(
      payload.includes(
        "Review the local draft above in the context of the original instruction.",
      ),
    );
  });

  it("includes history turns in the CONVERSATION_HISTORY section", () => {
    const result = constructor.constructPayload({
      userPrompt: "What is TypeScript?",
      localDraft:
        "[DRAFT_START]\nTypeScript is a typed superset of JavaScript.\n[DRAFT_END]",
      history: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
      ],
      cloudContextLimit: 4096,
    });

    assert.strictEqual(result.success, true);
    const { payload } = result.value;
    assert.ok(payload.includes("user: Hello"));
    assert.ok(payload.includes("assistant: Hi there!"));
  });
});

// ---------------------------------------------------------------------------
// Marker extraction
// ---------------------------------------------------------------------------

describe("Stage2PayloadConstructorUseCase — marker extraction", () => {
  it("extracts content between [DRAFT_START] and [DRAFT_END] markers", () => {
    const result = constructor.constructPayload({
      userPrompt: "Test",
      localDraft:
        "Preamble text\n[DRAFT_START]\nThis is the actual draft content.\n[DRAFT_END]\nPostamble text",
      history: [],
      cloudContextLimit: 4096,
    });

    assert.strictEqual(result.success, true);
    const { payload } = result.value;
    assert.ok(payload.includes("This is the actual draft content."));
    // Preamble and postamble should NOT appear in the LOCAL_DRAFT section
    assert.ok(!payload.includes("Preamble text"));
    assert.ok(!payload.includes("Postamble text"));
  });

  it("falls back to full output when markers are absent", () => {
    const fullDraft = "This is a draft without any markers at all.";
    const result = constructor.constructPayload({
      userPrompt: "Test",
      localDraft: fullDraft,
      history: [],
      cloudContextLimit: 4096,
    });

    assert.strictEqual(result.success, true);
    const { payload } = result.value;
    assert.ok(payload.includes(fullDraft));
  });

  it("returns truncatedDraft: false when no truncation occurred", () => {
    const result = constructor.constructPayload({
      userPrompt: "Short prompt",
      localDraft: "[DRAFT_START]\nShort draft.\n[DRAFT_END]",
      history: [],
      cloudContextLimit: 4096,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.truncatedDraft, false);
    assert.strictEqual(result.value.truncatedHistory, false);
  });
});

// ---------------------------------------------------------------------------
// Progressive truncation
// ---------------------------------------------------------------------------

describe("Stage2PayloadConstructorUseCase — progressive truncation", () => {
  it("truncates draft first when payload exceeds 90% of context limit", () => {
    // Create a large draft that will push the payload over 90% of a small limit
    // cloudContextLimit = 100 tokens → 90% = 90 tokens
    // A 200-word draft × 1.3 = 260 tokens → well over limit
    const largeDraft = makeWords(200, "draft");
    const result = constructor.constructPayload({
      userPrompt: "Short prompt",
      localDraft: `[DRAFT_START]\n${largeDraft}\n[DRAFT_END]`,
      history: [],
      cloudContextLimit: 100,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.truncatedDraft, true);
    assert.strictEqual(result.value.truncatedHistory, false);
  });

  it("truncates history when draft truncation alone is insufficient", () => {
    // Very small context limit so even an empty draft won't fit with history
    const largeHistory = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      content: makeWords(10, `turn${i}`),
    }));

    const result = constructor.constructPayload({
      userPrompt: "Short",
      localDraft: `[DRAFT_START]\n${makeWords(100, "draft")}\n[DRAFT_END]`,
      history: largeHistory,
      cloudContextLimit: 50,
    });

    assert.strictEqual(result.success, true);
    // Both should be truncated given the extreme constraint
    assert.strictEqual(result.value.truncatedDraft, true);
    assert.strictEqual(result.value.truncatedHistory, true);
  });

  it("drops draft entirely when both truncations are insufficient", () => {
    // Extremely small limit — even the template skeleton barely fits
    // Use a very large draft and history to force full drop
    const hugeDraft = makeWords(500, "draft");
    const hugeHistory = Array.from({ length: 100 }, (_, i) => ({
      role: "assistant" as const,
      content: makeWords(20, `hist${i}`),
    }));

    const result = constructor.constructPayload({
      userPrompt: "x",
      localDraft: `[DRAFT_START]\n${hugeDraft}\n[DRAFT_END]`,
      history: hugeHistory,
      cloudContextLimit: 30,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.value.truncatedDraft, true);
    // Draft should be empty or minimal in the payload
    const draftSection = result.value.payload.match(
      /\[LOCAL_DRAFT\]([\s\S]*?)\[\/LOCAL_DRAFT\]/,
    );
    assert.ok(draftSection !== null);
    const draftContent = draftSection[1].trim();
    // After full drop, draft content should be empty
    assert.strictEqual(draftContent, "");
  });

  it("payload never exceeds 90% of declared context limit after truncation", () => {
    const cloudContextLimit = 200;
    const largeDraft = makeWords(300, "draft");
    const largeHistory = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: makeWords(15, `h${i}`),
    }));

    const result = constructor.constructPayload({
      userPrompt: "Explain the concept",
      localDraft: `[DRAFT_START]\n${largeDraft}\n[DRAFT_END]`,
      history: largeHistory,
      cloudContextLimit,
    });

    assert.strictEqual(result.success, true);
    const tokenCount = estimateTokens(result.value.payload);
    assert.ok(
      tokenCount <= cloudContextLimit * 0.9,
      `Expected payload tokens (${tokenCount}) to be ≤ ${cloudContextLimit * 0.9}`,
    );
  });
});
