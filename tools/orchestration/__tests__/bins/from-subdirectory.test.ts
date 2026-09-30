import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * F8: `init` and `doctor` bound to the current directory.
 *
 * These run the BUILT bins, from a subdirectory of a real git repository,
 * because the defect lives in the bin's top-level wiring (`loadConfigFor()` with
 * no root), which nothing that calls the library functions can reach.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const bin = (name: string): string =>
  join(PACKAGE_ROOT, "dist/bins", `${name}.js`);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A git repository with an overlay, a ci.yml and an `agents_md: false` record. */
function repository(overlay: readonly string[]): { root: string; sub: string } {
  const root = mkdtempSync(join(tmpdir(), "orchestration-sub-"));
  dirs.push(root);
  const git = spawnSync("git", ["init", "-q"], { cwd: root });
  expect(git.status).toBe(0);
  mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
  for (const file of overlay) {
    writeFileSync(
      join(root, ".agents/orchestration", file),
      file === "config.yaml"
        ? "repo: acme/demo\nforbiddenPorts: [3000]\n"
        : `# ${file}\n`,
    );
  }
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "name: ci\n");
  writeFileSync(
    join(root, ".hexagen-template-config.json"),
    JSON.stringify({
      schemaVersion: "1",
      templates: {
        orchestration: {
          installedAt: "2026-09-29T00:00:00.000Z",
          version: "0.1.0",
          answers: { agents_md: false },
          generatedFiles: [],
        },
      },
    }),
  );
  const sub = join(root, "packages/deep/er");
  mkdirSync(sub, { recursive: true });
  return { root, sub };
}

const run = (name: string, cwd: string) =>
  spawnSync(process.execPath, [bin(name)], { cwd, encoding: "utf8" });

beforeAll(() => {
  expect(existsSync(bin("doctor")), "run `yarn build` first").toBe(true);
});

describe("F8: the bins find the repository root from a subdirectory", () => {
  test("doctor reads the real overlay and the real ci.yml", () => {
    const { sub } = repository([
      "config.yaml",
      "house-rules.md",
      "cast.md",
      "lessons.md",
    ]);
    const result = run("doctor", sub);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).not.toContain("no overlay at");
    expect(out).not.toContain("ci.yml is missing");
    // It read THIS overlay: the resolved repo is not asked of gh, and the
    // forbidden port from the file is honoured.
    expect(out).not.toContain("[repo]");
    expect(result.status).not.toBe(2);
  });

  test("init scaffolds at the root, honours agents_md: false, and writes nothing in the subdirectory", () => {
    const { root, sub } = repository(["config.yaml"]);
    const configBefore = readFileSync(
      join(root, ".agents/orchestration/config.yaml"),
      "utf8",
    );
    const result = run("init", sub);
    expect(result.status).toBe(0);

    const rules = readFileSync(
      join(root, ".agents/orchestration/house-rules.md"),
      "utf8",
    );
    expect(rules).not.toContain("Wave Observability");
    expect(existsSync(join(root, ".agents/orchestration/cast.md"))).toBe(true);
    expect(
      readFileSync(join(root, ".agents/orchestration/config.yaml"), "utf8"),
    ).toBe(configBefore);
    expect(existsSync(join(sub, ".agents"))).toBe(false);
  });
});
