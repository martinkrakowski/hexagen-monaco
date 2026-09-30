import { describe, test, expect } from "vitest";
import {
  ALLOWED_CONTROL_BYTES,
  MAX_LISTED,
  SCANNED_EXTENSIONS,
  byteName,
  exitCodeFor,
  formatReport,
  isForbiddenControlByte,
  isScanned,
  scanBytes,
  type Offence,
  type ScanReport,
} from "../../src/control-bytes/lib/scan.js";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const report = (over: Partial<ScanReport> = {}): ScanReport => ({
  filesScanned: 1,
  filesMissing: [],
  offences: [],
  elapsedMs: 4.2,
  ...over,
});

/**
 * The distinction the whole check turns on, written out so it is pinned rather
 * than assumed.
 *
 * `RAW` is a JavaScript string containing ONE character whose code point is 0,
 * which encodes to the single byte 0x00 on disk. `ESCAPED` is a string of FOUR
 * characters — backslash, x, zero, zero — which encodes to four printable ASCII
 * bytes and contains nothing below 0x20. The second is how
 * `tools/wave-status/lib/__tests__/render.test.ts:508` legitimately builds a NUL
 * for its sanitizer test: the source file on disk carries the escape, and the
 * runtime builds the byte. Condemning that file is the obvious way to get this
 * check wrong, and it is exactly as wrong as missing the raw byte.
 */
const RAW = "\x00";
const ESCAPED = "\\x00";

describe("raw byte versus escape sequence", () => {
  test("the two differ on disk, which is the only place this check looks", () => {
    expect(RAW).toHaveLength(1);
    expect(RAW.charCodeAt(0)).toBe(0);
    expect([...bytes(RAW)]).toEqual([0x00]);

    expect(ESCAPED).toHaveLength(4);
    expect([...bytes(ESCAPED)]).toEqual([0x5c, 0x78, 0x30, 0x30]);
    expect([...bytes(ESCAPED)].every((byte) => byte >= 0x20)).toBe(true);
  });

  test("a raw NUL in a string literal is an offence", () => {
    const offences = scanBytes("a.ts", bytes(`const x = "${RAW}";\n`));
    expect(offences).toEqual([
      { path: "a.ts", line: 1, column: 12, byte: 0x00 },
    ]);
  });

  test("the same literal written as an escape is not", () => {
    expect(scanBytes("a.ts", bytes(`const x = "${ESCAPED}";\n`))).toEqual([]);
  });

  test("the real fixture's whole line passes, escapes and all", () => {
    // Copied in shape from render.test.ts: several escapes, no raw byte.
    const line = `plan: "docs/p\\x00lan.md", reason: "gap closed\\x1b[31m exploit"\n`;
    expect(scanBytes("render.test.ts", bytes(line))).toEqual([]);
  });
});

describe("what counts as a control byte", () => {
  test("tab and newline are text", () => {
    expect(ALLOWED_CONTROL_BYTES).toEqual([0x09, 0x0a]);
    expect(isForbiddenControlByte(0x09)).toBe(false);
    expect(isForbiddenControlByte(0x0a)).toBe(false);
    expect(
      scanBytes("a.ts", bytes("\tconst x = 1;\n\tconst y = 2;\n")),
    ).toEqual([]);
  });

  test("carriage return is not, because this tree is LF-only", () => {
    expect(isForbiddenControlByte(0x0d)).toBe(true);
    expect(scanBytes("a.ts", bytes("const x = 1;\r\n"))).toEqual([
      { path: "a.ts", line: 1, column: 13, byte: 0x0d },
    ]);
  });

  test("every byte from 0x00 to 0x1f and DEL is decided, one at a time", () => {
    for (let byte = 0x00; byte <= 0x1f; byte += 1) {
      expect(isForbiddenControlByte(byte)).toBe(byte !== 0x09 && byte !== 0x0a);
    }
    expect(isForbiddenControlByte(0x7f)).toBe(true);
    // The boundary on each side: space is text, and so is the byte after DEL.
    expect(isForbiddenControlByte(0x20)).toBe(false);
    expect(isForbiddenControlByte(0x7e)).toBe(false);
    expect(isForbiddenControlByte(0x80)).toBe(false);
  });

  test("a UTF-8 multi-byte sequence cannot false-positive", () => {
    // Every continuation and lead byte is >= 0x80, so no part of "é — 日" is C0.
    expect(scanBytes("a.ts", bytes('const s = "é — 日";\n'))).toEqual([]);
    expect([...bytes("é")].every((byte) => byte >= 0x80)).toBe(true);
  });

  test("bytes are located by line and by byte offset in that line", () => {
    const source = bytes(`line one\nline two\x07here\nline three\n`);
    expect(scanBytes("a.ts", source)).toEqual([
      { path: "a.ts", line: 2, column: 9, byte: 0x07 },
    ]);
  });

  test("several offences come back in order, across lines", () => {
    const source = bytes(`a\x00b\nc\x1bd\x7f\n`);
    expect(
      scanBytes("a.ts", source).map((o) => [o.line, o.column, o.byte]),
    ).toEqual([
      [1, 2, 0x00],
      [2, 2, 0x1b],
      [2, 4, 0x7f],
    ]);
  });
});

