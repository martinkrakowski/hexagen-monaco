/* eslint-disable no-console */
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { checkGrantWindow, type GrantCheck } from "@hexagen/shared";
import {
  describeResolvedKey,
  type ResolvedGrantKey,
} from "@hexagen/shared/node/grant-key";
import { allowListEntry, isForbiddenPath } from "../workbook/allow-list.js";
import {
  listDir,
  openSidecar,
  readAllowed,
  Refusal,
  type Sidecar,
} from "../shared/grant-enumerator.js";
import {
  parseGrant,
  resolveVerifyKey,
  verifyGrantSignature,
  type VerifyContext,
} from "./verify.js";
import { discoverWorkspaceRoot } from "./workspace.js";

/**
 * `hexagen grant list`: a read-only listing of `.hexagen/grants/`, so an FDE can
 * see every grant, whether each is live, expired or revoked, and which one
 * verifies, without opening JSON by hand (plan 4, lane 4B).
 *
 * Three rules the listing is built on:
 *
 * - The window is never recomputed here. A row's status comes from
 *   `checkGrantWindow` (the same call `grant show` and `grant check` make), and
 *   its signature verdict from `verifyGrantSignature` (the same two the
 *   workbook export uses), so a listing cannot disagree with enforcement.
 * - Every entry in the directory becomes a row, including every refusal the
 *   shared enumerator returns and every error one raises. That is the one
 *   deliberate difference from `workbook export`, which fails the whole call
 *   instead: a listing is diagnostic, and one unreadable grant must not hide
 *   the others.
 * - A symlink is classified from its own `lstat` and never read, so it prints
 *   as `invalid: symlink` rather than as the enumerator's refusal wording.
 *   `readAllowed` still runs its own lstat and its `O_NOFOLLOW` read below that
 *   point; this is a reason, not a second read guard.
 *
 * It reads only. It prints the key's path and fingerprint, never the key.
 */

/** The statuses a row can carry, and the filters `--status` accepts. */
export const GRANT_LIST_STATUSES = [
  "live",
  "expired",
  "revoked",
  "invalid",
  "all",
] as const;

export type GrantListFilter = (typeof GRANT_LIST_STATUSES)[number];

/** What a row's status column says: `--status all` matches every one of them. */
export type GrantRowStatus = Exclude<GrantListFilter, "all">;

export interface GrantListRow {
  /** Path relative to `.hexagen/` (forward slashes). */
  readonly file: string;
  readonly id?: string;
  readonly principal?: string;
  readonly agent?: string;
  readonly mode?: string;
  readonly expires_at?: string;
  readonly revoked_at?: string;
  readonly status: GrantRowStatus;
  readonly signature: "verified" | "not verified" | "invalid";
  /** Why the signature failed, or why the row is invalid. Never key material. */
  readonly reason?: string;
}

export interface GrantListOptions {
  /** A `GRANT_LIST_STATUSES` member; anything else is bad input. */
  status?: string;
  json?: boolean;
  workspaceRoot?: string;
  keyFile?: string;
  engagement?: string;
  /** Test seams. */
  homeDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  /**
   * Test seam: runs inside every guarded read, after the enumerator's checks
   * and before the bytes are read (the hook `openSidecar` already takes).
   */
  afterValidate?: (file: string) => Promise<void>;
}

/** The one directory a Grant listing reads: the allow-list names no other. */
const GRANTS_DIR = "grants";

/** Bad input and a missing precondition are exit 2 (never a refusal to look). */
function fail(message: string): void {
  console.error(message);
  process.exitCode = 2;
}

/** The row's window status, read off the shared check rather than recomputed. */
function rowStatus(check: GrantCheck): GrantRowStatus {
  if (check.allowed) return "live";
  return check.code === "grant_revoked" ? "revoked" : "expired";
}

const DASH = "-";

/**
 * The row an entry that raised instead of returning gets. `readAllowed` refuses
 * the cases it knows about and its wording is kept verbatim. Anything else it
 * raises is an fs error (ENOENT when an entry vanishes between its lstat and its
 * realpath, EACCES, ELOOP, ENOTDIR) or a parse verdict that escaped: all of them
 * are the same kind of finding about the same file, so they become the same kind
 * of row rather than stopping the listing and hiding every other grant.
 */
export function unreadableRow(file: string, error: unknown): GrantListRow {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  const reason =
    error instanceof Refusal
      ? error.message
      : code === "ENOENT"
        ? "vanished before it could be read"
        : code === "EACCES" || code === "EPERM"
          ? "cannot be read: permission denied"
          : `cannot be read: ${(error as Error | null)?.message ?? String(error)}`;
  return { file, status: "invalid", signature: "invalid", reason };
}

