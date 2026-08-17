import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET, POST, PUT } from "../route";
import { closePlatformStore } from "../../../../lib/platform";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DROPPED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sample(id = ID, name = "listed"): SavedProject {
  return {
    id,
    name,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: `system: ${name}\nbounded_contexts: []\n`,
  };
}

function get(): NextRequest {
  return new NextRequest("http://localhost/api/projects");
}

describe("GET/POST/PUT /api/projects", () => {
  beforeEach(() => {
    closePlatformStore();
    vi.mocked(getToken).mockResolvedValue({ sub: "user-a" } as never);
  });
  afterEach(() => closePlatformStore());

  it("rejects a missing JWT with 401", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const res = await GET(get());
    assert.equal(res.status, 401);
  });

  it("lists an empty array then the created project", async () => {
    const empty = await GET(get());
    assert.equal(empty.status, 200);
    const emptyBody = (await empty.json()) as {
      projects: SavedProject[];
      initialized: boolean;
    };
    assert.deepEqual(emptyBody.projects, []);
    assert.equal(emptyBody.initialized, false);

    const created = await POST(
      new NextRequest("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample()),
      }),
    );
    assert.equal(created.status, 201);

    const listed = await GET(get());
    const body = (await listed.json()) as { projects: SavedProject[] };
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0]?.id, ID);
  });

  it("PUT replaces the owner's list and drops absent ids", async () => {
    await POST(
      new NextRequest("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample(DROPPED, "gone")),
      }),
    );
    const replaced = await PUT(
      new NextRequest("http://localhost/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: [sample()] }),
      }),
    );
    assert.equal(replaced.status, 200);
    const listed = await GET(get());
    const body = (await listed.json()) as { projects: SavedProject[] };
    assert.deepEqual(
      body.projects.map((p) => p.id),
      [ID],
    );

    const emptied = await PUT(
      new NextRequest("http://localhost/api/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: [] }),
      }),
    );
    assert.equal(emptied.status, 200);
    const afterEmpty = (await (await GET(get())).json()) as {
      projects: SavedProject[];
      initialized: boolean;
    };
    assert.deepEqual(afterEmpty.projects, []);
    assert.equal(afterEmpty.initialized, true);
  });
});
