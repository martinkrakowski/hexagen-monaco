import { promises as fs } from "node:fs";
import path from "node:path";
import { realpathOfExistingAncestor } from "./git-exclude.js";

/**
 * Resolve `--out` against the root and require it to land strictly under
 * `<root>/.hexagen/`, including through symlinks. Returns the absolute path.
 */
export async function resolveSidecarOut(
  root: string,
  out: string,
): Promise<string | null> {
  if (out.endsWith("/") || out.endsWith(path.sep)) return null;
  const abs = path.resolve(root, out);
  const sidecar = path.join(root, ".hexagen");
  const rel = path.relative(sidecar, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const realRoot = await fs.realpath(root);
  const realTarget = await realpathOfExistingAncestor(abs);
  const realRel = path.relative(path.join(realRoot, ".hexagen"), realTarget);
  if (realRel === "" || realRel.startsWith("..") || path.isAbsolute(realRel)) {
    return null;
  }
  return abs;
}
