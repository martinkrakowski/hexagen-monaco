import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { findMonorepoRoot } from "../../monorepo-root";

/**
 * Load the repo's OWN architecture manifest, merged exactly the way production
 * merges it, and hand it back as the YAML text `analyzeManifest` consumes.
 *
 * Why the real thing rather than a fixture: `manifest-analysis.ts` shipped a
 * read of `layers.domain.adapters` — a key that appears in ZERO of the repo's
 * 34 `context.yaml` files — and its suite stayed green because the fixture
 * hand-wrote that shape. A hand-written fixture can agree with a hand-written
 * bug forever. Driving the suite from `.architecture/` means the only way to
 * make these assertions pass is to read keys the repo actually writes.
 *
 * `.architecture/manifest.yaml` is an INDEX manifest: each `bounded_contexts`
 * entry carries a `file:` pointer instead of inline `layers`. Production merges
 * those context files in before anything reads `layers` (see
 * `app/api/llm/context/route.ts` → `mergeSplitManifest`); this mirrors that
 * merge with the same field precedence — the context file wins over the index
 * stub — so the object under test is the one governance would really see.
 */
export interface RealManifest {
  /** The merged manifest as YAML text — the analyzer's input type. */
  yamlText: string;
  /** The merged manifest as a parsed object, for key-path assertions. */
  parsed: Record<string, unknown>;
  /** Absolute path of the monorepo root the manifest was read from. */
  root: string;
}

interface IndexEntry {
  name?: string;
  file?: string;
  [key: string]: unknown;
}

export async function loadRealMergedManifest(): Promise<RealManifest> {
  // No explicit start dir: `findMonorepoRoot` walks upward from the test
  // process cwd, which is inside the repo whether Vitest is launched from
  // `apps/web` or from the monorepo root.
  const root = findMonorepoRoot();
  const architectureDir = join(root, ".architecture");
  const index = yaml.load(
    await readFile(join(architectureDir, "manifest.yaml"), "utf-8"),
  ) as { bounded_contexts?: IndexEntry[] } & Record<string, unknown>;

  const entries = index.bounded_contexts ?? [];
  const merged: IndexEntry[] = [];
  for (const entry of entries) {
    if (typeof entry.file !== "string") {
      merged.push(entry);
      continue;
    }
    const body = yaml.load(
      await readFile(join(architectureDir, entry.file), "utf-8"),
    ) as Record<string, unknown>;
    const stub: IndexEntry = { ...entry, ...body };
    delete stub.file;
    merged.push(stub);
  }

  const parsed = { ...index, bounded_contexts: merged };
  return { yamlText: yaml.dump(parsed), parsed, root };
}

/**
 * Every key path present anywhere in a parsed manifest, as dotted paths rooted
 * at the document, with `bounded_contexts` array elements flattened onto the
 * `bounded_contexts.<key>` prefix. Array indices are NOT part of a path — the
 * question these paths answer is "does any real context provide this key?", not
 * "which one".
 */
export function collectKeyPaths(
  node: unknown,
  prefix = "",
  seen: Set<string> = new Set(),
): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectKeyPaths(item, prefix, seen);
    return seen;
  }
  if (typeof node !== "object" || node === null) return seen;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    seen.add(path);
    collectKeyPaths(value, path, seen);
  }
  return seen;
}
