// @hexagen-server-only
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { exampleTool } from "./example.tool.js";

describe("exampleTool", () => {
  it("maps a successful Result to MCP text content", async () => {
    const res = await exampleTool.handler({ name: "Ada" });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /Ada/);
  });

  it("maps a use-case failure to an MCP error (isError: true)", async () => {
    const res = await exampleTool.handler({ name: "" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /must not be empty/);
  });

  it("rejects an invalid input shape with an MCP error", async () => {
    const res = await exampleTool.handler({ name: 123 });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /Invalid input/);
  });

  it("dry_run validates without performing the action", async () => {
    const res = await exampleTool.handler({ name: "Ada", dry_run: true });
    assert.equal(res.isError, undefined);
    assert.match(res.content[0].text, /dry-run/);
  });
});
