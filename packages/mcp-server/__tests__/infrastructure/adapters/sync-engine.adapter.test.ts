import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SyncEngineAdapter } from "../../../src/infrastructure/adapters/sync-engine.adapter.js";

describe("SyncEngineAdapter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-mcp-test-"));
    const archDir = path.join(tmpDir, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    await fs.writeFile(
      path.join(archDir, "manifest.yaml"),
      "bounded_contexts: []\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("getLinterReport", () => {
    it("returns success with violations when yarn lint:arch fails", async () => {
      const adapter = new SyncEngineAdapter(tmpDir);
      const result = await adapter.getLinterReport();
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(typeof result.value.isCompliant, "boolean");
        assert.ok(Array.isArray(result.value.violations));
      }
    });

    it("returns error when workspace root does not exist", async () => {
      const adapter = new SyncEngineAdapter("/nonexistent/path");
      const result = await adapter.getLinterReport();
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.value.isCompliant, false);
        assert.ok(result.value.violations.length > 0);
      }
    });
  });

  describe("getArchitectureGraph", () => {
    it("returns empty graph for manifest with no contexts", async () => {
      const adapter = new SyncEngineAdapter(tmpDir);
      const result = await adapter.getArchitectureGraph();
      assert.equal(result.success, true);
      if (result.success) {
        assert.deepEqual(result.value.nodes, []);
        assert.deepEqual(result.value.edges, []);
      }
    });

    it("returns error when manifest is missing", async () => {
      const noManifestDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "hexagen-mcp-nomanifest-"),
      );
      const adapter = new SyncEngineAdapter(noManifestDir);
      const result = await adapter.getArchitectureGraph();
      assert.equal(result.success, false);
      if (!result.success) {
        assert.ok(result.error instanceof Error);
      }
      await fs.rm(noManifestDir, { recursive: true, force: true });
    });
  });
});
