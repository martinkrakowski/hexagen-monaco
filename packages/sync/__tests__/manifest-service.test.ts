import { describe, it } from "node:test";
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
description: "HexaGen Monorepo"
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

/** Install a fake `hexagen-lint` bin so validateManifest can invoke it. */
async function installFakeLinter(dir: string, exitCode = 0): Promise<void> {
  const binDir = path.join(dir, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(
      path.join(binDir, "hexagen-lint.cmd"),
      `@echo off\r\nexit /b ${exitCode}\r\n`,
    );
  } else {
    const bin = path.join(binDir, "hexagen-lint");
    await fs.writeFile(bin, `#!/bin/sh\nexit ${exitCode}\n`);
    await fs.chmod(bin, 0o755);
  }
}

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

describe("manifest service", () => {
  it("should load valid manifest", async () => {
    await withTempManifest(
      validManifestYaml,
      async (_workspaceRoot, tempDir) => {
        const result = await loadManifest(tempDir);
        assert.strictEqual(result.success, true, "Should load valid manifest");
        assert.ok(result.value, "Should have manifest data");
        assert.strictEqual(result.value.system, "hexagen-monaco");
      },
    );
  });

  it("should fail when manifest not found", async () => {
    await withTempManifest(null, async (_workspaceRoot, tempDir) => {
      const result = await loadManifest(tempDir);
      assert.strictEqual(
        result.success,
        false,
        "Should fail when manifest not found",
      );
      assert.match(result.error.message, /not found/i);
    });
  });

  it("should fail with empty file", async () => {
    await withTempManifest("", async (_workspaceRoot, tempDir) => {
      const result = await loadManifest(tempDir);
      assert.strictEqual(result.success, false, "Should fail with empty file");
      const err = result.error;
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /empty/i);
    });
  });

  it("should fail with invalid YAML", async () => {
    await withTempManifest(
      manifestWithInvalidStructure,
      async (_workspaceRoot, tempDir) => {
        const result = await loadManifest(tempDir);
        assert.strictEqual(
          result.success,
          false,
          "Should fail with invalid YAML",
        );
      },
    );
  });

  it("should save and round-trip manifest", async () => {
    await withTempManifest(
      validManifestYaml,
      async (_workspaceRoot, tempDir) => {
        const writeResult = await saveManifest(tempDir, {
          description: "Test manifest",
          system: "test-system",
          bounded_contexts: [],
        } as Manifest);
        assert.strictEqual(writeResult.success, true, "Should save manifest");

        const readResult = await loadManifest(tempDir);
        assert.strictEqual(
          readResult.success,
          true,
          "Should read saved manifest",
        );
        assert.strictEqual(readResult.value.system, "test-system");
      },
    );
  });

  it("should return validation result when the linter is installed", async () => {
    await withTempManifest(
      validManifestYaml,
      async (_workspaceRoot, tempDir) => {
        await installFakeLinter(tempDir, 0); // compliant
        const result = await validateManifest(tempDir);
        assert.strictEqual(result.success, true, "Should return success");
        assert.ok(result.value, "Should have validation data");
        assert.strictEqual(result.value.valid, true);
      },
    );
  });

  it("reports a clear error (not 'invalid') when arch-linter is not installed", async () => {
    await withTempManifest(
      validManifestYaml,
      async (_workspaceRoot, tempDir) => {
        // No fake linter installed → resolveArchLinterBin returns null.
        const result = await validateManifest(tempDir);
        assert.strictEqual(
          result.success,
          false,
          "missing linter must surface as err, not a fake 'valid: false'",
        );
        if (!result.success) {
          assert.match(result.error.message, /arch-linter not found/);
        }
      },
    );
  });
});
