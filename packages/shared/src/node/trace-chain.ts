import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";

/**
 * The one place that decides how a brownfield trace line is serialised, hashed
 * and appended. The MCP server's `TraceWriteAdapter` (writer) and `hexagen
 * evidence pack` (verifier) both call it, so the bytes one signs and the other
 * checks cannot drift (see docs/kernel/TRACE.md "Chain and tip").
 *
 * Node-only (fs, crypto). Reached through `@hexagen/shared/node/trace-chain`
 * and deliberately NOT re-exported from the package barrel.
 */

/** `prev_hash` of the first line of a chain. */
export const GENESIS_PREV_HASH = "0".repeat(64);

const HEX64 = /^[0-9a-f]{64}$/;

/** JSON with object keys sorted at every depth; the bytes a line is hashed over. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** SHA-256 (hex) of a line's canonical bytes, including its own `prev_hash`. */
export function lineHash(line: unknown): string {
  return createHash("sha256").update(canonicalJson(line), "utf8").digest("hex");
}

export interface ChainPosition {
  readonly seq: number;
  readonly prev_hash: string;
}

function isChainFields(value: unknown): value is ChainPosition {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.seq === "number" &&
    Number.isInteger(v.seq) &&
    v.seq >= 0 &&
    typeof v.prev_hash === "string" &&
    HEX64.test(v.prev_hash)
  );
}

/** Raised when the file cannot be extended without corrupting or guessing. */
export class TraceChainError extends Error {
  constructor(
    readonly code: "torn-tail" | "unchained" | "lock-timeout",
    message: string,
  ) {
    super(message);
    this.name = "TraceChainError";
  }
}

const LOCK_TIMEOUT_MS = 15_000;
/** A held lock covers one small append; one this old is a crash, even if its pid was reused. */
const LOCK_MAX_AGE_MS = 30_000;
/** A lock file that exists but is still empty is a creator between `open` and `write`. */
const LOCK_EMPTY_GRACE_MS = 2_000;
/** The break file is held for microseconds; one this old belonged to a crashed process. */
const BREAK_MAX_AGE_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is not ours.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `<pid>:<epoch ms>:<random>`; the timestamp is what staleness is judged from. */
function newToken(): string {
  return `${process.pid}:${Date.now()}:${randomBytes(8).toString("hex")}`;
}

function judgeStale(content: string, mtimeMs: number): boolean {
  const m = /^(\d+):(\d+):[0-9a-f]+$/.exec(content);
  if (m === null) {
    // Empty or foreign: a creator between open and write, or a crashed one.
    return Date.now() - mtimeMs > LOCK_EMPTY_GRACE_MS;
  }
  return Date.now() - Number(m[2]) > LOCK_MAX_AGE_MS || !pidAlive(Number(m[1]));
}

/** Test seams: run after a lock (or a break file) is judged stale, before it is removed. */
export const lockTestHooks: {
  afterJudgedStale?: () => Promise<void>;
  afterJudgedBreakStale?: () => Promise<void>;
} = {};

/**
 * Runs `fn` holding `<lock>.break`, a second O_EXCL file that serialises every
 * removal of the lock (breaking a stale one, releasing a live one). Without it
 * two waiters that both judge a lock stale can each remove it, the second
 * removing the live lock the first just took.
 */
