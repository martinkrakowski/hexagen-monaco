/**
 * Public-surface contract — the root barrel of `@hexagen-monaco/sync`.
 *
 * WHY THIS EXISTS. Whether a given name may leave the barrel was, until now, a
 * per-PR judgement call: #450 and #470 each had to re-litigate it from scratch,
 * with nothing in the tree recording the answer. This suite turns that call into
 * a mechanical, reviewable one — a removal or an addition becomes a deliberate
 * red-then-green edit to `EXPECTED_PUBLIC_SURFACE` below, visible in the diff.
 *
 * WHAT IT IS NOT. It is **not** an argument that the barrel is the contract.
 * It is not: the supported contract of this package is the `hexagen` **binary**
 * (`dist/cli.js`) — see ADR-0056 and the sibling contract suites, which all
 * spawn the built CLI in a published consumer layout. Under 0.x the barrel is
 * PROVISIONAL. This suite exists so that provisional does not mean *accidental*.
 *
 * THE RULE THIS PINS (ADR-0056):
 *   - Removing a name from this list is a BREAKING change for any programmatic
 *     consumer. It rides a **minor** (`0.N.0`), never a patch, and it must be
 *     named explicitly in that release's `CHANGELOG.md` section.
 *   - Adding a name is not breaking, but it is still a widening of a surface the
 *     package has committed to keep working — take it on purpose.
 *
 * WHY ts-morph AND NOT `import * as barrel`. A runtime import sees only VALUE
 * exports; every type-only export — `Manifest`, `SyncConfig`, `Result`, the
 * whole `application/ports/out` surface — is erased before the test could look
 * at it. Those are precisely the names external consumers import most (the
 * arch-linter and `project-generation` both take `Manifest` from here). Reading
 * the declarations statically is the only way the snapshot covers the surface a
 * consumer's `tsc` actually sees. `ts-morph` is already a runtime dependency of
 * this package, so this costs no new dependency.
 *
 * The list is checked against SOURCE (`src/index.ts`), not `dist/`, so it runs
 * without a prior build — unlike its binary-spawning siblings in this folder.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const BARREL = path.join(PACKAGE_ROOT, "src", "index.ts");
const TSCONFIG = path.join(PACKAGE_ROOT, "tsconfig.json");

/**
 * Every name reachable from `src/index.ts`, values and types alike, sorted.
 *
 * ── HOW TO CHANGE THIS LIST ───────────────────────────────────────────────
 * Adding a name:   confirm you mean to support it forever-ish, then add it.
 * Removing a name: it is BREAKING.
 *   1. Land it on a MINOR version bump (`yarn bump minor`), never a patch —
 *      under 0.x, `^0.N.0` resolves `>=0.N.0 <0.N+1.0`, so a patch would push
 *      the removal into every already-generated project automatically.
 *   2. Name the removed export explicitly in `CHANGELOG.md`'s section for that
 *      release. "Trimmed the barrel" is not a changelog entry; the names are.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Last change: `sanitizeScope` ADDED — the canonical npm-scope normaliser from
 * `src/types/manifest/helpers.ts`, surfaced so the brownfield S4 ratification
 * screen and `POST /api/projects/bootstrap` can show and apply exactly what
 * `hexagen bootstrap` writes instead of reimplementing it. An addition, so not
 * breaking; it is on this list because it is now supported, not incidental.
 *
 * Before that: 0.10.0 removed `InMemoryConfigDouble`, `YamlConfigAdapter`, and
 * the six `fs-utils` names (`protectedFiles`, `isGeneratedFile`,
 * `isProtectedRoot`, `isInScope`, `safeWriteFileAtomic`, `safeWriteFile`).
 */
const EXPECTED_PUBLIC_SURFACE: readonly string[] = [
  "AclDefinition",
  "ArchitectureGraphProviderPort",
  "BootstrapStep",
  "BoundedContext",
  "DEFAULT_NAMING",
  "DEFAULT_TEMPLATES",
  "FailureMode",
  "FileSystemPort",
  "GeneratorConfigPort",
  "GeneratorResult",
  "IndexAppEntry",
  "IndexBoundedContextEntry",
  "IndexManifest",
  "InvariantConfig",
  "InvariantPriority",
  "LayerConfig",
  "LegacyOrNewPort",
  "LinterReportProviderPort",
  "LoggerConfig",
  "LoggerPort",
  "Manifest",
  "OwnershipRegistryPort",
  "PlaneType",
  "PortDefinition",
  "PortOwnershipRecord",
  "Relationship",
  "RelationshipPattern",
  "RelationshipRole",
  "ReportRecorder",
  "Result",
  "Session",
  "SymbolReferenceDto",
  "SymbolReferenceIndexPort",
  "SyncConfig",
  "SyncEngine",
  "SyncEngineOptions",
  "SyncFlags",
  "SyncRunSummary",
  "WorkspaceFileInfo",
  "WorkspaceFileProviderPort",
  "WriteStatus",
  "createEmptyResult",
  "err",
  "isIndexManifest",
  "loadManifest",
  "mergeSplitManifest",
  "ok",
  "parseArgs",
  "portName",
  "recordWriteStatus",
  "sanitizeScope",
  "saveManifest",
  "validateManifest",
];

