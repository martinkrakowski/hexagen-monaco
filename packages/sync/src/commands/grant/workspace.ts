import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Slice } from "@hexagen/shared";
import { isSameOrInside } from "../observe/same-path.js";
import { findWorkspaceRoot } from "../shared/project-root.js";

export async function loadSlice(
  workspaceRoot: string,
): Promise<Slice | undefined> {
  let raw: string;
  try {
    raw = await readFile(
      path.join(workspaceRoot, ".hexagen", "slice.json"),
      "utf-8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return Slice.parse(JSON.parse(raw));
}

/** Real path of the git work tree containing `cwd`, or null outside git. */
function gitToplevel(cwd: string): string | null {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return top ? realpathSync.native(path.resolve(top)) : null;
  } catch {
    return null;
  }
}

/**
 * Which workspace root the grant commands (issue, show, check) work from. `findWorkspaceRoot` walks up to ANY parent manifest,
 * so a client repo checked out beneath a monorepo would inherit its repo mode
 * (and its key). The git toplevel is the repo boundary: when discovery lands
 * outside it, the toplevel wins. A manifest at or below the toplevel (a HexaGen
 * project inside a larger repo) stays the root. `--workspace-root` overrides.
 */
export function discoverWorkspaceRoot(workspaceRootOption?: string): string {
  if (workspaceRootOption) return path.resolve(workspaceRootOption);
  const cwd = process.cwd();
  const found = findWorkspaceRoot(cwd);
  const top = gitToplevel(cwd);
  // Nothing declares a workspace: the git toplevel is the repo boundary, not
  // whichever subdirectory the command happened to run in.
  if (found === null) return top ?? cwd;
  const discovered = found;
  if (top === null) return discovered;
  try {
    // `top` came from git (forward slashes, maybe another case or an 8.3 name
    // on Windows); resolve both sides the same way before comparing.
    const realTop = realpathSync.native(path.resolve(top));
    const realDiscovered = realpathSync.native(path.resolve(discovered));
    return isSameOrInside(realTop, realDiscovered) ? discovered : top;
  } catch {
    return top;
  }
}
