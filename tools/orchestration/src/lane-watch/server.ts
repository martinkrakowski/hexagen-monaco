import { SESSION_ID_PATTERN } from "../internal/loopback-server.js";

/** The `fetch` shape lane-watch needs, so a test can observe every call. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const SESSION_PATH = new RegExp(
  `^/session/${SESSION_ID_PATTERN.source.slice(1, -1)}$`,
);

/** The only two paths this tool ever asks the server for. */
export function isAllowedPath(pathname: string): boolean {
  return pathname === "/global/event" || SESSION_PATH.test(pathname);
}

/**
 * The ONE place a request is made. It refuses any pathname off the allowlist
 * before `fetch` is called, never follows a redirect (a server that redirects
 * is a server that is not the one the operator named), and ties every request to
 * the caller's abort signal so that no exit path can leave a connection open.
 */
export function makeGet(
  fetchImpl: FetchLike,
  origin: string,
  signal: AbortSignal,
): (pathname: string) => Promise<Response> {
  return (pathname) => {
    if (!isAllowedPath(pathname)) {
      throw new Error(
        `refusing to request ${JSON.stringify(pathname)}: it is not on the allowlist`,
      );
    }
    return fetchImpl(`${origin}${pathname}`, {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        accept:
          pathname === "/global/event"
            ? "text/event-stream"
            : "application/json",
      },
    });
  };
}
