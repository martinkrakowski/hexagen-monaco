// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import type { PlatformDb } from "../db";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "platform.db");
}

/**
 * P-A1. `accounts.provider_account_id` holds GitHub's NUMERIC id, which nobody
 * can type into an invite box, so the handle itself has to be stored. It is
 * captured at sign-in and backfilled only on the next sign-in — a migration
 * must never call GitHub.
 */
describe.each(BACKENDS)("P-A1 — users.github_login (%s", (kind) => {
  it("persists the handle and is idempotent across repeat sign-ins", async () => {
    const backend = await openBackend(kind);
    try {
      const auth = backend.store.auth;
      const user = await auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });

      const before = defined(
        await backend.db.get<{ github_login: string | null }>(
          "SELECT github_login FROM users WHERE id = ?",
          [user.id],
        ),
        "user row before login",
      );
      assert.equal(before.github_login, null, "starts unset");

      await auth.setGithubLogin(user.id, "ada");
      await auth.setGithubLogin(user.id, "ada");

      const rows = await backend.db.all<{ github_login: string | null }>(
        "SELECT github_login FROM users WHERE github_login = ?",
        ["ada"],
      );
      assert.equal(rows.length, 1, "a repeat sign-in must not duplicate");
      assert.equal((await auth.getUserByGithubLogin("ada"))?.id, user.id);

      const other = await auth.createUser({
        name: "Other",
        email: "other@example.com",
        emailVerified: null,
      });
      await assert.rejects(
        () => auth.setGithubLogin(other.id, "ada"),
        (err: unknown) => {
          assert.equal(
            backend.db.isUniqueViolation(err),
            true,
            "a second user must not claim the same handle",
          );
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });

  it("canonicalizes mixed-case logins so Ada and ada are one identity", async () => {
    const backend = await openBackend(kind);
    try {
      const auth = backend.store.auth;
      const user = await auth.createUser({
        name: "Ada",
        email: "ada@example.com",
        emailVerified: null,
      });
      await auth.setGithubLogin(user.id, "  Ada ");

      const stored = defined(
        await backend.db.get<{ github_login: string | null }>(
          "SELECT github_login FROM users WHERE id = ?",
          [user.id],
        ),
        "user row after login",
      );
      assert.equal(stored.github_login, "ada");
      assert.equal((await auth.getUserByGithubLogin("ADA"))?.id, user.id);
      assert.equal((await auth.getUserByGithubLogin("Ada"))?.id, user.id);

      const other = await auth.createUser({
        name: "Impostor",
        email: "impostor@example.com",
        emailVerified: null,
      });
      await assert.rejects(
        () => auth.setGithubLogin(other.id, "ADA"),
        (err: unknown) => {
          assert.equal(
            backend.db.isUniqueViolation(err),
            true,
            "a second user must not claim the same handle",
          );
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });

  it("a user with no handle still authenticates (existing accounts)", async () => {
    const backend = await openBackend(kind);
    try {
      const auth = backend.store.auth;
      const user = await auth.createUser({
        name: "Legacy",
        email: "legacy@example.com",
        emailVerified: null,
      });
      await auth.linkAccount({
        provider: "github",
        providerAccountId: "12345",
        userId: user.id,
        type: "oauth",
      } as never);

      const found = await auth.getUserByAccount("github", "12345");
      assert.equal(found?.id, user.id, "sign-in path works without a handle");
      assert.equal(await auth.getUserByGithubLogin("nobody"), null);
      assert.equal(
        await auth.getUserByAccount("github", "missing"),
        null,
        "unknown provider account does not authenticate",
      );
    } finally {
      await backend.close();
    }
  });

  it("the handle is unique, and any number of users may have none", async () => {
    const backend = await openBackend(kind);
    try {
      const now = new Date().toISOString();
      const insert =
        "INSERT INTO users (id, github_login, created_at) VALUES (?, ?, ?)";

      // Both directions of the partial index, in one test: NULLs coexist…
      await backend.db.run(insert, ["u1", null, now]);
      await backend.db.run(insert, ["u2", null, now]);
      const nulls = defined(
        await backend.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM users WHERE github_login IS NULL",
          [],
        ),
        "null count",
      );
      assert.equal(nulls.n, 2, "multiple NULL handles are allowed");

      // …while a duplicate non-NULL handle is rejected.
      await backend.db.run(insert, ["u3", "dup", now]);
      await assert.rejects(
        () => backend.db.run(insert, ["u4", "dup", now]),
        (err: unknown) => {
          assert.equal(
            backend.db.isUniqueViolation(err),
            true,
            "a second user must not claim the same handle",
          );
          return true;
        },
      );

      // A mixed-case duplicate: Ada after ada.
      await backend.db.run(insert, ["u5", "ada", now]);
      await assert.rejects(
        () => backend.db.run(insert, ["u6", "Ada", now]),
        (err: unknown) => {
          if (kind === "sqlite") {
            assert.equal(
              backend.db.isUniqueViolation(err),
              true,
              "mixed-case dup is a NOCASE unique violation on SQLite",
            );
          } else {
            assert.equal(
              (err as { code?: string }).code,
              "23514",
              "mixed-case dup trips the lower-case CHECK on Postgres",
            );
          }
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });
});

/**
 * The two tests below reopen a database FILE and inspect the SQLite schema
 * directly (`new Database`, `db.pragma`). They have no Postgres analogue and
 * stay outside `describe.each`.
 */
describe("P-A1 — migration of a legacy users table", () => {
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
