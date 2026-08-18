import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { requirePersistenceOwner } from "../require-owner";

describe("requirePersistenceOwner", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
  });

  it("rejects a missing JWT with 401", async () => {
    vi.mocked(getToken).mockResolvedValue(null);
    const result = await requirePersistenceOwner(
      new NextRequest("http://localhost/api/projects"),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.response.status, 401);
  });

  it("returns the JWT sub as the owner id", async () => {
    vi.mocked(getToken).mockResolvedValue({ sub: "github-user-7" } as never);
    const result = await requirePersistenceOwner(
      new NextRequest("http://localhost/api/projects"),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ownerId, "github-user-7");
  });
});
