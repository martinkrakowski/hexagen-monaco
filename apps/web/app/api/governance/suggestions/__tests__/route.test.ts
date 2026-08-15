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
import {
  MAX_MANIFEST_YAML_CHARS,
  MAX_OPEN_FILE_CONTENT_CHARS,
} from "../../../../lib/request-guards";

function postJson(manifestYaml: unknown) {
  return new Request("http://localhost/api/governance/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifestYaml === undefined ? {} : { manifestYaml }),
  });
}

/** POST an arbitrary raw JSON value as the whole body (e.g. `null`, or a body
 * carrying an `openFileContent` field alongside the manifest). */
function postRawBody(value: unknown) {
  return new Request("http://localhost/api/governance/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

describe("POST /api/governance/suggestions", () => {
  it("400s when manifestYaml is missing", async () => {
    const res = await POST(postJson(undefined));
    assert.equal(res.status, 400);
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
    const res = await POST(postRawBody(null));
    assert.equal(res.status, 400);
  });

  it("400s an object-valued manifestYaml (would slip past the size guard)", async () => {
    const res = await POST(postJson({ nested: true }));
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

  it("400s an over-large openFileContent BEFORE calling the suggestion LLM", async () => {
    // openFileContent is appended verbatim to the prompt, so a huge open file
    // re-opens the same LLM-resource surface the manifest cap closes. The guard
    // must reject it before the use-case runs.
    const genBefore = generateExecute.mock.calls.length;
    const res = await POST(
      postRawBody({
        manifestYaml: "bounded_contexts: []",
        openFileContent: "a".repeat(MAX_OPEN_FILE_CONTENT_CHARS + 1),
      }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for an over-large open file",
    );
  });

  it("400s a non-string openFileContent BEFORE calling the suggestion LLM", async () => {
    // The `as` cast does not enforce the field's type; a `[object Object]` must
    // not reach the prompt.
    const genBefore = generateExecute.mock.calls.length;
    const res = await POST(
      postRawBody({
        manifestYaml: "bounded_contexts: []",
        openFileContent: { not: "a string" },
      }),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /must be a string/i);
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for a non-string open file",
    );
  });
});
