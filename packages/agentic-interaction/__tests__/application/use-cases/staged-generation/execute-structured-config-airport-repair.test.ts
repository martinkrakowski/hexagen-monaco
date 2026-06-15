import { describe, it, mock } from "node:test";
import assert from "node:assert";
import { ExecuteStructuredConfigGenerationUseCase } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";

const mockTransactionManager = {
  begin: mock.fn(() => ({
    id: "tx",
    status: "pending",
    intentId: "i",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  transition: mock.fn((id, status) => ({
    id,
    status,
    intentId: "i",
    metadata: {},
    lineage: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  })),
  get: mock.fn(() => null),
  list: mock.fn(() => []),
  commit: mock.fn(() => null),
  rollback: mock.fn(() => null),
};

// Stages 3/4 get a non-port response → 0 ports/adapters parsed, so the
// orchestrator's DETERMINISTIC fallback derives ports from the spec's aggregates
// (repository) + use_cases (inbound). Stage 6 reads it as a passing LLM verdict,
// so the only error is the DETERMINISTIC R01 (banned context name) — no LLM
// findings needed.
function llmPortPassingValidation(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: () => {
      async function* gen() {
        yield { success: true, value: '{"type":"result","passed":true}\n' };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// A faithful gpt-4o stand-in: it ECHOES the artifact it was actually fed (the
// <manifest>…</manifest> block), with the banned context renamed.
// This is what makes the test fail PRE-FIX: pre-fix Stage 7 was fed the raw
// config (no ports) → the reviewer echoes a port-less config → reconstruction is
// empty → the gate rejects. POST-FIX it is fed the assembled MANIFEST (which
// carries the fallback-derived ports) → it echoes a ported manifest → the rename
// applies.
function renamingReviewer(): SendStructuredRequestPort {
  return {
    sendRequest: async () => ({ success: true, value: { content: "" } }),
    streamStructuredRequest: (request: {
      messages?: Array<{ content: string }>;
      onModelResolved?: (i: unknown) => void;
    }) => {
      request?.onModelResolved?.({ model: "openai/gpt-4o" });
      const userPrompt = request?.messages?.[1]?.content ?? "";
      const match = userPrompt.match(/<manifest>\n([\s\S]*?)\n<\/manifest>/);
      const fed = match ? unescapeXml(match[1]) : "";
      const repaired = fed.replace(/payment-gateway/g, "billing");
      async function* gen() {
        yield { success: true, value: repaired };
      }
      return gen();
    },
  } as unknown as SendStructuredRequestPort;
}

// AI-GENERATED-PORT spec: NO `layers` / pre-defined ports. `payment-gateway`
// trips the deterministic R01 banned-context rule; the aggregate + use case give
// the fallback something to derive ports from.
const airportSpec = [
  "bounded_contexts:",
  "  - name: payment-gateway",
  "    aggregates:",
  "      - { name: Payment, root: true }",
  "use_cases:",
  "  payment-gateway:",
  "    - { name: ProcessPayment }",
  "context_mappings: []",
  "",
].join("\n");

describe("ExecuteStructuredConfigGenerationUseCase — Stage-7 repair for an AI-generated-port spec", () => {
  it("applies a rename repair even though the spec pre-defines NO ports (impossible pre-fix: config-feed reconstructed to 0 ports and the gate always rejected — RCA-2)", async () => {
    const useCase = new ExecuteStructuredConfigGenerationUseCase(
      llmPortPassingValidation(),
      mockTransactionManager,
      undefined,
      undefined,
      renamingReviewer(),
    );
    const result = await useCase.execute(airportSpec, { onProgress: () => {} });

    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.ok(result.repair, "a repair should have been attempted");
      assert.strictEqual(
        result.repair?.applied,
        true,
        "the rename repair must APPLY (the manifest carries the fallback-derived ports)",
      );
      assert.ok(
        (result.repair?.errorsAfter ?? 1) < (result.repair?.errorsBefore ?? 0),
      );
      // The surfaced manifest + report are the repaired ones: R01 is gone.
      assert.ok(!result.validation.errors.some((e) => e.includes("R01")));

      // Domain-survival guard (PR #344 review): an applied RENAME must not drop
      // the renamed context's domain model. Re-validation reuses stage1, whose
      // aggregate `subdomain` keys still hold the OLD name — without re-keying,
      // Stage-5's subdomain match misses the renamed context and ships an empty
      // layers.domain. countManifestEntities doesn't count domain entities, so
      // the gate can't catch this; only an explicit assertion can.
      const parsed = result.value.parsedObject as {
        bounded_contexts?: Array<{
          name: string;
          layers?: { domain?: { entities?: string[] } };
        }>;
      };
      const billing = parsed.bounded_contexts?.find(
        (c) => c.name === "billing",
      );
      assert.ok(billing, "renamed context 'billing' must be present");
      assert.ok(
        billing?.layers?.domain?.entities?.includes("Payment"),
        "the Payment aggregate must SURVIVE the rename, not be dropped from layers.domain",
      );
    }
  });
});
