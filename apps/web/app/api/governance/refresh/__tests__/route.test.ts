import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// The mutation gate (D1) must reject a cross-origin POST BEFORE the route spawns
// `yarn lint:arch` (a subprocess) or calls the suggestion LLM. Spy on both
// boundaries so the test enforces that "before doing any work" invariant — not
// merely the 403 status. `resolveWebLlmApiKey` returns a real key so the LLM
// path is actually reachable were the guard absent (an unset key would make
// runSuggestions short-circuit on its own, hiding a guard regression).
const { execSpy, generateExecute } = vi.hoisted(() => ({
  // child_process.exec is a Node-style callback fn; invoke the callback so the
  // route's promisified `execAsync` resolves if it were ever reached.
  execSpy: vi.fn(
    (
      _cmd: string,
      optsOrCb: unknown,
      cb?: (e: unknown, r: unknown) => void,
    ) => {
      const callback = (typeof optsOrCb === "function" ? optsOrCb : cb) as
        | ((e: unknown, r: unknown) => void)
        | undefined;
      callback?.(null, { stdout: "", stderr: "" });
    },
  ),
  generateExecute: vi.fn(async () => ({ success: true, value: [] })),
}));

// Plain (non-spread) factory: spreading the real module back in leaves the
// route's module-load `promisify(exec)` bound to the genuine `exec`, so the spy
// never intercepts. Provide the handful of exports the route graph may touch,
// plus a `default` for CJS-interop importers.
vi.mock("child_process", () => {
  const cp = {
    exec: execSpy,
    execSync: vi.fn(),
    execFile: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
  };
  return { ...cp, default: cp };
});
vi.mock("@/lib/wire.shared", () => ({
  resolveWebLlmApiKey: vi.fn(() => "test-llm-key"),
}));
vi.mock("@hexagen/agentic-interaction", () => ({
  GenerateSuggestionUseCase: class {
    execute = generateExecute;
  },
  ServerLLMAdapter: class {},
}));

import { POST } from "../route";
import {
  MAX_MANIFEST_YAML_CHARS,
  MAX_OPEN_FILE_CONTENT_CHARS,
} from "../../../../lib/request-guards";

/** Build a same-origin (no Origin header) refresh POST from a raw JSON body. */
function sameOriginPost(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/governance/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/governance/refresh — mutation gate (D1)", () => {
  it("rejects a cross-origin POST with 403 before spawning lint:arch / calling the LLM", async () => {
    const req = new NextRequest("http://localhost/api/governance/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        origin: "http://evil.example",
        host: "localhost",
      },
      body: JSON.stringify({ manifestYaml: "bounded_contexts: []" }),
    });

    const res = await POST(req);

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /cross-origin/i);

    // The guard must short-circuit BEFORE any downstream work: no lint:arch
    // subprocess and no suggestion-LLM execution. A regression that ran either
    // before returning 403 would still satisfy the status assertion above but
    // fail here.
    assert.equal(
      execSpy.mock.calls.length,
      0,
      "lint:arch subprocess must not be spawned for a rejected request",
    );
    assert.equal(
      generateExecute.mock.calls.length,
      0,
      "suggestion LLM must not be executed for a rejected request",
    );
  });

  it("surfaces a manifest parse failure as statusError, not an empty status (AUD-005)", async () => {
    // Same-origin (no Origin header) so the guard passes; unparseable YAML must
    // yield an explicit statusError rather than a bare empty portAdapterStatus
    // that reads as a valid empty manifest — matching governance/status.
    const req = new NextRequest("http://localhost/api/governance/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost" },
      body: JSON.stringify({ manifestYaml: "bounded_contexts: [unclosed" }),
    });

    const res = await POST(req);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.portAdapterStatus, []);
    assert.match(
      body.statusError,
      /parse/i,
      "refresh must surface the analyzer parse error, not swallow it",
    );
  });

  it("400s an over-large manifest BEFORE spawning lint:arch / calling the LLM", async () => {
    // Same-origin (no Origin) so the mutation gate passes; the size guard must
    // reject before any of the expensive downstream work runs. Measure the spies
    // as a delta so this holds regardless of test ordering (a prior test may
    // have legitimately invoked them).
    const execBefore = execSpy.mock.calls.length;
    const genBefore = generateExecute.mock.calls.length;

    const req = new NextRequest("http://localhost/api/governance/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", host: "localhost" },
      body: JSON.stringify({
        manifestYaml: "a".repeat(MAX_MANIFEST_YAML_CHARS + 1),
      }),
    });

    const res = await POST(req);

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
    assert.equal(
      execSpy.mock.calls.length,
      execBefore,
      "lint:arch subprocess must not be spawned for an over-large manifest",
    );
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for an over-large manifest",
    );
  });

  it("400s a null JSON body instead of throwing to a 500", async () => {
    // Same-origin so the mutation gate passes; a bare `null` body would make
    // `body.manifestYaml` throw (→ 500) without the shape guard.
    const res = await POST(sameOriginPost(null));
    assert.equal(res.status, 400);
  });

  it("400s an object-valued manifestYaml (would slip past the size guard)", async () => {
    const res = await POST(sameOriginPost({ manifestYaml: { nested: true } }));
    assert.equal(res.status, 400);
  });

  it("400s an over-large openFileContent BEFORE spawning lint:arch / calling the LLM", async () => {
    // openFileContent is appended verbatim to the suggestion prompt; bound it
    // before any of the expensive downstream work runs.
    const execBefore = execSpy.mock.calls.length;
    const genBefore = generateExecute.mock.calls.length;

    const res = await POST(
      sameOriginPost({
        manifestYaml: "bounded_contexts: []",
        openFileContent: "a".repeat(MAX_OPEN_FILE_CONTENT_CHARS + 1),
      }),
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
    assert.equal(
      execSpy.mock.calls.length,
      execBefore,
      "lint:arch subprocess must not be spawned for an over-large open file",
    );
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for an over-large open file",
    );
  });

  it("400s a non-string openFileContent BEFORE spawning lint:arch / calling the LLM", async () => {
    const execBefore = execSpy.mock.calls.length;
    const genBefore = generateExecute.mock.calls.length;

    const res = await POST(
      sameOriginPost({
        manifestYaml: "bounded_contexts: []",
        openFileContent: { not: "a string" },
      }),
    );

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /must be a string/i);
    assert.equal(
      execSpy.mock.calls.length,
      execBefore,
      "lint:arch subprocess must not be spawned for a non-string open file",
    );
    assert.equal(
      generateExecute.mock.calls.length,
      genBefore,
      "suggestion LLM must not be executed for a non-string open file",
    );
  });
});
