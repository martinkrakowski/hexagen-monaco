// @vitest-environment node
import { describe, it, vi, expect } from "vitest";
import assert from "node:assert/strict";
import {
  createOwnerDocumentsStore,
  listDocumentsAuthoredBy,
} from "../owner-documents-store";
import type { PlatformDb, PlatformDbSession } from "../db";
import type { DocumentKind } from "../owner-documents-store";
import { createSavedProjectsStore } from "../saved-projects-store";
import { createOrgsRepository } from "../orgs-store";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";
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

function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

async function docCount(
  db: PlatformDb,
  ownerId: string,
  userId: string,
  projectId: string | null = null,
): Promise<number> {
  if (projectId === null) {
    const row = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ?",
      [ownerId, userId],
    );
    return row.n;
  }
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND project_id = ?",
    [ownerId, userId, projectId],
  );
  return row.n;
}

async function auditCount(
  db: PlatformDb,
  action = "document.precondition_failed",
): Promise<number> {
  const row = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE action = ?",
    [action],
  );
  return row.n;
}

describe.each(BACKENDS)("owner-documents store (%s", (kind) => {
  it("a document put with no row is rev 1, and is read back unchanged", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("each put moves rev by exactly one and returns the rev it wrote", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      const stored = await db.get<{ rev: number }>(
        "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(stored.rev, 3);
    } finally {
      await backend.close();
    }
  });

  it("two unconditional puts started together get revs 2 and 3", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      const stored = await db.get<{ rev: number }>(
        "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(stored.rev, 3);
    } finally {
      await backend.close();
    }
  });

  it("two unconditional puts of a new id started together get revs 1 and 2, and the row exists once", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      const count = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(count.n, 1, "the row must exist exactly once");
    } finally {
      await backend.close();
    }
  });

  it("a stale expectedRev is a Conflict and leaves the row untouched", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      const row = await db.get<{
        payload: string;
        rev: number;
      }>(
        `SELECT payload, rev FROM owner_documents
            WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?`,
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(row.rev, 2, "a refused write must not move rev");
      assert.deepEqual(JSON.parse(row.payload), { v: "updated" });
    } finally {
      await backend.close();
    }
  });

  it("an expectedRev with no row is NotFound and writes nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
        await docCount(db, "user-1", "user-1"),
        0,
        "no row must be written",
      );
    } finally {
      await backend.close();
    }
  });

  it("a second author under the same owner reads, lists and deletes nothing of the first's", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("a second owner reads nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("list filters by kind and by project, newest first, without payloads", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      // Filter by both kind AND project: only doc-g-1 matches workspace+proj-a...
      // wait, doc-g-1 is governance. workspace+proj-a = doc-a-1 only.
      const both = await store.list({ kind: "workspace", projectId: "proj-a" });
      assert.equal(both.success, true);
      if (!both.success) return;
      assert.equal(both.value.length, 1);
      assert.equal(both.value[0]?.id, "doc-a-1");

      // Newest first (doc-a-2 was written last, so it must lead among workspace docs).
      assert.equal(byKind.value[0]?.id, "doc-a-2");

      // Summaries must not carry a payload key.
      assert.ok(
        !("payload" in byKind.value[0]),
        "list must not return payloads",
      );
    } finally {
      await backend.close();
    }
  });

  it("invalid kind, id, projectId and payload are InvalidInput and write nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
        await docCount(db, "user-1", "user-1"),
        0,
        "no invalid write must land",
      );
    } finally {
      await backend.close();
    }
  });

  it("a projectId that names no project in this tenant is UnknownProject and writes nothing (also: another owner's project is still UnknownProject)", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      assert.equal(await docCount(db, "user-1", "user-1"), 0);

      // projectId that exists under ANOTHER owner: still UnknownProject.
      const foreign = await store.put({
        kind: "workspace",
        id: "doc-2",
        payload: {},
        projectId: "proj-other",
      });
      assert.equal(foreign.success, false);
      if (!foreign.success) assert.equal(foreign.error.kind, "UnknownProject");
      assert.equal(await docCount(db, "user-1", "user-1"), 0);

      // The other tenant holds its one control document and nothing else.
      assert.equal(await docCount(db, "user-2", "user-2"), 1);
    } finally {
      await backend.close();
    }
  });

  it("a put without projectId detaches the document from its project", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      const row = await db.get<{ project_id: string | null }>(
        "SELECT project_id FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(row.project_id, null);
      const reread = await store.get("workspace", "doc-1");
      assert.equal(reread.success && reread.value?.projectId, null);
    } finally {
      await backend.close();
    }
  });

  it("delete reports whether a row went", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("a put by an author who is not a member of the org is NotAMember and writes nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
        await docCount(db, "org-1", "user-b"),
        0,
        "no row must be written",
      );
    } finally {
      await backend.close();
    }
  });

  it("a put in a personal tenant needs no membership", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("a put started together with the author's removal writes nothing that survives (removal first)", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
        await docCount(db, "org-1", "user-a"),
        0,
        "no document for a removed member may survive",
      );
    } finally {
      await backend.close();
    }
  });

  it("a put started together with the author's removal writes nothing that survives (put first)", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      // A3-00: "second" is the author's second document; the counter was 1
      // (from "seed"), so it starts at rev 2, not 1.
      assert.equal(putResult.value.rev, 2);
      assert.equal(
        await docCount(db, "org-1", "user-a"),
        0,
        "the put landed, then the removal deleted it",
      );
    } finally {
      await backend.close();
    }
  });

  it("a put started together with the org's deletion writes nothing that survives", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
        await docCount(db, "org-1", "user-a"),
        0,
        "no document for a deleted org may survive",
      );
    } finally {
      await backend.close();
    }
  });

  it("listDocumentsAuthoredBy returns every document the user authored across tenants, with payloads parsed and others excluded", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it.runIf(kind === "sqlite")(
    "flags a row whose payload fails to parse; a JSON null is unflagged; ordered by owner_id, kind, id",
    async () => {
      // jsonb refuses invalid JSON, so this assertion only applies to SQLite.
      const backend = await openBackend(kind);
      const db = backend.db;
      const platformDb = db;
      try {
        const insert = (
          id: string,
          kind: string,
          payload: string,
          ts: number,
        ) =>
          platformDb.run(
            `INSERT INTO owner_documents
             (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
           VALUES (@owner_id, @user_id, @kind, @id, @project_id, @rev, @payload, hx_ts(@updated_at), @updated_by)`,
            {
              owner_id: "org-1",
              user_id: "user-a",
              kind,
              id,
              project_id: null,
              rev: 1,
              payload,
              updated_at: ts,
              updated_by: "user-a",
            },
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
        await backend.close();
      }
    },
  );

  it.runIf(kind === "postgres")(
    "jsonb refuses an invalid JSON payloads blob (22P02)",
    async () => {
      const backend = await openBackend(kind);
      try {
        const db = backend.db;
        await expect(
          db.run(
            `INSERT INTO owner_documents
             (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
           VALUES (@owner_id, @user_id, @kind, @id, @project_id, @rev, @payload, hx_ts(@updated_at), @updated_by)`,
            {
              owner_id: "org-1",
              user_id: "user-a",
              kind: "workspace",
              id: "bad-ws",
              project_id: null,
              rev: 1,
              payload: "not-json{",
              updated_at: 1,
              updated_by: "user-a",
            },
          ),
        ).rejects.toMatchObject({ code: "22P02" });
      } finally {
        await backend.close();
      }
    },
  );

  it("listDocumentsAuthoredBy cuts by the maxChars budget before the row that would exceed it", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const docs = createOwnerDocumentsStore(platformDb, "user-a", "user-a");
    try {
      const p1 = "aaa";
      const p2 = "bbbbb";
      const p3 = "ccccccc";
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
      await backend.close();
    }
  });

  it("listDocumentsAuthoredBy reports the size cut when both ceilings are passed, and the row cut when only that one is", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const docs = createOwnerDocumentsStore(platformDb, "user-a", "user-a");
    try {
      const p = "aaa";
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
      await backend.close();
    }
  });

  it("listDocumentsAuthoredBy rejects a non-integer or negative limit or maxChars with RangeError", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("create-only on an absent row creates rev 1", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      await backend.close();
    }
  });

  it("create-only on an existing row returns PreconditionFailed with the current rev and changes nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      const row = await db.get<{ payload: string; rev: number }>(
        "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.deepEqual(JSON.parse(row.payload), { v: "B" });
      assert.equal(row.rev, 2, "the existing row must be untouched");
    } finally {
      await backend.close();
    }
  });

  it("create-only by a second author in the same org succeeds and leaves the first author's row alone", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      const aRow = await db.get<{ payload: string; rev: number }>(
        "SELECT payload, rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["org-1", "user-a", "workspace", "doc-1"],
      );
      assert.deepEqual(JSON.parse(aRow.payload), { v: "owned by user-a" });
      assert.equal(aRow.rev, 1);
    } finally {
      await backend.close();
    }
  });

  it("create-only by a non-member is NotAMember, not exists, and writes nothing", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrgWithOwner(
      { id: "org-1", slug: "test", name: "Test", createdBy: "founder" },
      { actorId: "founder" },
    );
    await orgs.addMember("org-1", "user-a", "member");
    // Plant a row for (org-1, user-b) so "exists" would be the wrong answer if
    // the membership check did not run first.
    await db.run(
      `INSERT INTO owner_documents
          (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
               VALUES (@owner_id, @user_id, @kind, @id, @project_id, @rev, @payload, hx_ts(@updated_at), @updated_by)`,
      {
        owner_id: "org-1",
        user_id: "user-b",
        kind: "workspace",
        id: "doc-1",
        project_id: null,
        rev: 1,
        payload: "{}",
        updated_at: 1,
        updated_by: "user-b",
      },
    );
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
      const row = await db.get<{ rev: number; payload: string }>(
        "SELECT rev, payload FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["org-1", "user-b", "workspace", "doc-1"],
      );
      assert.equal(row.rev, 1);
      assert.deepEqual(JSON.parse(row.payload), {});
      assert.equal(
        await auditCount(db),
        0,
        "a NotAMember refusal writes no audit row",
      );
    } finally {
      await backend.close();
    }
  });

  it("two create-only puts started together: one creates, one is refused, one row", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      const refused = refusals[0]!;
      if (!refused.success) {
        assert.equal(
          refused.error.kind,
          "PreconditionFailed",
          "the loser must be a PreconditionFailed, not a silent upsert",
        );
      }

      const count = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(count.n, 1, "the row must exist exactly once");

      assert.equal(
        await auditCount(db),
        1,
        "exactly one audit row for the refusal",
      );
    } finally {
      await backend.close();
    }
  });

  it("create-only runs ONE insert with ON CONFLICT … DO NOTHING and no select before it", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const store = createOwnerDocumentsStore(platformDb, "user-1", "user-1");
    const realTransaction = platformDb.transaction.bind(platformDb);
    try {
      const ran: string[] = [];
      vi.spyOn(platformDb, "transaction").mockImplementation((fn) =>
        realTransaction(async (tx: PlatformDbSession) => {
          const wrapped: PlatformDbSession = {
            get: (sql, params) => {
              ran.push(sql);
              return tx.get(sql, params);
            },
            all: tx.all.bind(tx),
            run: (sql, params) => {
              ran.push(sql);
              return tx.run(sql, params);
            },
          };
          return fn(wrapped);
        }),
      );

      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "a" } },
        undefined,
        { createOnly: true },
      );

      // The insert statement must contain ON CONFLICT … DO NOTHING.
      assert.ok(
        ran.some((s) =>
          s.includes("ON CONFLICT (owner_id, user_id, kind, id) DO NOTHING"),
        ),
        "createOnly must use INSERT … ON CONFLICT DO NOTHING",
      );
      // No SELECT FROM owner_documents may come before the insert.
      const insertIdx = ran.findIndex((s) =>
        s.includes("ON CONFLICT (owner_id, user_id, kind, id) DO NOTHING"),
      );
      assert.notEqual(insertIdx, -1, "the insert must be present");
      const beforeInsert = ran.slice(0, insertIdx);
      assert.equal(
        beforeInsert.filter((s) =>
          s.includes("SELECT rev FROM owner_documents"),
        ).length,
        0,
        "no select-before-insert (no read-then-insert)",
      );

      vi.restoreAllMocks();
    } finally {
      await backend.close();
    }
  });

  it("conditional delete with the right rev deletes; with a stale rev deletes nothing and reports the current rev; on an absent row reports NotFound", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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

      // Re-seed for the stale-rev case. A3-00: the counter was 1 (from the
      // first doc-1), so re-creating doc-1 starts it at rev 2, not 1.
      const reseed = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "again" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(reseed.success, true);
      assert.equal(reseed.success && reseed.value.rev, 2);

      // Stale rev: nothing deleted, reports current rev.
      const stale = await store.delete("workspace", "doc-1", 999);
      assert.equal(stale.success, false);
      if (!stale.success) {
        assert.equal(stale.error.kind, "PreconditionFailed");
        assert.equal(stale.error.currentRev, 2);
      }
      const untouched = await db.get<{ rev: number }>(
        "SELECT rev FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-1", "user-1", "workspace", "doc-1"],
      );
      assert.equal(untouched.rev, 2, "a refused delete must not touch the row");

      // Absent row: NotFound.
      const missing = await store.delete("workspace", "does-not-exist", 1);
      assert.equal(missing.success, false);
      if (!missing.success) assert.equal(missing.error.kind, "NotFound");
    } finally {
      await backend.close();
    }
  });

  it("conditional delete never touches another author's row with the same kind, id and rev", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
      const bRow = await db.get<{ payload: string }>(
        "SELECT payload FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["org-1", "user-b", "workspace", "doc-1"],
      );
      assert.deepEqual(JSON.parse(bRow.payload), { v: "B" });
    } finally {
      await backend.close();
    }
  });

  it("each refusal writes exactly one document.precondition_failed row with NULL grantee columns, and success writes none", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    // An injected now() drives the store's rev stamps and rate-limit window;
    // the audit row's own created_at uses the real clock, so base must be real.
    const base = Date.now();
    let offset = 0;
    const store = createOwnerDocumentsStore(
      platformDb,
      "user-1",
      "user-1",
      () => base + offset,
    );
    try {
      // Seed a row at rev 1, then bump to rev 2.
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } });
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "b" } });

      // Three refusals: stale PUT, create-only, conditional DELETE.
      // Advance past the 60s cap between each so each writes its own row.
      offset = 61_000;
      const stalePut = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
        1, // stale rev
      );
      assert.equal(stalePut.success, false);
      if (!stalePut.success) {
        assert.equal(stalePut.error.kind, "Conflict");
        assert.equal(stalePut.error.currentRev, 2);
        assert.equal(stalePut.error.audited, true);
      }
      offset = 122_000;
      const createOnly = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "create" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(createOnly.success, false);
      if (!createOnly.success) {
        assert.equal(createOnly.error.kind, "PreconditionFailed");
        assert.equal(createOnly.error.currentRev, 2);
        assert.equal(createOnly.error.audited, true);
      }
      offset = 183_000;
      const staleDel = await store.delete("workspace", "doc-1", 1); // stale rev
      assert.equal(staleDel.success, false);
      if (!staleDel.success) {
        assert.equal(staleDel.error.kind, "PreconditionFailed");
        assert.equal(staleDel.error.currentRev, 2);
        assert.equal(staleDel.error.audited, true);
      }

      assert.equal(
        await auditCount(db),
        3,
        "three refusals = three audit rows",
      );

      // Verify each row by subject + action (not by position), with NULL
      // grantee columns since the audit row carries no detail.
      const bySubject = await db.all<{
        subject_owner_id: string;
        subject_id: string;
        grantee_type: unknown;
        grantee_id: unknown;
      }>(
        `SELECT subject_owner_id, subject_id, grantee_type, grantee_id
             FROM audit_log WHERE action = ? AND subject_owner_id = ? AND subject_id = ?`,
        ["document.precondition_failed", "user-1", "workspace/doc-1"],
      );
      assert.equal(bySubject.length, 3, "three rows for workspace/doc-1");
      for (const r of bySubject) {
        assert.equal(r.subject_owner_id, "user-1");
        assert.equal(r.subject_id, "workspace/doc-1");
        assert.equal(r.grantee_type, null, "grantee_type must be NULL");
        assert.equal(r.grantee_id, null, "grantee_id must be NULL");
      }

      // A matching-rev PUT, a createOnly on an absent id, a matching DELETE:
      // none of these write an audit row.
      await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "ok" } },
        2, // matching
      );
      const absent = await store.put(
        { kind: "workspace", id: "doc-absent", payload: { v: "ok" } },
        undefined,
        { createOnly: true },
      );
      assert.equal(absent.success, true);
      // A3-00: doc-absent does not start at rev 1; delete at its real rev.
      if (absent.success) {
        await store.delete("workspace", "doc-absent", absent.value.rev);
      }

      assert.equal(
        await auditCount(db),
        3,
        "a success must not add an audit row",
      );

      // An expectedRev PUT on an absent row (NotFound) writes no audit row.
      await store.put(
        { kind: "workspace", id: "doc-missing", payload: { v: "x" } },
        999,
      );
      assert.equal(
        await auditCount(db),
        3,
        "a NotFound refusal must not add an audit row",
      );
    } finally {
      await backend.close();
    }
  });

  it("two refusals of the same document within a minute write one audit row", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const base = Date.now();
    let offset = 0;
    const store = createOwnerDocumentsStore(
      platformDb,
      "user-1",
      "user-1",
      () => base + offset,
    );
    try {
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } });

      const first = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
        999, // stale rev
      );
      assert.equal(first.success, false);
      if (!first.success) {
        assert.equal(first.error.kind, "Conflict");
        assert.equal(
          first.error.audited,
          true,
          "first refusal writes an audit row",
        );
      }

      // 5 seconds later — within the same minute cap.
      offset = 5_000;
      const second = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale2" } },
        999, // stale rev
      );
      assert.equal(second.success, false);
      if (!second.success) {
        assert.equal(second.error.kind, "Conflict");
        assert.equal(
          second.error.audited,
          false,
          "second refusal is rate-capped",
        );
      }

      assert.equal(
        await auditCount(db),
        1,
        "only one audit row for two refusals within a minute",
      );
    } finally {
      await backend.close();
    }
  });

  it("a refusal of another document, and one by another author, each write their own", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const orgs = createOrgsRepository(platformDb);
    await orgs.createOrg({
      id: "org-1",
      slug: "test",
      name: "Test",
      createdBy: "user-a",
    });
    await orgs.addMember("org-1", "user-a", "owner");
    await orgs.addMember("org-1", "user-b", "member");
    const base = Date.now();
    const authorA = createOwnerDocumentsStore(
      platformDb,
      "org-1",
      "user-a",
      () => base,
    );
    const authorB = createOwnerDocumentsStore(
      platformDb,
      "org-1",
      "user-b",
      () => base,
    );
    try {
      await authorA.put({
        kind: "workspace",
        id: "doc-1",
        payload: { v: "a" },
      });
      await authorB.put({
        kind: "workspace",
        id: "doc-2",
        payload: { v: "b" },
      });

      // Both at the same time, different docs, different authors: two rows.
      const [refuseA, refuseB] = await Promise.all([
        authorA.put(
          { kind: "workspace", id: "doc-1", payload: { v: "stale" } },
          999,
        ),
        authorB.put(
          { kind: "workspace", id: "doc-2", payload: { v: "stale" } },
          999,
        ),
      ]);
      assert.equal(refuseA.success, false);
      assert.equal(refuseB.success, false);
      if (!refuseA.success && refuseA.error.kind === "Conflict") {
        assert.equal(refuseA.error.audited, true);
      }
      if (!refuseB.success && refuseB.error.kind === "Conflict") {
        assert.equal(refuseB.error.audited, true);
      }

      assert.equal(
        await auditCount(db),
        2,
        "different docs/authors each write their own row",
      );
    } finally {
      await backend.close();
    }
  });

  it("a refusal 61 seconds later writes a second row", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
    const base = Date.now();
    let offset = 0;
    const store = createOwnerDocumentsStore(
      platformDb,
      "user-1",
      "user-1",
      () => base + offset,
    );
    try {
      await store.put({ kind: "workspace", id: "doc-1", payload: { v: "a" } });

      const first = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale1" } },
        999,
      );
      assert.equal(first.success, false);
      if (!first.success && first.error.kind === "Conflict") {
        assert.equal(first.error.audited, true);
      }

      // 61 seconds later — past the cap.
      offset = 61_000;
      const second = await store.put(
        { kind: "workspace", id: "doc-1", payload: { v: "stale2" } },
        999,
      );
      assert.equal(second.success, false);
      if (!second.success) {
        assert.equal(second.error.kind, "Conflict");
        assert.equal(
          second.error.audited,
          true,
          "61s later a new row is written",
        );
      }

      assert.equal(
        await auditCount(db),
        2,
        "two audit rows: one per minute window",
      );
    } finally {
      await backend.close();
    }
  });

  it("the conditional delete runs ONE delete statement carrying rev = ?", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    const platformDb = db;
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
            all: tx.all.bind(tx),
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
            s.includes("DELETE FROM owner_documents") &&
            s.includes("AND rev = ?"),
        ),
        "the delete must carry rev = ?",
      );
      assert.equal(
        ran.filter(
          (s) =>
            s.includes("DELETE FROM owner_documents") &&
            !s.includes("user_id = ?"),
        ).length,
        0,
        "no DELETE may omit user_id = ?",
      );

      // Also record tx.get so we can verify the audit INSERT ran through tx.
      const ranAll: string[] = [];
      vi.spyOn(platformDb, "transaction").mockImplementation((fn) =>
        realTransaction(async (tx: PlatformDbSession) => {
          const wrapped: PlatformDbSession = {
            get: (sql, params) => {
              ranAll.push(sql);
              return tx.get(sql, params);
            },
            all: tx.all.bind(tx),
            run: (sql, params) => {
              ranAll.push(sql);
              return tx.run(sql, params);
            },
          };
          return fn(wrapped);
        }),
      );

      // Re-seed so the stale-rev delete finds a row and enters the
      // ref-usal path that writes an audit row. Use createOnly on a new id.
      await store.put(
        { kind: "workspace", id: "doc-stale", payload: { v: "reseed" } },
        undefined,
        { createOnly: true },
      );
      ranAll.length = 0;
      // Stale-rev delete: triggers a refusal path that writes an audit row.
      await store.delete("workspace", "doc-stale", 999);

      assert.ok(
        ranAll.some((s) => s.includes("INSERT INTO audit_log")),
        "the stale delete's audit row must run THROUGH tx (not db after commit)",
      );

      vi.restoreAllMocks();
    } finally {
      await backend.close();
    }
  });
});

