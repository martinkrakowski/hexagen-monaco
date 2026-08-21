/**
 * Tier-A handoff ingest (F-07).
 *
 * The user runs `hexagen scan --handoff` LOCALLY and uploads the resulting
 * handoff zip (or the loose files). This module unpacks and parses those
 * artifacts **in-process and executes nothing** — no `execFile`, no CLI, no
 * spawn of any kind. That is the whole point of Tier A: it is immune to the
 * D-P1 blocker (a hexagen CLI inside the prod image) and no source code ever
 * leaves the user's machine.
 *
 * Contrast with {@link ../cli-hexagen-scan.adapter}: that is Tier B, it uploads
 * a source zip and spawns the CLI. This file must never grow a subprocess.
 *
 * NOTE ON `ScanEnvelope`: `@hexagen/shared` exports a zod `ScanEnvelope` schema.
 * It describes the CLI's **stdout envelope**, NOT the handoff files parsed here,
 * so it is deliberately not used. The two JSON artifacts below are untrusted
 * uploads and are validated defensively, field by field, by this module.
 */
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
} from "./limits";
import {
  DuplicateZipEntryError,
  EmptyZipError,
  InvalidZipError,
  TIER_A_ZIP_UNPACK_LIMITS,
  ZipResourceLimitError,
  ZipSlipError,
  unpackZipToDir,
} from "./zip-unpack";

/**
 * Compressed upload cap for a handoff. Deliberately far below the Tier-B
 * `MAX_SCAN_ZIP_BYTES` (32 MiB): a handoff is at most 6 small text files, and
 * `TIER_A_ZIP_UNPACK_LIMITS` caps the *uncompressed* side at 4 MiB anyway.
 */
export const MAX_HANDOFF_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Multipart wrapping (boundaries, `name` field, part headers) around the upload. */
export const MAX_HANDOFF_REQUEST_BYTES = MAX_HANDOFF_UPLOAD_BYTES + 256 * 1024;

/** Loose-file mode: never accept more parts than the zip profile allows entries. */
export const MAX_HANDOFF_LOOSE_FILES = TIER_A_ZIP_UNPACK_LIMITS.maxEntries;

/** Per loose file, mirroring the per-entry cap the unpacker enforces for zips. */
export const MAX_HANDOFF_LOOSE_FILE_BYTES =
  TIER_A_ZIP_UNPACK_LIMITS.maxEntryBytes;

/**
 * Ledger/baseline entries returned to the client. The files themselves are
 * bounded at 1 MiB by the unpacker, which still permits tens of thousands of
 * entries; the response is capped so a large-but-legal ledger cannot balloon
 * the JSON body.
 */
export const MAX_HANDOFF_LEDGER_ENTRIES = 500;

/** Exactly the entries `buildHandoffZip` emits (3 always, 3 conditional). */
export const HANDOFF_ARTIFACT_NAMES = [
  "hexagen-report.md",
  "hexagen-report.html",
  "suppression-ledger.json",
  "manifest.yaml",
  "layout.yaml",
  "arch-lint-baseline.json",
] as const;

export type HandoffArtifactName = (typeof HANDOFF_ARTIFACT_NAMES)[number];

const ARTIFACT_NAME_SET: ReadonlySet<string> = new Set(HANDOFF_ARTIFACT_NAMES);

export function isHandoffArtifactName(
  name: string,
): name is HandoffArtifactName {
  return ARTIFACT_NAME_SET.has(name);
}

/**
 * Tier A never executes anything, so it can never observe a linter exit code.
 * `ingested` = the engagement report was present and read. `incomplete` = some
 * handoff artifacts were found but the report was not among them.
 *
 * These are intentionally NOT `ScanVerdict`'s `pass`/`violations` values: this
 * route did not run the linter, and claiming a pass/fail it never computed
 * would be a fabricated verdict. The real verdict lives inside
 * `reportMarkdown`, produced by the user's own local run.
 */
export type HandoffVerdict = "ingested" | "incomplete";

export interface HandoffLedgerEntry {
  readonly rule: string;
  readonly file: string;
  readonly specifier: string;
  readonly reason: string | null;
  readonly expires: string | null;
}

