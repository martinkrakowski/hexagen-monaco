import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openPlatformDb } from "../platform-db";
import { createOrgsRepository, DuplicateOrgSlugError } from "../orgs-store";

function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), "hexagen-create-org-")), "p.db");
  const db = openPlatformDb(path);
  return { db, orgs: createOrgsRepository(db) };
}

const countOrgs = (db: ReturnType<typeof fixture>["db"]) =>
  (db.prepare("SELECT COUNT(*) AS n FROM orgs").get() as { n: number }).n;

const countAuditFor = (
  db: ReturnType<typeof fixture>["db"],
  action: string,
  subjectId: string,
) =>
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND subject_id = ?",
      )
      .get(action, subjectId) as { n: number }
  ).n;

/**
 * `createOrgWithOwner` is what makes org ownership reachable: before it,
 * nothing produced an org at all, so `owner_id = <org uuid>` was a shape the
 * storage layer accepted and no code path could ever create.
 */
describe("H1.1 — createOrgWithOwner", () => {
  it("makes the creator the org's owner", async () => {
    const { db, orgs } = fixture();
    try {
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      assert.equal(await orgs.memberRole(org.id, "founder"), "owner");
      assert.deepEqual(await orgs.listOrgIdsForUser("founder"), [org.id]);
      // And it is NOT another user's org.
      assert.deepEqual(await orgs.listOrgIdsForUser("stranger"), []);
    } finally {
      db.close();
    }
  });

  it("writes exactly one org.create audit row", async () => {
    const { db, orgs } = fixture();
    try {
      // Non-vacuity: nothing is in the log before the mutation, so the count
      // below cannot be satisfied by a pre-existing row.
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );
      assert.equal(countAuditFor(db, "org.create", org.id), 1);
    } finally {
      db.close();
    }
  });

  it("is atomic: a failing membership insert leaves NO orphan org row", async () => {
    const { db, orgs } = fixture();
    try {
      // The success case first, so the assertion below distinguishes a
      // rollback from a create that never worked at all.
      const ok = await orgs.createOrgWithOwner(
        { slug: "real", name: "Real", createdBy: "founder" },
        { actorId: "founder" },
      );
      assert.ok(await orgs.getOrg(ok.id), "the success case must insert a row");
      assert.equal(countOrgs(db), 1);

      // Force the SECOND statement of the transaction to fail. An org whose
      // owner insert failed is administerable by nobody and refused by
      // requireTenant for everybody — a row that exists and cannot be used.
      db.exec(`
        CREATE TRIGGER fail_org_member BEFORE INSERT ON org_members
        BEGIN SELECT RAISE(ABORT, 'membership blocked'); END;
      `);

      await assert.rejects(() =>
        orgs.createOrgWithOwner(
          { slug: "doomed", name: "Doomed", createdBy: "founder" },
          { actorId: "founder" },
        ),
      );

      assert.equal(
        countOrgs(db),
        1,
        "the doomed org row must have been rolled back",
      );
      assert.equal(await orgs.getOrgBySlug("doomed"), null);
    } finally {
      db.close();
    }
  });

  it("raises the typed duplicate error, not a raw SqliteError", async () => {
    const { db, orgs } = fixture();
    try {
      await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      await assert.rejects(
        () =>
          orgs.createOrgWithOwner(
            { slug: "acme", name: "Acme Again", createdBy: "other" },
            { actorId: "other" },
          ),
        (err: unknown) => {
          assert.ok(
            err instanceof DuplicateOrgSlugError,
            `expected DuplicateOrgSlugError, got ${(err as Error)?.name}`,
          );
          assert.equal((err as DuplicateOrgSlugError).slug, "acme");
          return true;
        },
      );

      // The failed create left nothing behind.
      assert.equal(countOrgs(db), 1);
    } finally {
      db.close();
    }
  });
});
