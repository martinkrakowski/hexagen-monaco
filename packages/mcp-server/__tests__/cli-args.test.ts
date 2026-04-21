import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli-args.js";

describe("parseArgs", () => {
  it("returns cwd when no args provided", () => {
    const result = parseArgs([], "/fallback");
    assert.equal(result.workspaceRoot, "/fallback");
    assert.equal(result.showHelp, false);
  });

  it("parses --workspace-root with space-separated value", () => {
    const result = parseArgs(["--workspace-root", "/my/root"], "/fallback");
    assert.equal(result.workspaceRoot, "/my/root");
  });

  it("parses --workspace-root= with equals syntax", () => {
    const result = parseArgs(["--workspace-root=/my/root"], "/fallback");
    assert.equal(result.workspaceRoot, "/my/root");
  });

  it("parses --help flag", () => {
    const result = parseArgs(["--help"]);
    assert.equal(result.showHelp, true);
  });

  it("parses -h flag", () => {
    const result = parseArgs(["-h"]);
    assert.equal(result.showHelp, true);
  });

  it("handles --help alongside --workspace-root", () => {
    const result = parseArgs(["--workspace-root", "/x", "--help"]);
    assert.equal(result.showHelp, true);
    assert.equal(result.workspaceRoot, "/x");
  });

  it("uses cwd fallback when --workspace-root has no value", () => {
    const result = parseArgs(["--workspace-root"], "/fallback");
    assert.equal(result.workspaceRoot, "/fallback");
  });
});
