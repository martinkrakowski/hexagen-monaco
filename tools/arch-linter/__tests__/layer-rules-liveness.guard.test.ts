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
 * `src/layer-import-violation.ts`. Keep this list in step with that type.
 */
const READ_KEYS = ["shared_kernels", "layers", "cross_package_rules"] as const;

/**
 * Keys present in the file that NO code reads. Each entry is debt with a
 * name on it; retiring one means deleting it from the YAML and from here in
 * the same change. Adding one here without a reason is the drift this guard
 * exists to stop.
 */
const PROSE_ONLY_KEYS_PENDING_RETIREMENT: Record<string, string> = {
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

    const missing = entries.filter(
      (e) => !fs.existsSync(path.join(REPO_ROOT, e.value)),
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
});
