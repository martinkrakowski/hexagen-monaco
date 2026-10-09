import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import {
  createOwnerDocumentsStore,
  listDocumentsAuthoredBy,
} from "../owner-documents-store";
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

  it("listDocumentsAuthoredBy returns every document the user authored across tenants, with payloads parsed and others excluded", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test-org", name: "Test Org", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    try {
      // Personal tenant: user-a authors two kinds.
      const personal = createOwnerDocumentsStore(
        platformDb,
        "user-a",
        "user-a",
      );
      await personal.put({
        kind: "workspace",
        id: "p-ws",
        payload: { v: 1 },
      });
      await personal.put({
        kind: "governance",
        id: "p-gov",
        payload: { v: 2 },
      });

      // Org tenant: user-a (a member) authors one kind.
      const orgDocs = createOwnerDocumentsStore(platformDb, "org-1", "user-a");
      await orgDocs.put({
        kind: "canvas-layout",
        id: "o-cl",
        payload: { v: 3 },
      });

      // Another user's personal document must not appear.
      const other = createOwnerDocumentsStore(platformDb, "user-b", "user-b");
      await other.put({
        kind: "workspace",
        id: "x-ws",
        payload: { v: 99 },
      });

      const res = await listDocumentsAuthoredBy(
        platformDb,
        "user-a",
        100,
        1_000_000_000,
      );
      assert.equal(res.items.length, 3);
      assert.equal(res.truncatedBy, null);
      const byKey = new Set(
        res.items.map((r) => `${r.ownerId}:${r.kind}:${r.id}`),
      );
      assert.ok(byKey.has("user-a:workspace:p-ws"));
      assert.ok(byKey.has("user-a:governance:p-gov"));
      assert.ok(byKey.has("org-1:canvas-layout:o-cl"));
      assert.equal(
        res.items.find((r) => r.id === "x-ws"),
        undefined,
        "another user's documents must not be returned",
      );
      assert.deepEqual(
        res.items.find((r) => r.id === "p-ws")!.payload,
        { v: 1 },
        "payloads must round-trip",
      );
      assert.deepEqual(
        res.items.find((r) => r.id === "o-cl")!.payload,
        { v: 3 },
        "org tenant payloads must round-trip",
      );
    } finally {
      db.close();
    }
  });

  it("listDocumentsAuthoredBy flags a row whose payload fails to parse, and leaves a genuine JSON null unflagged, ordered by owner_id, kind, id", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    try {
      const insert = (id: string, kind: string, payload: string, ts: number) =>
        platformDb.run(
          `INSERT INTO owner_documents
             (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ["org-1", "user-a", kind, id, null, 1, payload, ts, "user-a"],
        );
      await insert("bad-ws", "workspace", "not-json{", 1);
      await insert("bad-gov", "governance", "also-not-json", 2);
      // A real, round-trippable JSON `null`: parses to null, no failure.
      await insert("null-doc", "workspace", "null", 3);

      const res = await listDocumentsAuthoredBy(
        platformDb,
        "user-a",
        100,
        1_000_000_000,
      );
      assert.equal(
        res.items.length,
        3,
        "no row may be dropped for an unparseable payload",
      );
      assert.equal(res.truncatedBy, null);
      // ORDER BY owner_id, kind, id -> governance, then workspace by id.
      assert.equal(res.items[0].kind, "governance");
      assert.equal(res.items[0].id, "bad-gov");
      assert.equal(res.items[0].payload, null);
      assert.equal(res.items[0].payloadUnparseable, true);
      assert.equal(res.items[1].kind, "workspace");
      assert.equal(res.items[1].id, "bad-ws");
      assert.equal(res.items[1].payload, null);
      assert.equal(res.items[1].payloadUnparseable, true);
      assert.equal(res.items[2].kind, "workspace");
      assert.equal(res.items[2].id, "null-doc");
      assert.equal(res.items[2].payload, null);
      assert.equal(
        res.items[2].payloadUnparseable,
        undefined,
        "a genuine JSON null must not be flagged",
      );
    } finally {
      db.close();
    }
  });

  it("listDocumentsAuthoredBy cuts by the maxChars budget before the row that would exceed it", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const docs = createOwnerDocumentsStore(platformDb, "user-a", "user-a");
    try {
      const p1 = { v: "aaa" };
      const p2 = { v: "bbbbb" };
      const p3 = { v: "ccccccc" };
      const len = (p: unknown) => JSON.stringify(p).length;
      await docs.put({ kind: "workspace", id: "d-1", payload: p1 });
      await docs.put({ kind: "workspace", id: "d-2", payload: p2 });
      await docs.put({ kind: "workspace", id: "d-3", payload: p3 });

      // A budget that fits exactly the first two payloads: two items, in order,
      // size-truncated, payloads round-trip.
      const fitsTwo = await listDocumentsAuthoredBy(
        platformDb,
        "user-a",
        100,
        len(p1) + len(p2),
      );
      assert.equal(fitsTwo.items.length, 2);
      assert.equal(fitsTwo.truncatedBy, "size");
      assert.deepEqual(
        fitsTwo.items.map((r) => r.id),
        ["d-1", "d-2"],
        "kept rows must stay in ORDER BY order",
      );
      assert.deepEqual(fitsTwo.items[0].payload, p1);
      assert.deepEqual(fitsTwo.items[1].payload, p2);

      // A budget smaller than the first payload: nothing kept, still truncated.
      const belowFirst = await listDocumentsAuthoredBy(
        platformDb,
        "user-a",
        100,
        len(p1) - 1,
      );
      assert.equal(belowFirst.items.length, 0);
      assert.equal(belowFirst.truncatedBy, "size");
    } finally {
      db.close();
    }
  });

  it("listDocumentsAuthoredBy reports the size cut when both ceilings are passed, and the row cut when only that one is", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const docs = createOwnerDocumentsStore(platformDb, "user-a", "user-a");
    try {
      const p = { v: "aaa" };
      const len = JSON.stringify(p).length;
      for (const id of ["d-1", "d-2", "d-3", "d-4"]) {
        await docs.put({ kind: "workspace", id, payload: p });
      }
      // Four stored, limit three (so the row ceiling is passed), and a budget
      // that fits one: the size cut decided, and one item is kept.
      const both = await listDocumentsAuthoredBy(platformDb, "user-a", 3, len);
      assert.equal(both.items.length, 1);
      assert.equal(both.truncatedBy, "size");
      // The same rows with room for all three: only the row ceiling was passed.
      const rowsOnly = await listDocumentsAuthoredBy(
        platformDb,
        "user-a",
        3,
        len * 10,
      );
      assert.equal(rowsOnly.items.length, 3);
      assert.equal(rowsOnly.truncatedBy, "rows");
    } finally {
      db.close();
    }
  });

  it("listDocumentsAuthoredBy rejects a non-integer or negative limit or maxChars with RangeError", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    try {
      const MAX = 100;
      for (const bad of [-1, 1.5]) {
        await assert.rejects(
          () => listDocumentsAuthoredBy(platformDb, "user-a", bad, MAX),
          RangeError,
          `limit ${bad} must throw RangeError`,
        );
        await assert.rejects(
          () => listDocumentsAuthoredBy(platformDb, "user-a", MAX, bad),
          RangeError,
          `maxChars ${bad} must throw RangeError`,
        );
      }
    } finally {
      db.close();
    }
  });
});
