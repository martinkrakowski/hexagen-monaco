import { describe, it } from "vitest";
import assert from "node:assert";
import {
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  shouldInjectSyncIntegrityWorkflow,
} from "../../src/domain/sync-integrity-workflow.js";

describe("sync-integrity workflow content", () => {
  it("targets .github/workflows/sync-integrity.yml", () => {
    assert.strictEqual(
      SYNC_INTEGRITY_WORKFLOW_PATH,
      ".github/workflows/sync-integrity.yml",
    );
  });

  it("enables Corepack BEFORE setup-node (the yarn@4 probe-ordering fix)", () => {
    const corepackAt = SYNC_INTEGRITY_WORKFLOW.indexOf("corepack enable");
    const setupNodeAt = SYNC_INTEGRITY_WORKFLOW.indexOf(
      "actions/setup-node@v5",
    );
    assert.ok(corepackAt >= 0, "must enable Corepack");
    assert.ok(setupNodeAt >= 0, "must use setup-node@v5");
    assert.ok(
      corepackAt < setupNodeAt,
      "Corepack must be enabled before setup-node",
    );
  });

  it("does NOT set `cache: yarn` on setup-node (same probe hazard)", () => {
    // Line-anchored so the explanatory comment mentioning `cache: "yarn"` is
    // not mistaken for an actual cache directive.
    assert.ok(
      !/^[ \t]*cache:\s*["']?yarn/m.test(SYNC_INTEGRITY_WORKFLOW),
      "cache: yarn would run Yarn Classic before Corepack and fail on yarn@4",
    );
  });

  it("disables setup-node@v5's cache auto-probe explicitly (F21)", () => {
    // On setup-node@v5 omitting `cache:` is NOT enough — the action still
    // probes the package-manager cache with the global Yarn Classic.
    assert.ok(
      /^[ \t]*package-manager-cache:\s*false[ \t]*$/m.test(
        SYNC_INTEGRITY_WORKFLOW,
      ),
      "setup-node@v5 must carry package-manager-cache: false",
    );
  });

  it("installs with --immutable (Yarn Berry), never --frozen-lockfile (Classic)", () => {
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("yarn install --immutable"));
    assert.ok(!SYNC_INTEGRITY_WORKFLOW.includes("--frozen-lockfile"));
  });

  it("runs the generated project's sync:check script", () => {
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("yarn sync:check"));
  });

  it("pins actions at @v5 (Node-24-ready), with no @v4 left", () => {
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("actions/checkout@v5"));
    assert.ok(!SYNC_INTEGRITY_WORKFLOW.includes("@v4"));
  });
});

describe("shouldInjectSyncIntegrityWorkflow", () => {
  it("injects for the yarn default (absent/blank packageManager)", () => {
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow(undefined), true);
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow(""), true);
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("   "), true);
  });

  it("injects for an explicit yarn pin", () => {
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("yarn@4.12.0"), true);
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("yarn"), true);
  });

  it("opts out for pnpm / bun (the workflow is yarn-specific)", () => {
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("pnpm@9.0.0"), false);
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("bun@1.1.0"), false);
  });

  it("requires a yarn or yarn@ boundary (no loose substring match)", () => {
    assert.strictEqual(shouldInjectSyncIntegrityWorkflow("yarnlike@1"), false);
  });
});
