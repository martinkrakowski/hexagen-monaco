/**
 * Helpers for encoding/decoding a UserContext directly into the session cookie.
 * Useful when you need per-user mock data without the fixed MOCK_USER approach.
 * Uses TextEncoder/TextDecoder + btoa/atob — safe in both Node.js and Edge runtime,
 * and handles Unicode characters correctly.
 */

export function encodeMockSession(data: unknown): string {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeMockSession<T>(encoded: string): T | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
