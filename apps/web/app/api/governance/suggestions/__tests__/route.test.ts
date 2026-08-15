import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";

// The size guard short-circuits before the suggestion LLM is ever constructed,
// but importing the route still loads its module graph — mock the heavy
// agentic-interaction + key-resolution deps so the suite stays hermetic. The
// spy also lets the over-large test assert the LLM use-case is never executed.
const { generateExecute } = vi.hoisted(() => ({
  generateExecute: vi.fn(async () => ({ success: true, value: [] })),
}));

vi.mock("@hexagen/agentic-interaction", () => ({
  GenerateSuggestionUseCase: class {
    execute = generateExecute;
  },
  ServerLLMAdapter: class {},
}));
vi.mock("@/lib/wire.shared", () => ({
  resolveWebLlmApiKey: vi.fn(() => "test-llm-key"),
}));

import { POST } from "../route";
import { MAX_MANIFEST_YAML_CHARS } from "../../../../lib/request-guards";

function postJson(manifestYaml: unknown) {
  return new Request("http://localhost/api/governance/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifestYaml === undefined ? {} : { manifestYaml }),
  });
}

describe("POST /api/governance/suggestions", () => {
  it("400s when manifestYaml is missing", async () => {
    const res = await POST(postJson(undefined));
    assert.equal(res.status, 400);
  });

  it("400s an over-large manifest BEFORE calling the suggestion LLM", async () => {
    const genBefore = generateExecute.mock.calls.length;
    const res = await POST(postJson("a".repeat(MAX_MANIFEST_YAML_CHARS + 1)));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for an over-large manifest",
    );
  });
});
