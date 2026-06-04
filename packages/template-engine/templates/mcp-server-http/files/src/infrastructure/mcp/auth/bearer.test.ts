import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { authenticate } from "./bearer.js";

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

  it("allows the correct bearer token", async () => {
    process.env.MCP_BEARER_TOKEN = "s3cret";
    assert.equal(await authenticate(reqWith("Bearer s3cret")), true);
  });
});
