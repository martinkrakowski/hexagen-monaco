// @hexagen-server-only
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerTool,
  getRegisteredTools,
  applyTools,
} from "./tool-registry.js";
import type { RegisteredTool } from "./tool-registry.js";
import type { McpServerLike } from "../sdk.js";

const toolResult = async () => ({
  content: [{ type: "text" as const, text: "ok" }],
});

describe("tool-registry", () => {
  it("registers a tool and exposes it via getRegisteredTools", () => {
    const before = getRegisteredTools().length;
    const tool: RegisteredTool = {
      name: "sample",
      description: "test",
      inputSchema: {},
      handler: toolResult,
    };
    registerTool(tool);
    assert.equal(getRegisteredTools().length, before + 1);
    assert.ok(getRegisteredTools().some((t) => t.name === "sample"));
  });

  it("applies a registered tool onto the server with name, config, and handler", () => {
    // Self-contained: register a uniquely-named tool here rather than relying on
    // another test's registration leaking through the module-level registry.
    registerTool({
      name: "applied-check",
      description: "desc",
      inputSchema: { x: {} },
      handler: toolResult,
    });

    // Mock the full registerTool(name, config, handler) contract — so the test
    // fails if applyTools ever stops passing the config or handler.
    const calls: Array<{
      name: string;
      hasConfig: boolean;
      hasHandler: boolean;
    }> = [];
    const server: McpServerLike = {
      registerTool: (name, config, handler) => {
        calls.push({
          name,
          hasConfig:
            typeof config.description === "string" && !!config.inputSchema,
          hasHandler: typeof handler === "function",
        });
      },
      connect: async () => {},
    };

    applyTools(server);

    const applied = calls.find((c) => c.name === "applied-check");
    assert.ok(applied, "the registered tool was applied to the server");
    assert.ok(applied.hasConfig, "config (description + inputSchema) was passed");
    assert.ok(applied.hasHandler, "handler was passed");
  });
});