/**
 * Names deliberately NOT on the surface, with the reason. Asserted separately
 * from the snapshot so a re-export sneaking back in fails with the reason
 * attached, rather than as an anonymous "+1 name" in a 50-line diff.
 */
const DELIBERATELY_UNEXPORTED: ReadonlyArray<readonly [string, string]> = [
  ["InMemoryConfigDouble", "a test double — fakes are not public API"],
  ["YamlConfigAdapter", "infrastructure adapter — drive it through the CLI"],
  ["protectedFiles", "fs-utils internals — invariants hold only inside a run"],
  ["isGeneratedFile", "fs-utils internals"],
  ["isProtectedRoot", "fs-utils internals"],
  ["isInScope", "fs-utils internals"],
  ["safeWriteFileAtomic", "fs-utils internals"],
  ["safeWriteFile", "fs-utils internals"],
];

/**
 * Memoized: constructing the `Project` loads the package's whole tsconfig
 * program — measured at ~380 ms and 303 source files per construction — and
 * that cost is O(source files in the package), so it grows with the package.
 * Two of the tests below need the surface, and the barrel cannot change
 * between them within a run, so the read happens once per file.
 */
let cachedSurface: readonly string[] | undefined;

function readPublicSurface(): string[] {
  if (cachedSurface === undefined) {
    const project = new Project({ tsConfigFilePath: TSCONFIG });
    const barrel = project.getSourceFileOrThrow(BARREL);
    cachedSurface = [...barrel.getExportedDeclarations().keys()].sort();
  }
  // A fresh array per call: the cache is the expensive parse, not the result,
  // and a caller that sorted or spliced in place must not poison the next test.
  return [...cachedSurface];
}

/**
 * Build the failure message the next author actually needs: which names moved,
 * in which direction, and what a removal obliges them to do.
 */
function explainDrift(actual: string[], expected: readonly string[]): string {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const added = actual.filter((n) => !expectedSet.has(n));
  const removed = expected.filter((n) => !actualSet.has(n));

  const lines = [
    "",
    "The public surface of @hexagen-monaco/sync's root barrel changed.",
    "",
  ];
  if (removed.length > 0) {
    lines.push(
      `  REMOVED (${removed.length}) — BREAKING for programmatic consumers:`,
      ...removed.map((n) => `    - ${n}`),
      "",
      "  A removal must ride a MINOR version bump (`yarn bump minor`), never a",
      "  patch: under 0.x, `^0.N.0` resolves `>=0.N.0 <0.N+1.0`, so a patch",
      "  would push this into every already-generated project automatically.",
      "  It must also be named explicitly in CHANGELOG.md for that release.",
      "",
    );
  }
  if (added.length > 0) {
    lines.push(
      `  ADDED (${added.length}) — widens a surface we then have to keep working:`,
      ...added.map((n) => `    + ${n}`),
      "",
    );
  }
  lines.push(
    "  If the change is intended, update EXPECTED_PUBLIC_SURFACE in",
    "  __tests__/contract/public-surface.contract.test.ts to match. See",
    "  ADR-0056 (the binary is the contract; the barrel is provisional).",
    "",
  );
  return lines.join("\n");
}

describe("public-surface contract — root barrel of @hexagen-monaco/sync", () => {
  it("exports exactly the snapshotted set of names", () => {
    const actual = readPublicSurface();
    assert.deepEqual(
      actual,
      [...EXPECTED_PUBLIC_SURFACE],
      explainDrift(actual, EXPECTED_PUBLIC_SURFACE),
    );
  });

  it("keeps the snapshot itself sorted and duplicate-free", () => {
    // Guards the list's own hygiene: an unsorted or duplicated entry would make
    // every future diff harder to read, and a duplicate would silently mask a
    // removal (the set comparison above would still balance).
    const sorted = [...EXPECTED_PUBLIC_SURFACE].sort();
    assert.deepEqual(
      [...EXPECTED_PUBLIC_SURFACE],
      sorted,
      "EXPECTED_PUBLIC_SURFACE must be sorted — keep diffs readable",
    );
    assert.equal(
      new Set(EXPECTED_PUBLIC_SURFACE).size,
      EXPECTED_PUBLIC_SURFACE.length,
      "EXPECTED_PUBLIC_SURFACE contains a duplicate name",
    );
  });

  it("does not re-export the names 0.10.0 deliberately withdrew", () => {
    const actual = new Set(readPublicSurface());
    for (const [name, reason] of DELIBERATELY_UNEXPORTED) {
      assert.equal(
        actual.has(name),
        false,
        `"${name}" is back on the public surface of src/index.ts — it was ` +
          `withdrawn in 0.10.0 because it is ${reason}. Re-exporting it is a ` +
          `contract decision, not a refactor: see ADR-0056.`,
      );
    }
  });
});
