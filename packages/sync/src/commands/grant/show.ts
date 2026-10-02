/* eslint-disable no-console */
import { checkGrantWindow } from "@hexagen/shared";
import { describeResolvedKey } from "@hexagen/shared/node/grant-key";
import { isRepoMode } from "@hexagen/shared/node/grant-key";
import { discoverWorkspaceRoot, loadSlice } from "./workspace.js";
import { loadGrantFile, verifyGrantSignature } from "./verify.js";

export interface ShowOptions {
  grantFile: string;
  workspaceRoot?: string;
  keyFile?: string;
  engagement?: string;
  /** Test seams. */
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
}

/**
 * `hexagen grant show <grant-file>`: the grant as the runtime reads it, plus
 * whether its signature verifies. Exit 0 verified, 1 not verified, 2 bad
 * input. The window (expired/revoked) is informational here; `grant check`
 * enforces it. Prints the key's path and fingerprint, never the key.
 */
export async function grantShowCommand(options: ShowOptions): Promise<void> {
  const loaded = await loadGrantFile(options.grantFile);
  if (!loaded.ok) {
    console.error(loaded.problem);
    process.exitCode = 2;
    return;
  }
  const { grant } = loaded;
  const workspaceRoot = discoverWorkspaceRoot(options.workspaceRoot);
  if (!isRepoMode(workspaceRoot)) {
    try {
      await loadSlice(workspaceRoot);
    } catch (error) {
      console.error(
        `.hexagen/slice.json is not a valid slice: ${(error as Error).message}`,
      );
      process.exitCode = 2;
      return;
    }
  }
  const verification = verifyGrantSignature(grant, {
    workspaceRoot,
    keyFile: options.keyFile,
    engagement: options.engagement,
    env: options.env ?? process.env,
    homeDir: options.homeDir,
  });
  const window = checkGrantWindow(grant, options.now ?? new Date());

  const list = (label: string, items: readonly string[]): string[] =>
    items.length === 0
      ? [`  ${label.padEnd(11)} (none)`]
      : items.map(
          (item, i) => `  ${(i === 0 ? label : "").padEnd(11)} ${item}`,
        );
  const lines = [
    `Grant ${grant.id}`,
    `  ${"principal".padEnd(11)} ${grant.principal}`,
    `  ${"agent".padEnd(11)} ${grant.agent}`,
    ...(grant.contexts ? list("contexts", grant.contexts) : []),
    ...list("paths", grant.paths),
    ...list("tools", grant.tools),
    `  ${"mode".padEnd(11)} ${grant.mode}`,
    ...(grant.max_files !== undefined
      ? [`  ${"max_files".padEnd(11)} ${grant.max_files}`]
      : []),
    `  ${"expires_at".padEnd(11)} ${grant.expires_at}`,
    ...(grant.revoked_at !== undefined
      ? [`  ${"revoked_at".padEnd(11)} ${grant.revoked_at}`]
      : []),
    `window: ${window.allowed ? "in window" : window.reason}`,
    verification.verified
      ? "signature: verified"
      : `signature: NOT verified: ${verification.reason}`,
    describeResolvedKey(workspaceRoot, verification.key),
  ];
  console.log(lines.join("\n"));
  process.exitCode = verification.verified ? 0 : 1;
}
