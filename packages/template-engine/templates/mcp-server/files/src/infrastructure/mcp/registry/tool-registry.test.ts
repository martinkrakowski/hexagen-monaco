// @hexagen-server-only
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerTool,
  getRegisteredTools,
  applyTools,
} from "./tool-registry.js";
import type { McpServerLike } from "../sdk.js";

describe("tool-registry", () => {
  it("registers a tool and exposes it", () => {
    const before = getRegisteredTools().length;
    registerTool({
      name: "noop",
      description: "test",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    assert.equal(getRegisteredTools().length, before + 1);
  });

  it("applies every registered tool onto the server", () => {
    const applied: string[] = [];
    const server: McpServerLike = {
      registerTool: (name: string) => {
        applied.push(name);
      },
      connect: async () => {},
    };
    applyTools(server);
    assert.ok(applied.includes("noop"));
  });
});
