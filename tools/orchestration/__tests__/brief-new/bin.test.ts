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
import { dirname, join, resolve, delimiter } from "node:path";

/**
 * The built bin's wiring: a command line that cannot be acted on is refused
 * (exit 2) BEFORE the overlay is loaded, and an overlay is read without asking
 * the forge for a repository.
 */
const BIN = resolve(import.meta.dirname, "../../dist/bins/brief-new.js");

const CONFIG = `laneHosts:
  - name: midnight
    dispatch: [ocm-run]
    gate: targeted-only
  - name: local
    dispatch: [run]
    gate: full
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  expect(existsSync(BIN), "run `yarn build` first").toBe(true);
});

function sandbox(config?: string) {
  const root = mkdtempSync(join(tmpdir(), "brief-new-bin-"));
  dirs.push(root);
  expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
  if (config !== undefined) {
    mkdirSync(join(root, ".agents/orchestration"), { recursive: true });
    writeFileSync(join(root, ".agents/orchestration/config.yaml"), config);
  }
  const run = (args: string[]) =>
    spawnSync(process.execPath, [BIN, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: root,
        PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
      },
    });
  return { root, run };
}

const ARGS = (host: string) => [
  "--lane",
  "PB6",
  "--plan",
  "docs/plan.md",
  "--branch",
  "feat/x",
  "--tip",
  "abc1234",
  "--host",
  host,
];

describe("brief-new bin", () => {
  test("a bad command line exits 2 with the usage, and is not answered with an overlay complaint", () => {
    const { run } = sandbox("nope: 1\n");
    const result = run(["--lane", "a b"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: hexagen-orchestration-brief-new");
    expect(result.stderr).not.toContain("nope");
  });

  test("a good command line still reaches the overlay check", () => {
    const { run } = sandbox("nope: 1\n");
    const result = run(ARGS("midnight"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nope");
  });

  test("an unknown host is exit 2", () => {
    const { run } = sandbox(CONFIG);
    const result = run(ARGS("nowhere"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--host 'nowhere'");
  });

  test("a known host writes the brief into a directory the bin creates, and a second run refuses it", () => {
    const { root, run } = sandbox(CONFIG);
    const out = join(root, "briefs", "deep", "PB6.md");
    const first = run([...ARGS("midnight"), "--env", "K=v", "--out", out]);
    expect(first.status, first.stderr).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("You are lane PB6");
    expect(text).toContain("K=v");
    expect(text).toContain("`gate: targeted-only`");
    const second = run([...ARGS("midnight"), "--out", out]);
    expect(second.status).toBe(1);
    expect(readFileSync(out, "utf8")).toBe(text);
  });

  test("without --out the brief goes to stdout", () => {
    const { run } = sandbox(CONFIG);
    const result = run(ARGS("local"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("`gate: full`");
  });
});
