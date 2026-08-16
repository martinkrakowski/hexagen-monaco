import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { ExecuteStructuredConfigGenerationUseCase } from "@hexagen/agentic-interaction";
import type { AssembledManifest } from "@hexagen/agentic-interaction";
import { POST } from "../route.ts";

// The quota gate is a stateful sqlite-backed store; stub it open so these
// tests exercise only the route's streaming contract. The per-IP rate limiter
// stays real — each test uses its own X-Forwarded-For.
vi.mock("../../../../../../lib/enforce-quota", () => ({
  enforceDailyQuota: () => ({ ok: true, headers: {} }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

async function readNdjson(
  res: Response,
): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });
    if (done) break;
  }
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function specRequest(ip: string): NextRequest {
  return new NextRequest("http://localhost/api/manifest/generate/spec", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ config: "{}" }),
  });
}

test("emits the early `manifest` frame before `done`, and `done` still carries the final yaml (Part B-lite)", async () => {
  // The orchestrator fires onManifestReady between Stage 5 and Stage 6; the
  // route must translate it into a NON-terminal `manifest` frame. The final
  // `done` then carries a DIFFERENT yaml (as after a Stage-7 repair) — the
  // client replaces the early manifest with it.
  vi.spyOn(
    ExecuteStructuredConfigGenerationUseCase.prototype,
    "execute",
  ).mockImplementation(async (_config, callbacks) => {
    callbacks?.onProgress?.(5, 0);
    callbacks?.onProgress?.(5, 1);
    callbacks?.onManifestReady?.({
      yaml: "early: manifest\n",
      parsedObject: {
        bounded_contexts: [
          // Adapters as `draftToManifest` really emits them —
          // `layers.infrastructure.adapters`, not a root `adapters` key. The
          // fixture used to write the root shape, which is why a route that
          // read the root shape looked correct while reporting 0 in production.
          {
            name: "billing",
            layers: { infrastructure: { adapters: ["a1", "a2"] } },
          },
          { name: "shipping" },
        ],
        context_mappings: [{ upstream: "billing", downstream: "shipping" }],
      },
    } as AssembledManifest);
    callbacks?.onProgress?.(6, 0);
    callbacks?.onProgress?.(6, 2);
    return {
      success: true as const,
      value: {
        yaml: "final: manifest\n",
        parsedObject: {
          bounded_contexts: [{ name: "billing" }],
          context_mappings: [],
        },
      } as AssembledManifest,
      validation: { errors: [], warnings: [], passed: true },
      transactionId: "txn-blite-1",
    };
  });

  const res = await POST(specRequest("10.9.0.1"));
  assert.equal(res.status, 200);
  const events = await readNdjson(res);

  const manifestIdx = events.findIndex((e) => e.type === "manifest");
  const doneIdx = events.findIndex((e) => e.type === "done");
  assert.ok(manifestIdx !== -1, "a `manifest` frame must be emitted");
  assert.ok(doneIdx !== -1, "a `done` frame must be emitted");
  assert.ok(manifestIdx < doneIdx, "`manifest` must precede `done`");
  assert.equal(
    events.filter((e) => e.type === "manifest").length,
    1,
    "exactly one `manifest` frame",
  );
  // The early frame also precedes the stage-6 start the route relays.
  const stage6StartIdx = events.findIndex(
    (e) => e.type === "stage-start" && e.stage === 6,
  );
  assert.ok(manifestIdx < stage6StartIdx);

  // Early frame: Stage-5 yaml + counts from ITS parsedObject; transactionId is
  // "" because the transaction is only begun after the review (see route).
  assert.deepEqual(events[manifestIdx], {
    type: "manifest",
    yaml: "early: manifest\n",
    contextCount: 2,
    portCount: 1,
    adapterCount: 2,
    transactionId: "",
  });

  // `done` is UNCHANGED by Part B-lite: final yaml (superseding the early
  // one), real transaction id, counts from the final parsedObject, validation.
  assert.deepEqual(events[doneIdx], {
    type: "done",
    yaml: "final: manifest\n",
    contextCount: 1,
    portCount: 0,
    adapterCount: 0,
    transactionId: "txn-blite-1",
    validation: { errors: [], warnings: [], passed: true },
  });
});

test("a null bounded_contexts entry (bare `-` yaml list item) never crashes the count derivation (review fix)", async () => {
  // LLM-produced yaml can parse a bare `-` list item to null; counting must
  // contribute zero for it instead of throwing mid-stream.
  vi.spyOn(
    ExecuteStructuredConfigGenerationUseCase.prototype,
    "execute",
  ).mockImplementation(async (_config, callbacks) => {
    callbacks?.onManifestReady?.({
      yaml: "sparse: manifest\n",
      parsedObject: {
        bounded_contexts: [
          {
            name: "billing",
            layers: { infrastructure: { adapters: ["a1"] } },
          },
          null,
          "not-an-object",
        ],
        context_mappings: [],
      },
    } as unknown as AssembledManifest);
    return {
      success: true as const,
      value: {
        yaml: "sparse: manifest\n",
        parsedObject: {
          bounded_contexts: [null],
          context_mappings: [],
        },
      } as unknown as AssembledManifest,
      validation: { errors: [], warnings: [], passed: true },
      transactionId: "txn-null-ctx",
    };
  });

  const res = await POST(specRequest("10.9.0.4"));
  assert.equal(res.status, 200);
  const events = await readNdjson(res);

  const manifest = events.find((e) => e.type === "manifest");
  assert.ok(manifest, "the early frame still goes out");
  assert.equal(
    manifest.contextCount,
    3,
    "null entries still count as contexts",
  );
  assert.equal(
    manifest.adapterCount,
    1,
    "non-object entries contribute zero adapters",
  );

  const done = events.find((e) => e.type === "done");
  assert.ok(done, "the stream still terminates in `done`, not `error`");
  assert.equal(done.adapterCount, 0);
});

test("a run that never fires onManifestReady emits no `manifest` frame (backward compat)", async () => {
  vi.spyOn(
    ExecuteStructuredConfigGenerationUseCase.prototype,
    "execute",
  ).mockImplementation(async (_config, _callbacks) => ({
    success: true as const,
    value: { yaml: "only: final\n", parsedObject: {} } as AssembledManifest,
    validation: { errors: [], warnings: [], passed: true },
    transactionId: "txn-blite-2",
  }));

  const res = await POST(specRequest("10.9.0.2"));
  const events = await readNdjson(res);
  assert.equal(events.filter((e) => e.type === "manifest").length, 0);
  assert.equal(events.filter((e) => e.type === "done").length, 1);
});

test("POST /api/manifest/generate/spec with missing config returns 400", async () => {
  const req = new NextRequest("http://localhost/api/manifest/generate/spec", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "10.9.0.3",
    },
    body: JSON.stringify({}),
  });
  const res = await POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.type, "error");
  assert.match(body.message, /Missing config/);
});
