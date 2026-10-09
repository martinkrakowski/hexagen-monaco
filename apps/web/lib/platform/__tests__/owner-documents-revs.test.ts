// @vitest-environment node
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";
import {
  createOwnerDocumentsStore,
  deleteDocumentsOfOwner,
} from "../owner-documents-store";
import { createOrgsRepository } from "../orgs-store";
import { createSavedProjectsStore } from "../saved-projects-store";

type Backend = {
  db: PlatformDb;
  cleanup: () => Promise<void>;
};

async function makeSqlite(): Promise<Backend> {
  const handle = openPlatformDb(":memory:");
  return {
    db: createSqlitePlatformDb(handle),
    cleanup: async () => {
      await handle.close();
    },
  };
}

async function makePg(max = 2): Promise<Backend> {
  const result = await createTestPgDb({ max });
  return {
    db: result.db,
    cleanup: async () => {
      await result.db.close();
      await result.drop();
    },
  };
}

const backends: Array<[string, () => Promise<Backend>]> = [
  ["sqlite", makeSqlite],
  ["postgres", () => makePg(8)],
];

// A saved_projects row, written via raw SQL with hx_ts(@at) so the timestamp
// column is accepted on both backends. createProjectRecord is not used here:
// it binds epoch-ms created_at/updated_at directly, which Postgres rejects
// (22008) — a pre-existing saved-projects-store limitation outside A3-00's rev
// scope. deleteProjectRecord (plain DELETE) is used for the cascade, per the
// brief. The point of test 4 is the document counter through the FK cascade.
async function createProjectRow(
  db: PlatformDb,
  ownerId: string,
  id: string,
): Promise<void> {
  const at = Date.now();
  await db.run(
    "INSERT INTO saved_projects (id, owner_id, name, payload, created_at, updated_at, ord, rev) VALUES (@id, @oid, @name, @payload, hx_ts(@at), hx_ts(@at), @ord, 1)",
    { id, oid: ownerId, name: "P", payload: "{}", at, ord: 0 },
  );
}

