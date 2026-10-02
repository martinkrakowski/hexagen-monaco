import { execFile } from "node:child_process";
import { open, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  cleanText,
  edgesComplete,
  ObservedReport,
  Slice,
} from "@hexagen/shared";

/**
 * Read-only access to `.hexagen/`. Every function here opens files for reading
 * only (`readFile`, `readdir`); nothing creates, appends or renames. The one
 * child process is `hexagen grant show`, which is itself read-only.
 */

/** A pane's content: the value, or a one-line reason it cannot be shown. */
export type Loaded<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const ok = <T>(value: T): Loaded<T> => ({ ok: true, value });
const fail = (message: string): Loaded<never> => ({
  ok: false,
  message: clean(message),
});

/** Strips anything a terminal would act on (shared with the web viewer). */
export const clean = cleanText;

type Contained =
  | { readonly kind: "ok"; readonly real: string }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly message: string };

const isInside = (base: string, target: string): boolean => {
  const rel = path.relative(base, target);
  return rel === "" || !(rel.startsWith("..") || path.isAbsolute(rel));
};

/**
 * Real path of `.hexagen`, which must itself resolve inside the real
 * workspace root: a `.hexagen` symlinked elsewhere is refused outright.
 */
async function realSidecar(
  workspaceRoot: string,
): Promise<
  | { readonly kind: "ok"; readonly real: string }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly message: string }
> {
  try {
    const root = await realpath(workspaceRoot);
    const sidecar = await realpath(path.join(root, ".hexagen"));
    if (sidecar === root || !isInside(root, sidecar)) {
      return {
        kind: "refused",
        message: ".hexagen resolves outside the workspace; refusing to read it",
      };
    }
    return { kind: "ok", real: sidecar };
  } catch (error) {
    if (isMissing(error)) return { kind: "missing" };
    return {
      kind: "refused",
      message: `cannot read .hexagen: ${errorText(error)}`,
    };
  }
}

/** Real path of `target`, refused unless it is inside the real `.hexagen`. */
async function containInSidecar(
  workspaceRoot: string,
  target: string,
  label: string,
): Promise<Contained> {
  const sidecar = await realSidecar(workspaceRoot);
  if (sidecar.kind !== "ok") return sidecar;
  try {
    const real = await realpath(target);
    if (real === sidecar.real || !isInside(sidecar.real, real)) {
      return {
        kind: "refused",
        message: `${label} resolves outside .hexagen; refusing to read it`,
      };
    }
    return { kind: "ok", real };
  } catch (error) {
    if (isMissing(error)) return { kind: "missing" };
    return {
      kind: "refused",
      message: `cannot read ${label}: ${errorText(error)}`,
    };
  }
}

