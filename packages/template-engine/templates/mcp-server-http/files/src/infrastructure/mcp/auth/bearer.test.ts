import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { authenticate, assertConfigured } from "./bearer.js";

function reqWith(authorization?: string): IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
  } as IncomingMessage;
}

describe("bearer authenticate", () => {
  const original = process.env.MCP_BEARER_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = original;
  });

  it("denies when MCP_BEARER_TOKEN is unset (fail closed)", async () => {
    delete process.env.MCP_BEARER_TOKEN;
    assert.equal(await authenticate(reqWith("Bearer anything")), false);
  });

  it("denies a missing, prefix-less, or wrong token", async () => {
    process.env.MCP_BEARER_TOKEN = "s3cret";
    assert.equal(await authenticate(reqWith(undefined)), false);
    assert.equal(await authenticate(reqWith("s3cret")), false); // no "Bearer " prefix
    assert.equal(await authenticate(reqWith("Bearer wrong")), false);
  });

  it("allows the correct token (scheme is case-insensitive, RFC 7235)", async () => {
    process.env.MCP_BEARER_TOKEN = "s3cret";
    assert.equal(await authenticate(reqWith("Bearer s3cret")), true);
    assert.equal(await authenticate(reqWith("bearer s3cret")), true);
  });
});

describe("bearer assertConfigured", () => {
  const original = process.env.MCP_BEARER_TOKEN;
  afterEach(() => {
    if (original === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = original;
  });

  it("throws at startup when MCP_BEARER_TOKEN is unset", () => {
    delete process.env.MCP_BEARER_TOKEN;
    assert.throws(() => assertConfigured(), /MCP_BEARER_TOKEN/);
  });

  it("passes when MCP_BEARER_TOKEN is set", () => {
    process.env.MCP_BEARER_TOKEN = "s3cret";
    assert.doesNotThrow(() => assertConfigured());
  });
});
