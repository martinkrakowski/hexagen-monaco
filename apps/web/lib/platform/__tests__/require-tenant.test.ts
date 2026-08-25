import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { openPlatformDb } from "../platform-db";
import { createOrgsRepository } from "../orgs-store";
import { requireTenant } from "../require-owner";

function orgsOnTempDb() {
  const path = join(
    mkdtempSync(join(tmpdir(), "hexagen-require-tenant-")),
    "platform.db",
  );
  const db = openPlatformDb(path);
  return { db, orgs: createOrgsRepository(db) };
}

const req = () => new NextRequest("http://localhost/api/tenants/x/projects");

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

describe("H1.2 — requireTenant", () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReset();
  });

  it("401 without a JWT sub", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
      signedInAs(null);
      const result = await requireTenant(req(), "org-1", orgs);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 401);
    } finally {
      db.close();
    }
  });

  it("allows a personal tenant (tenantId === sub) without touching the org table", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
      signedInAs("user-1");
      const result = await requireTenant(req(), "user-1", orgs);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.access, "self");
        assert.equal(result.tenantId, "user-1");
        assert.equal(result.userId, "user-1");
      }
    } finally {
      db.close();
    }
  });

  it("allows an org member and reports their role", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
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
      db.close();
    }
  });

  it("403 for a non-member of an existing org", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
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
      db.close();
    }
  });

  it("resolves membership per request: removal takes effect on the next call", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
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
      db.close();
    }
  });

  it("403 on a blank tenant id rather than treating it as personal", async () => {
    const { db, orgs } = orgsOnTempDb();
    try {
      signedInAs("user-1");
      const result = await requireTenant(req(), "   ", orgs);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.response.status, 403);
    } finally {
      db.close();
    }
  });
});