/** Real path of `.hexagen/<segments>`, contained as above. */
async function resolveInside(
  workspaceRoot: string,
  ...segments: string[]
): Promise<Contained> {
  return containInSidecar(
    workspaceRoot,
    path.join(workspaceRoot, ".hexagen", ...segments),
    segments.join("/"),
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export interface SliceSummary {
  readonly paths: readonly string[];
  readonly excludes: readonly string[];
  readonly commit: string;
  readonly observed:
    | { readonly present: false }
    | { readonly present: true; readonly edgesComplete: boolean }
    | { readonly present: true; readonly invalid: string };
}

export async function loadSliceSummary(
  workspaceRoot: string,
): Promise<Loaded<SliceSummary>> {
  let slice: Slice;
  try {
    const file = await resolveInside(workspaceRoot, "slice.json");
    if (file.kind === "missing") return fail(".hexagen/slice.json not found");
    if (file.kind === "refused") return fail(file.message);
    slice = Slice.parse(JSON.parse(await readFile(file.real, "utf-8")));
  } catch (error) {
    if (isMissing(error)) return fail(".hexagen/slice.json not found");
    if (error instanceof SyntaxError) {
      return fail(".hexagen/slice.json is not valid JSON");
    }
    return fail(
      `.hexagen/slice.json is not a valid slice: ${errorText(error)}`,
    );
  }

  let observed: SliceSummary["observed"];
  try {
    const file = await resolveInside(workspaceRoot, "observed.json");
    if (file.kind === "missing") {
      observed = { present: false };
    } else if (file.kind === "refused") {
      observed = { present: true, invalid: clean(file.message) };
    } else {
      const report = ObservedReport.parse(
        JSON.parse(await readFile(file.real, "utf-8")),
      );
      observed = { present: true, edgesComplete: edgesComplete(report.edges) };
    }
  } catch {
    observed = {
      present: true,
      invalid: "observed.json is not a valid report",
    };
  }
  return ok({
    paths: slice.paths.map(clean),
    excludes: slice.excludes.map(clean),
    commit: clean(slice.repo.commit),
    observed,
  });
}

/** Grant files under `.hexagen/grants/`, sorted by name; any that resolve outside `.hexagen` are left out. */
export async function listGrantFiles(
  workspaceRoot: string,
): Promise<Loaded<readonly string[]>> {
  let names: string[];
  try {
    names = (await readdir(path.join(workspaceRoot, ".hexagen", "grants")))
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch (error) {
    return isMissing(error)
      ? fail(".hexagen/grants/ not found")
      : fail(`cannot read .hexagen/grants/: ${errorText(error)}`);
  }
  const files: string[] = [];
  let refused = 0;
  for (const n of names) {
    const r = await resolveInside(workspaceRoot, "grants", n);
    if (r.kind === "ok") {
      files.push(r.real);
    } else {
      refused += 1;
    }
  }
  if (files.length > 0) return ok(files);
  return fail(
    refused > 0
      ? "grant files resolve outside .hexagen; refusing to read them"
      : "no grant files in .hexagen/grants/",
  );
}

export interface GrantShowResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Null when the process could not be started or was cut off. */
  readonly exitCode: number | null;
  readonly failure?: "timeout" | "output-too-large" | "not-found" | "other";
  readonly spawnError?: string;
}

export type GrantShowRunner = (
  grantFile: string,
  workspaceRoot: string,
) => Promise<GrantShowResult>;

/**
 * Approach chosen: shell out to `hexagen grant show`. Signature verification
 * lives in `@hexagen/sync` (canonical payload + HMAC), which the TUI does not
 * depend on; re-implementing it here would let the two drift. The child prints
 * the key's path and fingerprint only, never the key.
 */
export function makeGrantShowRunner(
  exec: typeof execFile = execFile,
): GrantShowRunner {
  return (grantFile, workspaceRoot) =>
    new Promise((resolve) => {
      exec(
        "hexagen",
        ["grant", "show", grantFile, "--workspace-root", workspaceRoot],
        { cwd: workspaceRoot, timeout: 15_000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr, exitCode: 0 });
            return;
          }
          const e = error as NodeJS.ErrnoException & {
            killed?: boolean;
            signal?: string | null;
          };
          if (typeof e.code === "number") {
            resolve({ stdout, stderr, exitCode: e.code });
            return;
          }
          const failure =
            e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
              ? "output-too-large"
              : e.killed === true || (e.signal ?? null) !== null
                ? "timeout"
                : e.code === "ENOENT"
                  ? "not-found"
                  : "other";
          resolve({
            stdout,
            stderr,
            exitCode: null,
            failure,
            spawnError: errorText(error),
          });
        },
      );
    });
}

export const runGrantShow: GrantShowRunner = makeGrantShowRunner();

