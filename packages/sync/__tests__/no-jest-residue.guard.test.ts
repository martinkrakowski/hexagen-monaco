import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Repo-wide guard: this monorepo runs Vitest (ADR-0044) and must carry no Jest.
 *
 * Why this exists. The Vitest migration completed in #386, yet three years of
 * Jest configuration survived it untouched — `jest.config.cjs` /
 * `jest.resolver.cjs` / `jest.setup.js` in `agentic-interaction`, a root
 * `jest.setup.js`, a `jest.config.cjs` in `ui-projection-compiler` for a package
 * that never declared Jest at all, a `test:jest` script, `jest` + `ts-jest` +
 * `jest-environment-jsdom` in two manifests, and `types: ["jest"]` in
 * `ai-pipeline`'s orphaned `tsconfig.test.json`. None of it ran. All of it read
 * as a live second test stack to anyone (or any agent) opening the repo — which
 * is exactly the failure mode AGENTS.md §Tech Stack tries to prevent with
 * "Never suggest: … Jest". Item 3.2 (MOD-003, MOD-006) removed it.
 *
 * Dead config does not announce itself, so its return would be as quiet as its
 * survival was. This is the checked form of the convention: a written rule that
 * nothing enforces is how the residue accumulated in the first place, the same
 * class as the undeclared-`vitest` bug (#455) guarded by
 * `workspace-tool-declaration.guard.test.ts` next door.
 *
 * Scope note: this asserts ABSENCE of Jest, not presence of Vitest. Whether a
 * package has tests at all, and whether they run, is a separate concern (see
 * AUD-021 coverage work) — conflating them here would make one failure report
 * two different fixes.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * Directories the walk never enters.
 *
 * `node_modules` is the load-bearing one: Jest lives there legitimately as a
 * transitive of other tooling, and matching it would make this guard permanently
 * red. The build outputs (`dist`, `dist-test`, `.next`, `.turbo`, `coverage`)
 * are derived — a hit inside them is a stale artifact, not a source fact.
 *
 * `.claude` is skipped because agent worktrees are checked out beneath it: from
 * a primary checkout the walk would otherwise descend into every parallel
 * worktree and report ITS residue as this tree's, which is both wrong and
 * unfixable from here.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".yarn",
  ".claude",
  "dist",
  "dist-test",
  ".next",
  ".turbo",
  "coverage",
]);

/**
 * Package names that mean "Jest is installed here".
 *
 * `@[scope]/jest` covers the third-party transform adapters (`@swc/jest`,
 * `@sucrase/jest-plugin`'s cousins) — a package can only be named that to plug
 * INTO Jest, so its presence means a Jest run is being configured somewhere.
 *
 * Deliberately NOT matched: `@testing-library/jest-dom`. Despite the name it is
 * a DOM matcher library (`expect.extend`) that supports Vitest as a first-class
 * target and pulls in no Jest runtime — banning it would be banning a name, not
 * a dependency. It is excluded by construction (the scoped rule matches only an
 * exact `/jest` tail, not `/jest-*`), and asserted below so a widened pattern
 * cannot quietly start banning it.
 */
const JEST_PACKAGE =
  /^(jest|jest-cli|ts-jest|babel-jest|jest-[^/]+|@types\/jest|@jest\/[^/]+|@[^/]+\/jest)$/;

/** Binaries whose invocation from a script means Jest is being run. */
const JEST_BINARY = /^(jest|jest-cli)$/;

type Json = Record<string, unknown>;

type Found = {
  /** Repo-relative, POSIX-separated — stable across platforms in messages. */
  jestNamedFiles: string[];
  manifests: string[];
  tsconfigs: string[];
};

const rel = (absolute: string) =>
  path.relative(REPO_ROOT, absolute).split(path.sep).join("/");

/**
 * One traversal per run, shared by every assertion below. The tree is read-only
 * for the duration of a test run, so re-walking it four times would buy nothing
 * but I/O — and this walk is the guard's slowest part.
 */
