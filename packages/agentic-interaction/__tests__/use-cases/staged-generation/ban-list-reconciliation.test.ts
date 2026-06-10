/**
 * Ban-list reconciliation contract (plan step A2).
 *
 * architecture-contract.ts documents a KNOWN DIVERGENCE between the three
 * context-name ban lists (Stage 2 generation guidance, Stage 6 R01 validation,
 * deterministic runtime filter). Per the deferred-reconciliation decision on
 * #277, these tests land FIRST as failing tests, then the reconciliation makes
 * them green:
 *
 *   1. Single unified membership (STRUCTURAL + DELIVERY + INFRA_CORE + VENDOR)
 *      at all consumption sites — kills the three contradiction cases
 *      ("stripe-payments" generate-then-reject, "api-gateway" silent-drop,
 *      "user-database" validator pass-through).
 *   2. Token-boundary matching in the deterministic filter — kills the
 *      substring false positives ("restaurant-booking" ⊃ "rest",
 *      "feedback-management" ⊃ "db", "rapid-fulfillment" ⊃ "api").
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ExecuteContextClassificationUseCase } from "../../../src/application/use-cases/staged-generation/execute-context-classification.use-case";
import {
  CONTEXT_NAME_GENERATION_BANS,
  CONTEXT_NAME_VALIDATION_BANS,
  CONTEXT_NAME_DETERMINISTIC_BLOCKLIST,
  PROSE_ONLY_TOKENS,
} from "../../../src/domain/prompts/architecture-contract";
import {
  STAGE2_CLASSIFICATION_SYSTEM_PROMPT,
  STAGE6_VALIDATION_SYSTEM_PROMPT,
} from "../../../src/domain/prompts/generate-manifest.prompt";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";

/** Run the classification use case with the given names all LLM-"accepted"
 * (or "uncertain" with an accept recommendation), so the only thing deciding
 * their fate is the deterministic safety filter. */
async function classify(
  names: string[],
  status: "accepted" | "uncertain" = "accepted",
) {
  const ndjson = names
    .map((name) =>
      JSON.stringify({
        status,
        name,
        contextType: "core",
        reasoning: "test fixture",
        ...(status === "uncertain"
          ? { recommendation: "accept-as-supporting" }
          : {}),
      }),
    )
    .join("\n");

  const mockLLMPort: SendStructuredRequestPort = {
    sendRequest: async () => ({
      success: true as const,
      value: {
        id: "test",
        modelId: "qwen-coder-3b" as any,
        content: ndjson,
        finishReason: "stop" as const,
        timestamp: Date.now(),
      },
    }),
    streamStructuredRequest: async function* () {
      yield { success: true, value: ndjson };
    },
  };

  const useCase = new ExecuteContextClassificationUseCase(mockLLMPort);
  const result = await useCase.execute({
    stage0: {
      intent: "Build a restaurant booking platform with payments",
      explicitTechnologies: [],
      explicitPatterns: [],
      ambiguities: [],
    },
    stage1: {
      subdomains: ["Booking"],
      nouns: ["Reservation"],
      verbs: ["book"],
    },
  });

  assert.ok(result.success, "Use case should succeed");
  return result.value;
}

// ── 1. Unified membership ───────────────────────────────────────────────────

test("ban-list reconciliation: one membership, minus the documented prose-only carve-out", () => {
  const generation = new Set(CONTEXT_NAME_GENERATION_BANS);
  const validation = new Set(CONTEXT_NAME_VALIDATION_BANS);
  const blocklist = new Set(CONTEXT_NAME_DETERMINISTIC_BLOCKLIST);

  assert.deepStrictEqual(
    generation,
    validation,
    "Stage 2 generation bans must match Stage 6 validation bans",
  );

  // Deterministic blocklist = canonical list minus PROSE_ONLY_TOKENS, exactly.
  const expectedBlocklist = new Set(
    [...generation].filter(
      (t) => !(PROSE_ONLY_TOKENS as readonly string[]).includes(t),
    ),
  );
  assert.deepStrictEqual(
    blocklist,
    expectedBlocklist,
    "deterministic blocklist must be the canonical list minus the prose-only carve-out",
  );
  for (const token of PROSE_ONLY_TOKENS) {
    assert.ok(
      generation.has(token),
      `prose-only token "${token}" must still appear in prompt guidance`,
    );
    assert.ok(
      !blocklist.has(token),
      `prose-only token "${token}" must not be enforced deterministically`,
    );
  }
});

test("ban-list reconciliation: unified list covers all four token families", () => {
  // One representative per family; set-equality above extends this to all lists.
  for (const token of ["database", "api", "postgres", "stripe"]) {
    assert.ok(
      CONTEXT_NAME_GENERATION_BANS.includes(token),
      `generation bans must include "${token}"`,
    );
    assert.ok(
      CONTEXT_NAME_VALIDATION_BANS.includes(token),
      `validation bans must include "${token}"`,
    );
    assert.ok(
      CONTEXT_NAME_DETERMINISTIC_BLOCKLIST.includes(token),
      `deterministic blocklist must include "${token}"`,
    );
  }
});

