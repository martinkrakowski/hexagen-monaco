import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";
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
  });
  afterEach(() => {
    closePlatformStore();
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

  it("PUT upserts and GET returns the stored project", async () => {
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

    const renamed = { ...sample(), name: "renamed", updatedAt: 2 };
    const updated = await PUT(put(ID, renamed), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(updated.status, 200);
    assert.equal(((await updated.json()) as SavedProject).name, "renamed");

    const fromStore = await getPlatformStore().projects.loadProjects();
    assert.equal(fromStore.success, true);
    if (fromStore.success) assert.equal(fromStore.value[0]?.name, "renamed");

    const deleted = await DELETE(get(ID), {
      params: Promise.resolve({ projectId: ID }),
    });
    assert.equal(deleted.status, 200);
  });
});
