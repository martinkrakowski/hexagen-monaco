// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createOrgsRepository, DuplicateOrgSlugError } from "../orgs-store";
import {
  BACKENDS,
  openBackend,
  failOnSql,
} from "../../../test-support/platform-backends";
import type { PlatformDb } from "../db";

function defined<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error("expected " + what);
  return v;
}

const countOrgs = async (db: PlatformDb) =>
  defined(
    await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM orgs", []),
    "orgs count",
  ).n;

const countAuditFor = async (
  db: PlatformDb,
  action: string,
  subjectId: string,
) =>
  defined(
    await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND subject_id = ?",
      [action, subjectId],
    ),
    "audit count",
  ).n;

/**
 * `createOrgWithOwner` is what makes org ownership reachable: before it,
 * nothing produced an org at all, so `owner_id = <org uuid>` was a shape the
 * storage layer accepted and no code path could ever create.
 */
describe.each(BACKENDS)("H1.1 — createOrgWithOwner (%s", (kind) => {
  it("makes the creator the org's owner", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );

      assert.equal(await orgs.memberRole(org.id, "founder"), "owner");
      assert.deepEqual(await orgs.listOrgIdsForUser("founder"), [org.id]);
      // And it is NOT another user's org.
      assert.deepEqual(await orgs.listOrgIdsForUser("stranger"), []);
    } finally {
      await backend.close();
    }
  });

  it("writes exactly one org.create audit row", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      // Non-vacuity: nothing is in the log before the mutation, so the count
      // below cannot be satisfied by a pre-existing row.
      const org = await orgs.createOrgWithOwner(
        { slug: "acme", name: "Acme", createdBy: "founder" },
        { actorId: "founder" },
      );
      assert.equal(await countAuditFor(backend.db, "org.create", org.id), 1);
    } finally {
      await backend.close();
    }
  });

  it("is atomic: a failing membership insert leaves NO orphan org row", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
      // The success case first, so the assertion below distinguishes a
      // rollback from a create that never worked at all.
      const ok = await orgs.createOrgWithOwner(
        { slug: "real", name: "Real", createdBy: "founder" },
        { actorId: "founder" },
      );
      assert.ok(await orgs.getOrg(ok.id), "the success case must insert a row");
      assert.equal(await countOrgs(backend.db), 1);

      // Force the SECOND statement of the transaction to fail. An org whose
      // owner insert failed is administerable by nobody and refused by
      // requireTenant for everybody — a row that exists and cannot be used.
      const decorated = failOnSql(
        backend.db,
        (sql) => sql.includes("INSERT INTO org_members"),
        new Error("boom"),
      );
      const brokenOrgs = createOrgsRepository(decorated);

      await assert.rejects(() =>
        brokenOrgs.createOrgWithOwner(
          { slug: "doomed", name: "Doomed", createdBy: "founder" },
          { actorId: "founder" },
        ),
      );

      assert.equal(
        await countOrgs(backend.db),
        1,
        "the doomed org row must have been rolled back",
      );
      assert.equal(await orgs.getOrgBySlug("doomed"), null);
    } finally {
      await backend.close();
    }
  });

  it("raises the typed duplicate error, not a raw driver error", async () => {
    const backend = await openBackend(kind);
    try {
      const orgs = backend.store.orgs;
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
      assert.equal(await countOrgs(backend.db), 1);
    } finally {
      await backend.close();
    }
  });
});
