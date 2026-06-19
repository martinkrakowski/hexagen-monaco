import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileSystemReportAdapter } from "../../../src/infrastructure/adapters/file-system-report.adapter.js";
import { createFeatureId } from "../../../src/domain/value-objects/feature-id.js";
import { createTimestamp } from "../../../src/domain/value-objects/timestamp.js";
import { createReportManifest } from "../../../src/domain/value-objects/report-manifest.js";
import { createFeatureReport } from "../../../src/domain/model/feature-report/feature-report.js";
import type { FeatureReport } from "../../../src/domain/index.js";

let tempDir: string;

describe("FileSystemReportAdapter", () => {
  beforeEach(async () => {
    tempDir = join(tmpdir(), `report-adapter-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("save", () => {
    it("writes manifest.json to correct path", async () => {
      const adapter = new FileSystemReportAdapter();
      const id = createFeatureId("my-feature");
      const now = createTimestamp(1000);
      const manifest = createReportManifest(id, "01-blueprint", now);
      const report = createFeatureReport(id, "01-blueprint", manifest, now);
      const result = await adapter.save(report, tempDir);
      assert.strictEqual(result.success, true);
      const manifestContent = await readFile(
        join(tempDir, ".reports", "my-feature", "manifest.json"),
        "utf-8",
      );
      const parsed = JSON.parse(manifestContent) as FeatureReport;
      assert.strictEqual(parsed.currentPhase, "01-blueprint");
    });
  });

  describe("load", () => {
    it("reads existing manifest.json", async () => {
      const adapter = new FileSystemReportAdapter();
      const id = createFeatureId("my-feature");
      const now = createTimestamp(1000);
      const manifest = createReportManifest(id, "01-blueprint", now);
      const report = createFeatureReport(id, "01-blueprint", manifest, now);
      await adapter.save(report, tempDir);
      const result = await adapter.load(id, tempDir);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.ok(result.value !== null);
        assert.strictEqual(result.value!.currentPhase, "01-blueprint");
      }
    });

    it("returns null when manifest does not exist", async () => {
      const adapter = new FileSystemReportAdapter();
      const id = createFeatureId("nonexistent");
      const result = await adapter.load(id, tempDir);
      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.value, null);
      }
    });
  });

  describe("appendPhaseReport", () => {
    it("creates phase directory and file", async () => {
      const adapter = new FileSystemReportAdapter();
      const id = createFeatureId("my-feature");
      const result = await adapter.appendPhaseReport(
        id,
        "01-blueprint",
        "# Blueprint Report\n",
        tempDir,
      );
      assert.strictEqual(result.success, true);
      const content = await readFile(
        join(tempDir, ".reports", "my-feature", "01-blueprint", "report.md"),
        "utf-8",
      );
      assert.strictEqual(content, "# Blueprint Report\n");
    });

    it("appends to existing file", async () => {
      const adapter = new FileSystemReportAdapter();
      const id = createFeatureId("my-feature");
      await adapter.appendPhaseReport(id, "01-blueprint", "first\n", tempDir);
      await adapter.appendPhaseReport(id, "01-blueprint", "second\n", tempDir);
      const content = await readFile(
        join(tempDir, ".reports", "my-feature", "01-blueprint", "report.md"),
        "utf-8",
      );
      assert.strictEqual(content, "first\nsecond\n");
    });
  });
});
