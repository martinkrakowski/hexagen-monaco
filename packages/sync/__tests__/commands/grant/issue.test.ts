import { describe, it, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { issueGrantCommand } from "../../../src/commands/grant/issue.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "grant-issue-cmd-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("issueGrantCommand", () => {
  it("writes a signed grant to --out, verifiable against the key it created", async () => {
    const workspaceRoot = await makeWorkspace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "lane-ow3b",
      paths: ".architecture/,packages/billing/",
      tools: "hexagen_accept_transaction,hexagen_create_port",
      mode: "write",
      expiresIn: "4h",
      workspaceRoot,
      out: ".hexagen/grants/test.json",
    });
    errorSpy.mockRestore();

    const grant = JSON.parse(
      await readFile(
        path.join(workspaceRoot, ".hexagen/grants/test.json"),
        "utf-8",
      ),
    );
    assert.equal(grant.principal, "martin");
    assert.equal(grant.agent, "lane-ow3b");
    assert.deepEqual(grant.paths, [".architecture/", "packages/billing/"]);
    assert.deepEqual(grant.tools, [
      "hexagen_accept_transaction",
      "hexagen_create_port",
    ]);
    assert.equal(grant.mode, "write");
    assert.ok(grant.id);
    assert.ok(grant.expires_at);
    assert.ok(grant.signature);

    const keyHex = (
      await readFile(
        path.join(workspaceRoot, ".hexagen/grant-signing.key"),
        "utf-8",
      )
    ).trim();
    const { signature, ...unsigned } = grant;
    const expected = createHmac("sha256", Buffer.from(keyHex, "hex"))
      .update(JSON.stringify(unsigned, Object.keys(unsigned).sort()))
      .digest("hex");
    assert.equal(signature, expected);
  });

  it("prints to stdout when --out is omitted", async () => {
    const workspaceRoot = await makeWorkspace();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "lane-ow3b",
      paths: ".architecture/",
      tools: "hexagen_create_context",
      mode: "write",
      expiresIn: "1h",
      workspaceRoot,
    });
    assert.equal(logSpy.mock.calls.length, 1);
    const printed = JSON.parse(logSpy.mock.calls[0][0] as string);
    assert.equal(printed.principal, "martin");
  });

  it("rejects an empty --paths with no --contexts either", async () => {
    const workspaceRoot = await makeWorkspace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "a1",
      tools: "hexagen_create_context",
      mode: "write",
      expiresIn: "1h",
      workspaceRoot,
    });
    assert.ok(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("At least one of --paths or --contexts"),
      ),
    );
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it("rejects empty --tools", async () => {
    const workspaceRoot = await makeWorkspace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "a1",
      paths: ".architecture/",
      tools: "",
      mode: "write",
      expiresIn: "1h",
      workspaceRoot,
    });
    assert.ok(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("--tools is required"),
      ),
    );
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it("rejects an invalid --mode", async () => {
    const workspaceRoot = await makeWorkspace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "a1",
      paths: ".architecture/",
      tools: "hexagen_create_context",
      mode: "readonly" as never,
      expiresIn: "1h",
      workspaceRoot,
    });
    assert.ok(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("--mode must be"),
      ),
    );
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it("rejects an unknown --contexts entry before touching the signing key", async () => {
    const workspaceRoot = await makeWorkspace();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await issueGrantCommand({
      principal: "martin",
      agent: "a1",
      tools: "hexagen_create_context",
      mode: "write",
      expiresIn: "1h",
      contexts: "nonexistent",
      workspaceRoot,
    });
    assert.ok(
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("no manifest exists"),
      ),
    );
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    await assert.rejects(
      readFile(path.join(workspaceRoot, ".hexagen/grant-signing.key")),
    );
  });
});
