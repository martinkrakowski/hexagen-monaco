// packages/sync/src/domain/services/codec-echo.ts
//
// Bounds how much of an untrusted key or kind an error message repeats: at most
// MAX_ECHO_LENGTH characters, with line breaks and other control characters
// removed, so a message stays on one short line.

/** Longest fragment of an untrusted string an error message repeats. */
export const MAX_ECHO_LENGTH = 64;

/** Truncate and strip control characters from an untrusted string for a message. */
export function safeEcho(value: unknown): string {
  const text = typeof value === "string" ? value : String(typeof value);
  let out = "";
  let i = 0;
  for (; i < text.length && out.length < MAX_ECHO_LENGTH; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      continue;
    }
    out += text[i];
  }
  return i < text.length ? `${out}...` : out;
}
