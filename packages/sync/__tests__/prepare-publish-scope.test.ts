import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { stagePublishedManifest as stage } from "./helpers/stage-publish-package.js";

describe("prepare-publish-package scope rewrite", () => {
  it("rewrites @hexagen/* to @hexagen-monaco/* in the staged name", async () => {
    const staged = await stage("@hexagen/sync");
    assert.equal(staged.name, "@hexagen-monaco/sync");
  });

  it("only rewrites the scope, not the package portion", async () => {
    const staged = await stage("@hexagen/arch-linter");
    assert.equal(staged.name, "@hexagen-monaco/arch-linter");
  });

  it("leaves a non-@hexagen scope untouched", async () => {
    const staged = await stage("@acme/widget");
    assert.equal(staged.name, "@acme/widget");
  });

  it("does not rewrite a lookalike scope like @hexagenic/*", async () => {
    const staged = await stage("@hexagenic/thing");
    assert.equal(staged.name, "@hexagenic/thing");
  });
});

describe("prepare-publish-package workspace stripping", () => {
  it("strips workspace:* from peerDependencies and optionalDependencies", async () => {
    const staged = await stage("@acme/widget", {
      peerDependencies: { "@acme/core": "workspace:*", react: "^18.0.0" },
      optionalDependencies: { "@acme/extras": "workspace:*" },
    });
    // Workspace specs gone; the real third-party peer is kept.
    assert.deepEqual(staged.peerDependencies, { react: "^18.0.0" });
    // optionalDependencies had only a workspace spec → field omitted entirely.
    assert.equal(staged.optionalDependencies, undefined);
  });

  it("produces a manifest with no workspace: references at all", async () => {
    const staged = await stage("@acme/widget", {
      dependencies: { "@acme/shared": "workspace:*", lodash: "^4.0.0" },
      peerDependencies: { "@acme/core": "workspace:*" },
    });
    assert.ok(
      !JSON.stringify(staged).includes("workspace:"),
      "no workspace: spec may remain in the staged manifest",
    );
  });
});
