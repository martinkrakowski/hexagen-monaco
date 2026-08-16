import assert from "node:assert/strict";
import { describe, it, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  isIndexManifest,
  mergeSplitManifest,
} from "../../../src/infrastructure/adapters/manifest-merge-loader.js";
import { ManifestSchema } from "../../../src/domain/model/manifest-schema/manifest-schema.js";
import type { Manifest } from "../../../src/domain/model/manifest-schema/manifest-schema.js";

/**
 * Fidelity guard for `mergeSplitManifest`, run against THIS repository's real
 * `.architecture/` tree — deliberately not against a hand-written fixture.
 *
 * The two defects this file locks down both survived years of green fixtures
 * for the same reason: every fixture described a shape the real files do not
 * have, so nothing ever compared "what the author wrote" with "what the loader
 * returned".
 *
 *   - The merge built its result from a hand-written field list, so eight of
 *     the root manifest's fifteen top-level keys — `planes`, `mvk`,
 *     `invariants`, `agent_instructions`, `relationship_patterns`, `version`
 *     and the `workspace_config` / `legacy_config` side-car pointers — were
 *     dropped on the floor, and `monorepo` / `generator` (which the splitter
 *     moves INTO the side-car) were never read back at all.
 *   - `BoundedContextSchema.layers` was a non-strict `z.object` that declared
 *     only `domain` / `application` / `infrastructure`, so `layers.ui` was
 *     silently stripped from every context file that declared it.
 *
 * The guard is therefore written as "compare the real input with the real
 * output", never as "assert the keys someone remembered to list". Adding a new
 * top-level key to `.architecture/manifest.yaml`, or a new `layers.*` key to a
 * context file, automatically extends the assertion.
 */

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this test file to the workspace root that owns `.architecture/`. */
function findRepoRoot(): string {
  let dir = TEST_DIR;
  for (;;) {
    if (existsSync(path.join(dir, ".architecture", "manifest.yaml")))
      return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate a workspace root with .architecture/manifest.yaml walking up from ${TEST_DIR}`,
      );
    }
    dir = parent;
  }
}

const ROOT = findRepoRoot();
const ARCH_DIR = path.join(ROOT, ".architecture");
const MANIFEST_PATH = path.join(ARCH_DIR, "manifest.yaml");

type RawRecord = Record<string, unknown>;

/**
 * The two keys whose contents `hexagen manifest split` moves out of the root
 * manifest and into the side-car named by `workspace_config:` — see
 * `CATEGORY_B_KEYS` in packages/sync/src/commands/manifest/split.ts. The merge
 * is the inverse of the split, so exactly these must come back.
 */
const SIDE_CAR_KEYS = ["monorepo", "generator"] as const;

/**
 * Structurally rebuilt by the merge (entries are `{ name, file }` pointers in
 * the index and full records in the merged form), so they are compared by
 * membership below rather than by deep equality.
 */
const REBUILT_KEYS = new Set(["bounded_contexts", "apps"]);

async function readYaml(file: string): Promise<RawRecord> {
  return (await yaml.load(await fs.readFile(file, "utf-8"))) as RawRecord;
}

/** Every `context.yaml` under `.architecture/contexts/`, recursively. */
async function findContextFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findContextFiles(full)));
    else if (entry.name === "context.yaml") out.push(full);
  }
  return out;
}

describe("mergeSplitManifest fidelity (real .architecture/ tree)", () => {
  let rawIndex: RawRecord;
  let sideCar: RawRecord;
  let merged: Manifest;
  let contextFiles: string[];

  beforeAll(async () => {
    rawIndex = await readYaml(MANIFEST_PATH);
    merged = await mergeSplitManifest(ROOT, MANIFEST_PATH);
    contextFiles = await findContextFiles(path.join(ARCH_DIR, "contexts"));

    const pointer = rawIndex.workspace_config;
    assert.equal(
      typeof pointer,
      "string",
      "This guard assumes the repo manifest is in split (index) form and names a workspace_config side-car",
    );
    sideCar = await readYaml(path.join(ARCH_DIR, pointer as string));
  });

  it("the repo's own manifest really is an index manifest (guard precondition)", () => {
    assert.equal(isIndexManifest(rawIndex), true);
    assert.ok(
      contextFiles.length > 0,
      "expected at least one real context.yaml to compare against",
    );
  });

  it("carries EVERY top-level key of the real index manifest into the merge", () => {
    const rawKeys = Object.keys(rawIndex);
    const mergedKeys = new Set(Object.keys(merged as unknown as RawRecord));
    const dropped = rawKeys.filter((k) => !mergedKeys.has(k));
    assert.deepStrictEqual(
      dropped,
      [],
      `mergeSplitManifest dropped top-level manifest keys: ${dropped.join(", ")}`,
    );
  });

  it("carries the non-rebuilt top-level values through unchanged", () => {
    const record = merged as unknown as RawRecord;
    for (const key of Object.keys(rawIndex)) {
      if (REBUILT_KEYS.has(key)) continue;
      assert.deepStrictEqual(
        record[key],
        rawIndex[key],
        `top-level key "${key}" was altered by the merge`,
      );
    }
  });

  it("restores monorepo and generator from the workspace_config side-car", () => {
    const record = merged as unknown as RawRecord;
    for (const key of SIDE_CAR_KEYS) {
      assert.ok(
        sideCar[key] !== undefined,
        `precondition: ${path.basename(String(rawIndex.workspace_config))} must declare "${key}"`,
      );
      assert.deepStrictEqual(
        record[key],
        sideCar[key],
        `"${key}" did not survive the split→merge round trip through the side-car`,
      );
    }
  });

  it("does not narrow the side-car blocks (no silent key stripping)", () => {
    // Named spot-checks for the three consumers the audit called out. They are
    // nested BELOW the keys asserted above, so a schema that declared
    // `monorepo`/`generator` but stripped their inner keys would still pass the
    // deepStrictEqual above only if it stripped nothing — this test states the
    // intent explicitly so a future narrowing fails with a readable message.
    const generator = (merged as unknown as RawRecord).generator as RawRecord;
    const monorepo = (merged as unknown as RawRecord).monorepo as RawRecord;
    const sync = generator.sync as RawRecord;

    assert.ok(sync.layers, "generator.sync.layers must survive the merge");
    assert.ok(sync.stubs, "generator.sync.stubs must survive the merge");
    assert.ok(
      Array.isArray(sync.protectedRootFiles),
      "generator.sync.protectedRootFiles must survive the merge (undeclared-but-present key)",
    );
    assert.ok(
      monorepo.archInvariants,
      "monorepo.archInvariants must survive the merge",
    );
    assert.ok(
      monorepo.turboConfig,
      "monorepo.turboConfig must survive the merge (undeclared-but-present key)",
    );
  });

  it("keeps every layers.* key declared by every real context file", async () => {
    const byName = new Map(
      (merged.bounded_contexts ?? []).map((c) => [c.name, c]),
    );
    const losses: string[] = [];

    for (const file of contextFiles) {
      const raw = await readYaml(file);
      const name = raw.name as string;
      const mergedCtx = byName.get(name);
      assert.ok(
        mergedCtx,
        `context "${name}" missing from the merged manifest`,
      );

      const rawLayers = Object.keys((raw.layers as RawRecord) ?? {});
      const mergedLayers = new Set(
        Object.keys((mergedCtx.layers as RawRecord | undefined) ?? {}),
      );
      for (const layer of rawLayers) {
        if (!mergedLayers.has(layer)) {
          losses.push(`${name}: layers.${layer}`);
        }
      }
    }

    assert.deepStrictEqual(
      losses,
      [],
      `the merge dropped layer keys that real context files declare: ${losses.join(", ")}`,
    );
  });

  it("keeps every top-level key declared by every real context file", async () => {
    const byName = new Map(
      (merged.bounded_contexts ?? []).map((c) => [c.name, c]),
    );
    const losses: string[] = [];

    for (const file of contextFiles) {
      const raw = await readYaml(file);
      const name = raw.name as string;
      const mergedCtx = byName.get(name) as unknown as RawRecord;
      const mergedKeys = new Set(Object.keys(mergedCtx));
      for (const key of Object.keys(raw)) {
        if (!mergedKeys.has(key)) losses.push(`${name}: ${key}`);
      }
    }

    assert.deepStrictEqual(
      losses,
      [],
      `the merge dropped context keys that real context files declare: ${losses.join(", ")}`,
    );
  });

  it("preserves layers.ui.components verbatim", async () => {
    // The one real occurrence today (projection/model-settings). Asserted by
    // value, not by presence, so a schema that declared `ui` but not its
    // `components` array would still fail.
    const withUi: Array<[string, unknown]> = [];
    for (const file of contextFiles) {
      const raw = await readYaml(file);
      const ui = (raw.layers as RawRecord | undefined)?.ui;
      if (ui !== undefined) withUi.push([raw.name as string, ui]);
    }
    assert.ok(
      withUi.length > 0,
      "precondition: at least one real context file must declare layers.ui",
    );

    const byName = new Map(
      (merged.bounded_contexts ?? []).map((c) => [c.name, c]),
    );
    for (const [name, ui] of withUi) {
      const mergedLayers = byName.get(name)?.layers as RawRecord | undefined;
      assert.deepStrictEqual(
        mergedLayers?.ui,
        ui,
        `layers.ui of "${name}" did not survive the merge`,
      );
    }
  });

  it("the merged manifest still validates against the strict ManifestSchema", () => {
    const result = ManifestSchema.safeParse(merged);
    assert.ok(
      result.success,
      `the merged manifest must remain a valid flat manifest: ${result.success ? "" : result.error.message}`,
    );
  });

  it("the merged manifest is no longer in index form", () => {
    // `version: '2.0'` is carried through with every other key, so this pins
    // the thing that makes the carry safe: merged contexts hold records, not
    // `file:` pointers, so a re-read can never mistake the merge for an index.
    assert.equal(isIndexManifest(merged), false);
  });
});
