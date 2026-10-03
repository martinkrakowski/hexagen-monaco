import { promises as fs } from "node:fs";
import path from "node:path";
import { isForbiddenPath, type AllowedFile } from "../workbook/allow-list.js";
import { safeReadBytes } from "../observe/imports/safe-read.js";
import { realpathOfExistingAncestor } from "./git-exclude.js";

/**
 * The sidecar reader behind `workbook export`, extracted so `hexagen grant
 * list` (plan 4, lane 4B) enumerates `.hexagen/grants/` through these refusals
 * instead of becoming a third copy: open `<root>/.hexagen`, list one of its
 * subdirectories, read one allow-listed file. `export.ts` is the behaviour of
 * record and is unchanged by the move; the two commands differ only in what
 * they do with a refusal — the export fails the whole call, a listing renders
 * it as a row.
 */

/** Per-file cap, matching the viewer's scan cap (BW-D2). */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export class Refusal extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 2,
  ) {
    super(message);
  }
}

/**
 * True when `target` is `base` itself or lies under it, compared as paths.
 * Callers that must hold through a symlink pass real paths.
 */
export const inside = (base: string, target: string): boolean => {
  const rel = path.relative(base, target);
  return rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
};

export interface Sidecar {
  readonly root: string;
  readonly dir: string;
  /** Real path of `<root>/.hexagen`. */
  readonly real: string;
  readonly homeKeys: string;
  readonly afterValidate?: (file: string) => Promise<void>;
}

export async function openSidecar(
  root: string,
  home: string,
  afterValidate?: (file: string) => Promise<void>,
): Promise<Sidecar> {
  const dir = path.join(root, ".hexagen");
  let real: string;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw new Refusal(`${dir} does not exist; run \`hexagen observe\` first`);
  }
  const realHome = await realpathOfExistingAncestor(home);
  return {
    root,
    dir,
    real,
    homeKeys: path.join(realHome, ".hexagen", "keys"),
    afterValidate,
  };
}

/**
 * Reads one allow-listed file. The path must be a regular file (never a
 * symlink), must resolve under the real sidecar, and never under the home keys
 * directory. The forbidden pattern runs on the path as written and on the
 * resolved path relative to the sidecar.
 */
export async function readAllowed(
  sc: Sidecar,
  entry: AllowedFile,
): Promise<{ text: Buffer; file: string }> {
  const file = path.join(sc.dir, ...entry.source.split("/"));
  if (isForbiddenPath(path.relative(sc.root, file))) {
    throw new Refusal(`${entry.source}: names a key or env file; refusing`);
  }
  const st = await fs.lstat(file).catch(() => null);
  if (st === null) throw new Refusal(`${entry.source}: does not exist`);
  if (!st.isFile()) {
    throw new Refusal(
      `${entry.source}: is not a regular file (symlinks are refused)`,
    );
  }
  const real = await fs.realpath(file);
  if (!inside(sc.real, real)) {
    throw new Refusal(`${entry.source}: resolves outside ${sc.real}`);
  }
  if (inside(sc.homeKeys, real)) {
    throw new Refusal(
      `${entry.source}: resolves into ~/.hexagen/keys; refusing`,
    );
  }
  if (isForbiddenPath(path.relative(sc.real, real))) {
    throw new Refusal(
      `${entry.source}: resolves to a key or env file; refusing`,
    );
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new Refusal(`${entry.source}: larger than ${MAX_FILE_BYTES} bytes`);
  }
  await sc.afterValidate?.(file);
  // Open with O_NOFOLLOW and read through the handle: a swap after the checks
  // above is refused, and the size checked is the size read.
  const read = await safeReadBytes(file, MAX_FILE_BYTES);
  if (!read.ok) {
    throw new Refusal(
      read.why === "too-large"
        ? `${entry.source}: larger than ${MAX_FILE_BYTES} bytes`
        : `${entry.source}: is not a regular file (symlinks are refused)`,
    );
  }
  return { text: read.bytes, file };
}

/** Names in `<sidecar>/<sub>/`, sorted; empty when the directory is absent. */
export async function listDir(sc: Sidecar, sub: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(sc.dir, sub))).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
