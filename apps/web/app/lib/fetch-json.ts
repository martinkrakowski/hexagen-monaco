/**
 * Typed JSON fetch helpers that return discriminated Result types.
 * Replaces the duplicated `await fetch(...); if (!response.ok) { ... }`
 * pattern scattered across export and generation code paths.
 *
 * Never silently swallows parse errors — a malformed response body
 * produces a `parse-error` variant rather than the fallback defaults
 * produced by the previous `.catch(() => ({}))` idiom.
 */

/** Add-on materialization notice COUNTS, surfaced from sideband response
 * headers on a binary download (the full detail lives in the project's
 * HEXAGEN-ADDON-NOTICES.md). */
export interface AddOnNoticeCounts {
  warnings: number;
  errors: number;
}

export type FetchJsonResult<T> =
  | { kind: "success"; data: T; notices?: AddOnNoticeCounts }
  // `code` is the machine-readable error code from the JSON error body (e.g.
  // the snake_case codes emitted by /api/export/github and /api/push/github);
  // set only when the body carries a string `code`.
  | { kind: "http-error"; status: number; message: string; code?: string }
  | { kind: "network-error"; message: string }
  | { kind: "parse-error"; message: string };

interface PostJsonOptions {
  signal?: AbortSignal;
}

/**
 * Read add-on notice COUNTS from sideband response headers on a binary
 * download. Defensive: a missing or non-numeric header (e.g. stripped by a
 * proxy) reads as 0, and an all-zero result returns `undefined` so callers can
 * treat it as "no notices".
 */
export function parseNoticeCountHeaders(
  headers: Headers,
): AddOnNoticeCounts | undefined {
  const toCount = (raw: string | null): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const warnings = toCount(headers.get("x-hexagen-addon-warnings"));
  const errors = toCount(headers.get("x-hexagen-addon-errors"));
  if (warnings === 0 && errors === 0) return undefined;
  return { warnings, errors };
}

/**
 * Extract a machine-readable `code` from an already-parsed error body.
 * Only a string value qualifies — any other shape reads as `undefined` so a
 * malformed body cannot leak a non-string into consumers' code branching.
 */
function extractErrorCode(parsed: unknown): string | undefined {
  return parsed &&
    typeof parsed === "object" &&
    "code" in parsed &&
    typeof (parsed as { code: unknown }).code === "string"
    ? (parsed as { code: string }).code
    : undefined;
}

/**
 * POST a JSON body and parse the response as JSON.
 *
 * The response body is always parsed — for 4xx/5xx responses, the
 * helper tries to extract `{ error: string }` from the body and
 * surface it; if parsing fails, returns `parse-error` instead of
 * silently dropping the failure.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<FetchJsonResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    return {
      kind: "network-error",
      message: err instanceof Error ? err.message : "Network request failed",
    };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (err) {
    return {
      kind: "parse-error",
      message: err instanceof Error ? err.message : "Invalid JSON response",
    };
  }

  if (!response.ok) {
    const errorMessage =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${response.status})`;
    return {
      kind: "http-error",
      status: response.status,
      message: errorMessage,
      code: extractErrorCode(parsed),
    };
  }

  return { kind: "success", data: parsed as T };
}

/**
 * POST a JSON body and expect a binary (Blob) response — for file
 * downloads. On error responses, attempts to extract a JSON error
 * message from the body.
 */
export async function postForBlob(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<FetchJsonResult<Blob>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (err) {
    return {
      kind: "network-error",
      message: err instanceof Error ? err.message : "Network request failed",
    };
  }

  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      // No parsed body here, so there is no `code` to surface — only the
      // status-derived fallback message.
      return {
        kind: "http-error",
        status: response.status,
        message: `Request failed (${response.status})`,
      };
    }
    const errorMessage =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${response.status})`;
    return {
      kind: "http-error",
      status: response.status,
      message: errorMessage,
      code: extractErrorCode(parsed),
    };
  }

  try {
    const blob = await response.blob();
    return {
      kind: "success",
      data: blob,
      notices: parseNoticeCountHeaders(response.headers),
    };
  } catch (err) {
    return {
      kind: "parse-error",
      message: err instanceof Error ? err.message : "Failed to read blob",
    };
  }
}
