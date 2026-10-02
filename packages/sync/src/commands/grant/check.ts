/* eslint-disable no-console */
import {
  checkGrantWindow,
  checkWriteAgainstGrant,
  isPathInSlice,
  normalizeSlicePath,
  type Slice,
} from "@hexagen/shared";
import { isRepoMode } from "@hexagen/shared/node/grant-key";
import { discoverWorkspaceRoot, loadSlice } from "./workspace.js";
import { loadGrantFile, verifyGrantSignature } from "./verify.js";

export interface CheckOptions {
  grantFile: string;
  /** Field Kit form. */
  tool?: string | string[];
  path?: string[];
  /** Monaco form (`grant check <grant-file> <transaction-id>`); not built. */
  transactionId?: string;
  workspaceRoot?: string;
  keyFile?: string;
  engagement?: string;
  /** Test seams. */
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

function badInput(message: string): void {
  console.error(message);
  process.exitCode = 2;
}

/**
 * `hexagen grant check <grant-file> --tool <t> --path <p>...`: would this write
 * be allowed? Signature, then window, then `checkWriteAgainstGrant`; never
 * `checkGrantMode` (a client grant is propose-only, so the mode check would
 * deny every patch). In a client repo (no manifest at the workspace root) a
 * path outside `slice.paths`, or inside its excludes, is denied even when the
 * grant allows it. Exit 0 allow, 1 deny, 2 bad input. Prints the reason, the
 * workspace root and the key's path and fingerprint, never the key.
 */
export async function grantCheckCommand(options: CheckOptions): Promise<void> {
  if (options.transactionId !== undefined) {
    return badInput(
      "The monaco form (grant check <grant-file> <transaction-id>) is not built: pending transactions live in the MCP server's memory, which the CLI cannot reach. Use --tool <t> --path <p>...",
    );
  }
  const paths = options.path ?? [];
  const tools = [options.tool ?? []].flat();
  if (tools.length > 1) {
    return badInput("--tool may be given only once.");
  }
  const tool = tools[0];
  if (!tool || paths.length === 0) {
    return badInput(
      "grant check needs --tool <tool> and at least one --path <path>.",
    );
  }
  for (const entry of paths) {
    const normalized = normalizeSlicePath(entry);
    if (!normalized.ok) {
      return badInput(`--path '${entry}' is malformed: ${normalized.reason}`);
    }
  }
  const loaded = await loadGrantFile(options.grantFile);
  if (!loaded.ok) return badInput(loaded.problem);
  const { grant } = loaded;

  let workspaceRoot: string;
  try {
    workspaceRoot = discoverWorkspaceRoot(options.workspaceRoot);
  } catch (error) {
    return badInput((error as Error).message);
  }
  if (isRepoMode(workspaceRoot)) {
    return badInput(
      "the Field Kit form is for client repos; in a repo with a manifest, mutations are checked at accept",
    );
  }
  let slice: Slice | undefined;
  const brownfield = !isRepoMode(workspaceRoot);
  if (brownfield) {
    try {
      slice = await loadSlice(workspaceRoot);
    } catch (error) {
      return badInput(
        `.hexagen/slice.json is not a valid slice: ${(error as Error).message}`,
      );
    }
  }

  const verification = verifyGrantSignature(grant, {
    workspaceRoot,
    keyFile: options.keyFile,
    engagement: options.engagement,
    env: options.env ?? process.env,
    homeDir: options.homeDir,
  });
  const key = verification.key;
  const footer = [
    `workspace root ${workspaceRoot}`,
    `key ${key.path ?? "(none)"} [${key.source}]`,
    `fingerprint ${key.fingerprint ?? "(unavailable)"}`,
  ];
  const finish = (allowed: boolean, reason: string): void => {
    console.log(
      [`${allowed ? "ALLOW" : "DENY"}: ${reason}`, ...footer].join("\n"),
    );
    process.exitCode = allowed ? 0 : 1;
  };

  if (!verification.verified) {
    return finish(
      false,
      `grant '${grant.id}' signature is not verified: ${verification.reason}`,
    );
  }
  const window = checkGrantWindow(grant, options.now ?? new Date());
  if (!window.allowed) return finish(false, window.reason);
  const write = checkWriteAgainstGrant(grant, { tool, paths });
  if (!write.allowed) return finish(false, write.reason);

  if (brownfield && !slice) {
    return finish(
      false,
      "no .hexagen/slice.json: in a client repo the slice bounds every write; create one first",
    );
  }
  if (slice) {
    for (const entry of paths) {
      if (isPathInSlice(slice, entry)) continue;
      const excluded = isPathInSlice(
        { paths: slice.paths, excludes: [] },
        entry,
      );
      return finish(
        false,
        excluded
          ? `Path '${entry}' is excluded by the slice (grant '${grant.id}' allows it, the slice does not)`
          : `Path '${entry}' is outside the slice (grant '${grant.id}' allows it, the slice does not)`,
      );
    }
  }
  return finish(
    true,
    `tool '${tool}' on ${paths.length} path(s) is within grant '${grant.id}'${slice ? " and the slice" : ""}`,
  );
}