export async function loadGrantShow(
  grantFile: string,
  workspaceRoot: string,
  run: GrantShowRunner = runGrantShow,
): Promise<Loaded<string>> {
  // The link can change after listing: contain the path again just before use.
  const contained = await containInSidecar(
    workspaceRoot,
    grantFile,
    path.basename(grantFile),
  );
  if (contained.kind === "refused") return fail(contained.message);
  if (contained.kind === "missing") return fail("grant file no longer exists");
  const result = await run(contained.real, workspaceRoot);
  if (result.exitCode === null) {
    switch (result.failure) {
      case "timeout":
        return fail('"hexagen grant show" timed out');
      case "output-too-large":
        return fail('"hexagen grant show" output was too large');
      case "not-found":
        return fail(
          'could not run "hexagen grant show": the hexagen CLI is not on PATH',
        );
      default:
        return fail(
          `could not run "hexagen grant show": ${result.spawnError ?? "unknown error"}`,
        );
    }
  }
  // Exit 0 verified, 1 not verified (output is still the grant), 2 bad input.
  if (result.exitCode === 0 || result.exitCode === 1) {
    return ok(clean(result.stdout.trimEnd()));
  }
  return fail(
    (result.stderr || result.stdout).trim() ||
      `hexagen grant show exited ${result.exitCode}`,
  );
}

export interface TraceRow {
  readonly seq: number | undefined;
  readonly time: string;
  readonly tool: string;
  /** `halt_reason`, or "grant_missing" for that record kind. */
  readonly reason: string;
  readonly denial: boolean;
}

export const DEFAULT_TRACE_TAIL = 20;
/** The most of the file the tail reads, from the end. */
export const TRACE_READ_LIMIT = 256 * 1024;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? clean(v) : undefined;
}
function toRow(line: unknown): TraceRow | undefined {
  if (line === null || typeof line !== "object" || Array.isArray(line)) {
    return undefined;
  }
  const rec = line as Record<string, unknown>;
  const missing = rec.kind === "grant_missing";
  const calls = Array.isArray(rec.tool_calls)
    ? (rec.tool_calls as unknown[])
    : [];
  const callNames = calls
    .map((c) => str((c as Record<string, unknown> | null)?.name))
    .filter((n): n is string => n !== undefined);
  const firstCall = calls[0] as Record<string, unknown> | undefined;
  const reason = missing ? "grant_missing" : str(rec.halt_reason);
  if (reason === undefined) return undefined;
  return {
    seq: typeof rec.seq === "number" ? rec.seq : undefined,
    time: str(rec.time) ?? str(firstCall?.time) ?? str(rec.started_at) ?? "-",
    tool: str(rec.tool) ?? (callNames.length > 0 ? callNames.join(",") : "-"),
    reason,
    // TRACE.md "Denials": anything but `completed` is a refused attempt.
    denial: missing || reason !== "completed",
  };
}

export interface TraceTail {
  readonly rows: readonly TraceRow[];
  readonly unreadable: number;
  /** Lines in the window read; a lower bound when `truncated`. */
  readonly total: number;
  /** The file was larger than the read window. */
  readonly truncated: boolean;
}

export async function loadTraceTail(
  workspaceRoot: string,
  count: number = DEFAULT_TRACE_TAIL,
): Promise<Loaded<TraceTail>> {
  const file = await resolveInside(workspaceRoot, "evidence", "trace.jsonl");
  if (file.kind === "missing")
    return fail(".hexagen/evidence/trace.jsonl not found");
  if (file.kind === "refused") return fail(file.message);
  let raw: string;
  let truncated = false;
  try {
    const handle = await open(file.real, "r");
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, TRACE_READ_LIMIT);
      const start = size - length;
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(
          buffer,
          filled,
          length - filled,
          start + filled,
        );
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      raw = buffer.subarray(0, filled).toString("utf-8");
      if (start > 0) {
        truncated = true;
        // The window starts mid-file: its first line is a fragment.
        const nl = raw.indexOf("\n");
        raw = nl === -1 ? "" : raw.slice(nl + 1);
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    return fail(`cannot read trace.jsonl: ${errorText(error)}`);
  }
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return fail(
      truncated
        ? "last trace record is larger than 256 KiB; showing nothing"
        : "trace.jsonl is empty",
    );
  }
  const rows: TraceRow[] = [];
  let unreadable = 0;
  for (const text of lines.slice(-count)) {
    let row: TraceRow | undefined;
    try {
      row = toRow(JSON.parse(text));
    } catch {
      row = undefined;
    }
    if (row) rows.push(row);
    else unreadable += 1;
  }
  return ok({ rows, unreadable, total: lines.length, truncated });
}
