/**
 * `.architecture/invariants/layer-rules.yaml` — liveness guard.
 *
 * The loader (`optional-yaml-config.ts`) is a cast: it rejects a non-mapping
 * document but passes every top-level key through, read or not. Two defects
 * lived behind that for months (2026-08-23 enforcement plan, P4.2):
 *
 *   - `driver_slice_exceptions` named `apps/web/features/llm-driver/`, a
 *     directory deleted in #464. Nothing read the key, so nothing noticed.
 *   - `composition_root_exceptions` is still present and also read by nothing
 *     (no reference in `tools/arch-linter/src`, `packages/sync/src`, `scripts/`).
 *
 * This test makes both classes fail loudly: (a) every path-valued entry must
 * resolve on disk, and (b) the set of top-level keys must be exactly the keys
 * the linter reads plus an explicit, named list of prose-only keys awaiting
 * retirement. Adding a key to that list is a decision, not a drift.
 *
 * Both assertions check that discovery was non-empty before asserting clean:
 * a guard over an empty set reports success while checking nothing.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const LAYER_RULES = path.join(
  REPO_ROOT,
  ".architecture",
  "invariants",
  "layer-rules.yaml",
);

/**
 * Keys the linter reads — the `LayerRules` type in
 * `src/layer-import-violation.ts` (`layers`, `cross_package_rules`,
 * `shared_kernel` via `isSharedKernelAllowed()`). `layers` and
 * `cross_package_rules` are also read by the MCP governance adapter, and
 * `shared_kernel` (singular, object) is what the sync generator's
 * layer-rules template writes. Keep this list in step with those readers.
 *
 * The YAML does NOT carry `shared_kernel` today — only the dead plural
 * `shared_kernels` listed below. Listing the singular key here anyway is the
 * point: when the schema is reconciled to what the reader consumes, a valid
 * `shared_kernel` object must pass this guard, not be flagged as dead config
 * (review flag on #636).
 */
const READ_KEYS = ["layers", "cross_package_rules", "shared_kernel"] as const;

/**
 * Keys present in the file that NO code reads. Each entry is debt with a
 * name on it; retiring one means deleting it from the YAML and from here in
 * the same change. Adding one here without a reason is the drift this guard
 * exists to stop.
 */
const PROSE_ONLY_KEYS_PENDING_RETIREMENT: Record<string, string> = {
  shared_kernels:
    "DEAD BY KEY MISMATCH (review flag on #636): the reader is " +
    "isSharedKernelAllowed() (layer-import-violation.ts:19,83), which reads " +
    "singular `shared_kernel` as an OBJECT; this plural key is a per-package " +
    "LIST no code reads. Behaviour today equals the reader's default " +
    "(allowed_in_all_layers: true), which is also what every list entry says " +
    "-- so nothing is currently mis-enforced. Reconcile the schema and make " +
    "it live, or delete the block.",
  composition_root_exceptions:
    "no reader in tools/arch-linter/src, packages/sync/src or scripts/ (verified 2026-08-23); " +
    "the live per-context list lives in linter-config.yaml. Retire or wire.",
};

/** YAML keys whose values are repo-relative paths. */
const PATH_KEYS = new Set(["file", "slice", "path"]);

function collectPathEntries(
  node: unknown,
  trail: string,
  out: { trail: string; value: string }[],
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => collectPathEntries(item, `${trail}[${i}]`, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (PATH_KEYS.has(key) && typeof value === "string") {
        out.push({ trail: `${trail}.${key}`, value });
      } else {
        collectPathEntries(value, `${trail}.${key}`, out);
      }
    }
  }
}

function loadLayerRules(): Record<string, unknown> {
  const parsed = yaml.load(fs.readFileSync(LAYER_RULES, "utf8"));
  assert.ok(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "layer-rules.yaml must parse to a mapping",
  );
  return parsed as Record<string, unknown>;
}

type PathEntry = { trail: string; value: string };

/**
 * Classify path entries into `escapes` (not repo-relative, or resolving —
 * lexically OR through a symlink — outside `root`) and `missing` (inside the
 * root but absent on disk).
 *
 * The root is canonicalized first: on macOS a checkout under `/var/folders/`
 * has a realpath under `/private/var/folders/`, and comparing `realpathSync`
 * output for entries against the lexical root would flag every entry as an
 * escape. Existing entries are then canonicalized too, because `path.resolve`
 * only checks lexical containment — a repo-local symlink whose target lives
 * outside the root would otherwise satisfy the guard (review flag on #636).
 */
function findPathViolations(
  entries: PathEntry[],
  root: string,
): { escapes: PathEntry[]; missing: PathEntry[] } {
  const canonicalRoot = fs.realpathSync(root);
  const escapes: PathEntry[] = [];
  const missing: PathEntry[] = [];

  for (const entry of entries) {
    const resolved = path.resolve(canonicalRoot, entry.value);
    if (
      path.isAbsolute(entry.value) ||
      !(resolved + path.sep).startsWith(canonicalRoot + path.sep)
    ) {
      escapes.push(entry);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      missing.push(entry);
      continue;
    }
    const canonical = fs.realpathSync(resolved);
    if (!(canonical + path.sep).startsWith(canonicalRoot + path.sep)) {
      escapes.push(entry);
    }
  }

  return { escapes, missing };
}

