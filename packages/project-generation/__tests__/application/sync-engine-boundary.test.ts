import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * HEX-004 — the application layer of this bounded context must not name the
 * sync CLI package.
 *
 * `@hexagen/sync` is the generator *engine*: this context drives it from
 * `infrastructure/adapters/external-sync-engine.adapter.ts`, and that is the
 * only place allowed to know it exists. Before this guard, the application's
 * ports and use case were typed on `Manifest` imported straight from it, so the
 * generation contracts could not be compiled — or exercised — without the
 * engine. They are typed on the context-owned `GenerationManifest` DTO instead.
 *
 * The check is a source scan rather than a type assertion on purpose: the defect
 * is the *import edge*, and an edge is only observable in the source text. A
 * type test would keep passing the moment someone re-added the import for a
 * different symbol.
 */
const APPLICATION_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/application",
);

/** Import/export specifier of any `... from "<spec>"`, plus bare `import "<spec>"`. */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && full.endsWith(".ts") ? [full] : [];
  });
}

function specifiersIn(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

describe("HEX-004 — application layer does not depend on @hexagen/sync", () => {
  it("finds application sources to scan (the scan is not vacuous)", () => {
    const files = tsFilesUnder(APPLICATION_DIR);
    assert.ok(
      files.length >= 5,
      `expected the application layer to hold several modules, found ${files.length}`,
    );
    // The scanner must actually see specifiers, or an "everything is clean"
    // verdict would be meaningless.
    const total = files.flatMap(specifiersIn).length;
    assert.ok(total > 0, "scanner extracted no import specifiers at all");
  });

  it("no application module imports @hexagen/sync", () => {
    const offenders = tsFilesUnder(APPLICATION_DIR)
      .map((file) => ({
        file: path.relative(APPLICATION_DIR, file),
        hits: specifiersIn(file).filter(
          (spec) =>
            spec === "@hexagen/sync" || spec.startsWith("@hexagen/sync/"),
        ),
      }))
      .filter(({ hits }) => hits.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `application modules importing the sync engine:\n${offenders
        .map((o) => `  ${o.file} -> ${o.hits.join(", ")}`)
        .join("\n")}`,
    );
  });
});
