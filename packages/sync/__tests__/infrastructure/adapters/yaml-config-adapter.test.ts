import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { YamlConfigAdapter } from "../../../src/infrastructure/adapters/yaml-config.adapter.js";
import type {
  BootstrapStep,
  InvariantConfig,
  InvariantPriority,
  PortOwnershipRecord,
} from "../../../src/application/ports/out/index.js";

async function withTempConfig(
  yamlContent: string,
  fn: (configPath: string) => Promise<void>,
) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-test-"));
  const configPath = path.join(tmpDir, "generator.config.yaml");
  await fs.writeFile(configPath, yamlContent, "utf8");

  try {
    await fn(configPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("yaml config adapter", () => {
  it("should return empty defaults when config is missing", async () => {
    await withTempConfig("", async (configPath) => {
      const adapter = new YamlConfigAdapter(configPath, fs, console);

      const bootstrap = await adapter.getBootstrapSequence();
      assert.deepStrictEqual(
        bootstrap,
        { success: true, value: [] },
        "Bootstrap sequence should be empty when config is missing",
      );

      const invariants = await adapter.getAllInvariants();
      assert.deepStrictEqual(
        invariants,
        { success: true, value: [] },
        "Invariants list should be empty when config is missing",
      );

      const critical = await adapter.getFailureBehavior(
        "critical" as InvariantPriority,
      );
      assert.strictEqual(
        critical,
        "abort-and-cleanup",
        "Critical failure behavior should fall back to default",
      );

      const ownership = await adapter.loadOwnershipMap();
      assert.deepStrictEqual(
        ownership,
        { success: true, value: [] },
        "Ownership map should be empty when config is missing",
      );
    });
  });

  it("should read all values from a fully populated config", async () => {
    const yamlContent = `
invariants:
  - name: test-double-parity
    description: All fakes must match port signatures
    priority: medium
    enforcement: bootstrap
    failure: warn-and-continue
bootstrap-sequence:
  - name: load-ownership-map
    priority: high
    failure: abort
failure-behavior:
  critical: abort-and-cleanup
  high: abort
  medium: warn-and-continue
ownership-registry:
  ports:
    apply-semantic-patch-port: "@hexagen/monaco-orchestration"
`;
    await withTempConfig(yamlContent, async (configPath) => {
      const adapter = new YamlConfigAdapter(configPath, fs, console);

      const bootstrap = await adapter.getBootstrapSequence();
      const expectedBootstrap: BootstrapStep[] = [
        {
          name: "load-ownership-map",
          priority: "high",
          failure: "abort",
          note: undefined,
        },
      ];
      assert.deepStrictEqual(
        bootstrap,
        { success: true, value: expectedBootstrap },
        "Bootstrap sequence should match the YAML content",
      );

      const invariants = await adapter.getAllInvariants();
      const expectedInvariants: InvariantConfig[] = [
        {
          name: "test-double-parity",
          description: "All fakes must match port signatures",
          priority: "medium",
          enforcement: "bootstrap",
          failure: "warn-and-continue",
        },
      ];
      assert.deepStrictEqual(
        invariants,
        { success: true, value: expectedInvariants },
        "Invariants should match the YAML content",
      );

      const critical = await adapter.getFailureBehavior(
        "critical" as InvariantPriority,
      );
      assert.strictEqual(
        critical,
        "abort-and-cleanup",
        "Critical failure behavior should be read from YAML",
      );
      const high = await adapter.getFailureBehavior(
        "high" as InvariantPriority,
      );
      assert.strictEqual(
        high,
        "abort",
        "High failure behavior should be read from YAML",
      );
      const medium = await adapter.getFailureBehavior(
        "medium" as InvariantPriority,
      );
      assert.strictEqual(
        medium,
        "warn-and-continue",
        "Medium failure behavior should be read from YAML",
      );

      const ownership = await adapter.loadOwnershipMap();
      const expectedOwnership: PortOwnershipRecord[] = [
        {
          portName: "apply-semantic-patch-port",
          owningPackage: "@hexagen/monaco-orchestration",
        },
      ];
      assert.deepStrictEqual(
        ownership,
        { success: true, value: expectedOwnership },
        "Ownership map should match the YAML content",
      );
    });
  });
});
