/**
 * Helpers for encoding/decoding a UserContext directly into the session cookie.
 * Useful when you need per-user mock data without the fixed MOCK_USER approach.
 * Uses btoa/atob (Web Crypto API) — safe in both Node.js and Edge runtime.
 */

export function encodeMockSession(data: unknown): string {
  return btoa(JSON.stringify(data));
}

export function decodeMockSession<T>(encoded: string): T | null {
  try {
    return JSON.parse(atob(encoded)) as T;
  } catch {
    return null;
  }
}
