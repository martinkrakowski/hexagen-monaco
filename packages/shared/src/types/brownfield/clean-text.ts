/**
 * Strips anything a terminal or a text surface could act on. File contents
 * from a client repo are untrusted: every string read from disk, a child
 * process or a bundle goes through this before it reaches a pane or the page.
 * Keeps \n and \t only.
 */
/* eslint-disable no-control-regex */
export function cleanText(text: string): string {
  return text
    .replace(/\x1b[\]PX^_][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[\s\S]?/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
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
