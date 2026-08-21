import { describe, it } from "vitest";
import assert from "node:assert";
import {
  HEXAGEN_CONFORMANCE_ACTION_YML,
  HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
  HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
  HEXAGEN_GATE_INSTALL_DOC,
  HEXAGEN_GATE_INSTALL_DOC_PATH,
  HEXAGEN_TOOLCHAIN_RANGE,
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  hexagenConformanceActionFiles,
  hexagenGateBundleFiles,
} from "../../src/domain/conformance-gate-files.js";
import * as syncIntegrityWorkflowModule from "../../src/domain/sync-integrity-workflow.js";

describe("hexagenConformanceActionFiles — backward compatibility", () => {
  it("returns exactly the two vendored action files when called with no arguments", () => {
    const files = hexagenConformanceActionFiles();
    assert.deepEqual(
      files.map((f) => f.path),
      [
        HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
        HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
      ],
    );
  });

  it("returns the same two files for an empty options object", () => {
    // The three in-repo call sites are zero-arg; `{}` must not change the
    // contract either, or a caller that forwards a partial options bag would
    // silently get a different bundle.
    assert.deepEqual(hexagenConformanceActionFiles({}), [
      ...hexagenConformanceActionFiles(),
    ]);
  });

  it("defaults includeWorkflow to false — the use case writes the workflow itself", () => {
    // `GenerateProjectUseCase` seeds its injection map with
    // SYNC_INTEGRITY_WORKFLOW *before* merging these files in. An opt-out
    // default would double-write it and reorder the array.
    const paths = hexagenConformanceActionFiles().map((f) => f.path);
    assert.ok(!paths.includes(SYNC_INTEGRITY_WORKFLOW_PATH));
  });

  it("carries the action bytes unchanged", () => {
    const [actionYml, commentScript] = hexagenConformanceActionFiles();
    assert.strictEqual(actionYml?.content, HEXAGEN_CONFORMANCE_ACTION_YML);
    assert.strictEqual(
      commentScript?.content,
      HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
    );
  });
});

describe("hexagenConformanceActionFiles — includeWorkflow", () => {
  it("appends the workflow LAST, leaving indices 0 and 1 untouched", () => {
    const files = hexagenConformanceActionFiles({ includeWorkflow: true });
    assert.strictEqual(files.length, 3);
    assert.deepEqual(
      files.map((f) => f.path),
      [
        HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
        HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
        SYNC_INTEGRITY_WORKFLOW_PATH,
      ],
    );
    assert.strictEqual(files[2]?.content, SYNC_INTEGRITY_WORKFLOW);
  });

  it("is a pure append — the default result is a prefix of the opt-in result", () => {
    const withWorkflow = hexagenConformanceActionFiles({
      includeWorkflow: true,
    });
    const base = [...hexagenConformanceActionFiles()];
    assert.deepEqual(withWorkflow.slice(0, 2), base);
  });

  it("treats includeWorkflow: false as the default", () => {
    const explicit = hexagenConformanceActionFiles({ includeWorkflow: false });
    assert.deepEqual(explicit, [...hexagenConformanceActionFiles()]);
  });
});

describe("hexagenConformanceActionFiles — pathPrefix", () => {
  it("prefixes every returned path", () => {
    const files = hexagenConformanceActionFiles({
      pathPrefix: "acme-api",
      includeWorkflow: true,
    });
    assert.deepEqual(
      files.map((f) => f.path),
      [
        `acme-api/${HEXAGEN_CONFORMANCE_ACTION_YML_PATH}`,
        `acme-api/${HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH}`,
        `acme-api/${SYNC_INTEGRITY_WORKFLOW_PATH}`,
      ],
    );
  });

  it("leaves content untouched — only paths are prefixed", () => {
    const [actionYml] = hexagenConformanceActionFiles({
      pathPrefix: "acme-api",
    });
    assert.strictEqual(actionYml?.content, HEXAGEN_CONFORMANCE_ACTION_YML);
  });

  it("collapses a trailing slash so 'out/' and 'out' agree", () => {
    assert.deepEqual(
      hexagenConformanceActionFiles({ pathPrefix: "out/" }).map((f) => f.path),
      hexagenConformanceActionFiles({ pathPrefix: "out" }).map((f) => f.path),
    );
  });

  it("treats an empty or blank prefix as no prefix", () => {
    for (const pathPrefix of ["", "   "]) {
      assert.deepEqual(
        hexagenConformanceActionFiles({ pathPrefix }).map((f) => f.path),
        [
          HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
          HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
        ],
        `blank prefix ${JSON.stringify(pathPrefix)} must not alter paths`,
      );
    }
  });
});

