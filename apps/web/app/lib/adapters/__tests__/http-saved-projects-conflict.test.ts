import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { HttpSavedProjectsAdapter } from "../http-saved-projects.adapter";
import type { SavedProject } from "@hexagen/shared";

const PROJECT_ID = "55555555-5555-4555-8555-555555555555";

function storedProject(): SavedProject {
  return {
    id: PROJECT_ID,
    name: "alpha",
    createdAt: 1,
    updatedAt: 1,
    formState: {},
  } as unknown as SavedProject;
}

interface Call {
  url: string;
  method: string;
}

/**
 * Builds a fetch stub that answers the read and then fails every write with
 * `status`, recording each call so the test can count WRITE attempts.
 */
function stubFetch(status: number): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "GET") {
      return new Response(JSON.stringify(storedProject()), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ETag: '"rev:1"',
        },
      });
    }
    return new Response(JSON.stringify({ error: "conflict" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/**
 * H1.4. The adapter used to retry a 409 up to three times, re-reading and
 * re-applying the updater each round. That is how a co-editor's change
 * disappears: the second write wins silently and nobody is told. A 409 is a
 * decision by the server, not a transient blip.
 */
describe("H1.4 — a conflict is surfaced, never retried away", () => {
  it("issues exactly ONE write on 409 (it used to issue three)", async () => {
    const { fetchImpl, calls } = stubFetch(409);
    const adapter = new HttpSavedProjectsAdapter(fetchImpl);

    const result = await adapter.updateProjectRecord(PROJECT_ID, (p) => ({
      ...p,
      name: "mine",
    }));

    assert.equal(result.success, false, "the conflict must reach the caller");
    if (!result.success) assert.equal(result.error.kind, "Conflict");

    const writes = calls.filter((c) => c.method === "PUT");
    // Non-vacuous: prove a write was attempted at all before asserting the
    // count. Zero writes would also satisfy "not three".
    assert.ok(writes.length > 0, "no write was attempted");
    assert.equal(
      writes.length,
      1,
      `expected one write, got ${writes.length}: ${JSON.stringify(calls)}`,
    );
  });

  it("does not retry a 503 either — a transport failure is surfaced too", async () => {
    // Recorded honestly: this adapter has never had a transport retry. The
    // only retry it ever performed was the 409 loop removed above, so a 503
    // is reported after a single write attempt. If a transport retry is ever
    // wanted, it is new behaviour and belongs in its own change.
    const { fetchImpl, calls } = stubFetch(503);
    const adapter = new HttpSavedProjectsAdapter(fetchImpl);

    const result = await adapter.updateProjectRecord(PROJECT_ID, (p) => ({
      ...p,
      name: "mine",
    }));

    assert.equal(result.success, false);
    const writes = calls.filter((c) => c.method === "PUT");
    assert.ok(writes.length > 0, "no write was attempted");
    assert.equal(writes.length, 1);
  });

  it("returns without writing when the updater is a no-op", async () => {
    const { fetchImpl, calls } = stubFetch(409);
    const adapter = new HttpSavedProjectsAdapter(fetchImpl);

    const result = await adapter.updateProjectRecord(PROJECT_ID, (p) => p);

    assert.equal(result.success, true);
    assert.equal(
      calls.filter((c) => c.method === "PUT").length,
      0,
      "an unchanged project must not be written",
    );
  });
});
