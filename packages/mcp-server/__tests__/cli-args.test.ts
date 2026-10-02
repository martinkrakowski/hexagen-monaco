import { describe, it } from "vitest";
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

describe("parseArgs: grant key custody flags", () => {
  it("parses --key-file and --engagement in both syntaxes", () => {
    const a = parseArgs(["--key-file", "/k/a.key", "--engagement", "eng-1"]);
    assert.equal(a.keyFile, "/k/a.key");
    assert.equal(a.engagementId, "eng-1");
    const b = parseArgs(["--key-file=/k/b.key", "--engagement=eng-2"]);
    assert.equal(b.keyFile, "/k/b.key");
    assert.equal(b.engagementId, "eng-2");
  });

  it("leaves them undefined when absent", () => {
    const r = parseArgs([]);
    assert.equal(r.keyFile, undefined);
    assert.equal(r.engagementId, undefined);
  });

  it("does not let a flag value swallow the next flag", () => {
    const r = parseArgs(["--key-file", "--help"]);
    assert.equal(r.keyFile, undefined);
    assert.equal(r.showHelp, true);
  });
});