export interface HandoffArtifactSummary {
  readonly present: readonly HandoffArtifactName[];
  readonly missing: readonly HandoffArtifactName[];
  /**
   * The HTML report is acknowledged but never returned: it is attacker-supplied
   * markup, and echoing it into a client that might render it is a stored-XSS
   * vector for zero added signal (the Markdown report carries the same content).
   */
  readonly reportHtmlPresent: boolean;
  readonly manifestExcerpt: string | null;
  readonly suppressions: readonly HandoffLedgerEntry[];
  readonly suppressionCount: number | null;
  readonly baselineVersion: number | null;
  readonly baselineEntryCount: number | null;
}

/**
 * Structurally consistent with {@link ./types#ProjectScanResponse} — same field
 * names and nullability for every shared field — so the import-scan UI can
 * render a Tier-A result with the same component tree.
 *
 * `exitCode` and `filesScanned` are permanently `null`: both are byproducts of
 * *executing* the CLI, and Tier A executes nothing. They are retained rather
 * than dropped so the shape stays a superset of the Tier-B response.
 */
export interface ProjectHandoffResponse {
  readonly source: "handoff-artifacts";
  readonly verdict: HandoffVerdict;
  readonly exitCode: null;
  readonly projectName: string;
  readonly layoutExcerpt: string | null;
  readonly filesScanned: null;
  readonly reportMarkdown: string | null;
  readonly errorMessage: string | null;
  readonly artifacts: HandoffArtifactSummary;
  /** Non-fatal problems (malformed JSON, truncated file, duplicate basename). */
  readonly warnings: readonly string[];
}

export type HandoffRejectReason =
  | "zip-slip"
  | "invalid-zip"
  | "zip-too-large"
  | "duplicate-zip-entry"
  | "empty-zip"
  | "no-artifacts";

export type HandoffIngestOutcome =
  | { kind: "parsed"; result: ProjectHandoffResponse }
  | { kind: "rejected"; reason: HandoffRejectReason; message: string }
  | { kind: "failed"; message: string };

type ReadResult =
  | { ok: true; text: string; truncated: boolean }
  | { ok: false; error: string };

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}

/** Read at most `maxChars` (plus one byte, to detect truncation). Never slurps. */
async function readTextClipped(
  filePath: string,
  maxChars: number,
): Promise<ReadResult> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, "r");
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
  try {
    const buf = Buffer.alloc(maxChars + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString("utf8");
    return {
      ok: true,
      text: clip(text, maxChars),
      truncated: text.length > maxChars,
    };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  } finally {
    await handle.close().catch(() => {});
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `JSON.parse` an untrusted upload without letting a throw escape. The caller
 * gets a typed failure and turns it into a warning — never a 500.
 */
function parseJsonSafely(text: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: `not valid JSON (${messageOf(error)})` };
  }
}

/**
 * Validate one ledger/baseline entry field-by-field and rebuild it as a fresh
 * literal containing ONLY whitelisted keys. Nothing from the upload is spread
 * or assigned into a result object, so a crafted `__proto__`/`constructor` key
 * cannot reach the response (and cannot pollute anything on the way).
 */
function readLedgerEntry(candidate: unknown): HandoffLedgerEntry | null {
  if (!isRecord(candidate)) return null;
  const rule = candidate.rule;
  const file = candidate.file;
  if (typeof rule !== "string" || rule.trim().length === 0) return null;
  if (typeof file !== "string" || file.trim().length === 0) return null;
  const specifier =
    typeof candidate.specifier === "string" ? candidate.specifier : "";
  // `note` is the legacy spelling of `reason` the sync baseline reader accepts.
  const rawReason =
    typeof candidate.reason === "string"
      ? candidate.reason
      : typeof candidate.note === "string"
        ? candidate.note
        : null;
  const expires =
    typeof candidate.expires === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(candidate.expires)
      ? candidate.expires
      : null;
  return {
    rule: clip(rule.trim(), 200),
    file: clip(file.trim(), 400),
    specifier: clip(specifier, 400),
    reason: rawReason === null ? null : clip(rawReason.trim(), 400),
    expires,
  };
}

