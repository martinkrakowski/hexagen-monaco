/**
 * The byte-level half of source hygiene: no gate in this repo looked at bytes.
 *
 * A raw `\x00` inside a string literal in `PlanCapacity.ts` survived `build`,
 * `typecheck`, `lint`, `format:check` and all 6033 tests. TypeScript accepts a
 * control byte in a string literal; ESLint parses it; Prettier reprints it
 * unchanged; every test that read the string compared it against itself. It was
 * caught only because a mutation anchor stopped matching — by accident.
 *
 * The concept already existed here. `tools/wave-status/lib/render.ts` defines
 * C0 (0x00–0x1f) and DEL (0x7f) as "terminal control, never text" and strips
 * them out of identifiers that came off disk. It was never turned around and
 * pointed at the source files themselves.
 *
 * Everything here is pure and byte-oriented — no filesystem, no decoding. Bytes
 * rather than characters on purpose: decoding to UTF-16 first would let a lone
 * surrogate or a replacement character stand in for the byte that was actually
 * on disk, and the byte on disk is the whole question. A UTF-8 multi-byte
 * sequence cannot false-positive, because every one of its bytes is >= 0x80.
 */

/**
 * The C0 bytes that are legitimately text: horizontal tab and line feed.
 *
 * Carriage return is NOT among them, and that is a decision rather than an
 * oversight. Measured on 435cf215 over the 936 tracked text files this scan
 * covers: zero CR bytes — the tree is LF-only throughout, with no `.gitattributes`
 * and no CRLF file anywhere. Allowing CR would admit a CRLF file the rest of the
 * gate set has no opinion about; forbidding it costs nothing today and says so
 * the first time one appears.
 */
export const ALLOWED_CONTROL_BYTES: readonly number[] = [0x09, 0x0a];

/**
 * The file kinds scanned: text that a human writes or a tool parses.
 *
 * An ALLOWLIST, not a denylist. The tree carries `.ttf` fonts and `.png` images
 * whose bytes are control bytes by the thousand, and a denylist would have to be
 * extended for every new binary type anyone ever adds — silently scanning it, and
 * failing, until someone noticed. An allowlist fails the other way: a new text
 * extension goes unscanned until it is added here, which is visible in this list
 * rather than in a red gate nobody can explain.
 */
export const SCANNED_EXTENSIONS: readonly string[] = [
  "cjs",
  "css",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "mjs",
  "scss",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "yaml",
  "yml",
];

/** Human names for the bytes most likely to turn up, so a report is readable. */
const NAMES: Readonly<Record<number, string>> = {
  0x00: "NUL",
  0x07: "BEL",
  0x08: "BS",
  0x0b: "VT",
  0x0c: "FF",
  0x0d: "CR",
  0x1a: "SUB",
  0x1b: "ESC",
  0x7f: "DEL",
};

/** One forbidden byte, located by line and by byte offset within that line. */
export interface Offence {
  readonly path: string;
  readonly line: number;
  /** 1-based BYTE offset within the line, not a character offset. */
  readonly column: number;
  readonly byte: number;
}

export interface ScanReport {
  readonly filesScanned: number;
  /** Listed in the index but absent from the working tree — nothing to look at, not a failure. */
  readonly filesMissing: readonly string[];
  readonly offences: readonly Offence[];
  readonly elapsedMs: number;
}

/** Whether a path's extension is one this scan covers. A leading-dot name has none. */
export function isScanned(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // `dot <= 0` covers both "no dot at all" and a dotfile like `.gitignore`, whose
  // only dot starts the name: neither has an extension to match.
  if (dot <= 0) return false;
  return SCANNED_EXTENSIONS.includes(base.slice(dot + 1));
}

/** C0 (0x00–0x1f) and DEL (0x7f), less the two that are text. */
export function isForbiddenControlByte(byte: number): boolean {
  if (byte === 0x7f) return true;
  if (byte > 0x1f) return false;
  return !ALLOWED_CONTROL_BYTES.includes(byte);
}

export function byteName(byte: number): string {
  return NAMES[byte] ?? `control 0x${byte.toString(16).padStart(2, "0")}`;
}

/**
 * Every forbidden byte in one file's bytes, in order.
 *
 * The distinction this scan lives or dies by: a source file containing the four
 * ASCII characters `\`, `x`, `0`, `0` — an ESCAPE SEQUENCE, which is how
 * `tools/wave-status/lib/__tests__/render.test.ts` legitimately builds a NUL for
 * its sanitizer test — carries no byte below 0x20 at all and is untouched here.
 * Only the single byte 0x00 actually present on disk is an offence. A matcher
 * written against the decoded string, or against the two-character sequence
 * `\x00` in the text, would condemn that test and still be the wrong question.
 */
export function scanBytes(path: string, bytes: Uint8Array): readonly Offence[] {
  const offences: Offence[] = [];
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] as number;
    if (byte === 0x0a) {
      line += 1;
      lineStart = index + 1;
      continue;
    }
    if (isForbiddenControlByte(byte))
      offences.push({ path, line, column: index - lineStart + 1, byte });
  }
  return offences;
}

/** Past this many, the list stops being a report and starts being the file. */
export const MAX_LISTED = 20;

export function formatReport(report: ScanReport): string {
  const scanned =
    `control-bytes: scanned ${report.filesScanned} text files in ` +
    `${report.elapsedMs.toFixed(0)}ms`;
  const missing =
    report.filesMissing.length === 0
      ? ""
      : `\ncontrol-bytes: ${report.filesMissing.length} listed file(s) absent from the working ` +
        `tree, skipped: ${report.filesMissing.join(", ")}`;
  if (report.offences.length === 0)
    return `${scanned}${missing}\ncontrol-bytes: no raw C0 control bytes. OK`;
  const shown = report.offences.slice(0, MAX_LISTED).map((offence) => {
    const note =
      offence.byte === 0x0d
        ? " — this tree is LF-only; no tracked text file carries a CR"
        : "";
    return `  ${offence.path}:${offence.line}:${offence.column} raw ${byteName(offence.byte)}${note}`;
  });
  const more =
    report.offences.length > MAX_LISTED
      ? [`  … and ${report.offences.length - MAX_LISTED} more`]
      : [];
  return [
    `${scanned}${missing}`,
    `control-bytes: ${report.offences.length} raw control byte(s) in source:`,
    ...shown,
    ...more,
    "control-bytes: tab and newline are text; every other C0 byte and DEL is not.",
    "control-bytes: to write one in a string, use an escape (\\x00) — that is four ASCII",
    "control-bytes: characters and is not what this check looks for.",
  ].join("\n");
}

export function exitCodeFor(report: ScanReport): number {
  return report.offences.length === 0 ? 0 : 1;
}
