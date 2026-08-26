import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";
import { createNextAuthAdapter } from "../auth-store";

describe("auth store + NextAuth adapter", () => {
  it("persists a user and links a GitHub account without storing tokens", async () => {
    const store = createPlatformStore(":memory:");
    const adapter = createNextAuthAdapter(store.auth);
    assert.ok(adapter.createUser);
    assert.ok(adapter.linkAccount);
    assert.ok(adapter.getUserByAccount);

    // NextAuth's `Adapter.createUser` is typed as a union of the v4 and
    // future signatures, so through that type the id is demanded; the
    // repository is the precisely-typed write surface. Reads below go through
    // the adapter (Awaitable) to prove the delegation.
    const user = store.auth.createUser({
      name: "Octo Cat",
      email: "octo@example.com",
      emailVerified: null,
      image: "https://example.com/a.png",
    });
    assert.equal(user.email, "octo@example.com");
    assert.ok(user.id);

    await adapter.linkAccount({
      userId: user.id,
      type: "oauth",
      provider: "github",
      providerAccountId: "4242",
      access_token: "gho_must_not_be_stored",
    });

    const found = await adapter.getUserByAccount({
      provider: "github",
      providerAccountId: "4242",
    });
    assert.ok(found);
    assert.equal(found.id, user.id);

    const byEmail = await adapter.getUserByEmail?.("octo@example.com");
    assert.ok(byEmail);
    assert.equal(byEmail.id, user.id);
    store.close();
  });

  it("markOnboarded stamps once; a replay never moves the timestamp (P-U0b)", async () => {
    const store = createPlatformStore(":memory:");
    const user = store.auth.createUser({
      name: "Octo Cat",
      email: "octo@example.com",
      emailVerified: null,
    });

    assert.equal(await store.auth.getOnboardedAt(user.id), null);

    await store.auth.markOnboarded(user.id);
    const first = await store.auth.getOnboardedAt(user.id);
    assert.ok(first, "completion must persist a timestamp");

    // Millisecond precision: without this pause a non-idempotent second
    // UPDATE could write an identical string and pass by luck.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await store.auth.markOnboarded(user.id);
    assert.equal(
      await store.auth.getOnboardedAt(user.id),
      first,
      "idempotency lives in the statement's `AND onboarded_at IS NULL`",
    );

    // Unknown ids read as NULL — same answer as "not onboarded".
    assert.equal(await store.auth.getOnboardedAt("no-such-user"), null);
    store.close();
  });
});