function readLedgerEntries(raw: unknown): ParseResult<{
  entries: HandoffLedgerEntry[];
  total: number;
  skipped: number;
}> {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "'entries' is not an array" };
  }
  const entries: HandoffLedgerEntry[] = [];
  let skipped = 0;
  for (const candidate of raw) {
    if (entries.length >= MAX_HANDOFF_LEDGER_ENTRIES) break;
    const entry = readLedgerEntry(candidate);
    if (entry === null) {
      skipped += 1;
      continue;
    }
    entries.push(entry);
  }
  return { ok: true, value: { entries, total: raw.length, skipped } };
}

/**
 * `suppression-ledger.json` as `buildHandoffZip` writes it:
 * `{ "entries": ReportBaselineEntry[] }` — no version field.
 */
export function parseSuppressionLedger(text: string): ParseResult<{
  entries: HandoffLedgerEntry[];
  total: number;
  skipped: number;
}> {
  const parsed = parseJsonSafely(text);
  if (!parsed.ok) {
    return { ok: false, error: `suppression ledger ${parsed.error}` };
  }
  if (!isRecord(parsed.value)) {
    return {
      ok: false,
      error: "suppression ledger: expected a JSON object at the top level",
    };
  }
  const entries = readLedgerEntries(parsed.value.entries);
  if (!entries.ok) {
    return { ok: false, error: `suppression ledger: ${entries.error}` };
  }
  return entries;
}

/**
 * `arch-lint-baseline.json`: `{ version: 1, entries: ReportBaselineEntry[] }`.
 * An unsupported version is a hard parse failure, not a silent downgrade — the
 * entry semantics are version-scoped and we will not guess at them.
 */
export function parseArchLintBaseline(text: string): ParseResult<{
  version: number;
  entries: HandoffLedgerEntry[];
  total: number;
  skipped: number;
}> {
  const parsed = parseJsonSafely(text);
  if (!parsed.ok) {
    return { ok: false, error: `arch-lint baseline ${parsed.error}` };
  }
  if (!isRecord(parsed.value)) {
    return {
      ok: false,
      error: "arch-lint baseline: expected a JSON object at the top level",
    };
  }
  const version = parsed.value.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { ok: false, error: "arch-lint baseline: missing numeric 'version'" };
  }
  if (version !== 1) {
    return {
      ok: false,
      error: `arch-lint baseline: unsupported version ${version}`,
    };
  }
  const entries = readLedgerEntries(parsed.value.entries);
  if (!entries.ok) {
    return { ok: false, error: `arch-lint baseline: ${entries.error}` };
  }
  return { ok: true, value: { version, ...entries.value } };
}

/** Text content of each recognised artifact, already read from wherever it came. */
export type HandoffArtifactTexts = Partial<
  Record<HandoffArtifactName, { text: string; truncated: boolean }>
>;

/**
 * Pure core: turn recognised artifact text into the response. No I/O, no
 * process, no network — safe to unit-test directly.
 */
