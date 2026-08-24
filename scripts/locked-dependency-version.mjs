/**
 * Print the version yarn.lock resolved for a ROOT dependency.
 *
 *   node scripts/locked-dependency-version.mjs prettier   →  3.8.1
 *
 * Why this exists: the lint workflow's docs-only fast path skips
 * `yarn install`, and a bare `npx prettier` with no node_modules downloads
 * the NEWEST release rather than the locked one. On 2026-08-23 that judged
 * the tree with 3.9.6 against a lockfile pinned to 3.8.1 and flagged 85
 * files no PR had touched. The workflow runs `npx prettier@$(this)` instead.
 *
 * It resolves the root package.json selector to its lockfile block rather
 * than taking "the first prettier@ block": a second `prettier@npm:<range>`
 * entry from any workspace or plugin would otherwise win silently. Yarn 4
 * lockfile keys may carry several selectors (`"a@npm:^1, a@npm:^1.2":`), so
 * the key is split and each selector compared whole.
 *
 * Exit codes: 0 printed a version; 1 usage / not a root dependency / no
 * matching lockfile block. Never prints a guess.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Pure: given the root package.json and yarn.lock text, the locked version or null. */
export function lockedVersion(name, packageJsonText, lockfileText) {
  const pkg = JSON.parse(packageJsonText);
  const range = pkg.devDependencies?.[name] ?? pkg.dependencies?.[name];
  if (!range) return null;
  const wanted = `${name}@npm:${range}`;
  let inBlock = false;
  for (const line of lockfileText.split("\n")) {
    if (/^"/.test(line)) {
      const key = line.replace(/^"/, "").replace(/":\s*$/, "");
      inBlock = key.split(", ").includes(wanted);
      continue;
    }
    if (!inBlock) continue;
    const m = /^\s+version:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (m) return m[1];
  }
  return null;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const name = process.argv[2];
  if (!name) {
    console.error(
      "usage: node scripts/locked-dependency-version.mjs <root-dependency-name>",
    );
    process.exit(1);
  }
  const version = lockedVersion(
    name,
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    fs.readFileSync(path.join(REPO_ROOT, "yarn.lock"), "utf8"),
  );
  if (!version) {
    console.error(
      `::error::yarn.lock has no block matching the root selector for "${name}"`,
    );
    process.exit(1);
  }
  process.stdout.write(`${version}\n`);
}
