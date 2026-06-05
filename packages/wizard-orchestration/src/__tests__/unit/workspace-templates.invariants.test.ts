import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { workspaceTemplates } from "@hexagen/project-configuration";

// The wizard's two "is this strict?" consumers read DIFFERENT rule fields:
//   - the manifest generator (wizardToManifest) keys off `crossContextCalls`
//     (strict when !== "in-process") to gate peer `depends_on`;
//   - the web UI (PeerContextMappingStep, TemplateCard) keys off `strictness`.
// They only agree while the catalog keeps the two fields consistent. This
// invariant pins that relationship so a future template can't silently drift
// them apart (e.g. an `event-bus` template marked `flexible`), which would make
// generated wiring disagree with the UI's mapping defaults and badge.
//
// Lives in this (gating) suite rather than @hexagen/project-configuration's own
// __tests__ because that package's test harness is non-gating (`... || true`),
// so a failure there wouldn't fail CI. Same rationale as the "manifest enum
// casing" block in manifest-parser.test.ts.
describe("workspace-templates — strictness invariant", () => {
  for (const template of workspaceTemplates) {
    it(`${template.id}: strictness agrees with crossContextCalls`, () => {
      const isInProcess = template.rules.crossContextCalls === "in-process";
      const isFlexible = template.rules.strictness === "flexible";
      assert.equal(
        isInProcess,
        isFlexible,
        `${template.id}: crossContextCalls="${template.rules.crossContextCalls}" and ` +
          `strictness="${template.rules.strictness}" disagree. The manifest generator keys off ` +
          `crossContextCalls (strict when !== "in-process") while the UI keys off strictness; ` +
          `they must stay consistent (in-process ⟺ flexible).`,
      );
    });
  }
});
