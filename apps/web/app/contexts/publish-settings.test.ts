import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  decidePublishAction,
  defaultPublishMessage,
  resolveInitialPublishMode,
} from "./publish-settings";

describe("defaultPublishMessage", () => {
  it("scaffold and editor have sensible defaults; new-repo defers to the create dialog", () => {
    assert.equal(defaultPublishMessage("scaffold"), "Update project scaffold");
    assert.equal(defaultPublishMessage("editor"), "Update from HexaGen editor");
    assert.equal(defaultPublishMessage("new-repo"), "");
  });
});

describe("resolveInitialPublishMode", () => {
  it("keeps the preferred mode when it is usable", () => {
    assert.equal(resolveInitialPublishMode("scaffold", false), "scaffold");
    assert.equal(resolveInitialPublishMode("editor", true), "editor");
    assert.equal(resolveInitialPublishMode("new-repo", false), "new-repo");
  });

  it("falls back to scaffold when 'editor' is preferred but there are no edits", () => {
    assert.equal(resolveInitialPublishMode("editor", false), "scaffold");
  });
});

describe("decidePublishAction", () => {
  it("not linked → create dialog (first publish), ignoring any stray pref", () => {
    assert.deepEqual(decidePublishAction(false, null), {
      kind: "create-dialog",
    });
    assert.deepEqual(
      decidePublishAction(false, { mode: "scaffold", remember: true }),
      { kind: "create-dialog" },
    );
  });

  it("linked without a remembered preference → open the settings modal", () => {
    assert.deepEqual(decidePublishAction(true, null), {
      kind: "open-settings",
    });
    assert.deepEqual(
      decidePublishAction(true, { mode: "editor", remember: false }),
      { kind: "open-settings" },
    );
  });

  it("linked with a remembered preference → run it directly (no modal)", () => {
    assert.deepEqual(
      decidePublishAction(true, { mode: "scaffold", remember: true }),
      { kind: "run-remembered", mode: "scaffold" },
    );
    assert.deepEqual(
      decidePublishAction(true, { mode: "editor", remember: true }),
      { kind: "run-remembered", mode: "editor" },
    );
  });
});
