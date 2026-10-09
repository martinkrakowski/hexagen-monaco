import { describe, it, vi } from "vitest";
import type { MockedFunction } from "vitest";
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
    const fetchImpl = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      assert.equal(String(url), "/api/tenants/owner1/documents/workspace/ws1");
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
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.read("owner1", "ws1");
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.rev, 5);
      assert.equal(result.updatedAt, 100);
      assert.deepEqual(result.workspace, { files: {} });
    }
  });

  it("a 200 without an ETag is an error", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          kind: "workspace",
          id: "ws1",
          projectId: "proj",
          payload: { files: {} },
          updatedAt: 100,
        }),
        { status: 200 },
      );
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.read("owner1", "ws1");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.match(result.message, /missing ETag/);
    }
  });
});

describe("HttpEditorWorkspaceAdapter PUT", () => {
  it("write sends projectId in the body and If-Match only when the caller passes a rev", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        assert.ok(init?.body, "PUT must have a body");
        const body = JSON.parse(init.body as string);
        assert.equal(body.projectId, "proj-uuid");
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
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);

    const withRev = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
      { ifMatch: 3 },
    );
    assert.ok(withRev.ok);
    const withRevHeaders = new Headers(fetchImpl.mock.calls[0]![1]!.headers);
    assert.equal(withRevHeaders.get("If-Match"), '"rev:3"');
    assert.equal(withRevHeaders.get("If-None-Match"), null);

    const withoutRev = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
      { createOnly: true },
    );
    assert.ok(withoutRev.ok);
    const noRevHeaders = new Headers(fetchImpl.mock.calls[1]![1]!.headers);
    assert.equal(noRevHeaders.get("If-None-Match"), "*");
    assert.equal(noRevHeaders.get("If-Match"), null);
  });

  it("a create-only write sends If-None-Match: * and no If-Match", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("If-None-Match"), "*");
      assert.equal(headers.get("If-Match"), null);
      return new Response(
        JSON.stringify({
          kind: "workspace",
          id: "ws1",
          projectId: "proj-uuid",
          payload: {},
          updatedAt: 100,
        }),
        { status: 200, headers: { ETag: '"rev:1"' } },
      );
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
      { createOnly: true },
    );
    assert.ok(result.ok);
  });

  it("409 comes back as a conflict, not a retry: exactly one PUT", async () => {
    let puts = 0;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        puts += 1;
        return new Response("conflict", { status: 409 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
      { ifMatch: 3 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "conflict");
    assert.equal(puts, 1, "exactly one PUT, no retry");
  });

  it("a successful PUT without an ETag is an error, never revision 0", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          kind: "workspace",
          id: "ws1",
          projectId: "proj-uuid",
          payload: { files: {} },
          updatedAt: 200,
        }),
        { status: 200 },
      );
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.write(
      "owner1",
      "ws1",
      { files: {} },
      "proj-uuid",
      { ifMatch: 3 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "error");
      assert.match(result.message, /missing ETag/);
    }
  });
});

describe("HttpEditorWorkspaceAdapter 413", () => {
  it("413 comes back as too-large with the body length", async () => {
    const payload = { files: { big: "x".repeat(100) } };
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        return new Response("too large", { status: 413 });
      }
      return new Response("nope", { status: 500 });
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.write("owner1", "ws1", payload, "proj-uuid", {
      createOnly: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok && result.reason === "too_large") {
      const computedBody = JSON.stringify({ payload, projectId: "proj-uuid" });
      assert.equal(result.bodyLength, computedBody.length);
    } else {
      assert.fail("expected too_large result");
    }
  });
});

describe("HttpEditorWorkspaceAdapter DELETE", () => {
  it("delete sends If-Match with the revision", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("If-Match"), '"rev:5"');
        return new Response(null, { status: 204 });
      },
    ) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.delete("owner1", "ws1", 5);
    assert.ok(result.ok && result.deleted);
  });

  it("412 is a conflict carrying the server's revision", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response("conflict", {
        status: 412,
        headers: { ETag: '"rev:7"' },
      });
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.delete("owner1", "ws1", 5);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "conflict");
      assert.equal(result.serverRev, 7);
    }
  });

  it("404 is treated as done", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, { status: 404 });
    }) as unknown as MockedFunction<typeof fetch>;

    const adapter = new HttpEditorWorkspaceAdapter(fetchImpl);
    const result = await adapter.delete("owner1", "ws1", 5);
    assert.ok(result.ok && !result.deleted);
  });
});
