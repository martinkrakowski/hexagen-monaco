import { describe, it } from "vitest";
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

  it("throws for empty, whitespace, or otherwise invalid auth modes", () => {
    for (const MCP_AUTH_MODE of ["", "   ", "disabled", "basic"]) {
      assert.throws(
        () =>
          assertSafeTransport({
            MCP_TRANSPORT: "streamable-http",
            MCP_AUTH_MODE,
          }),
        /requires MCP_AUTH_MODE/,
        `MCP_AUTH_MODE=${JSON.stringify(MCP_AUTH_MODE)} must be rejected`,
      );
    }
  });

  it("accepts bearer/oauth case-insensitively and trims whitespace", () => {
    assert.doesNotThrow(() =>
      assertSafeTransport({
        MCP_TRANSPORT: "streamable-http",
        MCP_AUTH_MODE: " Bearer ",
      }),
    );
    assert.doesNotThrow(() =>
      assertSafeTransport({
        MCP_TRANSPORT: "streamable-http",
        MCP_AUTH_MODE: "OAUTH",
      }),
    );
  });
});
