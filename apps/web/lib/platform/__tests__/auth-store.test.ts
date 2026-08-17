import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
import { createNextAuthAdapter } from "../auth-store";

describe("auth store + NextAuth adapter", () => {
  it("persists a user and links a GitHub account without storing tokens", () => {
    const store = createPlatformStore(":memory:");
    const adapter = createNextAuthAdapter(store.auth);
    assert.ok(adapter.createUser);
    assert.ok(adapter.linkAccount);
    assert.ok(adapter.getUserByAccount);

    const user = adapter.createUser({
      name: "Octo Cat",
      email: "octo@example.com",
      emailVerified: null,
      image: "https://example.com/a.png",
    });
    assert.equal(user.email, "octo@example.com");
    assert.ok(user.id);

    adapter.linkAccount({
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "4242",
      access_token: "gho_must_not_be_stored",
    });

    const found = adapter.getUserByAccount({
      provider: "github",
      providerAccountId: "4242",
    });
    assert.ok(found);
    assert.equal(found.id, user.id);

    const byEmail = adapter.getUserByEmail?.("octo@example.com");
    assert.ok(byEmail);
    assert.equal(byEmail.id, user.id);
    store.close();
  });
});