async function rowFor(
  sc: Sidecar,
  name: string,
  verify: VerifyContext,
  now: Date,
  key: ResolvedGrantKey,
): Promise<GrantListRow> {
  const rel = `${GRANTS_DIR}/${name}`;
  const invalid = (reason: string): GrantListRow => ({
    file: rel,
    status: "invalid",
    signature: "invalid",
    reason,
  });

  if (isForbiddenPath(rel)) return invalid("names a key or env file");
  const entry = allowListEntry(rel);
  if (entry === null) return invalid("not allow-listed");

  // Classification only (see the file header): readAllowed does the refusing,
  // and it also reports an entry that vanishes between readdir and here.
  const st = await lstat(path.join(sc.dir, GRANTS_DIR, name)).catch(() => null);
  if (st !== null && !st.isFile()) {
    return invalid(st.isSymbolicLink() ? "symlink" : "not a regular file");
  }

  const read = await readAllowed(sc, entry);
  let json: unknown;
  try {
    json = JSON.parse(read.text.toString("utf8"));
  } catch {
    return invalid("not valid JSON");
  }
  const checked = parseGrant(json, rel);
  if (!checked.ok) return invalid(checked.problem);
  const grant = checked.grant;
  const signature = verifyGrantSignature(grant, verify, key);
  return {
    file: rel,
    id: grant.id,
    principal: grant.principal,
    agent: grant.agent,
    mode: grant.mode,
    expires_at: grant.expires_at,
    ...(grant.revoked_at !== undefined ? { revoked_at: grant.revoked_at } : {}),
    status: rowStatus(checkGrantWindow(grant, now)),
    signature: signature.verified ? "verified" : "not verified",
    ...(signature.verified ? {} : { reason: signature.reason }),
  };
}

/** Newest expiry first, then id. Invalid rows carry no expiry and sort last. */
function compareRows(a: GrantListRow, b: GrantListRow): number {
  const left =
    a.expires_at === undefined ? Number.NaN : Date.parse(a.expires_at);
  const right =
    b.expires_at === undefined ? Number.NaN : Date.parse(b.expires_at);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    if (!Number.isNaN(left) || !Number.isNaN(right))
      return Number.isNaN(left) ? 1 : -1;
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  }
  if (left !== right) return right - left;
  const ai = a.id ?? "";
  const bi = b.id ?? "";
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

const HEADER = [
  "file",
  "status",
  "id",
  "principal",
  "agent",
  "mode",
  "expires_at",
  "revoked_at",
  "signature",
] as const;

/** The signature column carries the verdict and, when there is one, the reason. */
function signatureCell(row: GrantListRow): string {
  if (row.signature === "verified") return "verified";
  return `${row.signature}: ${row.reason ?? "no reason given"}`;
}

function renderTable(rows: readonly GrantListRow[]): string[] {
  const cells = rows.map((row) => [
    row.file,
    row.status,
    row.id ?? DASH,
    row.principal ?? DASH,
    row.agent ?? DASH,
    row.mode ?? DASH,
    row.expires_at ?? DASH,
    row.revoked_at ?? DASH,
    signatureCell(row),
  ]);
  const widths = HEADER.map((label, i) =>
    Math.max(label.length, ...cells.map((cell) => cell[i].length)),
  );
  const line = (cell: readonly string[]): string =>
    cell
      .map((value, i) =>
        i === cell.length - 1 ? value : value.padEnd(widths[i]),
      )
      .join("  ")
      .trimEnd();
  return [line(HEADER), ...cells.map(line)];
}

function tally(rows: readonly GrantListRow[]): string {
  const count = (status: GrantRowStatus): number =>
    rows.filter((row) => row.status === status).length;
  return `${rows.length} entr${rows.length === 1 ? "y" : "ies"}: ${count("live")} live, ${count("expired")} expired, ${count("revoked")} revoked, ${count("invalid")} invalid`;
}

