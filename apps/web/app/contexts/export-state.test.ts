import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { isPublishDialogOpen, type GithubPublishState } from "./export-state";

// GOD-004: the predecessor of this selector (`isGithubExportActive`) also had
// to answer "is this state a GitHub state at all", because ZIP and GitHub
// shared one union — every ZIP variant appeared in this table purely to be
// classified false. The split made those cases unrepresentable, so what is
// left is the only question the Header still asks: does the create/result
// dialog own the screen? The settings modal is a separate surface with its own
// `open` condition, which is why it is excluded rather than lumped in.
describe("isPublishDialogOpen", () => {
  const cases: Array<[string, GithubPublishState, boolean]> = [
    ["idle", { kind: "idle" }, false],
    ["dialog-open", { kind: "dialog-open" }, true],
    [
      "settings-open",
      {
        kind: "settings-open",
        repo: { owner: "acme", repo: "api" },
        defaultMode: "scaffold",
        defaultMessage: "Update scaffold",
        defaultRemember: false,
        hasEditorEdits: true,
      },
      false,
    ],
    ["publishing", { kind: "publishing" }, true],
    ["success", { kind: "success", message: "Pushed" }, true],
    ["error", { kind: "error", message: "x" }, true],
  ];

  for (const [name, state, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      assert.strictEqual(isPublishDialogOpen(state), expected);
    });
  }
});
