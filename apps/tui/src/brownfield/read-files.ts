import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { edgesComplete, ObservedReport, Slice } from "@hexagen/shared";

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
const fail = (message: string): Loaded<never> => ({ ok: false, message });

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
  const dir = path.join(workspaceRoot, ".hexagen");
  let slice: Slice;
  try {
    slice = Slice.parse(
      JSON.parse(await readFile(path.join(dir, "slice.json"), "utf-8")),
    );
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
    const report = ObservedReport.parse(
      JSON.parse(await readFile(path.join(dir, "observed.json"), "utf-8")),
    );
    observed = { present: true, edgesComplete: edgesComplete(report.edges) };
  } catch (error) {
    observed = isMissing(error)
      ? { present: false }
      : { present: true, invalid: "observed.json is not a valid report" };
  }
  return ok({
    paths: slice.paths,
    excludes: slice.excludes,
    commit: slice.repo.commit,
    observed,
  });
}

/** Grant files under `.hexagen/grants/`, sorted by name. */
export async function listGrantFiles(
  workspaceRoot: string,
): Promise<Loaded<readonly string[]>> {
  try {
    const names = (
      await readdir(path.join(workspaceRoot, ".hexagen", "grants"))
    )
      .filter((n) => n.endsWith(".json"))
      .sort();
    return names.length === 0
      ? fail("no grant files in .hexagen/grants/")
      : ok(names.map((n) => path.join(workspaceRoot, ".hexagen", "grants", n)));
  } catch (error) {
    return isMissing(error)
      ? fail(".hexagen/grants/ not found")
      : fail(`cannot read .hexagen/grants/: ${errorText(error)}`);
  }
}

export interface GrantShowResult {
  readonly stdout: string;
  readonly stderr: string;
  /** Null when the process could not be started. */
  readonly exitCode: number | null;
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
export const runGrantShow: GrantShowRunner = (grantFile, workspaceRoot) =>
  new Promise((resolve) => {
    execFile(
      "hexagen",
      ["grant", "show", grantFile, "--workspace-root", workspaceRoot],
      { cwd: workspaceRoot, timeout: 15_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          stdout,
          stderr,
          exitCode: typeof code === "number" ? code : null,
          spawnError: typeof code === "number" ? undefined : errorText(error),
        });
      },
    );
  });

export async function loadGrantShow(
  grantFile: string,
  workspaceRoot: string,
  run: GrantShowRunner = runGrantShow,
): Promise<Loaded<string>> {
  const result = await run(grantFile, workspaceRoot);
  if (result.exitCode === null) {
    return fail(
      `could not run "hexagen grant show" (is the hexagen CLI on PATH?): ${result.spawnError ?? "unknown error"}`,
    );
  }
  // Exit 0 verified, 1 not verified (output is still the grant), 2 bad input.
  if (result.exitCode === 0 || result.exitCode === 1) {
    return ok(result.stdout.trimEnd());
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

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
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
  readonly total: number;
}

export async function loadTraceTail(
  workspaceRoot: string,
  count: number = DEFAULT_TRACE_TAIL,
): Promise<Loaded<TraceTail>> {
  let raw: string;
  try {
    raw = await readFile(
      path.join(workspaceRoot, ".hexagen", "evidence", "trace.jsonl"),
      "utf-8",
    );
  } catch (error) {
    return isMissing(error)
      ? fail(".hexagen/evidence/trace.jsonl not found")
      : fail(`cannot read trace.jsonl: ${errorText(error)}`);
  }
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return fail("trace.jsonl is empty");
  const tail = lines.slice(-count);
  const rows: TraceRow[] = [];
  let unreadable = 0;
  for (const text of tail) {
    let row: TraceRow | undefined;
    try {
      row = toRow(JSON.parse(text));
    } catch {
      row = undefined;
    }
    if (row) rows.push(row);
    else unreadable += 1;
  }
  return ok({ rows, unreadable, total: lines.length });
}
