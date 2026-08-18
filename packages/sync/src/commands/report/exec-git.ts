import { execFileSync } from "node:child_process";
import type { GitReader } from "./types.js";

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

export function createGitReader(workspaceRoot: string): GitReader {
  return {
    logFollow(relativePath: string) {
      const text = git(workspaceRoot, [
        "log",
        "--follow",
        "--pretty=format:%H%x09%cI%x09%s",
        "--",
        relativePath,
      ]);
      if (text === null || text.trim() === "") return [];
      return text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .map((line) => {
          const [hash, isoDate, ...rest] = line.split("\t");
          return {
            hash: hash ?? "",
            isoDate: isoDate ?? "",
            subject: rest.join("\t"),
          };
        })
        .filter((row) => row.hash.length > 0);
    },
    show(hash: string, relativePath: string) {
      return git(workspaceRoot, ["show", `${hash}:${relativePath}`]);
    },
  };
}
