import { describe, it } from "vitest";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEXAGEN_CONFORMANCE_ACTION_YML,
  HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  hexagenConformanceActionFiles,
  shouldInjectSyncIntegrityWorkflow,
} from "../../src/domain/sync-integrity-workflow.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

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

  it("uses the vendored hexagen-conformance action (0.10.0 contract)", () => {
    assert.ok(
      SYNC_INTEGRITY_WORKFLOW.includes(
        "uses: ./.github/actions/hexagen-conformance",
      ),
    );
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("yarn hexagen-lint --ratchet"));
    assert.match(SYNC_INTEGRITY_WORKFLOW, /0\.10\.0 unpublished/);
    assert.ok(!SYNC_INTEGRITY_WORKFLOW.includes("v0.9.0"));
  });

  it("vendors the composite action files next to the workflow", () => {
    const files = hexagenConformanceActionFiles();
    assert.deepEqual(
      files.map((f) => f.path),
      [
        HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
        HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
      ],
    );
    assert.ok(HEXAGEN_CONFORMANCE_ACTION_YML.includes("${{ github.token }}"));
    assert.ok(HEXAGEN_CONFORMANCE_ACTION_YML.includes("--pr-diff"));
    assert.ok(
      HEXAGEN_CONFORMANCE_COMMENT_SCRIPT.includes("hexagen-conformance"),
    );
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

describe("vendored hexagen-conformance action stays aligned with the in-repo action", () => {
  const inRepoAction = readFileSync(
    path.join(REPO_ROOT, ".github/actions/hexagen-conformance/action.yml"),
    "utf8",
  );
  const inRepoComment = readFileSync(
    path.join(
      REPO_ROOT,
      ".github/actions/hexagen-conformance/post-comment.mjs",
    ),
    "utf8",
  );

  it("shares --pr-diff, comment marker, pagination, and unshallow fetch", () => {
    for (const blob of [inRepoAction, HEXAGEN_CONFORMANCE_ACTION_YML]) {
      assert.ok(blob.includes("--pr-diff"), "action must append --pr-diff");
      assert.ok(
        blob.includes("--comment-file"),
        "action must write a comment file",
      );
      assert.ok(blob.includes("--unshallow"), "shallow clones must unshallow");
      assert.ok(
        !/git fetch --no-tags --prune --depth=1 origin/.test(blob),
        "depth-1 base fetch is the merge-base failure mode",
      );
    }
    for (const blob of [inRepoComment, HEXAGEN_CONFORMANCE_COMMENT_SCRIPT]) {
      assert.ok(blob.includes("<!-- hexagen-conformance -->"));
      assert.ok(blob.includes("page="), "comment lookup must paginate");
      assert.ok(blob.includes("!body.trim()"), "clean PRs must stay silent");
    }
  });
});
