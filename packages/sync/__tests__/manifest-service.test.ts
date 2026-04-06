import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadManifest,
  saveManifest,
  validateManifest,
} from "../src/manifest-service.js";
import type { Manifest } from "../src/types/manifest.js";

const validManifestYaml = `
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith
bounded_contexts:
  - name: shared
    type: shared-kernel
    description: Shared primitives
    layers:
      domain: {}
apps:
  - name: web
    driver: next.js
`;

const manifestWithInvalidStructure = "not: a valid yaml structure";

async function withTempManifest(
  yamlContent: string | null,
  fn: (workspaceRoot: string, tempDir: string) => Promise<void>,
) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const archDir = path.join(tempDir, ".architecture");
  await fs.mkdir(archDir, { recursive: true });
  const manifestPath = path.join(archDir, "manifest.yaml");

  if (yamlContent !== null) {
    await fs.writeFile(manifestPath, yamlContent, "utf8");
  }

  try {
    await fn(tempDir, tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

(async () => {
  console.log("Running manifest-service tests...\n");

  await withTempManifest(validManifestYaml, async (_workspaceRoot, tempDir) => {
    const result = await loadManifest(tempDir);
    assert.strictEqual(result.success, true, "Should load valid manifest");
    assert.ok(result.value, "Should have manifest data");
    assert.strictEqual(result.value.system, "hexagen-monaco");
    console.log("✅ loadManifest: success with valid manifest");
  });

  await withTempManifest(null, async (_workspaceRoot, tempDir) => {
    const result = await loadManifest(tempDir);
    assert.strictEqual(
      result.success,
      false,
      "Should fail when manifest not found",
    );
    assert.match(result.error.message, /not found/i);
    console.log("✅ loadManifest: fails when manifest not found");
  });

  await withTempManifest("", async (_workspaceRoot, tempDir) => {
    const result = await loadManifest(tempDir);
    assert.strictEqual(result.success, false, "Should fail with empty file");
    assert.match(result.error.message, /empty/i);
    console.log("✅ loadManifest: fails with empty file");
  });

  await withTempManifest(
    manifestWithInvalidStructure,
    async (_workspaceRoot, tempDir) => {
      const result = await loadManifest(tempDir);
      assert.strictEqual(
        result.success,
        false,
        "Should fail with invalid YAML",
      );
      console.log("✅ loadManifest: fails with invalid YAML");
    },
  );

  await withTempManifest(validManifestYaml, async (_workspaceRoot, tempDir) => {
    const writeResult = await saveManifest(tempDir, {
      system: "test-system",
      bounded_contexts: [],
    } as Manifest);
    assert.strictEqual(writeResult.success, true, "Should save manifest");
    console.log("✅ saveManifest: success");

    const readResult = await loadManifest(tempDir);
    assert.strictEqual(readResult.success, true, "Should read saved manifest");
    assert.strictEqual(readResult.value.system, "test-system");
    console.log("✅ saveManifest: round-trip write-then-read works");
  });

  await withTempManifest(validManifestYaml, async (_workspaceRoot, tempDir) => {
    const result = await validateManifest(tempDir);
    assert.strictEqual(result.success, true, "Should return success");
    assert.ok(result.value, "Should have validation data");
    assert.strictEqual(typeof result.value.valid, "boolean");
    console.log("✅ validateManifest: returns validation result");
  });

  console.log("\n✅ All manifest-service tests passed!");
})();
