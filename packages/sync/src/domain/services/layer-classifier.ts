import type { Layer } from "./impact-analysis.types.js";

/**
 * Reduce an absolute file path to a workspace-relative POSIX path.
 *
 * Both classifiers below read a *workspace-relative POSIX* string —
 * `determinePackageName` anchors on `/^(?:packages|apps)\//` and
 * `determineLayer` matches on `/domain/`-style segments — so producing that
 * dialect is part of the same contract and lives here beside them.
 *
 * The two arguments arrive in **different dialects**, which is the whole point.
 * `filePath` reaches the caller as a ts-morph *output*: `getFilePath()` returns
 * a `StandardizedFilePath`, already slash-normalised even on Windows
 * (`C:\ws\a.ts` -> `C:/ws/a.ts`). `workspaceRoot` is a raw *input* — whatever
 * the caller handed the analyser, on Windows a native `path.join`/`os.tmpdir`
 * string full of backslashes. Subtracting one from the other with a literal
 * `` `${workspaceRoot}/` `` prefix strip therefore matched nothing on Windows
 * and left the absolute path in `FileToModify.path`, which then failed the
 * `^(?:packages|apps)/` anchor and classified every file as package "unknown".
 * `@hexagen/sync` is published and `hexagen arch refactor` runs on consumer
 * machines, so that was a consumer-facing defect, not a test-only one.
 *
 * Implemented as pure segment arithmetic rather than `node:path` because this
 * is the domain layer and the architectural linter (rightly) bans node builtins
 * here. For the inputs this code path produces — two absolute paths under a
 * common root — it agrees exactly with the platform-correct reference
 * (`path.win32.relative` re-standardised to slashes for drive-letter roots,
 * `path.posix.relative` for POSIX roots), including out-of-tree `../` escapes
 * and trailing separators on the root. Doing the arithmetic explicitly is also
 * what makes the answer host-independent: `path.relative` bound to the host
 * returns backslashes on Windows, which the `^(?:packages|apps)/` anchor
 * rejects just as hard as an absolute path, while `path.posix.relative` on a
 * POSIX host does not treat `C:/...` as absolute and resolves it against the
 * process cwd.
 */
export function toWorkspaceRelativePosixPath(
  workspaceRoot: string,
  filePath: string,
): string {
  const standardize = (value: string): string => value.replace(/\\/g, "/");
  const rootSegments = standardize(workspaceRoot)
    .replace(/\/+$/, "")
    .split("/");
  const fileSegments = standardize(filePath).split("/");

  let shared = 0;
  while (
    shared < rootSegments.length &&
    shared < fileSegments.length &&
    rootSegments[shared] === fileSegments[shared]
  ) {
    shared += 1;
  }

  const ascend = Array<string>(rootSegments.length - shared).fill("..");
  return [...ascend, ...fileSegments.slice(shared)].join("/");
}

export function determineLayer(relativePath: string): Layer {
  if (relativePath.includes("/__tests__/")) {
    return "test";
  }
  if (relativePath.includes("/domain/")) {
    return "domain";
  }
  if (relativePath.includes("/application/")) {
    return "application";
  }
  if (relativePath.includes("/infrastructure/")) {
    return "infrastructure";
  }
  if (relativePath.includes(".architecture/manifest.yaml")) {
    return "manifest";
  }
  if (
    relativePath.includes("tsconfig") ||
    relativePath.includes("package.json")
  ) {
    return "config";
  }
  return "unknown";
}

export function determinePackageName(relativePath: string): string {
  const match = relativePath.match(/^(?:packages|apps)\/([^/]+)/);
  return match ? match[1] : "unknown";
}
