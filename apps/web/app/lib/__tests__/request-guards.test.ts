import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import {
  isSameOrigin,
  guardMutation,
  guardManifestSize,
  MAX_MANIFEST_YAML_CHARS,
} from "../request-guards";

/** Build a POST NextRequest with the given headers. A distinct IP per test
 * keeps the shared rate-limiter's fixed windows independent. */
function post(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/architecture/modify", {
    method: "POST",
    headers,
  });
}

describe("isSameOrigin", () => {
  it("allows a request whose Origin host matches the Host header", () => {
    assert.equal(
      isSameOrigin(
        post({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
      true,
    );
  });

  it("rejects a request whose Origin host differs from the Host header", () => {
    assert.equal(
      isSameOrigin(
        post({ origin: "http://evil.example", host: "localhost:3000" }),
      ),
      false,
    );
  });

  it("treats a missing Origin as same-origin (server-to-server / curl / CI)", () => {
    assert.equal(isSameOrigin(post({ host: "localhost:3000" })), true);
  });

  it("rejects a malformed Origin", () => {
    assert.equal(
      isSameOrigin(post({ origin: "not a url", host: "localhost:3000" })),
      false,
    );
  });

  it("matches on host:port, not just hostname", () => {
    // A different port is a different origin.
    assert.equal(
      isSameOrigin(
        post({ origin: "http://localhost:4000", host: "localhost:3000" }),
      ),
      false,
    );
  });
});

describe("isSameOrigin behind a Host-rewriting proxy", () => {
  const prev = {
    APP_ORIGIN: process.env.APP_ORIGIN,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  };
  afterEach(() => {
    // Restore whatever the harness had set (delete if it was unset).
    for (const k of ["APP_ORIGIN", "NEXTAUTH_URL"] as const) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("accepts the canonical Origin when the proxy rewrote Host to the upstream", () => {
    // A host-level reverse proxy that forwards to 127.0.0.1:3000 without
    // `proxy_set_header Host $host` presents Host = "127.0.0.1:3000" while the
    // browser still sends the real public Origin. The server-configured
    // canonical origin must keep this legitimate same-origin POST alive.
    process.env.NEXTAUTH_URL = "https://app.hexagen-monaco.cloud";
    delete process.env.APP_ORIGIN;
    assert.equal(
      isSameOrigin(
        post({
          origin: "https://app.hexagen-monaco.cloud",
          host: "127.0.0.1:3000",
        }),
      ),
      true,
    );
  });

  it("still rejects a foreign Origin even with a canonical origin configured", () => {
    process.env.NEXTAUTH_URL = "https://app.hexagen-monaco.cloud";
    delete process.env.APP_ORIGIN;
    assert.equal(
      isSameOrigin(
        post({ origin: "https://evil.example", host: "127.0.0.1:3000" }),
      ),
      false,
    );
  });

  it("prefers an explicit APP_ORIGIN over NEXTAUTH_URL", () => {
    process.env.APP_ORIGIN = "https://canvas.hexagen-monaco.cloud";
    process.env.NEXTAUTH_URL = "https://auth.example";
    assert.equal(
      isSameOrigin(
        post({
          origin: "https://canvas.hexagen-monaco.cloud",
          host: "127.0.0.1:3000",
        }),
      ),
      true,
    );
  });
});

describe("isSameOrigin scheme sensitivity (CWE-352)", () => {
  it("rejects an http Origin when the request is effectively https (x-forwarded-proto)", () => {
    // The proxy terminates TLS and forwards `x-forwarded-proto: https`. An
    // Origin that shares the host but downgrades the scheme is a DIFFERENT
    // origin — a host-only comparison would wrongly accept it and weaken the
    // CSRF gate.
    assert.equal(
      isSameOrigin(
        post({
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-proto": "https",
        }),
      ),
      false,
    );
  });

  it("accepts a same-scheme Origin under the forwarded proto", () => {
    assert.equal(
      isSameOrigin(
        post({
          origin: "https://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-proto": "https",
        }),
      ),
      true,
    );
  });

  it("ignores a malformed x-forwarded-proto instead of trusting it as an origin", () => {
    // A proto value that itself contains "://" must not be interpolated into
    // the allowed-origin set (it would otherwise parse to a foreign origin and
    // whitelist it). Only bare http/https tokens are honored; anything else
    // drops the own-origin path so a forged Origin cannot be matched.
    assert.equal(
      isSameOrigin(
        post({
          origin: "https://evil.example",
          host: "localhost:3000",
          "x-forwarded-proto": "https://evil.example",
        }),
      ),
      false,
    );
  });

  it("uses the first hop of a multi-value x-forwarded-proto", () => {
    // A chain of proxies can produce "https, http"; the client-facing scheme is
    // the first entry, so the downgraded http Origin is still cross-scheme.
    assert.equal(
      isSameOrigin(
        post({
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-proto": "https, http",
        }),
      ),
      false,
    );
  });
});

describe("guardMutation", () => {
  it("returns null (proceed) for a same-origin request under the limit", () => {
    const gate = guardMutation(
      post({
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "x-forwarded-for": "203.0.113.10",
      }),
    );
    assert.equal(gate, null);
  });

  it("returns a 403 for a cross-origin request", async () => {
    const gate = guardMutation(
      post({
        origin: "http://evil.example",
        host: "localhost:3000",
        "x-forwarded-for": "203.0.113.11",
      }),
    );
    assert.ok(gate);
    assert.equal(gate.status, 403);
    const body = await gate.json();
    assert.equal(body.success, false);
    assert.match(body.error, /cross-origin/i);
  });

  it("returns a 429 with Retry-After once the window limit is exceeded", async () => {
    // Same IP, same-origin: exhaust a small budget then expect the block.
    const headers = {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "x-forwarded-for": "203.0.113.12",
    };
    let gate = null;
    for (let i = 0; i < 3; i++) {
      gate = guardMutation(post(headers), { maxRequests: 2, windowMs: 60_000 });
    }
    assert.ok(gate);
    assert.equal(gate.status, 429);
    // Retry-After is a whole-second count derived from the window remainder.
    const retryAfter = Number(gate.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
    const body = await gate.json();
    assert.equal(body.success, false);
  });

  it("does not reject the cross-origin request on the rate-limit path (403 precedes 429)", async () => {
    // A cross-origin request must 403 regardless of budget — the origin check
    // runs before the limiter so a forged burst cannot be laundered into a 429.
    const gate = guardMutation(
      post({ origin: "http://evil.example", host: "localhost:3000" }),
      { maxRequests: 1, windowMs: 60_000 },
    );
    assert.ok(gate);
    assert.equal(gate.status, 403);
  });
});

describe("guardManifestSize", () => {
  it("allows a manifest within the size cap (returns null)", () => {
    assert.equal(guardManifestSize("bounded_contexts: []"), null);
  });

  it("allows a manifest exactly at the cap (rejects only strictly larger)", () => {
    assert.equal(guardManifestSize("a".repeat(MAX_MANIFEST_YAML_CHARS)), null);
  });

  it("rejects an over-cap manifest with a 400 'too large' response", async () => {
    const res = guardManifestSize("a".repeat(MAX_MANIFEST_YAML_CHARS + 1));
    assert.ok(res, "expected a rejection response, not null");
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /too large/i);
  });
});
