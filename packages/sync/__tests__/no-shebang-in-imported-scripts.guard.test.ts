import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * A root `scripts/` module that a test imports must NOT begin with a shebang.
 *
 * On Windows, vitest's transform leaves `#!` in place for a file outside the
 * package root; Node then reports `SyntaxError: Invalid or unexpected token`
 * with no stack and the importing test file collects ZERO tests — it does not
 * fail loudly, it disappears. The Windows leg (#640) caught this on
 * `scripts/bump-version.js`; the sibling `scripts/locked-dependency-version.mjs`
 * survived only because it happened to omit the shebang that every other
 * script in `scripts/` carries.
 *
 * The rule, therefore: CLI scripts keep their shebang, and any logic a test
 * needs is extracted into a shebang-free module (see `scripts/lib/`).
 *
 * What this cannot catch: a test that imports a script through an alias or a
 * dynamic specifier this scan cannot see. It reads static relative imports.
 */
describe("scripts imported by tests carry no shebang", () => {
  it("every statically imported scripts/ module starts with real code", async () => {
    const testFiles = execFileSync(
      "git",
      ["ls-files", "--", "*__tests__/*.ts", "*.test.ts", "*.test.tsx"],
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    )
      .split("\n")
      .filter(Boolean);

    assert.ok(
      testFiles.length > 50,
      `discovery found only ${testFiles.length} test files; the scan is not looking at the suite`,
    );

    const imported = new Set<string>();
    for (const rel of testFiles) {
      const source = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      for (const m of source.matchAll(
        /from\s+"([^"]*\/scripts\/[^"]+\.(?:m?js|ts))"/g,
      )) {
        imported.add(
          path.relative(
            REPO_ROOT,
            path.resolve(path.dirname(path.join(REPO_ROOT, rel)), m[1]),
          ),
        );
      }
    }

    // Non-vacuity: tests do import root scripts today. If this reads zero the
    // regex stopped matching and the guard is checking nothing.
    assert.ok(
      imported.size > 0,
      "no test imports a scripts/ module — the import scan matched nothing, so this guard is vacuous",
    );

    const offenders: string[] = [];
    for (const rel of imported) {
      const text = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      if (text.startsWith("#!")) offenders.push(rel);
    }

    assert.deepEqual(
      offenders,
      [],
      `these scripts are imported by a test AND start with a shebang, which makes the ` +
        `importing test collect zero tests on Windows instead of failing loudly:\n` +
        offenders.map((o) => `  ${o}`).join("\n") +
        `\nExtract the importable logic into a shebang-free module (scripts/lib/).`,
    );
  });
});
