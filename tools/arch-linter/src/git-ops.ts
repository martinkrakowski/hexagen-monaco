/**
 * Git helpers for `--staged` and `--pr-diff`. Kept out of `cli.ts` so the
 * parsers stay unit-testable; these functions only shell out.
 */
import { execFileSync } from "node:child_process";

export function gitText(
  root: string,
  args: string[],
): { ok: true; text: string } | { ok: false; message: string } {
  try {
    const text = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, text };
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    return {
      ok: false,
      message:
        (err.stderr && String(err.stderr).trim()) ||
        err.message ||
        "git failed",
    };
  }
}

export function stagedFiles(root: string): string[] {
  const result = gitText(root, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);
  if (!result.ok) {
    throw new Error(`--staged requires a git work tree: ${result.message}`);
  }
  return result.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function showFileAtRef(
  root: string,
  ref: string,
  relativePath: string,
): string | null {
  const result = gitText(root, ["show", `${ref}:${relativePath}`]);
  if (!result.ok) return null;
  return result.text;
}

export function renameNameStatus(root: string, baseRef: string): string {
  const result = gitText(root, [
    "diff",
    "--name-status",
    "--find-renames",
    `${baseRef}...HEAD`,
  ]);
  if (!result.ok) return "";
  return result.text;
}

/**
 * `--base-ref` wins; else `GITHUB_BASE_REF` (the GitHub Actions PR base);
 * a bare branch name is prefixed with `origin/`.
 */
export function resolveBaseRef(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = (explicit ?? env["GITHUB_BASE_REF"] ?? "").trim();
  if (!raw) return null;
  if (raw.includes("/") || raw.startsWith("origin/")) return raw;
  return `origin/${raw}`;
}
