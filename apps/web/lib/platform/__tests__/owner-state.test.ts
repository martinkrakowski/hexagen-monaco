import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPlatformStore } from "../store";

describe("project owner initialized flag", () => {
  it("starts unset and is set by markProjectsInitialized", () => {
    const store = createPlatformStore(":memory:");
    assert.equal(store.isProjectsInitialized("owner-a"), false);
    store.markProjectsInitialized("owner-a");
    assert.equal(store.isProjectsInitialized("owner-a"), true);
    assert.equal(store.isProjectsInitialized("owner-b"), false);
    store.close();
  });
});