describe.each(BACKENDS)("owner documents updated_at type (%s)", (kind) => {
  it("updatedAt is a number on put, get, list and the authored export", async () => {
    const backend = await openBackend(kind);
    try {
      const db = backend.db;
      const store = createOwnerDocumentsStore(db, "user-a", "user-a");
      const before = Date.now();

      // put via upsert (no precondition, no createOnly)
      const upserted = must(
        await store.put({
          kind: "workspace",
          id: "doc-upsert",
          payload: { a: 1 },
          projectId: null,
        }),
      );
      assert.equal(typeof upserted.updatedAt, "number");
      assert.ok(
        upserted.updatedAt >= before && upserted.updatedAt <= Date.now(),
      );

      // put via updateWithRev (with expectedRev)
      const updated = must(
        await store.put(
          {
            kind: "workspace",
            id: "doc-upsert",
            payload: { a: 2 },
            projectId: null,
          },
          upserted.rev,
        ),
      );
      assert.equal(typeof updated.updatedAt, "number");
      assert.ok(updated.updatedAt >= before && updated.updatedAt <= Date.now());

      // put via insertOnly (createOnly)
      const created = must(
        await store.put(
          {
            kind: "workspace",
            id: "doc-only",
            payload: { b: 1 },
            projectId: null,
          },
          undefined,
          { createOnly: true },
        ),
      );
      assert.equal(typeof created.updatedAt, "number");
      assert.ok(created.updatedAt >= before && created.updatedAt <= Date.now());

      // get (selectOne)
      const fetched = must(await store.get("workspace", "doc-upsert"));
      assert.equal(typeof fetched?.updatedAt, "number");
      assert.ok(
        fetched!.updatedAt >= before && fetched!.updatedAt <= Date.now(),
      );

      // list (selectList)
      const listed = must(await store.list({}));
      assert.ok(listed.length > 0);
      for (const item of listed) {
        assert.equal(typeof item.updatedAt, "number");
        assert.ok(item.updatedAt >= before && item.updatedAt <= Date.now());
      }

      // listDocumentsAuthoredBy (SELECT_AUTHORED_DOCUMENTS + SELECT_AUTHORED_DOCUMENT_PAYLOAD)
      const authored = await listDocumentsAuthoredBy(
        db,
        "user-a",
        100,
        1_000_000,
      );
      assert.equal(authored.truncatedBy, null);
      for (const item of authored.items) {
        assert.equal(typeof item.updatedAt, "number");
        assert.ok(item.updatedAt >= before && item.updatedAt <= Date.now());
      }
    } finally {
      await backend.close();
    }
  });

  it("a project deleted between the check and the write is UnknownProject and writes nothing", async () => {
    const backend = await openBackend(kind);
    try {
      // A seam that lies to the transaction about project existence: any
      // tx.get whose SQL contains "FROM saved_projects" returns { ok: 1 }.
      // The real FK on owner_documents.project_id still fires on the write.
      const honest = backend.db;
      const lyingTx = (session: PlatformDbSession): PlatformDbSession => ({
        get: async (sql, params) =>
          sql.includes("FROM saved_projects")
            ? ({ ok: 1 } as never)
            : session.get(sql, params),
        all: async (sql, params) => session.all(sql, params),
        run: async (sql, params) => session.run(sql, params),
      });
      const db: PlatformDb = {
        ...honest,
        transaction: async <T>(
          fn: (tx: PlatformDbSession) => Promise<T>,
        ): Promise<T> => honest.transaction((tx) => fn(lyingTx(tx))),
      };
      const store = createOwnerDocumentsStore(db, "user-a", "user-a");

      const result = await store.put({
        kind: "workspace",
        id: "doc-1",
        payload: {},
        projectId: "nonexistent-project",
      });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.equal(result.error.kind, "UnknownProject");
      }

      const count = await backend.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ?",
        ["user-a", "user-a"],
      );
      assert.equal(count.n, 0, "no documents must be written");
    } finally {
      await backend.close();
    }
  });

  it("list is newest first, then kind, then id", async () => {
    const backend = await openBackend(kind);
    try {
      const db = backend.db;
      // Seed three rows raw at 1000, 2000 and 2000 (the equal times differ in
      // kind), so the ORDER BY tie-breaks are exercised.
      const rows = [
        { kind: "workspace", id: "z", ts: 1000 },
        { kind: "governance", id: "a", ts: 2000 },
        { kind: "workspace", id: "a", ts: 2000 },
      ];
      for (const r of rows) {
        await db.run(
          `INSERT INTO owner_documents
             (owner_id, user_id, kind, id, project_id, rev, payload, updated_at, updated_by)
           VALUES (@owner_id, @user_id, @kind, @id, @project_id, @rev, @payload, hx_ts(@updated_at), @updated_by)`,
          {
            owner_id: "org-1",
            user_id: "user-a",
            kind: r.kind,
            id: r.id,
            project_id: null,
            rev: 1,
            payload: "{}",
            updated_at: r.ts,
            updated_by: "user-a",
          },
        );
      }
      const store = createOwnerDocumentsStore(db, "org-1", "user-a");
      const listed = must(await store.list({}));
      assert.deepEqual(
        listed.map((d) => `${d.kind}:${d.id}`),
        ["governance:a", "workspace:a", "workspace:z"],
        "ORDER BY updated_at DESC, kind, id",
      );
    } finally {
      await backend.close();
    }
  });

  it("a conditional write cannot reach another author's row", async () => {
    const backend = await openBackend(kind);
    try {
      const db = backend.db;
      const orgs = createOrgsRepository(db);
      await orgs.createOrgWithOwner(
        { id: "org-1", slug: "t", name: "T", createdBy: "user-a" },
        { actorId: "user-a" },
      );
      await orgs.addMember("org-1", "user-b", "member");
      const authorA = createOwnerDocumentsStore(db, "org-1", "user-a");
      const authorB = createOwnerDocumentsStore(db, "org-1", "user-b");

      const wrote = must(
        await authorA.put({
          kind: "workspace",
          id: "doc-1",
          payload: { v: "a" },
        }),
      );

      const rejected = await authorB.put(
        {
          kind: "workspace",
          id: "doc-1",
          payload: { v: "intrusion" },
        },
        wrote.rev,
      );
      assert.equal(rejected.success, false);
      if (!rejected.success) assert.equal(rejected.error.kind, "NotFound");

      const row = await db.get<{ payload: string }>(
        "SELECT payload FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["org-1", "user-a", "workspace", "doc-1"],
      );
      assert.deepEqual(JSON.parse(row!.payload), { v: "a" });
    } finally {
      await backend.close();
    }
  });

  it("an object payload is measured by jsonb's rendering, never by less than its compact text", async () => {
    const backend = await openBackend(kind);
    try {
      const db = backend.db;
      const store = createOwnerDocumentsStore(db, "user-a", "user-a");
      const payload = { a: 1, b: [1, 2] };
      must(
        await store.put({
          kind: "workspace",
          id: "doc-1",
          payload,
        }),
      );
      const row = await db.get<{ n: number }>(
        "SELECT length(CAST(payload AS TEXT)) AS n FROM owner_documents WHERE owner_id = ? AND user_id = ? AND kind = ? AND id = ?",
        ["user-a", "user-a", "workspace", "doc-1"],
      );
      assert.equal(typeof row!.n, "number");
      assert.ok(
        row!.n >= JSON.stringify(payload).length,
        `jsonb rendering must never be shorter than compact text: ${row!.n} vs ${JSON.stringify(payload).length}`,
      );
    } finally {
      await backend.close();
    }
  });

  it("the payload round-trips as the same JSON value, and put returns the caller's payload object", async () => {
    const backend = await openBackend(kind);
    try {
      const db = backend.db;
      const store = createOwnerDocumentsStore(db, "user-a", "user-a");
      const payload = {
        nested: { a: 1, b: [null, 2, "x"] },
        float: 1.5,
        long: "y".repeat(5000),
        unicode: "naïve Ünïcode ✓ 日本",
      };
      const written = must(
        await store.put({
          kind: "workspace",
          id: "doc-1",
          payload,
        }),
      );
      // put returns the caller's own payload object (not a re-serialized copy)
      assert.deepEqual(written.payload, payload);

      const fetched = must(await store.get("workspace", "doc-1"));
      assert.deepEqual(fetched.payload, payload);

      const authored = await listDocumentsAuthoredBy(
        db,
        "user-a",
        100,
        1_000_000,
      );
      assert.equal(authored.items.length, 1);
      assert.deepEqual(authored.items[0].payload, payload);
    } finally {
      await backend.close();
    }
  });
});
