import {
  CSRF_COOKIE_NAME,
  CSRF_ERROR_CODE,
  CSRF_HEADER_NAME,
} from "../../lib/csrf";

/**
 * D-H7 client half: the ONE helper every cookie-authenticated mutation goes
 * through. One helper for the same reason the server check lives in one
 * middleware — a second copy is how one call site ends up not sending the
 * header and failing only for signed-in users.
 *
 * Behaviour:
 * - Non-mutating methods pass straight through: the server never requires the
 *   header on a GET, and adding one would be noise.
 * - Mutations attach `x-hexagen-csrf` from the (script-readable) cookie when
 *   it exists. A missing cookie sends NO header — the server answers with the
 *   distinct `csrf` error code, and THEN this helper bootstraps a token from
 *   `/api/csrf` and retries exactly once. Recovery-on-denial rather than
 *   bootstrap-up-front keeps the anonymous path free of extra requests and
 *   keeps existing tests' fetch-call counts intact: a stubbed non-csrf 403
 *   (role denial) never triggers the retry.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const found = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`));
  if (!found) return null;
  const value = decodeURIComponent(found.slice(CSRF_COOKIE_NAME.length + 1));
  return value.length > 0 ? value : null;
}

function withCsrfHeader(init: RequestInit | undefined, token: string) {
  const headers = new Headers(init?.headers);
  headers.set(CSRF_HEADER_NAME, token);
  return { ...init, headers };
}

async function isCsrfDenial(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    return body?.error === CSRF_ERROR_CODE;
  } catch {
    return false;
  }
}

/**
 * ONE bootstrap at a time, shared: parallel denied mutations (Promise.all
 * call sites) must not each mint a token, because every mint rotates the
 * shared cookie and a retry carrying an older token then fails terminally.
 * All concurrent recoveries await the same in-flight request and retry with
 * the same token.
 */
let bootstrapInFlight: Promise<string | null> | null = null;

function bootstrapToken(): Promise<string | null> {
  bootstrapInFlight ??= (async () => {
    try {
      const response = await fetch("/api/csrf");
      if (!response.ok) return null;
      const body = (await response.json()) as { token?: unknown };
      return typeof body.token === "string" && body.token.length > 0
        ? body.token
        : null;
    } catch {
      return null;
    } finally {
      bootstrapInFlight = null;
    }
  })();
  return bootstrapInFlight;
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // A Request input carries its own method; init only overrides it. Reading
  // init alone would treat a mutating Request as a GET and skip the header.
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  if (SAFE_METHODS.has(method)) return fetch(input, init);

  const cookieToken = readCsrfCookie();
  const first = await fetch(
    input,
    cookieToken ? withCsrfHeader(init, cookieToken) : init,
  );
  if (!(await isCsrfDenial(first))) return first;

  const fresh = await bootstrapToken();
  if (!fresh) return first;
  // Prefer the cookie AS OF the retry: if another recovery rotated it after
  // our bootstrap resolved, the cookie is what the server will compare
  // against, so the header must match it — not our possibly stale token.
  return fetch(input, withCsrfHeader(init, readCsrfCookie() ?? fresh));
}
