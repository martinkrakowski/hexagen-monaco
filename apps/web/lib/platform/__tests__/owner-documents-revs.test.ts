// @vitest-environment node
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createTestPgDb } from "../../../test-support/pg-test-db";
import type { PlatformDb } from "../db";
import { createOwnerDocumentsStore } from "../owner-documents-store";
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
    cleanup: async () => handle.close(),
  };
}

async function makePg(): Promise<Backend> {
  const result = await createTestPgDb();
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
  ["postgres", makePg],
];

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

  it("9. a refused precondition writes one row whose detail is {method, sent, current}; a success writes none", async () => {
    const store = createOwnerDocumentsStore(db, "user-1", "user-1");
    try {
      // Three documents, each written twice. They share this author's counter,
      // so doc-a reaches rev 2, doc-b rev 4, doc-c rev 6.
      for (const id of ["doc-a", "doc-b", "doc-c"]) {
        await store.put({ kind: "workspace", id, payload: { v: "1" } });
        await store.put({ kind: "workspace", id, payload: { v: "2" } });
      }
      const aCur = (await store.get("workspace", "doc-a")).value!.rev;
      const bCur = (await store.get("workspace", "doc-b")).value!.rev;
      const cCur = (await store.get("workspace", "doc-c")).value!.rev;

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
        { method: "put", sent: aCur - 1, current: aCur },
        "stale PUT detail",
      );
      assert.equal(a!.grantee_type, null, "grantee_type must be NULL");
      assert.equal(a!.grantee_id, null, "grantee_id must be NULL");

      const b = bySubject.get("workspace/doc-b");
      assert.ok(b, "doc-b refusal row must exist");
      assert.deepEqual(
        JSON.parse(b!.detail as string),
        { method: "put", sent: null, current: bCur },
        "createOnly refusal detail",
      );

      const c = bySubject.get("workspace/doc-c");
      assert.ok(c, "doc-c refusal row must exist");
      assert.deepEqual(
        JSON.parse(c!.detail as string),
        { method: "delete", sent: cCur - 1, current: cCur },
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
});
