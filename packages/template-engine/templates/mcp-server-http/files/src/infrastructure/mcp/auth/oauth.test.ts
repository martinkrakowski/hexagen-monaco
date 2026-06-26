import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { authenticate, assertConfigured } from "./oauth.js";

function reqWith(authorization?: string): IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
  } as IncomingMessage;
}

describe("oauth authenticate (scaffold — fail closed)", () => {
  const original = process.env.MCP_OAUTH_ISSUER_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_OAUTH_ISSUER_URL;
    else process.env.MCP_OAUTH_ISSUER_URL = original;
  });

  it("denies when the issuer URL is unset", async () => {
    delete process.env.MCP_OAUTH_ISSUER_URL;
    assert.equal(await authenticate(reqWith("Bearer token")), false);
  });

  it("denies until real verification is wired (fail-closed default)", async () => {
    // The scaffold returns false even for a well-formed bearer until you
    // implement issuer verification — see auth/oauth.ts. This test documents
    // that contract; replace it once verification lands.
    process.env.MCP_OAUTH_ISSUER_URL = "https://issuer.example.com";
    assert.equal(await authenticate(reqWith("Bearer token")), false);
    assert.equal(await authenticate(reqWith(undefined)), false);
  });
});

describe("oauth assertConfigured", () => {
  const original = process.env.MCP_OAUTH_ISSUER_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_OAUTH_ISSUER_URL;
    else process.env.MCP_OAUTH_ISSUER_URL = original;
  });

  it("throws at startup when MCP_OAUTH_ISSUER_URL is unset", () => {
    delete process.env.MCP_OAUTH_ISSUER_URL;
    assert.throws(() => assertConfigured(), /MCP_OAUTH_ISSUER_URL/);
  });

  it("passes when MCP_OAUTH_ISSUER_URL is set", () => {
    process.env.MCP_OAUTH_ISSUER_URL = "https://issuer.example.com";
    assert.doesNotThrow(() => assertConfigured());
  });
});
