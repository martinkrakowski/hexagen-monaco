/**
 * Strict reader for a git-style unified diff, for `hexagen_propose_patch`
 * (plan 2026-10-01, BW10). Pure: it never touches the filesystem and never
 * applies anything. Its one job is to name every path the patch would touch,
 * and to refuse any patch it cannot read with certainty. A path the parser
 * misses is a path no check ever sees, so every ambiguity is a refusal.
 *
 * Shape accepted, and nothing else: one or more file sections, each opened by
 * `diff --git a/<p> b/<p>`, then only the extended header lines git writes
 * (modes, similarity, rename/copy, index, `---`/`+++`), then hunks. Hunk
 * bodies are consumed by their declared line counts, so a body line that
 * looks like a header (`+++ b/x`, `diff --git …`) is never read as one, and
 * a line that is neither a header nor a counted hunk line is refused, never
 * skipped (`git apply` would also parse a headerless `---`/`+++` pair).
 *
 * Both sides of a rename or copy are read. Every path found anywhere in a
 * section (the `diff --git` line, `---`, `+++`, `rename`/`copy`) is returned
 * and judged, so a section that names two different files on two lines
 * cannot hide one. `/dev/null` marks a created or deleted file and is never a
 * path.
 */
import { normalizeSlicePath } from "@hexagen/shared";

/** Refuse a patch larger than this many bytes (1 MiB). */
export const MAX_PATCH_BYTES = 1024 * 1024;

export type PatchParse =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const ALLOWED_MODES = new Set(["100644", "100755"]);
const DEV_NULL = "/dev/null";

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

function show(line: string): string {
  const flat = line.length > 60 ? `${line.slice(0, 60)}...` : line;
  return JSON.stringify(flat);
}

function checkMode(mode: string, line: string): void {
  if (mode === "120000")
    refuse(`symlink mode 120000 is refused: ${show(line)}`);
  if (mode === "160000") {
    refuse(`submodule mode 160000 is refused: ${show(line)}`);
  }
  if (!ALLOWED_MODES.has(mode)) {
    refuse(
      `file mode ${mode} is refused (only 100644 and 100755): ${show(line)}`,
    );
  }
}

/** Index of the closing quote of a git C-quoted string starting at `start`. */
function closingQuote(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === '"') return i;
  }
  return -1;
}

const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  "\\": 0x5c,
  '"': 0x22,
};

/** Decode git's C-style quoting (`"` ... `"`); null when it is not decodable. */
function unquote(token: string): string | null {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"')) {
    return null;
  }
  // By code point, never by UTF-16 unit: a literal non-BMP character (an
  // emoji) must become its four UTF-8 bytes, not two replacement characters.
  const inner = Array.from(token.slice(1, -1));
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i] as string;
    if (ch === '"') return null;
    if (ch !== "\\") {
      bytes.push(...encoder.encode(ch));
      continue;
    }
    const next = inner[i + 1];
    if (next === undefined) return null;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 1;
      continue;
    }
    const octal = /^[0-3][0-7][0-7]/.exec(inner.slice(i + 1, i + 4).join(""));
    if (octal === null) return null;
    bytes.push(Number.parseInt(octal[0], 8));
    i += 3;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return null;
  }
}

/** A path token as git writes it: quoted, or raw. */
function pathToken(token: string, context: string): string {
  let name = token;
  if (token.startsWith('"')) {
    const decoded = unquote(token);
    if (decoded === null) {
      refuse(`quoted path that cannot be decoded safely: ${show(context)}`);
    }
    name = decoded;
  }
  // A replacement character means the name we would judge is not the name
  // git writes.
  if (name.includes("\uFFFD")) {
    refuse(`path contains U+FFFD (undecodable bytes): ${show(context)}`);
  }
  return name;
}

function stripPrefix(name: string, prefix: "a/" | "b/", line: string): string {
  if (!name.startsWith(prefix)) {
    refuse(
      `path does not start with ${prefix} (apply uses -p1): ${show(line)}`,
    );
  }
  return name.slice(prefix.length);
}

/** The two names on a `diff --git` line, with their `a/` and `b/` removed. */
function parseDiffGit(line: string): [string, string] {
  const rest = line.slice("diff --git ".length);
  let tokenA: string;
  let tokenB: string;
  if (rest.startsWith('"')) {
    const q = closingQuote(rest, 0);
    if (q === -1 || rest[q + 1] !== " ") {
      refuse(`unreadable diff --git line: ${show(line)}`);
    }
    tokenA = rest.slice(0, q + 1);
    tokenB = rest.slice(q + 2);
  } else if (rest.includes(' "')) {
    // An unquoted name never holds a quote, so a quote starts the second name.
    const at = rest.indexOf(' "');
    tokenA = rest.slice(0, at);
    tokenB = rest.slice(at + 1);
  } else {
    const splits: number[] = [];
    let from = 0;
    for (;;) {
      const at = rest.indexOf(" b/", from);
      if (at === -1) break;
      splits.push(at);
      from = at + 1;
    }
    const equal = splits.find((at) => rest.slice(2, at) === rest.slice(at + 3));
    const only = splits.length === 1 ? splits[0] : undefined;
    const at = equal ?? only;
    if (at === undefined) {
      refuse(`ambiguous or unreadable diff --git line: ${show(line)}`);
    }
    tokenA = rest.slice(0, at);
    tokenB = rest.slice(at + 1);
  }
  return [
    stripPrefix(pathToken(tokenA, line), "a/", line),
    stripPrefix(pathToken(tokenB, line), "b/", line),
  ];
}

