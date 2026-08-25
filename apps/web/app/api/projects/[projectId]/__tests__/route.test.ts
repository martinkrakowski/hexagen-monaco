import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { DELETE, GET, PUT } from "../route";
import {
  closePlatformStore,
  getPlatformStore,
} from "../../../../../lib/platform";

const ID = "11111111-1111-4111-8111-111111111111";

function sample(id = ID): SavedProject {
  return {
    id,
    name: "shop",
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: "system: shop\nbounded_contexts: []\n",
  };
}

function get(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${id}`);
}

function put(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET/PUT /api/projects/[projectId]", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockResolvedValue({ sub: "user-a" } as never);
  });
  afterEach(() => {
    closePlatformStore();
  });

  it("rejects a missing JWT with 401", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const res = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects an invalid project id with 400, never 501", async () => {
    const res = await GET(get("not-a-uuid"), {
      params: Promise.resolve({ projectId: "not-a-uuid" }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { statusCode: number };
    assert.notEqual(body.statusCode, 501);
  });

  it("returns 404 for a missing project instead of 501", async () => {
    const res = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.notEqual(body.error, "not_implemented");
  });

  it("PUT upserts and GET returns the stored project for the JWT owner only", async () => {
    const written = await PUT(put(ID, sample()), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.ok(written.status === 200 || written.status === 201);
    const created = (await written.json()) as SavedProject;
    assert.equal(created.name, "shop");

    const read = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(read.status, 200);
    const body = (await read.json()) as SavedProject;
    assert.equal(body.id, ID);
    assert.equal(body.manifestYaml.includes("system: shop"), true);

    vi.mocked(getToken).mockResolvedValue({ sub: "user-b" } as never);
    const other = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(other.status, 404);

    vi.mocked(getToken).mockResolvedValue({ sub: "user-a" } as never);
    const renamed = { ...sample(), name: "renamed", updatedAt: 2 };
    const updated = await PUT(put(ID, renamed), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as SavedProject).name, "renamed");

    const fromStore = await getPlatformStore()
      .projectsFor("user-a")
      .loadProjects();
    assert.equal(fromStore.success, true);
    if (fromStore.success) {
      const row = fromStore.value.find((p) => p.id === ID);
      assert.equal(row?.name, "renamed");
    }

    const deleted = await DELETE(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(deleted.status, 200);
  });

  it("PUT with a stale If-Match returns 409 and keeps the current row", async () => {
    await PUT(put(ID, sample()), {
      params: Promise.resolve({ projectId: ID }),
    });
    const winner = { ...sample(), name: "winner", updatedAt: 2 };
    const first = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": "1" },
        body: JSON.stringify(winner),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(first.status, 200);

    const stale = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": "1" },
        body: JSON.stringify({ ...sample(), name: "stale", updatedAt: 3 }),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(stale.status, 409);

    const read = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(((await read.json()) as SavedProject).name, "winner");
  });

  it("PUT with a canonical rev If-Match succeeds, then a stale rev 409s", async () => {
    const created = await PUT(put(ID, sample()), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.ok(created.status === 200 || created.status === 201);

    const winner = { ...sample(), name: "rev-winner", updatedAt: 2 };
    const first = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": "rev:1",
        },
        body: JSON.stringify(winner),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("ETag"), '"rev:2"');

    const stale = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": "rev:1",
        },
        body: JSON.stringify({ ...sample(), name: "rev-stale", updatedAt: 3 }),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(stale.status, 409);

    const read = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(((await read.json()) as SavedProject).name, "rev-winner");
  });

  it("GET returns the canonical rev ETag so a client can echo it on PUT", async () => {
    const created = await PUT(put(ID, sample()), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.ok(created.status === 200 || created.status === 201);

    const read = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("ETag"), '"rev:1"');

    const echoed = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": read.headers.get("ETag") ?? "",
        },
        body: JSON.stringify({ ...sample(), name: "echoed", updatedAt: 2 }),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(echoed.status, 200);
    assert.equal(echoed.headers.get("ETag"), '"rev:2"');
    assert.equal(((await echoed.json()) as SavedProject).name, "echoed");
  });

  it("oversized rev:<n> If-Match is 400, not a persistence 500", async () => {
    await PUT(put(ID, sample()), {
      params: Promise.resolve({ projectId: ID }),
    });

    const huge = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": `rev:${"9".repeat(400)}`,
        },
        body: JSON.stringify({ ...sample(), name: "huge", updatedAt: 2 }),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(huge.status, 400);
    const hugeBody = (await huge.json()) as {
      error: string;
      statusCode: number;
    };
    assert.equal(hugeBody.error, "validation");
    assert.notEqual(huge.status, 500);

    const rounded = await PUT(
      new NextRequest(`http://localhost/api/projects/${ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          // MAX_SAFE_INTEGER is 9007199254740991; this value is finite after
          // Number() but not a safe integer (it rounds).
          "If-Match": "rev:9007199254740993",
        },
        body: JSON.stringify({ ...sample(), name: "rounded", updatedAt: 2 }),
      }),
      { params: Promise.resolve({ projectId: ID }) },
    );
    assert.equal(rounded.status, 400);
    assert.equal(
      ((await rounded.json()) as { error: string }).error,
      "validation",
    );

    const stored = await GET(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(((await stored.json()) as SavedProject).name, "shop");
  });
});
