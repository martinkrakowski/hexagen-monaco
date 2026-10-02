import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const dirs: string[] = [];

export async function cleanup(): Promise<void> {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
}

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

export async function put(
  root: string,
  rel: string,
  text = "x\n",
): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
}

/** A git repo with one commit holding the given files. */
export async function makeRepo(
  files: readonly string[] = ["src/a.ts", "src/b.ts", "lib/c.ts", "other/d.go"],
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "bf-slice-"));
  dirs.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.test");
  for (const f of files) await put(root, f);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

export interface Edge {
  from: string;
  to: string;
  specifier: string;
}
export interface Unresolved {
  from: string;
  specifier: string;
  reason: string;
}

/** Hand-written synthetic observed report at the repo's HEAD. */
export async function writeObserved(
  root: string,
  opts: {
    edges?: Edge[];
    unresolved?: Unresolved[];
    unreadLanguages?: string[];
    edgesCollected?: boolean;
    commit?: string;
  } = {},
): Promise<void> {
  const commit = opts.commit ?? git(root, "rev-parse", "HEAD");
  const empty = { collected: true, items: [] };
  const report = {
    schemaVersion: "1.0.0",
    repo: { commit },
    generatedAt: "2026-10-01T00:00:00Z",
    packages: empty,
    languages: empty,
    build: empty,
    generated: empty,
    dontTouch: empty,
    edges:
      opts.edgesCollected === false
        ? { collected: false, reason: "synthetic: not collected" }
        : {
            collected: true,
            unreadLanguages: opts.unreadLanguages ?? [],
            items: opts.edges ?? [],
          },
    unresolved:
      opts.edgesCollected === false
        ? { collected: false, reason: "synthetic: not collected" }
        : { collected: true, items: opts.unresolved ?? [] },
    limits: { truncated: false, reasons: [] },
  };
  await put(root, ".hexagen/observed.json", JSON.stringify(report));
}