/** A `---` or `+++` name: null for /dev/null. Git may append a tab and a stamp. */
function parseFileLine(line: string, prefix: "a/" | "b/"): string | null {
  const body = line.slice(4);
  let token: string;
  if (body.startsWith('"')) {
    const q = closingQuote(body, 0);
    const rest = q === -1 ? "x" : body.slice(q + 1);
    if (q === -1 || (rest !== "" && !rest.startsWith("\t"))) {
      refuse(`unreadable quoted path: ${show(line)}`);
    }
    token = body.slice(0, q + 1);
  } else {
    token = body.split("\t")[0] as string;
  }
  if (token === DEV_NULL) return null;
  return stripPrefix(pathToken(token, line), prefix, line);
}

const NO_NEWLINE = "\\ No newline at end of file";
const HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+(?: (\d{6}))?$/;
const SIMILARITY = /^(?:dis)?similarity index \d+%$/;

/** Consume hunks from `lines[at]`; returns the index after the last one. */
function skipHunks(lines: readonly string[], start: number): number {
  let i = start;
  while (i < lines.length && (lines[i] as string).startsWith("@@")) {
    const header = HUNK.exec(lines[i] as string);
    if (header === null)
      refuse(`unreadable hunk header: ${show(lines[i] as string)}`);
    let oldLeft = header[1] === undefined ? 1 : Number(header[1]);
    let newLeft = header[2] === undefined ? 1 : Number(header[2]);
    i++;
    let afterHunkLine = false;
    for (;;) {
      const line = lines[i];
      if (line === undefined) {
        if (oldLeft > 0 || newLeft > 0) refuse("patch ends inside a hunk");
        break;
      }
      if (line.startsWith("\\")) {
        if (line !== NO_NEWLINE || !afterHunkLine) {
          refuse(
            `backslash line that is not a no-newline marker after a hunk line: ${show(line)}`,
          );
        }
        afterHunkLine = false;
        i++;
        continue;
      }
      if (oldLeft === 0 && newLeft === 0) break;
      const mark = line.length === 0 ? " " : line[0];
      if (mark === " ") {
        if (oldLeft === 0 || newLeft === 0) {
          refuse(`hunk has more lines than it declares: ${show(line)}`);
        }
        oldLeft--;
        newLeft--;
      } else if (mark === "-") {
        if (oldLeft === 0)
          refuse(`hunk has more lines than it declares: ${show(line)}`);
        oldLeft--;
      } else if (mark === "+") {
        if (newLeft === 0)
          refuse(`hunk has more lines than it declares: ${show(line)}`);
        newLeft--;
      } else {
        refuse(`unexpected line inside a hunk: ${show(line)}`);
      }
      afterHunkLine = true;
      i++;
    }
  }
  return i;
}

function parseSections(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const found: string[] = [];
  const add = (p: string | null): void => {
    if (p === null) return;
    const checked = normalizeSlicePath(p);
    if (!checked.ok) refuse(`path ${show(p)} is refused: ${checked.reason}`);
    if (!found.includes(checked.path)) found.push(checked.path);
  };

  let i = 0;
  let sections = 0;
  while (i < lines.length) {
    const head = lines[i] as string;
    if (!head.startsWith("diff --git ")) {
      refuse(`unexpected line outside a file section: ${show(head)}`);
    }
    sections++;
    const [a, b] = parseDiffGit(head);
    add(a);
    add(b);
    i++;
    while (i < lines.length) {
      const line = lines[i] as string;
      if (line.startsWith("diff --git ")) break;
      if (line.startsWith("@@")) {
        i = skipHunks(lines, i);
        break;
      }
      if (line.startsWith("--- ")) {
        const next = lines[i + 1];
        if (next === undefined || !next.startsWith("+++ ")) {
          refuse(`'---' line not followed by '+++': ${show(line)}`);
        }
        add(parseFileLine(line, "a/"));
        add(parseFileLine(next, "b/"));
        i += 2;
        continue;
      }
      if (line.startsWith("+++ ")) refuse(`stray '+++' line: ${show(line)}`);
      if (line === "GIT binary patch" || line.startsWith("Binary files ")) {
        refuse("binary patches are refused");
      }
      const mode =
        /^(?:old mode|new mode|deleted file mode|new file mode) (\d+)$/.exec(
          line,
        );
      if (mode !== null) {
        checkMode(mode[1] as string, line);
        i++;
        continue;
      }
      const index = INDEX_LINE.exec(line);
      if (index !== null) {
        if (index[1] !== undefined) checkMode(index[1], line);
        i++;
        continue;
      }
      if (SIMILARITY.test(line)) {
        i++;
        continue;
      }
      const moved = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line);
      if (moved !== null) {
        add(pathToken(moved[1] as string, line));
        i++;
        continue;
      }
      refuse(`unrecognised header line: ${show(line)}`);
    }
  }
  if (sections === 0) refuse("no file headers (diff --git) found");
  return found;
}

/** Name every path a unified diff touches, or say why it is refused. */
export function parseUnifiedDiff(patch: string): PatchParse {
  if (new TextEncoder().encode(patch).length > MAX_PATCH_BYTES) {
    return {
      ok: false,
      reason: `patch is larger than ${MAX_PATCH_BYTES} bytes`,
    };
  }
  try {
    return { ok: true, paths: parseSections(patch) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message };
    throw error;
  }
}