describe("layer-rules.yaml liveness", () => {
  it("every path-valued entry resolves to something on disk", () => {
    const entries: { trail: string; value: string }[] = [];
    collectPathEntries(loadLayerRules(), "$", entries);

    // Non-vacuity: the file carries path entries today (composition root
    // exceptions). If this ever reads zero, the schema changed under the
    // guard and the guard must be revisited, not silently passed.
    assert.ok(
      entries.length > 0,
      "expected at least one path-valued entry in layer-rules.yaml; found none — guard is not checking anything",
    );

    // An absolute value or `..` traversal must not be able to satisfy the
    // guard by resolving OUTSIDE the repo — lexically or via a repo-local
    // symlink (review flag on #636).
    const { escapes, missing } = findPathViolations(entries, REPO_ROOT);
    assert.deepEqual(
      escapes,
      [],
      `layer-rules.yaml path entries must be repo-relative and stay inside the repo:\n${escapes
        .map((m) => `  ${m.trail} = ${m.value}`)
        .join("\n")}`,
    );

    assert.deepEqual(
      missing,
      [],
      `layer-rules.yaml names paths that do not exist:\n${missing
        .map((m) => `  ${m.trail} = ${m.value}`)
        .join("\n")}`,
    );
  });

  it("top-level keys are exactly the read keys plus the named prose-only list", () => {
    const actual = Object.keys(loadLayerRules()).sort();
    assert.ok(actual.length > 0, "layer-rules.yaml has no top-level keys");

    const allowed = [
      ...READ_KEYS,
      ...Object.keys(PROSE_ONLY_KEYS_PENDING_RETIREMENT),
    ].sort();

    const unknown = actual.filter((k) => !allowed.includes(k));
    assert.deepEqual(
      unknown,
      [],
      `layer-rules.yaml carries top-level keys nothing reads: ${unknown.join(", ")}. ` +
        "Either wire a reader in tools/arch-linter/src, or record the key in " +
        "PROSE_ONLY_KEYS_PENDING_RETIREMENT with a reason.",
    );

    // The other direction: a prose-only key listed here but no longer in the
    // file is stale bookkeeping — clear it so the list stays honest.
    const stale = Object.keys(PROSE_ONLY_KEYS_PENDING_RETIREMENT).filter(
      (k) => !actual.includes(k),
    );
    assert.deepEqual(
      stale,
      [],
      `PROSE_ONLY_KEYS_PENDING_RETIREMENT lists keys no longer in the file: ${stale.join(", ")}`,
    );
  });

  it("READ_KEYS covers a reconciled layer-rules.yaml (review flag on #636)", () => {
    // The `LayerRules` reader (layer-import-violation.ts:18-33) consumes
    // `shared_kernel` (singular, object). If the YAML's dead plural
    // `shared_kernels` block is ever reconciled to the reader's schema, the
    // key-set guard above must pass — not report live config as dead. This
    // fails if READ_KEYS ever drops a key the reader consumes.
    const reconciledYamlKeys = [
      "shared_kernel",
      "layers",
      "cross_package_rules",
    ];
    const allowed = [
      ...READ_KEYS,
      ...Object.keys(PROSE_ONLY_KEYS_PENDING_RETIREMENT),
    ];
    const unknown = reconciledYamlKeys.filter((k) => !allowed.includes(k));
    assert.deepEqual(
      unknown,
      [],
      `READ_KEYS is missing keys the linter reads: ${unknown.join(", ")}`,
    );
  });

  it("path classification traps repo-local symlinks pointing outside the root", () => {
    // Hermetic fixture for findPathViolations: a symlink inside the root
    // whose target lives outside passes the lexical containment check that
    // the repo-wide assertion used before (review flag on #636). Both temp
    // roots are deliberately passed lexically — on macOS os.tmpdir() is
    // /var/folders/... whose realpath is /private/var/folders/..., which is
    // exactly the root-canonicalization the helper must do itself.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "liveness-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "liveness-out-"));
    try {
      const outsideTarget = path.join(fs.realpathSync(outside), "target");
      fs.writeFileSync(outsideTarget, "x");

      fs.writeFileSync(path.join(root, "real.txt"), "x");
      fs.symlinkSync(outsideTarget, path.join(root, "link-out"));
      fs.symlinkSync("real.txt", path.join(root, "link-in"));

      const { escapes, missing } = findPathViolations(
        [
          { trail: "ok.file", value: "real.txt" },
          { trail: "ok.inRepoSymlink", value: "link-in" },
          { trail: "bad.absolute", value: outsideTarget },
          { trail: "bad.dotdot", value: "../escape" },
          { trail: "bad.outsideSymlink", value: "link-out" },
          { trail: "bad.missing", value: "nope.txt" },
        ],
        root,
      );

      assert.deepEqual(
        escapes.map((e) => e.trail).sort(),
        ["bad.absolute", "bad.dotdot", "bad.outsideSymlink"],
        "absolute, traversing, and outside-pointing-symlink values must all be escapes",
      );
      assert.deepEqual(
        missing.map((e) => e.trail),
        ["bad.missing"],
        "an in-root value that does not exist is missing, not an escape",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