export function buildHandoffResponse(
  projectName: string,
  texts: HandoffArtifactTexts,
  carriedWarnings: readonly string[] = [],
): ProjectHandoffResponse {
  const warnings = [...carriedWarnings];
  const present = HANDOFF_ARTIFACT_NAMES.filter((name) => texts[name] != null);
  const missing = HANDOFF_ARTIFACT_NAMES.filter((name) => texts[name] == null);

  for (const name of present) {
    if (texts[name]?.truncated) {
      warnings.push(`${name} was truncated to the display limit.`);
    }
  }

  const report = texts["hexagen-report.md"];
  const layout = texts["layout.yaml"];
  const manifest = texts["manifest.yaml"];

  let suppressions: readonly HandoffLedgerEntry[] = [];
  let suppressionCount: number | null = null;
  const ledger = texts["suppression-ledger.json"];
  if (ledger) {
    const parsed = parseSuppressionLedger(ledger.text);
    if (parsed.ok) {
      suppressions = parsed.value.entries;
      suppressionCount = parsed.value.total;
      if (parsed.value.skipped > 0) {
        warnings.push(
          `suppression-ledger.json: ${parsed.value.skipped} malformed entr${parsed.value.skipped === 1 ? "y was" : "ies were"} ignored.`,
        );
      }
      if (parsed.value.total > parsed.value.entries.length) {
        warnings.push(
          `suppression-ledger.json: showing the first ${parsed.value.entries.length} of ${parsed.value.total} entries.`,
        );
      }
    } else {
      warnings.push(parsed.error);
    }
  }

  let baselineVersion: number | null = null;
  let baselineEntryCount: number | null = null;
  const baseline = texts["arch-lint-baseline.json"];
  if (baseline) {
    const parsed = parseArchLintBaseline(baseline.text);
    if (parsed.ok) {
      baselineVersion = parsed.value.version;
      baselineEntryCount = parsed.value.total;
      if (parsed.value.skipped > 0) {
        warnings.push(
          `arch-lint-baseline.json: ${parsed.value.skipped} malformed entr${parsed.value.skipped === 1 ? "y was" : "ies were"} ignored.`,
        );
      }
    } else {
      warnings.push(parsed.error);
    }
  }

  const verdict: HandoffVerdict = report ? "ingested" : "incomplete";
  const errorMessage =
    verdict === "incomplete"
      ? clip(
          "The upload contained no hexagen-report.md. Re-run `hexagen scan --handoff` and upload the zip it produces.",
          MAX_SCAN_ERROR_CHARS,
        )
      : null;

  return {
    source: "handoff-artifacts",
    verdict,
    exitCode: null,
    projectName,
    layoutExcerpt: layout ? layout.text : null,
    filesScanned: null,
    reportMarkdown: report ? report.text : null,
    errorMessage,
    artifacts: {
      present,
      missing,
      reportHtmlPresent: texts["hexagen-report.html"] != null,
      manifestExcerpt: manifest ? manifest.text : null,
      suppressions,
      suppressionCount,
      baselineVersion,
      baselineEntryCount,
    },
    warnings,
  };
}

/** Per-artifact display cap. Reuses the Tier-B limits rather than inventing new ones. */
function limitFor(name: HandoffArtifactName): number {
  switch (name) {
    case "hexagen-report.md":
      return MAX_SCAN_REPORT_CHARS;
    case "layout.yaml":
    case "manifest.yaml":
      return MAX_SCAN_LAYOUT_EXCERPT_CHARS;
    default:
      // JSON artifacts are parsed, not displayed: allow the full entry budget
      // so a legitimate ledger is not silently truncated into "malformed JSON".
      return TIER_A_ZIP_UNPACK_LIMITS.maxEntryBytes;
  }
}

/** Recursively list files under `root`, bounded by the unpacker's entry cap. */
async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const stack: string[] = [root];
  const cap = TIER_A_ZIP_UNPACK_LIMITS.maxEntries;
  while (stack.length > 0 && found.length <= cap) {
    const dir = stack.pop() as string;
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(full);
      else if (dirent.isFile()) found.push(full);
    }
  }
  return found;
}

/**
 * Ingest a `hexagen scan --handoff` zip.
 *
 * Unpacks with {@link TIER_A_ZIP_UNPACK_LIMITS} (8 entries / 1 MiB per entry /
 * 4 MiB total) — deliberately NOT the 256 MiB Tier-B scan profile. Every
 * crafted-archive failure is mapped to an explicit `kind:"rejected"` so the
 * route can answer 400; none of them may surface as a generic 500 or as a soft
 * "could not run".
 */
