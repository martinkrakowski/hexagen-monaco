import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";

describe("project owner initialized flag", () => {
  it("starts unset and is set by markProjectsInitialized", async () => {
    const store = createPlatformStore(":memory:");
    assert.equal(await store.isProjectsInitialized("owner-a"), false);
    await store.markProjectsInitialized("owner-a");
    assert.equal(await store.isProjectsInitialized("owner-a"), true);
    assert.equal(await store.isProjectsInitialized("owner-b"), false);
    await store.close();
  });
});
