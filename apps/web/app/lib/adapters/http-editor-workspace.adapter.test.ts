import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  HttpEditorWorkspaceAdapter,
  DOCUMENT_ID_PATTERN,
} from "./http-editor-workspace.adapter";
// Imported in the TEST only — this module is server code and must not be
// imported by client code.
import { DOCUMENT_ID_PATTERN as SERVER_PATTERN } from "../../../lib/platform/owner-documents-store";

describe("HttpEditorWorkspaceAdapter.id pattern matches the server", () => {
  it("the id pattern in this file equals the server's", () => {
    assert.equal(
      DOCUMENT_ID_PATTERN.source,
      SERVER_PATTERN.source,
      "client-side id pattern drifted from the server's",
    );
  });
});

describe("HttpEditorWorkspaceAdapter GET", () => {
  it("GET hits /api/tenants/<id>/documents/workspace/<id> and reads rev from the ETag", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ url: href, method });
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            kind: "workspace",
            id: "ws1",
            projectId: "proj",
            payload: { files: {} },
            updatedAt: 100,
          }),
          { status: 200, headers: { ETag: '"rev:5"' } },
        );
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.read("owner1", "ws1");

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.rev, 5);
      assert.equal(result.updatedAt, 100);
      assert.deepEqual(result.workspace, { files: {} });
    }
    assert.equal(calls[0]?.url, "/api/tenants/owner1/documents/workspace/ws1");
    assert.equal(calls[0]?.method, "GET");
  });
});

describe("HttpEditorWorkspaceAdapter PUT", () => {
  it("PUT sends projectId in the body every time, and If-Match rev:<n> once a rev is known", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            kind: "workspace",
            id: "ws1",
            projectId: "proj",
            payload: { files: {} },
            updatedAt: 100,
          }),
          { status: 200, headers: { ETag: '"rev:3"' } },
        );
      }
      if (method === "PUT") {
        assert.ok(init?.body, "PUT must have a body");
        const body = JSON.parse(init.body as string);
        assert.equal(body.projectId, "proj-uuid");
        const headers = new Headers(init.headers);
        assert.equal(
          headers.get("If-Match"),
          "rev:3",
          "should send If-Match after a read seeded the rev",
        );
        return new Response(
          JSON.stringify({
            kind: "workspace",
            id: "ws1",
            projectId: "proj",
            payload: body.payload,
            updatedAt: 200,
          }),
          { status: 200, headers: { ETag: '"rev:4"' } },
        );
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    await adapter.read("owner1", "ws1");
    const result = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
    );
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.rev, 4);
    }
  });

  it("the first PUT after a 404 carries no If-Match", async () => {
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return new Response(null, { status: 404 });
      }
      if (method === "PUT") {
        assert.ok(init?.body, "PUT must have a body");
        const body = JSON.parse(init.body as string);
        assert.equal(body.projectId, "proj-uuid");
        const headers = new Headers(init.headers);
        assert.equal(
          headers.get("If-Match"),
          null,
          "no If-Match when no rev was ever read",
        );
        return new Response(
          JSON.stringify({
            kind: "workspace",
            id: "ws1",
            projectId: "proj",
            payload: body.payload,
            updatedAt: 200,
          }),
          { status: 200, headers: { ETag: '"rev:1"' } },
        );
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const readResult = await adapter.read("owner1", "ws1");
    assert.equal(readResult.ok, false);
    if (!readResult.ok) assert.equal(readResult.reason, "not_found");

    const writeResult = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
    );
    assert.ok(writeResult.ok);
  });

  it("409 comes back as a conflict, not a retry: exactly one PUT", async () => {
    let puts = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return new Response(
          JSON.stringify({
            kind: "workspace", id: "ws1", projectId: "proj",
            payload: { files: {} }, updatedAt: 100,
          }),
          { status: 200, headers: { ETag: '"rev:3"' } },
        );
      }
      if (method === "PUT") {
        puts += 1;
        return new Response("conflict", { status: 409 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    await adapter.read("owner1", "ws1");
    const result = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(puts, 1, "exactly one PUT, no retry");
  });
});

describe("HttpEditorWorkspaceAdapter 413", () => {
  it("413 comes back as too-large with the body length", async () => {
    const payload = { files: { big: "x".repeat(100) } };
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        return new Response("too large", { status: 413 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.write(
      "owner1",
      "ws1",
      payload,
      "proj-uuid",
    );
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === "too_large") {
      const computedBody = JSON.stringify({ payload, projectId: "proj-uuid" });
      assert.equal(result.bodyLength, computedBody.length);
    } else {
      assert.fail("expected too_large result");
    }
  });
});
