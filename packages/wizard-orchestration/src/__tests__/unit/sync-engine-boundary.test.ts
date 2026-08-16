import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * HEX-004 — this bounded context does not depend on the sync CLI package.
 *
 * `wizardToManifest` is a *projection*: wizard answers in, a manifest-shaped
 * plain object out. It emits the generator's dialect but it does not drive the
 * generator, so it has no business naming `@hexagen/sync`. It used to, purely to
 * reach `Manifest["apps"]` for two type positions — an import edge onto a CLI
 * package for the sake of a string union. Those positions are now typed on the
 * context-owned DTO in `application/manifest-app.dto.ts`.
 *
 * Two assertions, because the two failure modes are different:
 *   - the *source scan* catches a re-added import (all workspaces are hoisted
 *     into the root `node_modules`, so a dropped dependency still resolves —
 *     dropping it alone enforces nothing);
 *   - the *manifest check* catches the declaration creeping back, which is what
 *     makes the package graph claim a coupling that does not exist.
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SRC_DIR = path.join(PACKAGE_ROOT, "src");
const SYNC_PACKAGE = "@hexagen/sync";

/** Import/export specifier of any `... from "<spec>"`, plus bare `import "<spec>"`. */
const SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function specifiersIn(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

describe("HEX-004 — wizard-orchestration is independent of @hexagen/sync", () => {
  it("finds sources to scan (the scan is not vacuous)", () => {
    const files = tsFilesUnder(SRC_DIR);
    assert.ok(
      files.length >= 10,
      `expected the package to hold several modules, found ${files.length}`,
    );
    assert.ok(
      files.flatMap(specifiersIn).length > 0,
      "scanner extracted no import specifiers at all",
    );
  });

  it("no module imports the sync engine", () => {
    // This test file names the package in prose only; exclude it so the guard
    // cannot be satisfied — or broken — by its own text.
    const self = fileURLToPath(import.meta.url);
    const offenders = tsFilesUnder(SRC_DIR)
      .filter((file) => file !== self)
      .map((file) => ({
        file: path.relative(PACKAGE_ROOT, file),
        hits: specifiersIn(file).filter(
          (spec) =>
            spec === SYNC_PACKAGE || spec.startsWith(`${SYNC_PACKAGE}/`),
        ),
      }))
      .filter(({ hits }) => hits.length > 0);

    assert.deepEqual(
      offenders,
      [],
      `modules importing the sync engine:\n${offenders
        .map((o) => `  ${o.file} -> ${o.hits.join(", ")}`)
        .join("\n")}`,
    );
  });

  it("package.json declares no dependency on the sync engine", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;

    const declaredIn = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ].filter((field) => manifest[field]?.[SYNC_PACKAGE] !== undefined);

    assert.deepEqual(
      declaredIn,
      [],
      `${SYNC_PACKAGE} is still declared in: ${declaredIn.join(", ")}`,
    );
  });
});
