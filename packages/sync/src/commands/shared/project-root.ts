import { existsSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

/**
 * Detect if we're in a git worktree and return its root.
 * Returns null if not in a worktree or if git command fails.
 */
function getWorktreeRoot(from: string): string | null {
  try {
    // Check if we're in a git worktree (not the main working tree)
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: from,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // In a worktree, .git is a file, not a directory
    // In main repo, .git is a directory
    const gitPath = join(from, gitDir);
    if (existsSync(gitPath) && !existsSync(join(gitPath, "HEAD"))) {
      // This is a worktree - get its root
      const worktreeRoot = execSync("git rev-parse --show-toplevel", {
        cwd: from,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return worktreeRoot;
    }
  } catch {
    // Not in a git repo or command failed - fall through to normal search
  }
  return null;
}

export function findProjectRoot(from: string): string | null {
  // First, check if we're in a git worktree
  const worktreeRoot = getWorktreeRoot(from);
  if (worktreeRoot) {
    const manifestPath = join(worktreeRoot, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return worktreeRoot;
    }
  }

  // Fall back to walking up the directory tree
  let current = from;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function getProjectRoot(): string {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    // eslint-disable-next-line no-console
    console.error(
      "❌ No project root found. Is .architecture/manifest.yaml present?",
    );
    process.exit(1);
  }
  return root;
}
