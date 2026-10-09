// @vitest-environment node
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("../store", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getPlatformStore: vi.fn(),
  };
});

import { getToken } from "next-auth/jwt";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createOrgsRepository } from "../orgs-store";
import { createAuthRepository } from "../auth-store";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
import { requireTenant } from "../require-owner";
import { getPlatformStore } from "../store";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

function orgsOnTempDb() {
  const path = join(
    mkdtempSync(join(tmpdir(), "hexagen-require-tenant-")),
    "platform.db",
  );
  const db = openPlatformDb(path);
  const platformDb = createSqlitePlatformDb(db);
  return { db, orgs: createOrgsRepository(platformDb) };
}

const req = () => new NextRequest("http://localhost/api/tenants/x/projects");

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

describe.each(BACKENDS)("H1.2 — requireTenant (%s", (kind) => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
    vi.mocked(getPlatformStore).mockReset();
  });

  it("401 without a JWT sub", async () => {
    const backend = await openBackend(kind);
    try {
      signedInAs(null);
      const result = await requireTenant(req(), "org-1", backend.store.orgs);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 401);
    } finally {
      await backend.close();
    }
  });

  it("allows a personal tenant (tenantId === sub) without touching the org table", async () => {
    const backend = await openBackend(kind);
    try {
      signedInAs("user-1");
      const result = await requireTenant(req(), "user-1", backend.store.orgs);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.access, "self");
        assert.equal(result.tenantId, "user-1");
        assert.equal(result.userId, "user-1");
      }
    } finally {
      await backend.close();
    }
  });

  it("allows an org member and reports their role", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      await orgs.addMember(org.id, "user-1", "owner");
      await orgs.addMember(org.id, "user-2", "member");

      signedInAs("user-2");
      const result = await requireTenant(req(), org.id, orgs);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.access, "member");
        assert.equal(result.tenantId, org.id);
        assert.equal(result.userId, "user-2");
      }
    } finally {
      await backend.close();
    }
  });

  it("403 for a non-member of an existing org", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      await orgs.addMember(org.id, "user-1", "owner");

      // Non-vacuity: the org exists and HAS a member, so the 403 below is an
      // authorization decision rather than a lookup that found nothing.
      assert.equal(await orgs.memberRole(org.id, "user-1"), "owner");

      signedInAs("outsider");
      const result = await requireTenant(req(), org.id, orgs);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 403);
    } finally {
      await backend.close();
    }
  });

  it("resolves membership per request: removal takes effect on the next call", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrg({
        slug: "acme",
        name: "Acme",
        createdBy: "user-1",
      });
      await orgs.addMember(org.id, "user-2", "member");
      signedInAs("user-2");

      const allowed = await requireTenant(req(), org.id, orgs);
      assert.equal(allowed.ok, true, "member is allowed while the row exists");

      // No token is reissued and nothing is invalidated — the only change is
      // the database row. A guard that cached the decision, or that read the
      // role from a JWT claim, would still allow the call below.
      await orgs.removeMember(org.id, "user-2");

      const denied = await requireTenant(req(), org.id, orgs);
      assert.equal(denied.ok, false, "the very next request is denied");
      if (!denied.ok) assert.equal(denied.response.status, 403);
    } finally {
      await backend.close();
    }
  });

  it("does not open the platform store for unauthenticated or personal-tenant requests", async () => {
    signedInAs(null);
    const unauth = await requireTenant(req(), "org-1");
    assert.equal(unauth.ok, false);
    if (!unauth.ok) assert.equal(unauth.response.status, 401);
    assert.equal(vi.mocked(getPlatformStore).mock.calls.length, 0);

    signedInAs("user-1");
    const personal = await requireTenant(req(), "user-1");
    assert.equal(personal.ok, true);
    if (personal.ok) assert.equal(personal.access, "self");
    assert.equal(vi.mocked(getPlatformStore).mock.calls.length, 0);

    const memberRole = vi.fn().mockResolvedValue("member");
    vi.mocked(getPlatformStore).mockReturnValue({
      orgs: { memberRole },
    } as never);
    const orgAccess = await requireTenant(req(), "org-1");
    assert.equal(orgAccess.ok, true);
    assert.equal(vi.mocked(getPlatformStore).mock.calls.length, 1);
    assert.equal(memberRole.mock.calls.length, 1);
  });

  // SQLite-only: PRAGMA foreign_keys = OFF cannot plant an orphan on Postgres.
  it.runIf(kind === "sqlite")(
    "does not authorize a membership whose org_id is a personal user id",
    async () => {
      const { db, orgs } = orgsOnTempDb();
      try {
        const auth = createAuthRepository(createSqlitePlatformDb(db));
        const victim = await auth.createUser({
          name: "Victim",
          email: "victim@example.com",
          emailVerified: null,
        });

        await assert.rejects(
          () =>
            orgs.createOrg({
              id: victim.id,
              slug: "takeover",
              name: "Takeover",
              createdBy: "attacker",
            }),
          /collides with an existing user/,
        );
        await assert.rejects(
          () => orgs.addMember(victim.id, "attacker", "member"),
          /FOREIGN KEY/,
        );
        const org = await orgs.createOrg({
          slug: "acme",
          name: "Acme",
          createdBy: victim.id,
        });
        await assert.rejects(
          () => orgs.addMember(org.id, "attacker", "admin" as never),
          /invalid org role/,
        );

        db.pragma("foreign_keys = OFF");
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?,?,?,?)",
        ).run(victim.id, "attacker", "member", now);
        db.pragma("foreign_keys = ON");

        assert.equal(
          await orgs.memberRole(victim.id, "attacker"),
          null,
          "orphan membership must not resolve a role",
        );

        signedInAs("attacker");
        const result = await requireTenant(req(), victim.id, orgs);
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.response.status, 403);
      } finally {
        db.close();
      }
    },
  );

  it("OR8: the database refuses a membership of an org that does not exist", async () => {
    const backend = await openBackend(kind);
    try {
      const auth = backend.store.auth;
      const orgs = backend.store.orgs;
      // A user id is not an org id — the FK to orgs(id) must reject it.
      const victim = await auth.createUser({
        name: "Victim",
        email: "victim@example.com",
        emailVerified: null,
      });
      assert.equal(await orgs.getOrg(victim.id), null);

      await assert.rejects(
        () =>
          backend.db.run(
            "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
            [victim.id, "attacker", new Date().toISOString()],
          ),
        (err: unknown) => {
          assert.equal(
            backend.db.isForeignKeyViolation(err),
            true,
            "an org_id that is not an org must be refused",
          );
          return true;
        },
      );
    } finally {
      await backend.close();
    }
  });

  it("403 on a blank tenant id rather than treating it as personal", async () => {
    const backend = await openBackend(kind);
    try {
      signedInAs("user-1");
      const result = await requireTenant(req(), "   ", backend.store.orgs);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 403);
    } finally {
      await backend.close();
    }
  });
});
