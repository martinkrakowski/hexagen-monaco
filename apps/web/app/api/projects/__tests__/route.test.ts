import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";
import { GET, POST } from "../route";
import { closePlatformStore } from "../../../../lib/platform";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function sample(): SavedProject {
  return {
    id: ID,
    name: "listed",
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: "system: listed\nbounded_contexts: []\n",
  };
}

describe("GET/POST /api/projects", () => {
  beforeEach(() => closePlatformStore());
  afterEach(() => closePlatformStore());

  it("lists an empty array then the created project", async () => {
    const empty = await GET();
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).projects, []);

    const created = await POST(
      new NextRequest("http://localhost/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sample()),
      }),
    );
    assert.equal(created.status, 201);

    const listed = await GET();
    const body = (await listed.json()) as { projects: SavedProject[] };
    assert.equal(body.projects.length, 1);
    assert.equal(body.projects[0]?.id, ID);
  });
});
