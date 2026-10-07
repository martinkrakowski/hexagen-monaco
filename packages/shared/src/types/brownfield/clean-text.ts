/**
 * Strips anything a terminal or a text surface could act on. File contents
 * from a client repo are untrusted: every string read from disk, a child
 * process or a bundle goes through this before it reaches a pane or the page.
 * Keeps \n and \t only.
 *
 * It also strips the Unicode format characters that change what a reader SEES
 * without changing what the text IS: the bidirectional controls (embeddings,
 * overrides and isolates, the two direction marks and the Arabic letter mark),
 * which can display source in a different order than a compiler reads it, and
 * the zero-width characters (space, non-joiner, joiner, word joiner and the
 * byte order mark), which make two different strings look the same. The cost,
 * accepted for a surface that shows untrusted repos: a joined emoji sequence
 * renders as its separate emoji, and text in scripts that use the joiners
 * loses them on screen. Nothing is written back, so no file changes.
 */
/* eslint-disable no-control-regex */
export function cleanText(text: string): string {
  return text
    .replace(/\x1b[\]PX^_][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[\s\S]?/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
    .replace(
      /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g,
      "",
    );
}
/* eslint-enable no-control-regex */

/**
 * `cleanText` for text that must be shown byte for byte: a `\r` that is
 * followed by `\n` (a CRLF line ending) is kept; a lone `\r` is stripped like
 * any other control character.
 */
export function cleanTextKeepingCrlf(text: string): string {
  return text.split("\r\n").map(cleanText).join("\r\n");
}