let discovery: Promise<Found> | undefined;
const walk = (): Promise<Found> => (discovery ??= traverse());

async function traverse(): Promise<Found> {
  const found: Found = { jestNamedFiles: [], manifests: [], tsconfigs: [] };
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      // `jest.config.cjs`, `jest.setup.js`, `jest.resolver.cjs`, `jest.config.ts`…
      // Matching the `jest.` prefix rather than an enumerated list: the point is
      // that no Jest-owned file shape returns, including ones not seen yet.
      if (entry.name.startsWith("jest.")) found.jestNamedFiles.push(absolute);
      if (entry.name === "package.json") found.manifests.push(absolute);
      if (/^tsconfig(\..+)?\.json$/.test(entry.name))
        found.tsconfigs.push(absolute);
    }
  };
  await visit(REPO_ROOT);
  return found;
}

/**
 * `tsconfig.json` is JSONC in practice — `apps/api-gateway/tsconfig.json` carries
 * trailing line comments, and TypeScript accepts them. Strip comments and
 * trailing commas, string-aware so a `//` inside a value survives.
 */
function parseJsonc(source: string, file: string): Json {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i++;
      } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += char;
  }
  const withoutTrailingCommas = out.replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(withoutTrailingCommas) as Json;
  } catch (error) {
    // A file this guard cannot read is a file this guard is not checking.
    // Fail loudly rather than skipping: silent gaps are how residue survives.
    return assert.fail(
      `${rel(file)} could not be parsed as JSON(C) — teach this guard the ` +
        `syntax rather than letting the file go unchecked. ${String(error)}`,
    );
  }
}

async function readJsonc(file: string): Promise<Json> {
  return parseJsonc(await fs.readFile(file, "utf8"), file);
}

/**
 * The Jest binaries a script command runs, in whatever position they appear.
 *
 * The sibling workspace-tool-declaration guard resolves the ONE binary each
 * segment invokes, because it asks "is this command's tool declared?". This
 * guard asks the opposite question — "does Jest run anywhere in here?" — and
 * command position is not where the answer lives. `jest` reaches the shell as a
 * bare word, behind a launcher (`npx jest`, `yarn dlx jest`), as a path
 * (`./node_modules/.bin/jest`), as an argument to another runtime
 * (`node ./node_modules/.bin/jest`), and on Windows with a `.cmd` tail. Chasing
 * each form through a positional parser is how a bypass survives; scanning every
 * token for a Jest basename has no positions to miss.
 *
 * The trade-off is a possible false positive — a literal argument that happens
 * to be exactly `jest`. That failure is loud, visible in the violation message,
 * and one line to adjudicate. A silent bypass is neither.
 */
function jestBinariesInvoked(command: string): string[] {
  const hits: string[] = [];
  for (const token of command.split(/\s+/).filter(Boolean)) {
    // Basename across both separators, minus a Windows launcher suffix.
    const base = (token.split(/[\\/]/).pop() ?? "").replace(
      /\.(cmd|ps1|exe|bat)$/i,
      "",
    );
    if (JEST_BINARY.test(base)) hits.push(base);
  }
  return hits;
}

