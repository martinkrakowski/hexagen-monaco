import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assertSafeTransport } from "./guard.js";

describe("assertSafeTransport", () => {
  it("throws when streamable-http has no auth mode set", () => {
    assert.throws(
      () => assertSafeTransport({ MCP_TRANSPORT: "streamable-http" }),
      /requires MCP_AUTH_MODE/,
    );
  });

  it("throws when streamable-http has MCP_AUTH_MODE=none", () => {
    assert.throws(
      () =>
        assertSafeTransport({
          MCP_TRANSPORT: "streamable-http",
          MCP_AUTH_MODE: "none",
        }),
      /requires MCP_AUTH_MODE/,
    );
  });

  it("allows streamable-http with bearer auth", () => {
    assert.doesNotThrow(() =>
      assertSafeTransport({
        MCP_TRANSPORT: "streamable-http",
        MCP_AUTH_MODE: "bearer",
      }),
    );
  });

  it("allows streamable-http with oauth auth", () => {
    assert.doesNotThrow(() =>
      assertSafeTransport({
        MCP_TRANSPORT: "streamable-http",
        MCP_AUTH_MODE: "oauth",
      }),
    );
  });

  it("ignores non-http transports — stdio needs no auth", () => {
    assert.doesNotThrow(() => assertSafeTransport({ MCP_TRANSPORT: "stdio" }));
    assert.doesNotThrow(() => assertSafeTransport({}));
  });
});
