/**
 * The one rule for "a server this tool may talk to": a loopback http(s) origin.
 *
 * `laneHosts[].server` (A-30) and the `lane-watch` bin's `--server` flag share
 * it, so a value the overlay accepts is a value the bin accepts. A lane host's
 * opencode server is reached through a local tunnel, so the address that is ever
 * right is the loopback end of it; a non-loopback address would send a session
 * id, and whatever the server answers with, across a network nobody vetted.
 */

export type LoopbackServer =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly message: string };

/**
 * A session id as it travels in a URL path. Deliberately narrower than "any
 * string": it is interpolated into `/session/<id>`, so no `/`, `.`, `?`, `#`,
 * whitespace or control byte may reach the path.
 */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function isLoopbackHostname(hostname: string): boolean {
  // `URL` has already normalized the host, so an IPv4 hostname here is four
  // decimal octets, and `127.0.0.1.evil.com` is not one.
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * Parse a server address. Refuses anything that is not a bare http(s) origin on
 * a loopback host: no credentials, no path, no query, no fragment.
 */
export function parseLoopbackServer(raw: string): LoopbackServer {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      message: `must be a URL such as http://127.0.0.1:4097. Read ${JSON.stringify(raw)}`,
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      message: `must be an http(s) URL. Read ${JSON.stringify(raw)}`,
    };
  }
  if (!isLoopbackHostname(url.hostname)) {
    return {
      ok: false,
      message: `must be a LOOPBACK address (127.x.x.x, localhost or [::1]): the server is reached through a local tunnel. Read ${JSON.stringify(raw)}`,
    };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "must not carry credentials" };
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      message: `must be an origin only: no path, query or fragment. Read ${JSON.stringify(raw)}`,
    };
  }
  return { ok: true, origin: url.origin };
}
