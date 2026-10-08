import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { closePlatformStore, getPlatformStore } from "../../../lib/platform";
import { resolveShareHandle } from "../share-handles";

describe("resolveShareHandle — async guard (P-A4)", () => {
  beforeEach(() => {
    closePlatformStore();
  });
  afterEach(() => {
    closePlatformStore();
  });

  it("resolves @nobody to null, not to a hit, when no user holds that login", async () => {
    const store = getPlatformStore();
    // Create a DIFFERENT user so the database is not empty, proving the
    // null result is a genuine miss and not an empty-table shortcut.
    const created = await store.auth.createUser({
      name: "Ada",
      email: "ada@example.com",
      emailVerified: null,
    });
    await store.auth.setGithubLogin(created.id, "ada");

    const resolved = await resolveShareHandle("@nobody");
    assert.equal(resolved, null, "a login with no row must resolve to null");
  });
});
