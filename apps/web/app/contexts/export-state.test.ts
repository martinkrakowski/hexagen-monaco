import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isGithubExportActive, type ExportState } from "./export-state";

describe("isGithubExportActive", () => {
  const cases: Array<[string, ExportState, boolean]> = [
    ["idle", { kind: "idle" }, false],
    ["dialog-open", { kind: "dialog-open" }, true],
    [
      "settings-open",
      {
        kind: "settings-open",
        repo: { owner: "acme", repo: "api" },
        defaultMode: "scaffold",
        defaultMessage: "Update scaffold",
        hasEditorEdits: true,
      },
      true,
    ],
    ["exporting zip", { kind: "exporting", destination: "zip" }, false],
    ["exporting github", { kind: "exporting", destination: "github" }, true],
    [
      "success zip",
      { kind: "success", destination: "zip", message: "ZIP downloaded" },
      false,
    ],
    [
      "success github",
      { kind: "success", destination: "github", message: "Pushed" },
      true,
    ],
    ["error zip", { kind: "error", destination: "zip", message: "x" }, false],
    [
      "error github",
      { kind: "error", destination: "github", message: "x" },
      true,
    ],
  ];

  for (const [name, state, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      assert.strictEqual(isGithubExportActive(state), expected);
    });
  }
});
