import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { createOwnerDocumentsStore } from "../owner-documents-store";
import type { DocumentKind } from "../owner-documents-store";
import { createSavedProjectsStore } from "../saved-projects-store";
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
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        .get("owner-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(stored.rev, 3);
    } finally {
      db.close();
    }
  });

  it("two unconditional puts started together get revs 2 and 3", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        .get("owner-1", "user-1", "workspace", "doc-1") as { rev: number };
      assert.equal(stored.rev, 3);
    } finally {
      db.close();
    }
  });

  it("two unconditional puts of a new id started together get revs 1 and 2, and the row exists once", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        .get("owner-1", "user-1", "workspace", "doc-1") as { n: number };
      assert.equal(count.n, 1, "the row must exist exactly once");
    } finally {
      db.close();
    }
  });

  it("a stale expectedRev is a Conflict and leaves the row untouched", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        .get("owner-1", "user-1", "workspace", "doc-1") as {
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
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        docCount(db, "owner-1", "user-1"),
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
    const firstAuthor = createOwnerDocumentsStore(
      platformDb,
      "owner-1",
      "user-a",
    );
    const secondAuthor = createOwnerDocumentsStore(
      platformDb,
      "owner-1",
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
      "owner-a",
      "user-1",
    );
    const secondOwner = createOwnerDocumentsStore(
      platformDb,
      "owner-b",
      "user-1",
    );
    try {
      await firstOwner.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "owned by owner-a" },
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
    const projects = createSavedProjectsStore(seam, "owner-1");
    const store = createOwnerDocumentsStore(seam, "owner-1", "user-1");
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
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
        docCount(db, "owner-1", "user-1"),
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
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
    const otherStore = createOwnerDocumentsStore(
      platformDb,
      "owner-2",
      "user-2",
    );
    try {
      // Create a project under owner-2.
      await createSavedProjectsStore(platformDb, "owner-2").createProjectRecord(
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
      assert.equal(docCount(db, "owner-1", "user-1"), 0);

      // projectId that exists under ANOTHER owner: still UnknownProject.
      const foreign = await store.put({
        kind: "workspace",
        id: "doc-2",
        payload: {},
        projectId: "proj-other",
      });
      assert.equal(foreign.success, false);
      if (!foreign.success) assert.equal(foreign.error.kind, "UnknownProject");
      assert.equal(docCount(db, "owner-1", "user-1"), 0);

      // The other tenant holds its one control document and nothing else.
      assert.equal(docCount(db, "owner-2", "user-2"), 1);
    } finally {
      db.close();
    }
  });

  it("a put without projectId detaches the document from its project", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const projects = createSavedProjectsStore(platformDb, "owner-1");
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
    } finally {
      db.close();
    }
  });

  it("delete reports whether a row went", async () => {
    const db = openPlatformDb(":memory:");
    const platformDb = createSqlitePlatformDb(db);
    const store = createOwnerDocumentsStore(platformDb, "owner-1", "user-1");
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
});