describe.each(backends)("owner document revs: %s", (_name, make) => {
  let db: PlatformDb;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const result = await make();
    db = result.db;
    cleanup = result.cleanup;
  });
  afterEach(async () => {
    await cleanup();
  });

  it("1. a stale If-Match (= rev 1) after delete + re-create is refused as Conflict and leaves the new copy unchanged", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } }); // rev 1
    await store.delete("workspace", "doc-1");
    const re = await store.put({
      kind: "workspace",
      id: "doc-1",
      payload: { v: "new" },
    });
    assert.equal(re.success, true);
    const stale = await store.put(
      { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
      1,
    );
    assert.equal(stale.success, false);
    if (!stale.success) {
      assert.equal(stale.error.kind, "Conflict");
      assert.equal(stale.error.currentRev, re.value.rev);
    }
    const row = await db.get<{ payload: string; rev: number }>(
      "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
      ["user-1", "user-1", "workspace", "doc-1"],
    );
    assert.deepEqual(JSON.parse(row!.payload), { v: "new" });
    assert.equal(row!.rev, re.value.rev, "the new copy must be untouched");
  });

  it("2. a conditional DELETE with the old rev (=1) after delete + re-create is PreconditionFailed and the new copy survives", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } }); // rev 1
    await store.delete("workspace", "doc-1");
    const re = await store.put({
      kind: "workspace",
      id: "doc-1",
      payload: { v: "new" },
    });
    assert.equal(re.success, true);
    const stale = await store.delete("workspace", "doc-1", 1); // old rev 1
    assert.equal(stale.success, false);
    if (!stale.success) {
      assert.equal(stale.error.kind, "PreconditionFailed");
      assert.equal(stale.error.currentRev, re.value.rev);
    }
    const row = await db.get<{ rev: number }>(
      "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
      ["user-1", "user-1", "workspace", "doc-1"],
    );
    assert.ok(row, "the new copy must survive");
    assert.equal(row!.rev, re.value.rev);
  });

  it("3. the re-created document's rev is greater than the deleted one's last rev (written up to rev 3 first)", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    for (const v of ["a", "b", "c"]) {
      await store.put({ kind: "workspace", id: "doc-1", payload: { v } });
    }
    const lastRev = 3;
    await store.delete("workspace", "doc-1");
    const re = await store.put({
      kind: "workspace",
      id: "doc-1",
      payload: { v: "new" },
    });
    assert.equal(re.success, true);
    assert.equal(
      re.success && re.value.rev,
      4,
      "re-created rev must exceed the last rev",
    );
    assert.ok(re.value.rev > lastRev);
  });

  it("5. a create-only PUT after a delete yields a rev greater than the old one", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } }); // rev 1
    const oldRev = 1;
    await store.delete("workspace", "doc-1");
    const re = await store.put(
      { kind: "workspace", id: "doc-1", payload: { v: "new" } },
      undefined,
      { createOnly: true },
    );
    assert.equal(re.success, true);
    assert.ok(
      re.value.rev > oldRev,
      `re-created rev ${re.value.rev} must exceed ${oldRev}`,
    );
  });

  it("6. two authors in one tenant: B's writes never move A's counter or revs; each stays 1,2,3", async () => {
    const orgs = createOrgsRepository(db);
    await orgs.createOrg({
      id: "org-1",
      slug: "t",
      name: "T",
      createdBy: "user-a",
    });
    await orgs.addMember("org-1", "user-a", "member");
    await orgs.addMember("org-1", "user-b", "member");
    const a = createOwnerDocumentsStore(db, "org-1", "user-a");
    const b = createOwnerDocumentsStore(db, "org-1", "user-b");
    {
      for (const v of ["a", "b", "c"]) {
        await a.put({ kind: "workspace", id: "doc-1", payload: { v } }); // A: rev 1,2,3
      }
      for (const v of ["a", "b", "c"]) {
        await b.put({ kind: "workspace", id: "doc-2", payload: { v } }); // B: rev 1,2,3
      }

      const aRow = await db.get<{ rev: number }>(
        "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["org-1", "user-a", "workspace", "doc-1"],
      );
      assert.equal(aRow!.rev, 3);

      const aCounter = await db.get<{ last_rev: number }>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        ["org-1", "user-a"],
      );
      assert.equal(aCounter!.last_rev, 3, "A's counter must be 3");
      const bCounter = await db.get<{ last_rev: number }>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        ["org-1", "user-b"],
      );
      assert.equal(
        bCounter!.last_rev,
        3,
        "B's counter must be 3, untouched by A",
      );

      // A's second document takes a rev from A's counter (now 3), not from B's.
      const a2 = await a.put({
        kind: "workspace",
        id: "doc-1b",
        payload: { v: "x" },
      });
      assert.equal(a2.success, true);
      assert.equal(
        a2.value.rev,
        4,
        "B must not have moved A's counter; A's next rev is counter(3)+1",
      );
    }
  });

  it("4. a delete of the project row cascades the document; re-creating it takes a rev above the old one and the stale If-Match is refused", async () => {
    const projects = createSavedProjectsStore(db, "user-1");
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    try {
      await createProjectRow(db, "user-1", "proj-a");
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "a" },
        projectId: "proj-a",
      }); // rev 1
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "b" },
        projectId: "proj-a",
      }); // rev 2
      const lastRev = 2;

      // Deleting the project row cascades to its documents (DB-level FK), but
      // does NOT touch the per-author counter.
      const dropped = await projects.deleteProjectRecord("proj-a");
      assert.equal(dropped.success, true);

      // Re-create the project row and the document; the new rev must exceed the
      // old one because the counter was not reset by the cascade.
      await createProjectRow(db, "user-1", "proj-a");
      const re = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "new" },
        projectId: "proj-a",
      });
      assert.equal(re.success, true);
      assert.ok(
        re.value.rev > lastRev,
        `re-created rev ${re.value.rev} must exceed the pre-delete rev ${lastRev}`,
      );

      // The old If-Match (= lastRev) is refused and the new copy is untouched.
      const stale = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
        lastRev,
      );
      assert.equal(stale.success, false);
      if (!stale.success) {
        assert.equal(stale.error.kind, "Conflict");
        assert.equal(stale.error.currentRev, re.value.rev);
      }
      const row = await db.get<{ payload: string; rev: number }>(
        "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.deepEqual(JSON.parse(row!.payload), { v: "new" });
      assert.equal(row!.rev, re.value.rev, "the re-created copy is untouched");
    } finally {
      await cleanup();
    }
  });

  it("9. a refused precondition writes one row whose detail is {method, sent, current}; a success writes none", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    try {
      // Three documents, each written twice. They share this author's counter,
      // so doc-a reaches rev 2, doc-b rev 4, doc-c rev 6.
      for (const id of ["doc-a", "doc-b", "doc-c"]) {
        await store.put({ kind: "workspace", id, payload: { v: "1" } });
        await store.put({ kind: "workspace", id, payload: { v: "2" } });
      }
      const aGet = await store.get("workspace", "doc-a");
      assert.equal(aGet.success, true);
      const aCur = aGet.value!.rev;
      const bGet = await store.get("workspace", "doc-b");
      assert.equal(bGet.success, true);
      const bCur = bGet.value!.rev;
      const cGet = await store.get("workspace", "doc-c");
      assert.equal(cGet.success, true);
      const cCur = cGet.value!.rev;

      // (a) stale PUT on doc-a: sent = current-1.
      const stalePut = await store.put(
        { kind: "workspace", id: "doc-a", payload: { v: "stale" } },
        aCur - 1,
      );
      assert.equal(stalePut.success, false);
      // (b) createOnly on existing doc-b: no expected rev was sent.
      const createOnly = await store.put(
        { kind: "workspace", id: "doc-b", payload: { v: "x" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(createOnly.success, false);
      // (c) stale DELETE on doc-c: sent = current-1.
      const staleDel = await store.delete("workspace", "doc-c", cCur - 1);
      assert.equal(staleDel.success, false);

      // Each refusal wrote exactly one row, keyed by subject.
      const rows = await db.all<{
        subject_id: string;
        grantee_type: unknown;
        grantee_id: unknown;
        detail: unknown;
      }>(
        "SELECT subject_id, grantee_type, grantee_id, detail FROM audit_log WHERE action = ?",
        ["document.precondition_failed"],
      );
      assert.equal(rows.length, 3, "three refusals = three rows");

      const bySubject = new Map(rows.map((r) => [r.subject_id, r]));
      const a = bySubject.get("workspace/doc-a");
      assert.ok(a, "doc-a refusal row must exist");
      assert.deepEqual(
        JSON.parse(a!.detail as string),
        { method: "PUT", sent: aCur - 1, current: aCur },
        "stale PUT detail",
      );
      assert.equal(a!.grantee_type, null, "grantee_type must be NULL");
      assert.equal(a!.grantee_id, null, "grantee_id must be NULL");

      const b = bySubject.get("workspace/doc-b");
      assert.ok(b, "doc-b refusal row must exist");
      assert.deepEqual(
        JSON.parse(b!.detail as string),
        { method: "PUT", sent: "*", current: bCur },
        "createOnly refusal detail",
      );

      const c = bySubject.get("workspace/doc-c");
      assert.ok(c, "doc-c refusal row must exist");
      assert.deepEqual(
        JSON.parse(c!.detail as string),
        { method: "DELETE", sent: cCur - 1, current: cCur },
        "stale DELETE detail",
      );

      // A matching-PUT success writes no row.
      await store.put(
        { kind: "workspace", id: "doc-a", payload: { v: "ok" } },
        aCur, // matching
      );
      const after = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = ?",
        ["document.precondition_failed"],
      );
      assert.equal(after!.n, 3, "a success must not add an audit row");
    } finally {
      await cleanup();
    }
  });

  it("a member removed and added again does not restart the author's revisions", async () => {
    const orgs = createOrgsRepository(db);
    const ORG = "org-1";
    const MEMBER_A = "user-a";
    const FOUNDER = "user-founder";
    await orgs.createOrg({
      id: ORG,
      slug: "acme",
      name: "Acme",
      createdBy: FOUNDER,
    });
    await orgs.addMember(ORG, MEMBER_A, "member");
    const store = createOwnerDocumentsStore(db, ORG, MEMBER_A);
    try {
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "1" } });
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "2" } });
      const n = (await store.get("workspace", "doc-1")).value!.rev;

      // Member removal deletes the member's documents, but must NOT touch the
      // counter (a re-added member, or a doc under a re-created project, would
      // otherwise restart).
      await orgs.removeMember(ORG, MEMBER_A, { actorId: FOUNDER });
      const counter = await db.get<{ last_rev: number } | undefined>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        [ORG, MEMBER_A],
      );
      assert.ok(counter, "the counter row must survive member removal");
      assert.ok(
        counter!.last_rev >= n,
        "counter must be >= the last rev written",
      );

      // Re-add the member and write the same document again: rev must exceed n.
      await orgs.addMember(ORG, MEMBER_A, "member");
      const re = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "3" },
      });
      assert.equal(re.success, true);
      assert.ok(
        re.value.rev > n,
        `re-created rev ${re.value.rev} must exceed the pre-removal rev ${n}`,
      );
      const after = await db.get<{ last_rev: number }>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        [ORG, MEMBER_A],
      );
      assert.ok(
        after!.last_rev >= n,
        "the counter row endures past re-creation",
      );
    } finally {
      await cleanup();
    }
  });

  it("a tenant's documents deleted through deleteDocumentsOfOwner do not restart the author's revisions", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    try {
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "1" } });
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "2" } });
      const n = (await store.get("workspace", "doc-1")).value!.rev;

      // Delete the owner's documents the same way an org delete does: through
      // the session, inside a transaction. The counter must not be touched.
      await db.transaction(async (tx) => {
        await deleteDocumentsOfOwner(tx, "user-1");
      });
      const counter = await db.get<{ last_rev: number } | undefined>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        ["user-1", "user-1"],
      );
      assert.ok(counter, "the counter row must survive deleteDocumentsOfOwner");
      assert.ok(
        counter!.last_rev >= n,
        "counter must be >= the last rev written",
      );

      // Write the same document again: rev must exceed n (not restart at 1).
      const re = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "3" },
      });
      assert.equal(re.success, true);
      assert.ok(
        re.value.rev > n,
        `re-created rev ${re.value.rev} must exceed the pre-delete rev ${n}`,
      );
    } finally {
      await cleanup();
    }
  });

  it("C. two writers started together get two different revs; the counter ends at the larger", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    try {
      // Seed doc-1; the counter is now at the seed's rev.
      const seedResult = await store.put({
        kind: "workspace",
        id: "seed",
        payload: { v: "s" },
      });
      assert.equal(seedResult.success, true);
      const seedRev = seedResult.value.rev;
      const before = await db.get<{ last_rev: number }>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        ["user-1", "user-1"],
      );
      assert.ok(before, "the seed put must have raised the counter");
      const counterBefore = before!.last_rev;
      assert.equal(counterBefore, seedRev);

      // Postgres can exhaust the seam's five retries under contention, so run
      // fewer concurrent writers there; SQLite serialises them on one connection.
      const N = db.dialect === "postgres" ? 4 : 8;
      const half = N / 2;
      type Res =
        | { ok: true; id: string; rev: number }
        | { ok: false; id: string; reason: string };
      const batch: Promise<Res>[] = [];
      // `half` new documents (each inserts a new key).
      for (let i = 0; i < half; i++) {
        const id = `new-${i}`;
        batch.push(
          store
            .put({ kind: "workspace", id, payload: { v: i } })
            .then(
              (r): Res =>
                r.success
                  ? { ok: true, id, rev: r.value.rev }
                  : { ok: false, id, reason: r.error.kind },
            ),
        );
      }
      // `half` conditional updates of the SAME existing document, each betting
      // on the seed rev. Exactly one can win; the rest are refused as stale, or
      // — rarely on Postgres — retried to exhaustion.
      for (let i = 0; i < half; i++) {
        batch.push(
          store
            .put({ kind: "workspace", id: "seed", payload: { v: i } }, seedRev)
            .then(
              (r): Res =>
                r.success
                  ? { ok: true, id: "seed", rev: r.value.rev }
                  : { ok: false, id: "seed", reason: r.error.kind },
            ),
        );
      }
      const results = await Promise.all(batch);

      const successes = results.filter(
        (r): r is { ok: true; id: string; rev: number } => r.ok,
      );
      const refusals = results.filter((r) => !r.ok && r.reason === "Conflict");
      const exhausted = results.filter(
        (r) => !r.ok && r.reason === "SerializationFailed",
      );
      // successes + stale-409 refusals + retry-exhausted must account for all N.
      assert.equal(
        successes.length + refusals.length + exhausted.length,
        N,
        "every writer must resolve (success, stale-409, or retry-exhausted)",
      );
      assert.ok(successes.length >= 2, "at least two writers must succeed");

      // (a) every successful rev is distinct;
      const revs = successes.map((r) => r.rev);
      assert.equal(
        new Set(revs).size,
        revs.length,
        "successful revs must be distinct",
      );
      // (b) none is at or below the counter before the race;
      assert.ok(
        revs.every((r) => r > counterBefore),
        "every rev must exceed the pre-race counter",
      );
      // (c) the counter ends at the largest rev handed out;
      const after = await db.get<{ last_rev: number }>(
        "SELECT last_rev FROM owner_document_revs WHERE owner_id = ? AND user_id = ?",
        ["user-1", "user-1"],
      );
      assert.equal(
        after!.last_rev,
        Math.max(...revs),
        "counter ends at the largest rev",
      );
      // (d) each successful writer's stored row carries the rev it was told;
      for (const r of successes) {
        const row = await db.get<{ rev: number }>(
          "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
          ["user-1", "user-1", "workspace", r.id],
        );
        assert.ok(row, `stored row for ${r.id} must exist`);
        assert.equal(
          row!.rev,
          r.rev,
          `stored rev of ${r.id} must match its writer's rev`,
        );
      }
    } finally {
      await cleanup();
    }
  });
});