// ── 2. Prompt wiring (lists actually reach the prompts) ─────────────────────

test("ban-list reconciliation: Stage 2 system prompt interpolates the generation bans", () => {
  assert.ok(
    STAGE2_CLASSIFICATION_SYSTEM_PROMPT.includes(
      CONTEXT_NAME_GENERATION_BANS.join(", "),
    ),
    "Stage 2 prompt must contain the joined generation ban list",
  );
});

test("ban-list reconciliation: Stage 6 R01 interpolates the validation bans", () => {
  assert.ok(
    STAGE6_VALIDATION_SYSTEM_PROMPT.includes(
      CONTEXT_NAME_VALIDATION_BANS.join(", "),
    ),
    "Stage 6 prompt must contain the joined validation ban list",
  );
});

// ── 3. The three contradiction cases (deterministic filter as enforcement) ──

test("ban-list reconciliation: filter rejects the three contradiction-case names", async () => {
  const { accepted, rejected } = await classify([
    "order-management",
    "stripe-payments", // was: generate-then-reject (filter allowed, Stage 6 errored)
    "api-gateway", // was: silent-drop (prompts allowed, filter dropped)
    "user-database", // was: validator pass-through (Stage 6 allowed)
  ]);

  assert.deepStrictEqual(
    accepted.map((c) => c.name),
    ["order-management"],
  );

  const rejectedNames = rejected.map((r) => r.name);
  assert.ok(rejectedNames.includes("stripe-payments"));
  assert.ok(rejectedNames.includes("api-gateway"));
  assert.ok(rejectedNames.includes("user-database"));
});

// ── 4. Token-boundary matching (substring false positives must survive) ─────

test("ban-list reconciliation: filter accepts business names that merely contain banned substrings", async () => {
  const { accepted, rejected } = await classify([
    "restaurant-booking", // "rest" is a substring, not a token
    "feedback-management", // "db" is a substring, not a token
    "rapid-fulfillment", // "api" is a substring, not a token
  ]);

  assert.deepStrictEqual(rejected, [], "no false-positive rejections");
  assert.deepStrictEqual(accepted.map((c) => c.name).sort(), [
    "feedback-management",
    "rapid-fulfillment",
    "restaurant-booking",
  ]);
});

test('ban-list reconciliation: prose-only carve-out — "rest" guides prompts but is not hard-rejected', async () => {
  // HITL decision (PR #285 review round): "rest" is a plain English word;
  // names like driver-rest-periods must survive the deterministic filter.
  const { accepted, rejected } = await classify([
    "driver-rest-periods",
    "rest-api", // still caught: "api" remains deterministic
  ]);

  assert.deepStrictEqual(
    accepted.map((c) => c.name),
    ["driver-rest-periods"],
  );
  assert.deepStrictEqual(
    rejected.map((r) => r.name),
    ["rest-api"],
  );
});

test("ban-list reconciliation: diacritics are normalized, not treated as separators", async () => {
  const { accepted, rejected } = await classify([
    "café-management", // é must not corrupt tokenization ("caf" + "management")
    "Café-Database", // banned token still detected through the diacritic
  ]);

  assert.deepStrictEqual(
    accepted.map((c) => c.name),
    ["café-management"],
  );
  assert.deepStrictEqual(
    rejected.map((r) => r.name),
    ["Café-Database"],
  );
});

test("ban-list reconciliation: uncertain→accepted promotion runs the same safety filter", async () => {
  // Before A2 the promotion path bypassed the filter entirely: an "uncertain"
  // line with an accept recommendation landed in `accepted` unchecked.
  const { accepted, rejected, uncertain } = await classify(
    ["loyalty-program", "user-database"],
    "uncertain",
  );

  assert.deepStrictEqual(
    accepted.map((c) => c.name),
    ["loyalty-program"],
  );
  assert.ok(accepted[0].promotedFromUncertain);
  assert.deepStrictEqual(
    rejected.map((r) => r.name),
    ["user-database"],
  );
  assert.ok(
    rejected[0].reasoning.includes(
      "Safety Filter: Context name contains infrastructure term",
    ),
  );
  // Both names are still recorded as uncertain regardless of promotion outcome.
  assert.deepStrictEqual(uncertain.map((u) => u.name).sort(), [
    "loyalty-program",
    "user-database",
  ]);
});

test("ban-list reconciliation: token matching still catches separator and camelCase variants", async () => {
  const { accepted, rejected } = await classify([
    "order-management",
    "PostgresStore", // camelCase boundary → "postgres"
    "APIGateway", // acronym run → "api", "gateway"
    "payment_db", // underscore separator → "db"
  ]);

  assert.deepStrictEqual(
    accepted.map((c) => c.name),
    ["order-management"],
  );
  assert.deepStrictEqual(rejected.map((r) => r.name).sort(), [
    "APIGateway",
    "PostgresStore",
    "payment_db",
  ]);
});
