import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

  it("registers hexagen bootstrap exactly once on the CLI program", () => {
    // Merge of the Phase-0 bootstrap module and adopt/bootstrap both
    // added a `bootstrap` command. Commander throws
    // "cannot add command 'bootstrap' as already have command 'bootstrap'"
    // if both stay wired — that is what broke capstone lint:arch / sync:check.
    const src = readFileSync(
      new URL("../../src/cli.ts", import.meta.url),
      "utf8",
    );
    const inline = (src.match(/\.command\("bootstrap"\)/g) ?? []).length;
    const added = (src.match(/addCommand\(bootstrapCommander\)/g) ?? []).length;
    assert.equal(inline, 0);
    assert.equal(added, 1);
  });

  it("wires bootstrap as a real command that ratifies, never asserts", () => {
    assert.equal(bootstrapCommander.name(), "bootstrap");
    assert.match(bootstrapCommander.description(), /question/i);
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--yes"));
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--answers"));
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--llm"));
  });
});
