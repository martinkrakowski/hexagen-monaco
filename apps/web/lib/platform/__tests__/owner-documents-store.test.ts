import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createOwnerDocumentsStore } from "../owner-documents-store";
import type { PlatformDbSession } from "../db";
import type { DocumentKind } from "../owner-documents-store";
import { createSavedProjectsStore } from "../saved-projects-store";
import { createOrgsRepository } from "../orgs-store";
import type { SavedProject } from "@hexagen/shared";

function project(id: string): SavedProject {
  return {
    id,
    name: "test-project",
    createdAt: 1,
    updatedAt: 1,
    formState: {},
  } as unknown as SavedProject;
}

function docCount(
  db: ReturnType<typeof openPlatformDb>,
  ownerId: string,
  userId: string,
  projectId: string | null = null,
): number {
  if (projectId === null) {
    return (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ?",
        )
        .get(ownerId, userId) as { n: number }
    ).n;
  }
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND project_id = ?",
      )
      .get(ownerId, userId, projectId) as { n: number }
  ).n;
}

function auditCount(
  db: ReturnType<typeof openPlatformDb>,
  action = "document.precondition_failed",
): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?")
      .get(action) as { n: number }
  ).n;
}

describe("owner-documents store", () => {
  it("a document put with no row is rev 1, and is read back unchanged", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const payload = { text: "hello", nested: { value: 42 } };
      const result = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload,
        projectId: null,
      });
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.value.rev, 1);
      assert.equal(result.value.kind, "workspace");
      assert.equal(result.value.id, "doc-1");
      assert.equal(result.value.projectId, null);

      const fetched = await store.get("workspace", "doc-1");
      assert.equal(fetched.success, true);
      if (!fetched.success) return;
      assert.ok(fetched.value, "the document must exist");
      if (!fetched.value) return;
      assert.deepEqual(fetched.value.payload, payload);
      assert.equal(fetched.value.rev, 1);
    } finally {
      db.close();
    }
  });

  it("each put moves rev by exactly one and returns the rev it wrote", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const payload = { v: "first" };
      const first = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload,
      });
      assert.equal(first.success, true);
      if (!first.success) return;
      assert.equal(first.value.rev, 1);

      const second = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "second" },
      });
      assert.equal(second.success, true);
      if (!second.success) return;
      assert.equal(second.value.rev, 2);

      const third = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "third" },
      });
      assert.equal(third.success, true);
      if (!third.success) return;
      assert.equal(third.value.rev, 3);

      const stored = db
        .prepare(
          "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(stored.rev, 3);
    } finally {
      db.close();
    }
  });

  it("two unconditional puts started together get revs 2 and 3", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      // Seed a row at rev 1.
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "seed" },
      });

      const [a, b] = await Promise.all([
        store.put({
          kind: "workspace",
          id: "doc-1",
          payload: { v: "a" },
        }),
        store.put({
          kind: "workspace",
          id: "doc-1",
          payload: { v: "b" },
        }),
      ]);
      assert.equal(a.success, true);
      assert.equal(b.success, true);
      const revs = [a, b].map((r) => (r.success ? r.value.rev : -1)).sort();
      assert.deepEqual(revs, [2, 3]);

      const stored = db
        .prepare(
          "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(stored.rev, 3);
    } finally {
      db.close();
    }
  });

  it("two unconditional puts of a new id started together get revs 1 and 2, and the row exists once", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const [a, b] = await Promise.all([
        store.put({
          kind: "workspace",
          id: "doc-1",
          payload: { v: "a" },
        }),
        store.put({
          kind: "workspace",
          id: "doc-1",
          payload: { v: "b" },
        }),
      ]);
      assert.equal(a.success, true);
      assert.equal(b.success, true);
      const revs = [a, b].map((r) => (r.success ? r.value.rev : -1)).sort();
      assert.deepEqual(revs, [1, 2]);

      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { n: number };
      assert.equal(count.n, 1, "the row must exist exactly once");
    } finally {
      db.close();
    }
  });

  it("a stale expectedRev is a Conflict and leaves the row untouched", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const payload = { v: "original" };
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload,
      });

      const first = await store.put(
        {
          kind: "workspace",
          id: "doc-1",
          payload: { v: "updated" },
        },
        1,
      );
      assert.equal(first.success, true);
      if (!first.success) return;
      assert.equal(first.value.rev, 2);

      // A second seat still holding rev 1.
      const stale = await store.put(
        {
          kind: "workspace",
          id: "doc-1",
          payload: { v: "stale" },
        },
        1,
      );
      assert.equal(stale.success, false);
      if (!stale.success) assert.equal(stale.error.kind, "Conflict");

      // The row must be untouched by the refused write.
      const row = db
        .prepare(
          `SELECT payload, rev FROM owner_documents
            WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?`,
        )
        .get("user-1", "user-1", "workspace", "doc-1") as {
        payload: string;
        rev: number;
      };
      assert.equal(row.rev, 2, "a refused write must not move rev");
      assert.deepEqual(JSON.parse(row.payload), { v: "updated" });
    } finally {
      db.close();
    }
  });

  it("an expectedRev with no row is NotFound and writes nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const result = await store.put(
        {
          kind: "workspace",
          id: "doc-1",
          payload: { v: "new" },
        },
        999,
      );
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error.kind, "NotFound");

      assert.equal(
        docCount(db, "user-1", "user-1"),
        0,
        "no row must be written",
      );
    } finally {
      db.close();
    }
  });

  it("a second author under the same owner reads, lists and deletes nothing of the first's", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrg({
      id: "org-1",
      slug: "test-org",
      name: "Test Org",
      createdBy: "user-a",
    });
    await orgs.addMember("org-1", "user-a", "owner");
    await orgs.addMember("org-1", "user-b", "member");
    const firstAuthor = createOwnerDocumentsStore(
      platformDb,
      "org-1",
      "user-a",
    );
    const secondAuthor = createOwnerDocumentsStore(
      platformDb,
      "org-1",
      "user-b",
    );
    try {
      const result = await firstAuthor.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "owned by user-a" },
      });
      assert.equal(result.success, true);

      // Second author cannot read it.
      const fetched = await secondAuthor.get("workspace", "doc-1");
      assert.equal(fetched.success, true);
      if (!fetched.success) return;
      assert.equal(fetched.value, null);

      // Second author does not list it.
      const listed = await secondAuthor.list();
      assert.equal(listed.success, true);
      if (!listed.success) return;
      assert.equal(listed.value.length, 0);

      // Second author's delete hits nothing.
      const deleted = await secondAuthor.delete("workspace", "doc-1");
      assert.equal(deleted.success, true);
      if (!deleted.success) return;
      assert.equal(deleted.value.deleted, false);

      // First author can still read it.
      const stillThere = await firstAuthor.get("workspace", "doc-1");
      assert.equal(stillThere.success, true);
      if (!stillThere.success) return;
      assert.ok(stillThere.value, "the first author's document must survive");
    } finally {
      db.close();
    }
  });

  it("a second owner reads nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const firstOwner = createOwnerDocumentsStore(
      platformDb,
      "user-a",
      "user-a",
    );
    const secondOwner = createOwnerDocumentsStore(
      platformDb,
      "user-b",
      "user-b",
    );
    try {
      await firstOwner.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "owned by user-a" },
      });

      // Second owner cannot read it.
      const fetched = await secondOwner.get("workspace", "doc-1");
      assert.equal(fetched.success, true);
      if (!fetched.success) return;
      assert.equal(fetched.value, null);

      // Second owner does not list it.
      const listed = await secondOwner.list();
      assert.equal(listed.success, true);
      if (!listed.success) return;
      assert.equal(listed.value.length, 0);
    } finally {
      db.close();
    }
  });

  it("list filters by kind and by project, newest first, without payloads", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const seam = platformDb;
    const projects = createSavedProjectsStore(seam, "user-1");
    const store = createOwnerDocumentsStore(seam, "user-1", "user-1");
    try {
      const projA = project("proj-a");
      await projects.createProjectRecord(projA);
      const projB = project("proj-b");
      await projects.createProjectRecord(projB);

      await store.put(
        {
          kind: "workspace",
          id: "doc-a-1",
          payload: { v: "a1" },
          projectId: "proj-a",
        },
        undefined,
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      await store.put(
        {
          kind: "governance",
          id: "doc-g-1",
          payload: { v: "g1" },
          projectId: "proj-a",
        },
        undefined,
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      await store.put(
        {
          kind: "workspace",
          id: "doc-a-2",
          payload: { v: "a2" },
          projectId: "proj-b",
        },
        undefined,
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      await store.put(
        {
          kind: "canvas-layout",
          id: "doc-c-1",
          payload: { v: "c1" },
        },
        undefined,
      );

      // Filter by kind: workspace only, ordered by updated_at DESC.
      const byKind = await store.list({ kind: "workspace" });
      assert.equal(byKind.success, true);
      if (!byKind.success) return;
      assert.equal(byKind.value.length, 2);
      assert.ok(
        byKind.value.every((d) => d.kind === "workspace"),
        "every listed doc must match the kind filter",
      );

      // Filter by project.
      const byProject = await store.list({ projectId: "proj-a" });
      assert.equal(byProject.success, true);
      if (!byProject.success) return;
      assert.equal(byProject.value.length, 2);
      assert.ok(byProject.value.every((d) => d.projectId === "proj-a"));

      // No filter returns all.
      const all = await store.list();
      assert.equal(all.success, true);
      if (!all.success) return;
      assert.equal(all.value.length, 4);

      // Newest first (doc-a-2 was written last, so it must lead among workspace docs).
      assert.equal(byKind.value[0]?.id, "doc-a-2");

      // Summaries must not carry a payload key.
      assert.ok(
        !("payload" in byKind.value[0]),
        "list must not return payloads",
      );
    } finally {
      db.close();
    }
  });

  it("invalid kind, id, projectId and payload are InvalidInput and write nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const circular: { self?: unknown } = {};
      circular.self = circular;

      const tooLong = "x".repeat(2_000_001);

      const cases: Array<{
        name: string;
        input: {
          kind: unknown;
          id: unknown;
          projectId?: unknown;
          payload: unknown;
        };
      }> = [
        {
          name: "invalid kind",
          input: {
            kind: "bogus" as never,
            id: "doc-1",
            payload: { ok: true },
          },
        },
        {
          name: "invalid id",
          input: {
            kind: "workspace",
            id: "has spaces",
            payload: { ok: true },
          },
        },
        {
          name: "invalid projectId",
          input: {
            kind: "workspace",
            id: "doc-1",
            projectId: "has spaces",
            payload: { ok: true },
          },
        },
        {
          name: "undefined payload",
          input: {
            kind: "workspace",
            id: "doc-1",
            payload: undefined,
          },
        },
        {
          name: "non-serializable payload",
          input: {
            kind: "workspace",
            id: "doc-1",
            payload: circular,
          },
        },
        {
          name: "payload too long",
          input: {
            kind: "workspace",
            id: "doc-1",
            payload: tooLong,
          },
        },
      ];

      for (const c of cases) {
        const result = await store.put(
          c.input as {
            kind: DocumentKind;
            id: string;
            projectId?: string | null;
            payload: unknown;
          },
        );
        assert.equal(result.success, false, `${c.name} must be rejected`);
        if (!result.success) {
          assert.equal(
            result.error.kind,
            "InvalidInput",
            `${c.name}: ${result.error.message}`,
          );
        }
      }

      assert.equal(
        docCount(db, "user-1", "user-1"),
        0,
        "no invalid write must land",
      );
    } finally {
      db.close();
    }
  });

  it("a projectId that names no project in this tenant is UnknownProject and writes nothing (also: another owner's project is still UnknownProject)", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    const otherStore = createOwnerDocumentsStore(
      platformDb,
      "user-2",
      "user-2",
    );
    try {
      // Create a project under owner-2.
      await createSavedProjectsStore(platformDb, "user-2").createProjectRecord(
        project("proj-other"),
      );
      // Positive control: its own tenant can attach a document to it, so the
      // refusals below are about the tenant and not about the project id.
      const own = await otherStore.put({
        kind: "workspace",
        id: "doc-own",
        payload: {},
        projectId: "proj-other",
      });
      assert.equal(own.success, true);

      // projectId that names no project in this tenant: UnknownProject.
      const missing = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
        projectId: "proj-missing",
      });
      assert.equal(missing.success, false);
      if (!missing.success) assert.equal(missing.error.kind, "UnknownProject");
      assert.equal(docCount(db, "user-1", "user-1"), 0);

      // projectId that exists under ANOTHER owner: still UnknownProject.
      const foreign = await store.put({
        kind: "workspace",
        id: "doc-2",
        payload: {},
        projectId: "proj-other",
      });
      assert.equal(foreign.success, false);
      if (!foreign.success) assert.equal(foreign.error.kind, "UnknownProject");
      assert.equal(docCount(db, "user-1", "user-1"), 0);

      // The other tenant holds its one control document and nothing else.
      assert.equal(docCount(db, "user-2", "user-2"), 1);
    } finally {
      db.close();
    }
  });

  it("a put without projectId detaches the document from its project", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const projects = createSavedProjectsStore(platformDb, "user-1");
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      await projects.createProjectRecord(project("proj-a"));

      const attached = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "attached" },
        projectId: "proj-a",
      });
      assert.equal(attached.success, true);
      if (!attached.success) return;
      assert.equal(attached.value.projectId, "proj-a");

      const detached = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "detached" },
      });
      assert.equal(detached.success, true);
      if (!detached.success) return;
      assert.equal(detached.value.projectId, null);
      // The returned value echoes the input; the row is what must have changed.
      const row = db
        .prepare(
          "SELECT project_id FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as {
        project_id: string | null;
      };
      assert.equal(row.project_id, null);
      const reread = await store.get("workspace", "doc-1");
      assert.equal(reread.success && reread.value?.projectId, null);
    } finally {
      db.close();
    }
  });

  it("delete reports whether a row went", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "to be deleted" },
      });

      const gone = await store.delete("workspace", "doc-1");
      assert.equal(gone.success, true);
      if (!gone.success) return;
      assert.equal(gone.value.deleted, true);

      const again = await store.delete("workspace", "doc-1");
      assert.equal(again.success, true);
      if (!again.success) return;
      assert.equal(again.value.deleted, false);
    } finally {
      db.close();
    }
  });

  it("a put by an author who is not a member of the org is NotAMember and writes nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    // user-b is NOT a member.
    const store = createOwnerDocumentsStore(platformDb, "org-1", "user-b");
    try {
      const result = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
      });
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error.kind, "NotAMember");
      assert.equal(
        docCount(db, "org-1", "user-b"),
        0,
        "no row must be written",
      );
    } finally {
      db.close();
    }
  });

  it("a put in a personal tenant needs no membership", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const result = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
      });
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.value.rev, 1);
    } finally {
      db.close();
    }
  });

  it("a put started together with the author's removal writes nothing that survives (removal first)", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    const store = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
    try {
      // Seed one document so (org-1, user-a) has a row to begin with.
      await store.put({
        kind: "workspace",
        id: "seed",
        payload: {},
      });

      const [removed, putResult] = await Promise.all([
        orgs.removeMember("org-1", "user-a", { actorId: "founder" }),
        store.put({
          kind: "workspace",
          id: "second",
          payload: {},
        }),
      ]);
      assert.equal(removed, undefined);
      assert.equal(putResult.success, false);
      if (!putResult.success) assert.equal(putResult.error.kind, "NotAMember");
      assert.equal(
        docCount(db, "org-1", "user-a"),
        0,
        "no document for a removed member may survive",
      );
    } finally {
      db.close();
    }
  });

  it("a put started together with the author's removal writes nothing that survives (put first)", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    const store = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
    try {
      // Seed one document so (org-1, user-a) has a row to begin with.
      await store.put({
        kind: "workspace",
        id: "seed",
        payload: {},
      });

      const [putResult] = await Promise.all([
        store.put({
          kind: "workspace",
          id: "second",
          payload: {},
        }),
        orgs.removeMember("org-1", "user-a", { actorId: "founder" }),
      ]);
      assert.equal(putResult.success, true, "the put lands before the removal");
      if (!putResult.success) return;
      assert.equal(putResult.value.rev, 1);
      assert.equal(
        docCount(db, "org-1", "user-a"),
        0,
        "the put landed, then the removal deleted it",
      );
    } finally {
      db.close();
    }
  });

  it("a put started together with the org's deletion writes nothing that survives", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    const store = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
    try {
      // Seed one document.
      await store.put({
        kind: "workspace",
        id: "seed",
        payload: {},
      });

      const [, putResult] = await Promise.all([
        orgs.deleteOrg("org-1", { actorId: "founder" }),
        store.put({
          kind: "workspace",
          id: "second",
          payload: {},
        }),
      ]);
      assert.equal(putResult.success, false);
      if (!putResult.success) assert.equal(putResult.error.kind, "NotAMember");
      assert.equal(
        docCount(db, "org-1", "user-a"),
        0,
        "no document for a deleted org may survive",
      );
    } finally {
      db.close();
    }
  });

  it("create-only on an absent row creates rev 1", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const result = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "a" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(result.success, true);
      if (!result.success) return;
      assert.equal(result.value.rev, 1);
    } finally {
      db.close();
    }
  });

  it("create-only on an existing row returns PreconditionFailed with the current rev and changes nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      // Put twice -> rev 2.
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "A" } });
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "B" } });

      const result = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "C" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.kind, "PreconditionFailed");
        assert.equal(result.error.currentRev, 2);
      }

      const row = db
        .prepare(
          "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as {
        payload: string;
        rev: number;
      };
      assert.deepEqual(JSON.parse(row.payload), { v: "B" });
      assert.equal(row.rev, 2, "the existing row must be untouched");
    } finally {
      db.close();
    }
  });

  it("create-only by a second author in the same org succeeds and leaves the first author's row alone", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrg({
      id: "org-1",
      slug: "test-org",
      name: "Test Org",
      createdBy: "user-a",
    });
    await orgs.addMember("org-1", "user-a", "owner");
    await orgs.addMember("org-1", "user-b", "member");
    const firstAuthor = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
    const secondAuthor = createOwnerDocumentsStore(platformDb, "org-1", "user-b");
    try {
      // First author creates a row at rev 1.
      const first = await firstAuthor.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "owned by user-a" },
      });
      assert.equal(first.success, true);

      // Second author's createOnly on the SAME kind/id succeeds (the key
      // includes user_id, so there is no conflict) — catches a missing
      // user_id in the ON CONFLICT target.
      const second = await secondAuthor.put(
        { kind: "workspace", id: "doc-1", payload: { v: "owned by user-b" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(second.success, true);
      if (!second.success) return;
      assert.equal(second.value.rev, 1);

      // The first author's row must be untouched.
      const aRow = db
        .prepare(
          "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("org-1", "user-a", "workspace", "doc-1") as {
        payload: string;
        rev: number;
      };
      assert.deepEqual(JSON.parse(aRow.payload), { v: "owned by user-a" });
      assert.equal(aRow.rev, 1);
    } finally {
      db.close();
    }
  });

  it("create-only by a non-member is NotAMember, not exists, and writes nothing", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    // Plant a row for (org-1, user-b) so "exists" would be the wrong answer if
    // the membership check did not run first.
    db.prepare(
      `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("org-1", "user-b", "workspace", "doc-1", null, 1, "{}", 1, "user-b");
    const store = createOwnerDocumentsStore(platformDb, "org-1", "user-b");
    try {
      const result = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "new" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(result.success, false);
      if (!result.success) assert.equal(result.error.kind, "NotAMember");

      // The row must be unchanged and no audit row written.
      const row = db
        .prepare(
          "SELECT rev, payload FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("org-1", "user-b", "workspace", "doc-1") as {
        rev: number;
        payload: string;
      };
      assert.equal(row.rev, 1);
      assert.deepEqual(JSON.parse(row.payload), {});
      assert.equal(
        auditCount(db),
        0,
        "a NotAMember refusal writes no audit row",
      );
    } finally {
      db.close();
    }
  });

  it("two create-only puts started together: one creates, one is refused, one row", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      const [a, b] = await Promise.all([
        store.put(
          { kind: "workspace", id: "doc-1", payload: { v: "a" } },
          undefined,
          { createOnly: true },
        ),
        store.put(
          { kind: "workspace", id: "doc-1", payload: { v: "b" } },
          undefined,
          { createOnly: true },
        ),
      ]);

      const successes = [a, b].filter((r) => r.success);
      const refusals = [a, b].filter((r) => !r.success);
      assert.equal(successes.length, 1, "exactly one must create the row");
      assert.equal(refusals.length, 1, "exactly one must be refused");

      const count = db
        .prepare(
          "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { n: number };
      assert.equal(count.n, 1, "the row must exist exactly once");
    } finally {
      db.close();
    }
  });

  it("conditional delete with the right rev deletes; with a stale rev deletes nothing and reports the current rev; on an absent row reports NotFound", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "to delete" },
      });

      // Matching rev deletes.
      const matched = await store.delete("workspace", "doc-1", 1);
      assert.equal(matched.success, true);
      if (!matched.success) return;
      assert.equal(matched.value.deleted, true);

      // Re-seed for the stale-rev case.
      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "again" } },
        undefined,
        { createOnly: true },
      );

      // Stale rev: nothing deleted, reports current rev.
      const stale = await store.delete("workspace", "doc-1", 999);
      assert.equal(stale.success, false);
      if (!stale.success) {
        assert.equal(stale.error.kind, "PreconditionFailed");
        assert.equal(stale.error.currentRev, 1);
      }
      const untouched = db
        .prepare(
          "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("user-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(untouched.rev, 1, "a refused delete must not touch the row");

      // Absent row: NotFound.
      const missing = await store.delete("workspace", "does-not-exist", 1);
      assert.equal(missing.success, false);
      if (!missing.success) assert.equal(missing.error.kind, "NotFound");
    } finally {
      db.close();
    }
  });

  it("conditional delete never touches another author's row with the same kind, id and rev", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrg({
      id: "org-1",
      slug: "test-org",
      name: "Test Org",
      createdBy: "user-a",
    });
    await orgs.addMember("org-1", "user-a", "member");
    await orgs.addMember("org-1", "user-b", "member");
    const authorA = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
    const authorB = createOwnerDocumentsStore(platformDb, "org-1", "user-b");
    try {
      // Both authors write their own row at rev 1, same kind/id.
      await authorA.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "A" },
      });
      await authorB.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "B" },
      });

      // A's delete at rev 1 must delete only A's row.
      const deleted = await authorA.delete("workspace", "doc-1", 1);
      assert.equal(deleted.success, true);
      if (!deleted.success) return;
      assert.equal(deleted.value.deleted, true);

      // B's row must survive.
      const bRow = db
        .prepare(
          "SELECT payload FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        )
        .get("org-1", "user-b", "workspace", "doc-1") as { payload: string };
      assert.deepEqual(JSON.parse(bRow.payload), { v: "B" });
    } finally {
      db.close();
    }
  });

  it("each refusal writes exactly one document.precondition_failed row with the detail, and success writes none", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    try {
      // Seed a row at rev 1, then bump to rev 2.
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } });
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "b" } });

      // Three refusals: stale PUT, create-only, conditional DELETE.
      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
        1, // stale rev
      );
      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "create" } },
        undefined,
        { createOnly: true },
      );
      await store.delete("workspace", "doc-1", 1); // stale rev

      assert.equal(auditCount(db), 3, "three refusals = three audit rows");

      // Verify the detail blob for each.
      const rows = db
        .prepare(
          `SELECT grantee_type, grantee_id, subject_owner_id, subject_id
             FROM audit_log WHERE action = ?
            ORDER BY created_at`,
        )
        .all("document.precondition_failed") as Array<{
        grantee_type: string;
        grantee_id: string;
        subject_owner_id: string;
        subject_id: string;
      }>;
      assert.equal(rows.length, 3);
      assert.deepEqual(JSON.parse(rows[0]!.grantee_id), {
        method: "PUT",
        sent: 1,
        current: 2,
      });
      assert.deepEqual(JSON.parse(rows[1]!.grantee_id), {
        method: "PUT",
        sent: "*",
        current: 2,
      });
      assert.deepEqual(JSON.parse(rows[2]!.grantee_id), {
        method: "DELETE",
        sent: 1,
        current: 2,
      });
      for (const r of rows) {
        assert.equal(r.grantee_type, "precondition");
        assert.equal(r.subject_owner_id, "user-1");
        assert.equal(r.subject_id, "workspace/doc-1");
      }

      // A matching-rev PUT, a createOnly on an absent id, a matching DELETE:
      // none of these write an audit row.
      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "ok" } },
        2, // matching
      );
      await store.put(
        { kind: "workspace", id: "doc-absent", payload: { v: "ok" } },
        undefined,
        { createOnly: true },
      );
      await store.delete("workspace", "doc-absent", 1); // matching

      assert.equal(
        auditCount(db),
        3,
        "a success must not add an audit row",
      );

      // An expectedRev PUT on an absent row (NotFound) writes no audit row.
      await store.put(
        { kind: "workspace", id: "doc-missing", payload: { v: "x" } },
        999,
      );
      assert.equal(
        auditCount(db),
        3,
        "a NotFound refusal must not add an audit row",
      );
    } finally {
      db.close();
    }
  });

  it("the conditional delete runs ONE delete statement carrying rev = ?", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    const realTransaction = platformDb.transaction.bind(platformDb);
    try {
      await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "seed" },
      });

      const ran: string[] = [];
      vi.spyOn(platformDb, "transaction").mockImplementation((fn) =>
        realTransaction(async (tx: PlatformDbSession) => {
          const wrapped: PlatformDbSession = {
            get: tx.get,
            all: tx.all,
            run: (sql, params) => {
              ran.push(sql);
              return tx.run(sql, params);
            },
          };
          return fn(wrapped);
        }),
      );

      await store.delete("workspace", "doc-1", 1);

      assert.ok(
        ran.some(
          (s) =>
            s.includes("DELETE FROM owner_documents") && s.includes("AND rev = ?"),
        ),
        "the delete must carry rev = ?",
      );
      assert.equal(
        ran.filter(
          (s) =>
            s.includes("DELETE FROM owner_documents") && !s.includes("user_id = ?"),
        ).length,
        0,
        "no DELETE may omit user_id = ?",
      );

      vi.restoreAllMocks();
    } finally {
      db.close();
    }
  });
});
