import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildGrant,
  deriveContextsFromPaths,
  expandContexts,
} from "../../../src/commands/grant/build.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";

const tempDirs: string[] = [];

async function makeWorkspace(manifestYaml?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "grant-build-"));
  tempDirs.push(dir);
  if (manifestYaml !== undefined) {
    await mkdir(path.join(dir, ".architecture"), { recursive: true });
    await writeFile(
      path.join(dir, ".architecture", "manifest.yaml"),
      manifestYaml,
    );
  }
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const MANIFEST = `
bounded_contexts:
  - name: billing
    type: core
  - name: shared
    type: core
`;

describe("expandContexts", () => {
  it("expands known context names to packages/<name>/", async () => {
    const workspaceRoot = await makeWorkspace(MANIFEST);
    const paths = await expandContexts(workspaceRoot, ["billing", "shared"]);
    assert.deepEqual(paths, ["packages/billing/", "packages/shared/"]);
  });

  it("fails closed on an unknown context, naming it and the known set", async () => {
    const workspaceRoot = await makeWorkspace(MANIFEST);
    await assert.rejects(
      () => expandContexts(workspaceRoot, ["billing", "nope"]),
      /Unknown bounded context\(s\) in --contexts: nope/,
    );
  });

  it("fails with a clear message when no manifest exists", async () => {
    const workspaceRoot = await makeWorkspace();
    await assert.rejects(
      () => expandContexts(workspaceRoot, ["billing"]),
      /no manifest exists/,
    );
  });
});

describe("deriveContextsFromPaths", () => {
  it("reverse-matches packages/<name>/ path prefixes against known contexts", async () => {
    const workspaceRoot = await makeWorkspace(MANIFEST);
    const contexts = await deriveContextsFromPaths(workspaceRoot, [
      ".architecture/",
      "packages/billing/",
    ]);
    assert.deepEqual(contexts, ["billing"]);
  });

  it("ignores a packages/ path that doesn't match a known context", async () => {
    const workspaceRoot = await makeWorkspace(MANIFEST);
    const contexts = await deriveContextsFromPaths(workspaceRoot, [
      "packages/not-a-real-context/",
    ]);
    assert.deepEqual(contexts, []);
  });

  it("returns no contexts when no manifest exists, rather than throwing", async () => {
    const workspaceRoot = await makeWorkspace();
    const contexts = await deriveContextsFromPaths(workspaceRoot, [
      "packages/billing/",
    ]);
    assert.deepEqual(contexts, []);
  });
});

describe("buildGrant", () => {
  const sign = (payload: string, keyHex: string) =>
    `sig(${keyHex}:${payload.length})`;
  const now = new Date("2026-10-01T12:00:00.000Z");

  it("assembles a grant from explicit --paths, with a fresh id and computed expiry", async () => {
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "lane-ow3b",
        paths: [".architecture/"],
        tools: ["hexagen_create_context"],
        mode: "write",
        expiresIn: "4h",
        now,
      },
      "deadbeef",
      sign,
    );
    assert.match(grant.id, /^[0-9a-f-]{36}$/);
    assert.equal(grant.expires_at, "2026-10-01T16:00:00.000Z");
    assert.deepEqual(grant.paths, [".architecture/"]);
    assert.deepEqual(grant.contexts, []);
    assert.match(grant.signature, /^sig\(deadbeef:\d+\)$/);
  });

  it("omitContexts leaves the contexts key off the grant and signs without it", async () => {
    const sign = (payload: string) => payload;
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "a",
        paths: ["src/"],
        tools: ["write_file"],
        mode: "write",
        expiresIn: "1h",
        omitContexts: true,
      },
      "deadbeef",
      sign,
    );
    assert.equal("contexts" in grant, false);
    assert.equal(JSON.parse(grant.signature).contexts, undefined);
    assert.equal(grant.signature.includes("contexts"), false);
  });

  it("merges --paths with context-derived paths and de-duplicates", async () => {
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "lane-ow3b",
        paths: [".architecture/", "packages/billing/"],
        tools: ["hexagen_create_context"],
        mode: "write",
        expiresIn: "1h",
        contexts: ["billing"],
        now,
      },
      "deadbeef",
      sign,
      ["packages/billing/"],
    );
    assert.deepEqual(grant.paths, [".architecture/", "packages/billing/"]);
    assert.deepEqual(grant.contexts, ["billing"]);
  });

  it("auto-includes .architecture/ in paths whenever contexts is non-empty", async () => {
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "lane-ow3b",
        paths: ["packages/billing/"],
        tools: ["hexagen_create_port"],
        mode: "write",
        expiresIn: "1h",
        contexts: ["billing"],
        now,
      },
      "deadbeef",
      sign,
    );
    assert.deepEqual(grant.paths, ["packages/billing/", ".architecture/"]);
  });

  it("leaves paths untouched when contexts is empty", async () => {
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "lane-ow3b",
        paths: ["packages/billing/"],
        tools: ["hexagen_create_port"],
        mode: "write",
        expiresIn: "1h",
        now,
      },
      "deadbeef",
      sign,
    );
    assert.deepEqual(grant.paths, ["packages/billing/"]);
  });

  it("signs exactly canonicalGrantPayload(unsigned) with the given key", async () => {
    let capturedPayload = "";
    let capturedKey = "";
    const captureSign = (payload: string, keyHex: string) => {
      capturedPayload = payload;
      capturedKey = keyHex;
      return "the-signature";
    };
    const grant = await buildGrant(
      {
        principal: "martin",
        agent: "lane-ow3b",
        paths: [".architecture/"],
        tools: ["hexagen_create_context"],
        mode: "write",
        expiresIn: "4h",
        now,
      },
      "feedface",
      captureSign,
    );
    assert.equal(grant.signature, "the-signature");
    assert.equal(capturedKey, "feedface");
    assert.equal(
      capturedPayload,
      canonicalGrantPayload({
        id: grant.id,
        principal: grant.principal,
        agent: grant.agent,
        contexts: grant.contexts,
        paths: grant.paths,
        tools: grant.tools,
        mode: grant.mode,
        max_files: grant.max_files,
        expires_at: grant.expires_at,
        revoked_at: grant.revoked_at,
      }),
    );
  });
});
