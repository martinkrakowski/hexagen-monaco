/**
 * Item 6.2 / HEX-003 — the `/api/manifest/generate*` family stops constructing
 * adapters and transaction infrastructure. `wire.server` is the single server
 * composition root for these paths.
 *
 * The assertions are IDENTITY assertions, not "was a function called": each
 * route must hand its use case the very objects the composition root produced.
 * A route that keeps `new`-ing its own `LLMProviderSelectorAdapter` /
 * `InMemoryTransactionManager` passes a different object and fails here, even
 * though `@hexagen/agentic-interaction` and `@hexagen/transaction-system` are
 * still importable.
 *
 * Mock-trap note: the whole of `wire.server` is mocked, so anything these
 * routes obtain from it is a sentinel under this suite. That is the point —
 * the sentinels are what the assertions compare on. Nothing here asserts over
 * behaviour that lives inside the mocked module.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const wire = vi.hoisted(() => {
  // Distinct object identities so an assertion can only pass by the route
  // actually threading THESE through to the use case.
  const llmAdapter = { __sentinel: "wire.createLLMProviderSelector" };
  const transactionManager = {
    __sentinel: "wire.createGenerationTransactionManager",
  };
  return {
    llmAdapter,
    transactionManager,
    createLLMProviderSelector: vi.fn(() => llmAdapter),
    createGenerationTransactionManager: vi.fn(() => transactionManager),
    createStage1RefinerConfig: vi.fn(() => null),
    createStage6ReviewerConfig: vi.fn(() => null),
    createStage6ValidatorConfig: vi.fn(() => null),
    createWebLLMAdapter: vi.fn(async () => null),
  };
});

vi.mock("../../../../lib/wire.server", () => ({
  createLLMProviderSelector: wire.createLLMProviderSelector,
  createGenerationTransactionManager: wire.createGenerationTransactionManager,
  createStage1RefinerConfig: wire.createStage1RefinerConfig,
  createStage6ReviewerConfig: wire.createStage6ReviewerConfig,
  createStage6ValidatorConfig: wire.createStage6ValidatorConfig,
  createWebLLMAdapter: wire.createWebLLMAdapter,
}));

// The quota gate is a stateful sqlite-backed store; stub it open. The per-IP
// rate limiter stays real — every request below uses its own X-Forwarded-For.
vi.mock("../../../../../lib/enforce-quota", () => ({
  enforceDailyQuota: () => ({ ok: true, headers: {} }),
}));

const recorded = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown[] }>,
}));

vi.mock("@hexagen/agentic-interaction", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const recorder = (name: string, execute: () => Promise<unknown>) =>
    class {
      constructor(...args: unknown[]) {
        recorded.calls.push({ name, args });
      }
      execute = execute;
    };
  return {
    ...actual,
    GenerateManifestFromDescriptionUseCase: recorder(
      "GenerateManifestFromDescriptionUseCase",
      async () => ({
        success: true,
        manifest: {
          manifest: "system: x\n",
          confidence: 0.9,
          suggestions: [],
          warnings: [],
          metadata: {
            model: "m",
            processingTime: 1,
            tokensUsed: 1,
            provider: "p",
          },
        },
      }),
    ),
    ExecuteFullStagedGenerationUseCase: recorder(
      "ExecuteFullStagedGenerationUseCase",
      async () => ({ success: true, state: {}, transactionId: "tx-stage" }),
    ),
    ExecuteStructuredConfigGenerationUseCase: recorder(
      "ExecuteStructuredConfigGenerationUseCase",
      async () => ({
        success: true,
        value: { yaml: "system: x\n", parsedObject: {} },
        validation: { errors: [], warnings: [], passed: true },
        transactionId: "tx-spec",
      }),
    ),
    ExecuteLooseSpecConversionUseCase: recorder(
      "ExecuteLooseSpecConversionUseCase",
      async () => ({
        success: true,
        value: { configJson: "{}", config: {} },
      }),
    ),
  };
});

beforeEach(() => {
  recorded.calls.length = 0;
  vi.clearAllMocks();
  // Keep the same-origin gate's allowed set to the request's own origin.
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("NEXTAUTH_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function post(
  pathname: string,
  ip: string,
  body: Record<string, unknown>,
  origin?: string,
): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "localhost",
      "X-Forwarded-For": ip,
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function drain(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

function ctorArgsFor(name: string): unknown[] {
  const call = recorded.calls.find((c) => c.name === name);
  expect(call, `${name} was never constructed`).toBeTruthy();
  return call!.args;
}

test("/api/manifest/generate takes both the LLM port and the transaction manager from wire.server", async () => {
  const { POST } = await import("../route");
  const res = await POST(
    post("/api/manifest/generate", "10.61.0.1", {
      description: "an online shop with billing and shipping",
    }),
  );
  expect(res.status).toBe(200);

  expect(wire.createLLMProviderSelector).toHaveBeenCalledTimes(1);
  expect(wire.createGenerationTransactionManager).toHaveBeenCalledTimes(1);

  const args = ctorArgsFor("GenerateManifestFromDescriptionUseCase");
  expect(args[0]).toBe(wire.llmAdapter);
  expect(args[1]).toBe(wire.transactionManager);
});

test("/api/manifest/generate/local takes both from wire.server too", async () => {
  const { POST } = await import("../local/route");
  const res = await POST(
    post("/api/manifest/generate/local", "10.61.0.2", {
      description: "an online shop with billing and shipping",
    }),
  );
  expect(res.status).toBe(200);

  expect(wire.createLLMProviderSelector).toHaveBeenCalledTimes(1);
  expect(wire.createGenerationTransactionManager).toHaveBeenCalledTimes(1);

  const args = ctorArgsFor("GenerateManifestFromDescriptionUseCase");
  expect(args[0]).toBe(wire.llmAdapter);
  expect(args[1]).toBe(wire.transactionManager);
});

test("/api/manifest/generate/stage takes its transaction manager from wire.server", async () => {
  const { POST } = await import("../stage/route");
  const res = await POST(
    post("/api/manifest/generate/stage", "10.61.0.3", {
      description: "an online shop with billing and shipping",
    }),
  );
  expect(res.status).toBe(200);
  await drain(res);

  const args = ctorArgsFor("ExecuteFullStagedGenerationUseCase");
  expect(args[0]).toBe(wire.llmAdapter);
  expect(args[1]).toBe(wire.transactionManager);
});

test("/api/manifest/generate/spec takes its transaction manager from wire.server", async () => {
  const { POST } = await import("../spec/route");
  const res = await POST(
    post("/api/manifest/generate/spec", "10.61.0.4", { config: "{}" }),
  );
  expect(res.status).toBe(200);
  await drain(res);

  const args = ctorArgsFor("ExecuteStructuredConfigGenerationUseCase");
  expect(args[0]).toBe(wire.llmAdapter);
  expect(args[1]).toBe(wire.transactionManager);
});

// ---------------------------------------------------------------------------
// Wildcard CORS removal (the half of AUD-004 that PR #494 scoped to this
// family). #443 established the pattern for `app/api/architecture/`:
// no `Access-Control-*` headers, no preflight handler, a same-origin gate in
// front, and the shared rate limiter behind it. These routes are the last
// holders of `Access-Control-Allow-Origin: *` in apps/web.
// ---------------------------------------------------------------------------

const DESCRIPTION = "an online shop with billing and shipping";

const FAMILY: Array<{
  label: string;
  load: () => Promise<Record<string, unknown>>;
  path: string;
  body: Record<string, unknown>;
  n: number;
}> = [
  {
    label: "generate",
    load: () => import("../route"),
    path: "/api/manifest/generate",
    body: { description: DESCRIPTION },
    n: 1,
  },
  {
    label: "generate/local",
    load: () => import("../local/route"),
    path: "/api/manifest/generate/local",
    body: { description: DESCRIPTION },
    n: 2,
  },
  {
    label: "generate/stage",
    load: () => import("../stage/route"),
    path: "/api/manifest/generate/stage",
    body: { description: DESCRIPTION },
    n: 3,
  },
  {
    label: "generate/spec",
    load: () => import("../spec/route"),
    path: "/api/manifest/generate/spec",
    body: { config: "{}" },
    n: 4,
  },
  {
    label: "generate/spec/convert",
    load: () => import("../spec/convert/route"),
    path: "/api/manifest/generate/spec/convert",
    body: { looseSpec: "a shop with billing" },
    n: 5,
  },
];

test.each(FAMILY)(
  "$label exports no wildcard-CORS preflight handler",
  async ({ load }) => {
    const mod = await load();
    expect(mod.OPTIONS).toBeUndefined();
  },
);

test.each(FAMILY)(
  "$label rejects a cross-origin POST with 403",
  async ({ load, path, body, n }) => {
    const { POST } = (await load()) as {
      POST: (r: NextRequest) => Promise<Response>;
    };
    const res = await POST(
      post(path, `10.62.0.${n}`, body, "https://evil.example"),
    );
    expect(res.status).toBe(403);
    await drain(res);
  },
);

test.each(FAMILY)(
  "$label never sets Access-Control-Allow-Origin on a same-origin response",
  async ({ load, path, body, n }) => {
    const { POST } = (await load()) as {
      POST: (r: NextRequest) => Promise<Response>;
    };
    const res = await POST(post(path, `10.63.0.${n}`, body));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    await drain(res);
  },
);