async function withBreakFile<T>(
  lockPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const breakPath = `${lockPath}.break`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(breakPath, "wx");
      try {
        await handle.writeFile(newToken(), "utf8");
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    try {
      const judged = await stat(breakPath);
      if (Date.now() - judged.mtimeMs > BREAK_MAX_AGE_MS) {
        const judgedContent = await readFile(breakPath, "utf8");
        await lockTestHooks.afterJudgedBreakStale?.();
        // Remove it only if it is still the very file judged stale. The
        // check-then-unlink gap that remains is a few microseconds wide and
        // needs a crashed breaker plus a waiter that takes the file in
        // exactly that gap; it is documented rather than closed.
        const again = await stat(breakPath);
        if (
          again.ino === judged.ino &&
          (await readFile(breakPath, "utf8")) === judgedContent
        ) {
          await unlink(breakPath);
        }
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > deadline) {
      throw new TraceChainError(
        "lock-timeout",
        `could not take ${breakPath} within ${LOCK_TIMEOUT_MS} ms`,
      );
    }
    await sleep(2 + Math.floor(Math.random() * 10));
  }
  try {
    return await fn();
  } finally {
    await unlink(breakPath).catch(() => undefined);
  }
}

/** True when the lock was stale and has been removed (or already gone), so the caller retries at once. */
async function breakIfStale(lockPath: string): Promise<boolean> {
  let judged: string;
  let judgedIno: number;
  try {
    judged = await readFile(lockPath, "utf8");
    const st = await stat(lockPath);
    if (!judgeStale(judged, st.mtimeMs)) return false;
    judgedIno = st.ino;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
  await lockTestHooks.afterJudgedStale?.();
  return withBreakFile(lockPath, async () => {
    // Re-read under the break file: the lock may have been broken and
    // re-taken since it was judged. Only the very file judged stale goes.
    try {
      const now = await readFile(lockPath, "utf8");
      const st = await stat(lockPath);
      if (now !== judged || st.ino !== judgedIno) return true;
      await unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return true;
  });
}

async function acquireLock(
  lockPath: string,
  timeoutMs: number,
): Promise<string> {
  const token = newToken();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(token, "utf8");
      } finally {
        await handle.close();
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (await breakIfStale(lockPath)) continue;
    if (Date.now() > deadline) {
      throw new TraceChainError(
        "lock-timeout",
        `could not take ${lockPath} within ${timeoutMs} ms`,
      );
    }
    await sleep(5 + Math.floor(Math.random() * 20));
  }
}

/**
 * Removes the lock only if it still holds our token, under the break file, so
 * a holder that outlived LOCK_MAX_AGE_MS (its lock broken and re-taken) never
 * removes the new holder's lock.
 */
async function releaseLock(lockPath: string, token: string): Promise<void> {
  try {
    await withBreakFile(lockPath, async () => {
      try {
        if ((await readFile(lockPath, "utf8")) === token) {
          await unlink(lockPath);
        }
      } catch {
        // Already gone; nothing of ours to release.
      }
    });
  } catch {
    // The lock goes stale by age if it cannot be released here.
  }
}

/**
 * The trace's real path: symlinks in its directory chain, or the file itself,
 * resolved, so every caller (writer, pack, a path through an alias) locks the
 * same lock file. Creates the directory.
 */
async function canonicalTracePath(filePath: string): Promise<string> {
  const dir = path.dirname(path.resolve(filePath));
  await mkdir(dir, { recursive: true });
  const target = path.join(await realpath(dir), path.basename(filePath));
  try {
    return await realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return target;
    throw error;
  }
}

/** Runs `fn` holding the trace's exclusive lock (`<file>.lock`). */
export async function withTraceLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: { readonly timeoutMs?: number } = {},
): Promise<T> {
  const lockPath = `${await canonicalTracePath(filePath)}.lock`;
  const token = await acquireLock(
    lockPath,
    options.timeoutMs ?? LOCK_TIMEOUT_MS,
  );
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, token);
  }
}

/** The last line of `filePath`, or null when the file is absent or empty. */
async function readLastLine(
  filePath: string,
): Promise<{ text: string; value: unknown } | null> {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return null;
    const probe = Buffer.alloc(1);
    await handle.read(probe, 0, 1, size - 1);
    if (probe[0] !== 0x0a) {
      throw new TraceChainError(
        "torn-tail",
        `${filePath} does not end with a newline (torn last line); refusing to append`,
      );
    }
    // Walk back in chunks until the newline that precedes the last line.
    const CHUNK = 64 * 1024;
    let end = size - 1;
    const parts: Buffer[] = [];
    while (end > 0) {
      const from = Math.max(0, end - CHUNK);
      const buf = Buffer.alloc(end - from);
      await handle.read(buf, 0, buf.length, from);
      const nl = buf.lastIndexOf(0x0a);
      if (nl >= 0) {
        parts.unshift(buf.subarray(nl + 1));
        break;
      }
      parts.unshift(buf);
      end = from;
    }
    const text = Buffer.concat(parts).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new TraceChainError(
        "torn-tail",
        `the last line of ${filePath} is not valid JSON (torn); refusing to append`,
      );
    }
    return { text, value };
  } finally {
    await handle.close();
  }
}

export type TraceFileMode = "absent" | "chained" | "unchained" | "torn";

/**
 * What the file's last line says about it, without taking the lock: `chained`
 * (`seq`/`prev_hash` present), `unchained` (a greenfield line), `absent`
 * (missing or empty) or `torn`.
 */
export async function peekTraceMode(filePath: string): Promise<TraceFileMode> {
  try {
    const last = await readLastLine(filePath);
    if (last === null) return "absent";
    return isChainFields(last.value) ? "chained" : "unchained";
  } catch (error) {
    if (error instanceof TraceChainError) return "torn";
    throw error;
  }
}

export interface TraceInspection {
  /**
   * Decided on the last complete line (ends in a newline and parses):
   * `chained` (has `seq`/`prev_hash`), `unchained` (a greenfield line),
   * `absent` (missing or empty) or `unknown` (non-empty, but no complete line).
   */
  readonly mode: "absent" | "chained" | "unchained" | "unknown";
  /** Something follows the last complete line: a fragment, or an unparsable line. */
  readonly torn: boolean;
}

/** Index of the last newline strictly before `pos`, or -1. */
async function lastNewlineBefore(
  handle: Awaited<ReturnType<typeof open>>,
  pos: number,
): Promise<number> {
  const CHUNK = 64 * 1024;
  let end = pos;
  while (end > 0) {
    const from = Math.max(0, end - CHUNK);
    const buf = Buffer.alloc(end - from);
    await handle.read(buf, 0, buf.length, from);
    const nl = buf.lastIndexOf(0x0a);
    if (nl >= 0) return from + nl;
    end = from;
  }
  return -1;
}