export async function ingestHandoffZip(input: {
  zip: Buffer;
  projectName: string;
}): Promise<HandoffIngestOutcome> {
  let dir: string;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "hexagen-handoff-"));
  } catch (error) {
    return {
      kind: "failed",
      message: `Could not stage the handoff for parsing: ${messageOf(error)}`,
    };
  }

  try {
    try {
      await unpackZipToDir(input.zip, dir, TIER_A_ZIP_UNPACK_LIMITS);
    } catch (error) {
      return rejectionFor(error);
    }

    let files: string[];
    try {
      files = await listFiles(dir);
    } catch (error) {
      return {
        kind: "failed",
        message: `Could not read the unpacked handoff: ${messageOf(error)}`,
      };
    }

    // The CLI writes flat names, but a user who re-zips a folder produces
    // `handoff/hexagen-report.md`. Match on basename, and when the same
    // artifact appears twice pick deterministically (shallowest, then
    // lexicographic) rather than letting directory order decide.
    const byName = new Map<HandoffArtifactName, string[]>();
    for (const full of files) {
      const base = path.basename(full);
      if (!isHandoffArtifactName(base)) continue;
      const bucket = byName.get(base);
      if (bucket) bucket.push(full);
      else byName.set(base, [full]);
    }

    if (byName.size === 0) {
      return {
        kind: "rejected",
        reason: "no-artifacts",
        message:
          "The zip contained no hexagen handoff artifacts. Upload the zip produced by `hexagen scan --handoff`.",
      };
    }

    const warnings: string[] = [];
    const texts: HandoffArtifactTexts = {};
    for (const [name, candidates] of byName) {
      candidates.sort((a, b) => {
        const depth = a.split(path.sep).length - b.split(path.sep).length;
        return depth !== 0 ? depth : a.localeCompare(b);
      });
      if (candidates.length > 1) {
        warnings.push(
          `${name} appeared ${candidates.length} times in the zip; the shallowest copy was used.`,
        );
      }
      const read = await readTextClipped(
        candidates[0] as string,
        limitFor(name),
      );
      if (!read.ok) {
        warnings.push(`${name} could not be read (${read.error}).`);
        continue;
      }
      texts[name] = { text: read.text, truncated: read.truncated };
    }

    return {
      kind: "parsed",
      result: buildHandoffResponse(input.projectName, texts, warnings),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Ingest loose handoff files (no zip). Content arrives already buffered from
 * the multipart body, so there is nothing to unpack and no temp dir at all.
 */
export function ingestHandoffFiles(input: {
  files: ReadonlyArray<{ name: string; content: Buffer }>;
  projectName: string;
}): HandoffIngestOutcome {
  const warnings: string[] = [];
  const texts: HandoffArtifactTexts = {};
  let recognised = 0;

  for (const file of input.files) {
    const base = path.basename(file.name.replace(/\\/g, "/"));
    if (!isHandoffArtifactName(base)) continue;
    if (texts[base] != null) {
      warnings.push(
        `${base} was uploaded more than once; the first copy was used.`,
      );
      continue;
    }
    recognised += 1;
    const max = limitFor(base);
    const decoded = file.content.toString("utf8");
    texts[base] = {
      text: clip(decoded, max),
      truncated: decoded.length > max,
    };
  }

  if (recognised === 0) {
    return {
      kind: "rejected",
      reason: "no-artifacts",
      message:
        "No hexagen handoff artifacts were uploaded. Upload the zip produced by `hexagen scan --handoff`, or its files.",
    };
  }

  return {
    kind: "parsed",
    result: buildHandoffResponse(input.projectName, texts, warnings),
  };
}

/**
 * Map an unpacker throw onto an explicit rejection. Every branch is a client
 * error: a crafted archive is a deliberate act and must read as 400, never as
 * a 500 and never as a shrugging "could not run".
 *
 * This diverges from the Tier-B adapter on `EmptyZipError` only: there, an
 * empty zip is a scan that could not run; here there is simply nothing to
 * ingest, which is a bad upload.
 */
function rejectionFor(error: unknown): HandoffIngestOutcome {
  if (error instanceof ZipSlipError) {
    return { kind: "rejected", reason: "zip-slip", message: error.message };
  }
  if (error instanceof DuplicateZipEntryError) {
    return {
      kind: "rejected",
      reason: "duplicate-zip-entry",
      message: error.message,
    };
  }
  if (error instanceof InvalidZipError) {
    return { kind: "rejected", reason: "invalid-zip", message: error.message };
  }
  if (error instanceof ZipResourceLimitError) {
    return {
      kind: "rejected",
      reason: "zip-too-large",
      message: error.message,
    };
  }
  if (error instanceof EmptyZipError) {
    return { kind: "rejected", reason: "empty-zip", message: error.message };
  }
  return { kind: "failed", message: messageOf(error) };
}
