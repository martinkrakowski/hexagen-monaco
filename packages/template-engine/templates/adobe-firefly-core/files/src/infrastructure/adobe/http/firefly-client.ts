// @hexagen-server-only
import { imsTokenProvider } from "../auth/ims-token-provider.adapter";
import { classifyAdobeError, FireflyError } from "../errors/firefly-errors";

/**
 * Base Firefly REST client.
 *
 * Injects the IMS bearer + `x-api-key` (the client id) on every call, applies a
 * per-request timeout and bounded retry on retryable failures (429/5xx, honouring
 * `Retry-After`), and throws a classified `FireflyError` on non-2xx. Service
 * adapters build on this rather than calling `fetch` directly.
 */
const BASE_URL = process.env.ADOBE_FIREFLY_BASE_URL ?? "https://firefly-api.adobe.io";
const DEFAULT_TIMEOUT_MS = Number("{default_timeout_ms}");
const MAX_RETRIES = Number("{max_retries}");

export interface FireflyRequestOptions {
  timeoutMs?: number;
  /** Extra headers (e.g. `x-gw-ims-org-id`) merged over the defaults. */
  headers?: Record<string, string>;
}

class FireflyClient {
  async post<T>(path: string, body: unknown, opts: FireflyRequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, body, opts);
  }

  async get<T>(pathOrUrl: string, opts: FireflyRequestOptions = {}): Promise<T> {
    return this.request<T>("GET", pathOrUrl, undefined, opts);
  }

  private async request<T>(
    method: "GET" | "POST",
    pathOrUrl: string,
    body: unknown,
    opts: FireflyRequestOptions,
  ): Promise<T> {
    // Status URLs returned by Firefly are absolute; service paths are relative.
    // Case-insensitive: services that post to another host (Photoshop/Lightroom on
    // image.adobe.io) may carry an upper/mixed-case scheme ("HTTPS://…"); without
    // the `i` flag those would be treated as relative and mis-prefixed with BASE_URL.
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let lastError: FireflyError | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.attempt<T>(method, url, body, timeoutMs, opts.headers);
      } catch (error) {
        const fe = classifyAdobeError(error);
        if (!fe.retryable || attempt === MAX_RETRIES) throw fe;
        lastError = fe;
        await delay(backoffMs(attempt, fe));
      }
    }
    // Unreachable (loop either returns or throws), but satisfies the type checker.
    throw lastError ?? new FireflyError("Firefly request failed");
  }

  private async attempt<T>(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    timeoutMs: number,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const token = await imsTokenProvider.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-api-key": process.env.ADOBE_CLIENT_ID ?? "",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw classifyAdobeError({
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
          body: await safeBody(response),
        });
      }
      // 202/empty bodies resolve to an empty object.
      return (await safeBody(response)) as T;
    } catch (error) {
      // Match on name, not the DOMException subclass — some edge runtimes / shims
      // throw a plain Error with name "AbortError" rather than a DOMException.
      if (error instanceof Error && error.name === "AbortError") {
        throw new FireflyError(`Firefly request timed out after ${timeoutMs}ms`, 408, true);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function backoffMs(attempt: number, error: FireflyError): number {
  if (error instanceof FireflyError && "retryAfterMs" in error) {
    const retryAfter = (error as { retryAfterMs?: number }).retryAfterMs;
    if (typeof retryAfter === "number") return retryAfter;
  }
  return Math.min(2000 * 2 ** attempt, 15000); // exponential, capped
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Shared singleton used by all service adapters. */
export const fireflyClient = new FireflyClient();
export { FireflyClient };
