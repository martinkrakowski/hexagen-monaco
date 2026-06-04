import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { authenticate } from "./oauth.js";

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