describe("byteName", () => {
  test("names the bytes a reader will meet", () => {
    expect(byteName(0x00)).toBe("NUL");
    expect(byteName(0x0d)).toBe("CR");
    expect(byteName(0x1b)).toBe("ESC");
    expect(byteName(0x7f)).toBe("DEL");
  });

  test("falls back to the hex value for the rest", () => {
    expect(byteName(0x01)).toBe("control 0x01");
    expect(byteName(0x1f)).toBe("control 0x1f");
  });
});

describe("scope", () => {
  test("source and text extensions are scanned", () => {
    for (const extension of SCANNED_EXTENSIONS)
      expect(isScanned(`a/b.${extension}`)).toBe(true);
    expect(isScanned("packages/x/src/a.ts")).toBe(true);
    expect(isScanned("apps/web/src/a.tsx")).toBe(true);
    expect(isScanned("scripts/verify-manifests.sh")).toBe(true);
  });

  test("binaries and extensionless files are not", () => {
    // These carry control bytes by the thousand and always will.
    expect(isScanned("assets/fonts/Inter-Bold.ttf")).toBe(false);
    expect(isScanned("assets/inputs/reuse-bg.png")).toBe(false);
    expect(isScanned("yarn.lock")).toBe(false);
    expect(isScanned("LICENSE")).toBe(false);
    expect(isScanned("briefs/.gitkeep")).toBe(false);
  });

  test("a dotfile's leading dot is not an extension", () => {
    expect(isScanned(".gitignore")).toBe(false);
    expect(isScanned("a/b/.gitignore")).toBe(false);
    // But a dotfile that really does carry one is scanned on that.
    expect(isScanned(".coderabbit.yaml")).toBe(true);
  });

  test("a directory name that looks like an extension does not decide it", () => {
    expect(isScanned("a.ts/b")).toBe(false);
  });
});

describe("the report", () => {
  test("a clean scan says so, with the count and the runtime", () => {
    const text = formatReport(report({ filesScanned: 936, elapsedMs: 41.7 }));
    expect(text).toContain("scanned 936 text files in 42ms");
    expect(text).toContain("no raw C0 control bytes. OK");
    expect(exitCodeFor(report({ filesScanned: 936 }))).toBe(0);
  });

  test("an offence is named with its file, line, column and byte", () => {
    const offences: Offence[] = [
      { path: "a/b.ts", line: 12, column: 30, byte: 0x00 },
    ];
    const text = formatReport(report({ offences }));
    expect(text).toContain("1 raw control byte(s) in source");
    expect(text).toContain("a/b.ts:12:30 raw NUL");
    // And it tells the reader what to write instead, since the escape is fine.
    expect(text).toContain("\\x00");
    expect(exitCodeFor(report({ offences }))).toBe(1);
  });

  test("a CR carries the reason it is refused", () => {
    const text = formatReport(
      report({ offences: [{ path: "a.ts", line: 1, column: 2, byte: 0x0d }] }),
    );
    expect(text).toContain("raw CR — this tree is LF-only");
  });

  test("a long list is truncated rather than reprinted whole", () => {
    const offences: Offence[] = Array.from(
      { length: MAX_LISTED + 3 },
      (_unused, index) => ({
        path: "a.ts",
        line: index + 1,
        column: 1,
        byte: 0x00,
      }),
    );
    const text = formatReport(report({ offences }));
    expect(text).toContain(`${MAX_LISTED + 3} raw control byte(s)`);
    expect(text).toContain("… and 3 more");
    expect(
      text.split("\n").filter((line) => line.includes("raw NUL")),
    ).toHaveLength(MAX_LISTED);
  });

  test("a file listed but absent is reported as skipped, not as clean silence", () => {
    const text = formatReport(
      report({ filesScanned: 5, filesMissing: ["gone.ts", "also.ts"] }),
    );
    expect(text).toContain(
      "2 listed file(s) absent from the working tree, skipped: gone.ts, also.ts",
    );
    expect(text).toContain("no raw C0 control bytes. OK");
  });
});
