// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { BACKENDS, openBackend } from "../../../test-support/platform-backends";

describe.each(BACKENDS)("project owner initialized flag (%s)", (kind) => {
  it("starts unset and is set by markProjectsInitialized", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      assert.equal(await store.isProjectsInitialized("owner-a"), false);
      await store.markProjectsInitialized("owner-a");
      assert.equal(await store.isProjectsInitialized("owner-a"), true);
      assert.equal(await store.isProjectsInitialized("owner-b"), false);
    } finally {
      await backend.close();
    }
  });

  it("mark is idempotent and per owner", async () => {
    const backend = await openBackend(kind);
    try {
      const store = backend.store;
      await store.markProjectsInitialized("owner-a");
      await store.markProjectsInitialized("owner-a");
      assert.equal(await store.isProjectsInitialized("owner-a"), true);
      assert.equal(await store.isProjectsInitialized("owner-b"), false);

      const count = await backend.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM project_owner_state WHERE owner_id = ?",
        ["owner-a"],
      );
      assert.equal(typeof count?.n, "number");
      assert.equal(count?.n, 1);

      const row = await backend.db.get<{ initialized: number }>(
        "SELECT initialized FROM project_owner_state WHERE owner_id = ?",
        ["owner-a"],
      );
      assert.equal(row?.initialized, 1);
    } finally {
      await backend.close();
    }
  });
});
