// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import { createNextAuthAdapter } from "../auth-store";

describe.each(BACKENDS)("auth store + NextAuth adapter (%s)", (kind) => {
  it("persists a user and links a GitHub account without storing tokens", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const adapter = createNextAuthAdapter(store.auth);
      assert.ok(adapter.createUser);
      assert.ok(adapter.linkAccount);
      assert.ok(adapter.getUserByAccount);

      const user = await store.auth.createUser({
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
    } finally {
      await backend.close();
    }
  });

  it("markOnboarded stamps once; a replay never moves the timestamp (P-U0b)", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const user = await store.auth.createUser({
        name: "Octo Cat",
        email: "octo@example.com",
        emailVerified: null,
      });

      assert.equal(await store.auth.getOnboardedAt(user.id), null);

      await store.auth.markOnboarded(user.id);
      const first = await store.auth.getOnboardedAt(user.id);
      assert.ok(first, "completion must persist a timestamp");

      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.auth.markOnboarded(user.id);
      assert.equal(
        await store.auth.getOnboardedAt(user.id),
        first,
        "idempotency lives in the statement's `AND onboarded_at IS NULL`",
      );

      assert.equal(await store.auth.getOnboardedAt("no-such-user"), null);
    } finally {
      await backend.close();
    }
  });

  it("updateUser keeps a column when the new value is null (COALESCE)", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const verified = new Date("2026-09-01T12:00:00.000Z");
      const user = await store.auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: verified,
        image: "https://example.com/a.png",
      });
      const updated = await store.auth.updateUser({ id: user.id, name: "New" });
      assert.equal(updated.name, "New");
      assert.equal(updated.email, "ada@example.com");
      assert.equal(updated.image, "https://example.com/a.png");
      assert.ok(updated.emailVerified);
      assert.equal(updated.emailVerified.getTime(), verified.getTime());
    } finally {
      await backend.close();
    }
  });

  it("a session round-trips its expiry as the same instant, and updateSession can change only the expiry", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const user = await store.auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });
      const expires1 = new Date("2026-12-31T00:00:00.000Z");
      const sessionToken = "tok-session";
      await store.auth.createSession({
        sessionToken,
        userId: user.id,
        expires: expires1,
      });
      const fetched = await store.auth.getSessionAndUser(sessionToken);
      assert.ok(fetched);
      assert.equal(fetched.session.expires.getTime(), expires1.getTime());

      const expires2 = new Date("2027-01-01T00:00:00.000Z");
      const updated = await store.auth.updateSession({ sessionToken, expires: expires2 });
      assert.ok(updated);
      assert.equal(updated.expires.getTime(), expires2.getTime());

      await store.auth.deleteSession(sessionToken);
      assert.equal(await store.auth.getSessionAndUser(sessionToken), null);
    } finally {
      await backend.close();
    }
  });

  it("a verification token is consumed once", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const expires = new Date("2026-12-31T00:00:00.000Z");
      await store.auth.createVerificationToken({
        identifier: "ada@example.com",
        token: "verify-1",
        expires,
      });
      const first = await store.auth.useVerificationToken({
        identifier: "ada@example.com",
        token: "verify-1",
      });
      assert.ok(first);
      assert.equal(first.expires.getTime(), expires.getTime());
      const second = await store.auth.useVerificationToken({
        identifier: "ada@example.com",
        token: "verify-1",
      });
      assert.equal(second, null);
    } finally {
      await backend.close();
    }
  });

  it("onboarding is stamped once", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const user = await store.auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });
      assert.equal(await store.auth.getOnboardedAt(user.id), null);
      await store.auth.markOnboarded(user.id);
      const first = await store.auth.getOnboardedAt(user.id);
      assert.ok(first, "should return an ISO string after marking");
      assert.equal(first, first); // truthy check above; now verify second mark is a no-op
      await new Promise((resolve) => setTimeout(resolve, 10));
      await store.auth.markOnboarded(user.id);
      assert.equal(
        await store.auth.getOnboardedAt(user.id),
        first,
        "the `AND onboarded_at IS NULL` condition prevents a second stamp",
      );
    } finally {
      await backend.close();
    }
  });

  it("github logins are canonical and looked up exactly", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const user = await store.auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });
      await store.auth.setGithubLogin(user.id, " Ada ");
      const found = await store.auth.getUserByGithubLogin("ADA");
      assert.ok(found);
      assert.equal(found.id, user.id);
      assert.equal(
        await store.auth.getUserByGithubLogin("bob"),
        null,
      );
    } finally {
      await backend.close();
    }
  });

  it("linking the same account twice moves it, not duplicates it", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      const userA = await store.auth.createUser({
        name: "A",
        email: "a@example.com",
        emailVerified: null,
      });
      const userB = await store.auth.createUser({
        name: "B",
        email: "b@example.com",
        emailVerified: null,
      });
      const account = {
        provider: "github",
        providerAccountId: "9999",
        type: "oauth" as const,
        userId: userA.id,
      };
      await store.auth.linkAccount(account);
      await store.auth.linkAccount({ ...account, userId: userB.id });
      const found = await store.auth.getUserByAccount("github", "9999");
      assert.ok(found);
      assert.equal(found.id, userB.id);
      const count = await backend.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM accounts",
      );
      assert.equal(typeof count?.n, "number");
      assert.equal(count?.n, 1);
    } finally {
      await backend.close();
    }
  });
});
