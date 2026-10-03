import { Contract, Slice } from "@hexagen/shared";
import { createGitReader } from "../report/exec-git.js";
import { UsageError, git } from "../shared/brownfield-sidecar.js";

/**
 * The `--base` half of `hexagen contract check`: the two sidecar files at a
 * git ref, so the working tree can be compared with the contract the client
 * staged. The comparison itself is pure and lives in
 * `@hexagen/shared` (`findContractGrowth`); this module is only the git read
 * and the parsing, which is where the exit-2 causes live.
 */

/** Repo-relative, as `git show <hash>:<path>` wants it. */
const CONTRACT_REL = ".hexagen/contract.json";
const SLICE_REL = ".hexagen/slice.json";

export interface ContractBase {
  /** The commit `<ref>` resolved to — the hash the files were read at. */
  hash: string;
  contract: Contract;
  slice: Slice;
}

/** The part of `GitReader` the guard needs, so a caller can supply its own. */
export interface BaseFileReader {
  show(hash: string, relativePath: string): string | null;
}

/**
 * The contract and the slice as committed at `ref`.
 *
 * Bad input throws `UsageError` (exit 2), never a pass: an unresolvable ref
 * (a shallow CI clone that never fetched the base) and a sidecar file that was
 * never staged are both "the guard cannot tell", and a guard that cannot tell
 * must fail closed. `GitReader.show` returns `null` for both causes, so the ref
 * is resolved FIRST and the two cannot be confused.
 */
export function readContractBase(
  root: string,
  ref: string,
  reader: BaseFileReader = createGitReader(root),
): ContractBase {
  const hash = git(root, ["rev-parse", "--verify", `${ref}^{commit}`])?.trim();
  if (!hash) {
    throw new UsageError(
      `cannot resolve --base "${ref}" to a commit in ${root}; a shallow CI clone must fetch it (git fetch --unshallow)`,
    );
  }
  return {
    hash,
    contract: readAt<Contract>(
      root,
      reader,
      hash,
      CONTRACT_REL,
      Contract,
      "contract",
    ),
    slice: readAt<Slice>(root, reader, hash, SLICE_REL, Slice, "slice"),
  };
}

/**
 * `existsAt` answers only whether git can see the blob, and its own output is a
 * few bytes, so it cannot fail the way `show` does.
 */
function existsAt(root: string, hash: string, rel: string): boolean {
  return git(root, ["cat-file", "-e", `${hash}:${rel}`]) !== null;
}

function readAt<T>(
  root: string,
  reader: BaseFileReader,
  hash: string,
  rel: string,
  schema: { parse(v: unknown): T },
  label: string,
): T {
  if (!existsAt(root, hash, rel)) {
    // Every writer of `.hexagen/` adds it to the exclude file, so `git show`
    // cannot tell "never staged" from "the commit that first added it". There is
    // no first-commit pass: stage the file instead (workbook export --stage).
    throw new UsageError(
      `${rel} absent at base because it was never staged (read at ${hash}); stage it with \`hexagen workbook export --stage ${rel} --yes\``,
    );
  }
  // The blob is there, so a null here is a failed read, not a missing file:
  // `show` swallows every subprocess failure, and a contract past the exec
  // buffer limit is one. Saying "never staged" would send the reader looking for
  // a staging bug that is not there.
  const text = reader.show(hash, rel);
  if (text === null) {
    throw new UsageError(
      `cannot read ${rel} at ${hash}: the git read failed; re-run with a larger output buffer or check the object`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new UsageError(
      `${rel} at base ${hash} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    return schema.parse(value);
  } catch (e) {
    throw new UsageError(
      `${label} at base ${hash} does not match its schema: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