/**
 * Classifies a trace file by its last complete line, so a torn tail (a crash
 * mid-append) does not change which format the file is. Call it while holding
 * the trace lock.
 */
export async function inspectTrace(filePath: string): Promise<TraceInspection> {
  let handle;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mode: "absent", torn: false };
    }
    throw error;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return { mode: "absent", torn: false };
    let torn = false;
    let end = size;
    const probe = Buffer.alloc(1);
    await handle.read(probe, 0, 1, size - 1);
    if (probe[0] !== 0x0a) {
      torn = true;
      end = (await lastNewlineBefore(handle, size)) + 1;
    }
    while (end > 0) {
      const start = (await lastNewlineBefore(handle, end - 1)) + 1;
      const buf = Buffer.alloc(end - 1 - start);
      await handle.read(buf, 0, buf.length, start);
      try {
        const value: unknown = JSON.parse(buf.toString("utf8"));
        return { mode: isChainFields(value) ? "chained" : "unchained", torn };
      } catch {
        torn = true;
        end = start;
      }
    }
    return { mode: "unknown", torn: true };
  } finally {
    await handle.close();
  }
}

export interface AppendedLine {
  readonly seq: number;
  readonly hash: string;
}

/**
 * Appends one chained line to `filePath`, creating it at genesis when absent.
 * An exclusive lock file (`<file>.lock`, created with O_EXCL, pid and time
 * inside; stale locks broken under a second O_EXCL `.break` file) is held across reading the last line,
 * appending and fsync, so concurrent writers cannot fork the chain.
 *
 * Refuses, rather than guesses, when the existing last line is torn or has no
 * chain fields (an old greenfield file): the file is never rewritten.
 */
export async function appendChainedLine(
  filePath: string,
  build: (next: ChainPosition) => Record<string, unknown>,
): Promise<AppendedLine> {
  return withTraceLock(filePath, () =>
    appendChainedLineLocked(filePath, build),
  );
}

/**
 * `appendChainedLine` for a caller that already holds `withTraceLock(filePath)`
 * (so it can choose a format and append inside one lock hold). The lock is not
 * reentrant: never call this without it.
 */
export async function appendChainedLineLocked(
  filePath: string,
  build: (next: ChainPosition) => Record<string, unknown>,
): Promise<AppendedLine> {
  const last = await readLastLine(filePath);
  let next: ChainPosition = { seq: 0, prev_hash: GENESIS_PREV_HASH };
  if (last !== null) {
    if (!isChainFields(last.value)) {
      throw new TraceChainError(
        "unchained",
        `${filePath} has a last line with no seq/prev_hash (an unchained trace); refusing to extend it. Move it aside to start a chained trace.`,
      );
    }
    next = {
      seq: last.value.seq + 1,
      prev_hash: lineHash(last.value),
    };
  }
  const line = build(next);
  const bytes = `${canonicalJson(line)}\n`;
  const handle = await open(filePath, "a");
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { seq: next.seq, hash: lineHash(line) };
}

export interface SplitLine {
  /** 0-based position in the file. */
  readonly index: number;
  readonly raw: string;
  readonly value?: unknown;
  readonly parseError?: string;
}

export interface SplitTrace {
  readonly lines: readonly SplitLine[];
  /** The file does not end in a newline, or its last line is not valid JSON. */
  readonly torn: boolean;
}

/** Splits a trace file into lines, parsing each; never throws. */
export function splitTrace(text: string): SplitTrace {
  if (text.length === 0) return { lines: [], torn: false };
  const endsWithNewline = text.endsWith("\n");
  const raws = (endsWithNewline ? text.slice(0, -1) : text).split("\n");
  const lines: SplitLine[] = raws.map((raw, index) => {
    try {
      return { index, raw, value: JSON.parse(raw) as unknown };
    } catch (error) {
      return { index, raw, parseError: (error as Error).message };
    }
  });
  const lastBad = lines[lines.length - 1]?.parseError !== undefined;
  return { lines, torn: !endsWithNewline || lastBad };
}

function hmacHex(domain: string, payload: unknown, keyHex: string): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(`${domain}\n${canonicalJson(payload)}`, "utf8")
    .digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (!HEX64.test(a) || !HEX64.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** HMAC over the canonical `{seq, hash}` of a tip. */
export function signTip(seq: number, hash: string, keyHex: string): string {
  return hmacHex("hexagen-tip-v1", { seq, hash }, keyHex);
}

export function verifyTip(
  tip: { seq: number; hash: string; hmac: string },
  keyHex: string,
): boolean {
  return safeEqualHex(tip.hmac, signTip(tip.seq, tip.hash, keyHex));
}

/** HMAC over a bundle index without its own `hmac` field. */
export function signBundleIndex(
  indexWithoutHmac: Record<string, unknown>,
  keyHex: string,
): string {
  return hmacHex("hexagen-bundle-v1", indexWithoutHmac, keyHex);
}

export function verifyBundleIndex(
  index: Record<string, unknown> & { hmac: string },
  keyHex: string,
): boolean {
  const { hmac, ...rest } = index;
  return safeEqualHex(hmac, signBundleIndex(rest, keyHex));
}