describe("no Jest residue", () => {
  it("discovery reaches the whole repo", async () => {
    const { manifests, tsconfigs } = await walk();
    // Anchors, not magic numbers: the root manifest and the base tsconfig must
    // both be reachable, or the walk is rooted somewhere unexpected and every
    // other assertion below would pass vacuously.
    assert.ok(
      manifests.some((file) => rel(file) === "package.json"),
      `walk did not reach the root package.json from ${REPO_ROOT}`,
    );
    assert.ok(
      tsconfigs.some((file) => rel(file) === "tsconfig.base.json"),
      `walk did not reach tsconfig.base.json from ${REPO_ROOT}`,
    );
    assert.ok(
      manifests.some((file) => rel(file) === "packages/sync/package.json"),
      `walk did not reach packages/sync, the package this guard lives in`,
    );
  });

  it("no jest.* config, setup, or resolver file exists", async () => {
    const { jestNamedFiles } = await walk();
    assert.deepEqual(
      jestNamedFiles.map(rel).sort(),
      [],
      `This repo runs Vitest (ADR-0044). A jest.* file is either dead config ` +
        `(delete it) or a second test stack (do not add one).`,
    );
  });

  it("no manifest declares a Jest package or runs a Jest binary", async () => {
    const { manifests } = await walk();
    const violations: string[] = [];
    for (const file of manifests) {
      const pkg = (await readJsonc(file)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      const declared = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
      ];
      for (const dep of declared) {
        if (JEST_PACKAGE.test(dep))
          violations.push(`${rel(file)}: declares "${dep}"`);
      }
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        for (const bin of jestBinariesInvoked(command))
          violations.push(`${rel(file)}: script "${name}" invokes "${bin}"`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Jest packages and scripts must not reappear — Vitest is the runner ` +
        `(ADR-0044, AGENTS.md §Tech Stack).\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });

  /**
   * The two matchers above are the whole guard: everything else is a file walk.
   * A gap in either is invisible — the suite stays green while checking less —
   * so they are exercised directly rather than only through the repo's current
   * (clean) state, which cannot demonstrate a detection that does not exist.
   */
  it("recognises Jest packages, including scoped adapters, but not jest-dom", () => {
    const banned = [
      "jest",
      "jest-cli",
      "ts-jest",
      "babel-jest",
      "jest-environment-jsdom",
      "@types/jest",
      "@jest/globals",
      "@swc/jest",
    ].filter((name) => !JEST_PACKAGE.test(name));
    assert.deepEqual(
      banned,
      [],
      `not recognised as Jest: ${banned.join(", ")}`,
    );

    const allowed = [
      "@testing-library/jest-dom",
      "vitest",
      "@vitest/coverage-v8",
      "jsdom",
      "@types/jsdom",
    ].filter((name) => JEST_PACKAGE.test(name));
    assert.deepEqual(
      allowed,
      [],
      `wrongly flagged as Jest: ${allowed.join(", ")}. ` +
        `\`@testing-library/jest-dom\` in particular is a Vitest-compatible ` +
        `matcher library — this guard bans a dependency, not a name.`,
    );
  });

  it("sees a Jest invocation wherever in a command it hides", () => {
    const missed = [
      "jest",
      "jest --config jest.config.cjs",
      "npx jest",
      "yarn dlx jest --ci",
      "tsc && jest",
      "./node_modules/.bin/jest",
      "node ./node_modules/.bin/jest --runInBand",
      "node_modules\\.bin\\jest.cmd",
    ].filter((command) => jestBinariesInvoked(command).length === 0);
    assert.deepEqual(missed, [], `Jest invocation not detected in: ${missed}`);

    const falsePositives = [
      "vitest run",
      "vitest run __tests__/no-jest-residue.guard.test.ts",
      "eslint src --rulesdir ./jest-rules",
    ].filter((command) => jestBinariesInvoked(command).length > 0);
    assert.deepEqual(
      falsePositives,
      [],
      `wrongly read as a Jest invocation: ${falsePositives}`,
    );
  });

  it("no tsconfig pulls in Jest ambient types", async () => {
    const { tsconfigs } = await walk();
    const violations: string[] = [];
    for (const file of tsconfigs) {
      const config = (await readJsonc(file)) as {
        compilerOptions?: { types?: unknown };
      };
      const types = config.compilerOptions?.types;
      if (!Array.isArray(types)) continue;
      if (types.some((entry) => entry === "jest" || entry === "@types/jest"))
        violations.push(`${rel(file)}: compilerOptions.types includes "jest"`);
    }
    assert.deepEqual(
      violations,
      [],
      `\`types: ["jest"]\` types the test tree against a runner that is not ` +
        `installed: every \`describe\`/\`it\` resolves to a Jest global that ` +
        `does not exist at runtime. Use Vitest's imports instead.\n\n` +
        violations.map((v) => `  - ${v}`).join("\n"),
    );
  });
});