describe("hexagenGateBundleFiles — the brownfield leave-behind", () => {
  it("ships the workflow, both action files, and the install doc", () => {
    assert.deepEqual(
      hexagenGateBundleFiles().map((f) => f.path),
      [
        HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
        HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
        SYNC_INTEGRITY_WORKFLOW_PATH,
        HEXAGEN_GATE_INSTALL_DOC_PATH,
      ],
    );
  });

  it("always includes the workflow — nothing else writes it on this path", () => {
    const paths = hexagenGateBundleFiles().map((f) => f.path);
    assert.ok(paths.includes(SYNC_INTEGRITY_WORKFLOW_PATH));
  });

  it("honours pathPrefix across every entry, install doc included", () => {
    const paths = hexagenGateBundleFiles({ pathPrefix: "bundle" }).map(
      (f) => f.path,
    );
    assert.ok(
      paths.every((p) => p.startsWith("bundle/")),
      `every bundle path must be prefixed: ${paths.join(", ")}`,
    );
    assert.ok(paths.includes(`bundle/${HEXAGEN_GATE_INSTALL_DOC_PATH}`));
  });

  it("has no duplicate paths (a zip entry would be silently overwritten)", () => {
    const paths = hexagenGateBundleFiles().map((f) => f.path);
    assert.strictEqual(new Set(paths).size, paths.length);
  });

  it("emits no empty file", () => {
    for (const file of hexagenGateBundleFiles()) {
      assert.ok(file.content.trim().length > 0, `${file.path} must have bytes`);
    }
  });
});

describe("HEXAGEN-GATE-INSTALL.md (decision D-B4)", () => {
  it("documents the packageManager pin the Corepack step reads", () => {
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /"packageManager"/);
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /yarn@4/);
  });

  it("documents both scripts the workflow invokes", () => {
    // The workflow calls `yarn hexagen-lint --ratchet` and `yarn sync:check`;
    // if the doc stops naming either script the bundle is unusable.
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("yarn hexagen-lint --ratchet"));
    assert.ok(SYNC_INTEGRITY_WORKFLOW.includes("yarn sync:check"));
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /"hexagen-lint":/);
    assert.match(
      HEXAGEN_GATE_INSTALL_DOC,
      /"sync:check": "hexagen sync --check"/,
    );
  });

  it("names the published toolchain packages at the 0.11.0 contract", () => {
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /@hexagen-monaco\/sync/);
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /@hexagen-monaco\/arch-linter/);
    assert.strictEqual(HEXAGEN_TOOLCHAIN_RANGE, "^0.11.0");
    assert.ok(HEXAGEN_GATE_INSTALL_DOC.includes(HEXAGEN_TOOLCHAIN_RANGE));
  });

  it("states that it does NOT patch the consumer's package.json", () => {
    assert.match(
      HEXAGEN_GATE_INSTALL_DOC,
      /does not rewrite your `package\.json`/,
    );
  });

  it("points at the baseline-seeding command so the first run can be green", () => {
    assert.ok(HEXAGEN_GATE_INSTALL_DOC.includes("--update-baseline"));
    assert.ok(
      HEXAGEN_GATE_INSTALL_DOC.includes(
        ".architecture/arch-lint-baseline.json",
      ),
    );
  });

  it("preserves the Corepack-before-setup-node warning the workflow depends on", () => {
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /package-manager-cache: false/);
    assert.match(HEXAGEN_GATE_INSTALL_DOC, /Corepack/);
  });
});

describe("sync-integrity-workflow.ts re-export shim", () => {
  it("re-exports the identical function object, not a copy", () => {
    // Three in-repo call sites still import from the old path — one of them
    // (`scripts/capstone/generate-fixture.ts`) by deep relative specifier from
    // outside this package, where a broken path fails at runtime, not compile
    // time. Identity, so a future divergence is impossible rather than merely
    // unlikely.
    assert.strictEqual(
      syncIntegrityWorkflowModule.hexagenConformanceActionFiles,
      hexagenConformanceActionFiles,
    );
  });

  it("re-exports every constant the old module owned, byte-for-byte", () => {
    assert.strictEqual(
      syncIntegrityWorkflowModule.SYNC_INTEGRITY_WORKFLOW,
      SYNC_INTEGRITY_WORKFLOW,
    );
    assert.strictEqual(
      syncIntegrityWorkflowModule.SYNC_INTEGRITY_WORKFLOW_PATH,
      SYNC_INTEGRITY_WORKFLOW_PATH,
    );
    assert.strictEqual(
      syncIntegrityWorkflowModule.HEXAGEN_CONFORMANCE_ACTION_YML,
      HEXAGEN_CONFORMANCE_ACTION_YML,
    );
    assert.strictEqual(
      syncIntegrityWorkflowModule.HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
      HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
    );
    assert.strictEqual(
      syncIntegrityWorkflowModule.HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
      HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
    );
    assert.strictEqual(
      syncIntegrityWorkflowModule.HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
      HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
    );
  });

  it("keeps shouldInjectSyncIntegrityWorkflow on the old path", () => {
    assert.strictEqual(
      typeof syncIntegrityWorkflowModule.shouldInjectSyncIntegrityWorkflow,
      "function",
    );
  });
});
