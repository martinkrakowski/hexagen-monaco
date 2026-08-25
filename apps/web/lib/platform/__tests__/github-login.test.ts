import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { createAuthRepository } from "../auth-store";

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "platform.db");
}

/**
 * P-A1. `accounts.provider_account_id` holds GitHub's NUMERIC id, which nobody
 * can type into an invite box, so the handle itself has to be stored. It is
 * captured at sign-in and backfilled only on the next sign-in — a migration
 * must never call GitHub.
 */
describe("P-A1 — users.github_login", () => {
  it("persists the handle and is idempotent across repeat sign-ins", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-login-set-"));
    try {
      const auth = createAuthRepository(db);
      const user = auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });

      const before = db
        .prepare("SELECT github_login FROM users WHERE id = ?")
        .get(user.id) as { github_login: string | null };
      assert.equal(before.github_login, null, "starts unset");

      await auth.setGithubLogin(user.id, "ada");
      await auth.setGithubLogin(user.id, "ada");

      const rows = db
        .prepare("SELECT github_login FROM users WHERE github_login = ?")
        .all("ada");
      assert.equal(rows.length, 1, "a repeat sign-in must not duplicate");
      assert.equal(auth.getUserByGithubLogin("ada")?.id, user.id);

      const other = auth.createUser({
        name: "Other",
        email: "other@example.com",
        emailVerified: null,
      });
      await assert.rejects(
        () => auth.setGithubLogin(other.id, "ada"),
        /UNIQUE/,
        "a second user must not claim the same handle",
      );
    } finally {
      db.close();
    }
  });

  it("canonicalizes mixed-case logins so Ada and ada are one identity", async () => {
    const db = openPlatformDb(tmpDbPath("hexagen-login-case-"));
    try {
      const auth = createAuthRepository(db);
      const user = auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });
      await auth.setGithubLogin(user.id, "  Ada ");
      const stored = db
        .prepare("SELECT github_login FROM users WHERE id = ?")
        .get(user.id) as { github_login: string | null };
      assert.equal(stored.github_login, "ada");
      assert.equal(auth.getUserByGithubLogin("ADA")?.id, user.id);
      assert.equal(auth.getUserByGithubLogin("Ada")?.id, user.id);

      const other = auth.createUser({
        name: "Impostor",
        email: "impostor@example.com",
        emailVerified: null,
      });
      await assert.rejects(
        () => auth.setGithubLogin(other.id, "ADA"),
        /UNIQUE/,
      );
    } finally {
      db.close();
    }
  });

  it("a user with no handle still authenticates (existing accounts)", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-login-null-"));
    try {
      const auth = createAuthRepository(db);
      const user = auth.createUser({
        name: "Legacy",
        email: "legacy@example.com",
        emailVerified: null,
      });
      auth.linkAccount({
        provider: "github",
        providerAccountId: "12345",
        userId: user.id,
        type: "oauth",
      } as never);

      const found = auth.getUserByAccount("github", "12345");
      assert.equal(found?.id, user.id, "sign-in path works without a handle");
      assert.equal(auth.getUserByGithubLogin("nobody"), null);
      assert.equal(
        auth.getUserByAccount("github", "missing"),
        null,
        "unknown provider account does not authenticate",
      );
    } finally {
      db.close();
    }
  });

  it("the handle is unique, and any number of users may have none", () => {
    const db = openPlatformDb(tmpDbPath("hexagen-login-unique-"));
    try {
      const insert = db.prepare(
        "INSERT INTO users (id, name, email, email_verified, image, github_login, created_at) VALUES (?,?,?,?,?,?,?)",
      );
      const now = new Date().toISOString();

      // Both directions of the partial index, in one test: NULLs coexist…
      insert.run("u1", "One", "one@example.com", null, null, null, now);
      insert.run("u2", "Two", "two@example.com", null, null, null, now);
      const nulls = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE github_login IS NULL")
        .get() as { n: number };
      assert.equal(nulls.n, 2, "multiple NULL handles are allowed");

      // …while a duplicate non-NULL handle is rejected.
      insert.run("u3", "Three", "three@example.com", null, null, "dup", now);
      assert.throws(
        () =>
          insert.run("u4", "Four", "four@example.com", null, null, "dup", now),
        /UNIQUE/,
        "a second user must not claim the same handle",
      );
    } finally {
      db.close();
    }
  });

  it("migrates a legacy users table that predates the column", () => {
    const path = tmpDbPath("hexagen-login-migrate-");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        email_verified TEXT,
        image TEXT,
        created_at TEXT NOT NULL
      );
    `);
    legacy
      .prepare(
        "INSERT INTO users (id, name, email, created_at) VALUES (?,?,?,?)",
      )
      .run("legacy-1", "Existing", "existing@example.com", "2026-01-01");
    const cols = (
      legacy.pragma("table_info(users)") as Array<{
        name: string;
      }>
    ).map((c) => c.name);
    assert.ok(
      !cols.includes("github_login"),
      "precondition: the legacy table has no handle column",
    );
    legacy.close();

    const db = openPlatformDb(path);
    try {
      const migrated = (
        db.pragma("table_info(users)") as Array<{
          name: string;
        }>
      ).map((c) => c.name);
      assert.ok(migrated.includes("github_login"), "column added by ALTER");
      const row = db
        .prepare("SELECT name, github_login FROM users WHERE id = ?")
        .get("legacy-1") as { name: string; github_login: string | null };
      assert.equal(row.name, "Existing", "the existing row survives");
      assert.equal(row.github_login, null, "backfill waits for the next login");

      // Re-open is the migration error path: a non-idempotent ALTER throws
      // `duplicate column name: github_login` against the live volume.
      const reopened = openPlatformDb(path);
      try {
        const again = (
          reopened.pragma("table_info(users)") as Array<{ name: string }>
        ).map((c) => c.name);
        assert.ok(again.includes("github_login"));
        const survived = reopened
          .prepare("SELECT github_login FROM users WHERE id = ?")
          .get("legacy-1") as { github_login: string | null };
        assert.equal(survived.github_login, null);
      } finally {
        reopened.close();
      }
    } finally {
      db.close();
    }
  });
});