export async function grantListCommand(
  options: GrantListOptions,
): Promise<void> {
  const filter = options.status ?? "all";
  if (!(GRANT_LIST_STATUSES as readonly string[]).includes(filter)) {
    fail(
      `--status must be one of ${GRANT_LIST_STATUSES.join("|")}; got '${filter}'`,
    );
    return;
  }

  let root: string;
  try {
    root = discoverWorkspaceRoot(options.workspaceRoot);
  } catch (error) {
    fail((error as Error).message);
    return;
  }

  const home = options.homeDir ?? os.homedir();
  let sc: Sidecar;
  try {
    sc = await openSidecar(root, home, options.afterValidate);
  } catch (error) {
    if (error instanceof Refusal) {
      fail(error.message);
      return;
    }
    throw error;
  }

  // A grants directory that is absent, or that is not a plain directory, is a
  // precondition failure (exit 2), not an empty listing: it means nothing was
  // staged, and a symlink here would read outside the sidecar.
  const dirPath = path.join(sc.dir, GRANTS_DIR);
  const dirStat = await lstat(dirPath).catch(() => null);
  if (dirStat === null) {
    fail(
      `${dirPath} does not exist; nothing is staged there. Stage the grants first: hexagen workbook export --stage .hexagen/${GRANTS_DIR}/<id>.json --yes`,
    );
    return;
  }
  if (!dirStat.isDirectory()) {
    fail(`${dirPath} is not a directory; refusing to list through it`);
    return;
  }

  const verify: VerifyContext = {
    workspaceRoot: root,
    keyFile: options.keyFile,
    engagement: options.engagement,
    env: options.env ?? process.env,
    homeDir: options.homeDir,
  };
  const now = options.now ?? new Date();
  // One resolution for the whole listing: every row verifies under the same key,
  // and the header names that key. `verifyGrantSignature` still reads and checks
  // the key on each call — only the lookup is hoisted.
  const key = resolveVerifyKey(verify);

  let names: string[];
  try {
    names = await listDir(sc, GRANTS_DIR);
  } catch (error) {
    fail(`cannot list ${dirPath}: ${(error as Error).message}`);
    return;
  }

  const rows: GrantListRow[] = [];
  for (const name of names) {
    try {
      rows.push(await rowFor(sc, name, verify, now, key));
    } catch (error) {
      rows.push(unreadableRow(`${GRANTS_DIR}/${name}`, error));
    }
  }
  rows.sort(compareRows);

  const shown =
    filter === "all" ? rows : rows.filter((row) => row.status === filter);
  // The window was evaluated at `now`, so the time is printed with it (plan §4.2).
  const at = `as of ${now.toISOString()}`;
  // A filter hides rows, never their failures: the summary always totals every
  // row in the directory, so a signature failure the filter dropped is still on
  // screen next to the exit code it caused.
  const summary =
    filter === "all"
      ? tally(rows)
      : `${shown.length} shown (--status ${filter}); all ${tally(rows)}`;
  // `rowStatus` reads the window alone, so the footer must not read as though
  // the status covered the signature too.
  const footer =
    `note: a listing is a snapshot ${at}; "live" says only that the window is open at ` +
    `that moment — read the signature column before trusting a row — not what the ` +
    `agent did, and a grant can be revoked a second later.`;

  if (options.json) {
    console.log(JSON.stringify(shown, null, 2));
    console.error(`${dirPath} (${at}; ${summary})`);
    console.error(describeResolvedKey(root, key));
    console.error(footer);
  } else {
    console.log(`${dirPath} (${at})`);
    console.log(describeResolvedKey(root, key));
    console.log(renderTable(shown).join("\n"));
    console.log(summary);
    console.log(footer);
  }

  // Every exit code is decided over the whole listing, not over the printed
  // rows: a failure `--status` filtered out of the output is still a failure.
  const read = rows.filter((row) => row.status !== "invalid");
  const failed =
    read.length === 0 ||
    read.some((row) => row.signature !== "verified") ||
    rows.some((row) => row.status === "invalid");
  process.exitCode = failed ? 1 : 0;
}

export const grantListCommander = new Command("list").description(
  "List every grant under .hexagen/grants/ with its status and signature verdict (exit 0 every grant read verifies, 1 any grant unread, invalid or unverified, 2 bad input)",
);

grantListCommander
  .option(
    "--status <filter>",
    "Which rows to print: live, expired, revoked, invalid or all (a failure filtered out of the output still decides the exit code)",
    "all",
  )
  .option(
    "--workspace-root <path>",
    "Workspace root (default: nearest project/workspace root, bounded by the git toplevel)",
  )
  .option(
    "--key-file <path>",
    "Verification key file (overrides HEXAGEN_GRANT_KEY_FILE and ~/.hexagen/keys/<engagement>.key)",
  )
  .option(
    "--engagement <id>",
    "Brownfield: engagement id naming ~/.hexagen/keys/<id>.key (default: the id in .hexagen/slice.json)",
  )
  .option(
    "--json",
    "Print a JSON array of rows on stdout; the key line and the note go to stderr",
  )
  .action(async (options: GrantListOptions) => {
    await grantListCommand(options);
  });
