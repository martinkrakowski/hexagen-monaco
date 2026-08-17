import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { adoptCommander } from "../../src/commands/adopt/index.js";
import { bootstrapCommander } from "../../src/commands/bootstrap/index.js";

describe("hexagen adopt / bootstrap CLI surface", () => {
  it("wires adopt as a real command with a layout-mapping description", () => {
    assert.equal(adoptCommander.name(), "adopt");
    assert.match(adoptCommander.description(), /layout\.yaml/i);
    assert.ok(
      adoptCommander.options.some((o) => o.long === "--yes"),
      "adopt must support --yes for deterministic tests",
    );
  });

  it("wires bootstrap as a real command that ratifies, never asserts", () => {
    assert.equal(bootstrapCommander.name(), "bootstrap");
    assert.match(bootstrapCommander.description(), /question/i);
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--yes"));
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--answers"));
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--llm"));
  });
});
