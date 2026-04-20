/**
 * Typed JSON fetch helpers that return discriminated Result types.
 * Replaces the duplicated `await fetch(...); if (!response.ok) { ... }`
 * pattern scattered across export and generation code paths.
 *
 * Never silently swallows parse errors — a malformed response body
 * produces a `parse-error` variant rather than the fallback defaults
 * produced by the previous `.catch(() => ({}))` idiom.
 */

export type FetchJsonResult<T> =
  | { kind: "success"; data: T }
  | { kind: "http-error"; status: number; message: string }
  | { kind: "network-error"; message: string }
  | { kind: "parse-error"; message: string };

interface PostJsonOptions {
  signal?: AbortSignal;
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
    };
  }

  try {
    const blob = await response.blob();
    return { kind: "success", data: blob };
  } catch (err) {
    return {
      kind: "parse-error",
      message: err instanceof Error ? err.message : "Failed to read blob",
    };
  }
}
