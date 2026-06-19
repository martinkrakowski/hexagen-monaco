import assert from "node:assert";
import { describe, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import type { Manifest } from "../../src/types/manifest.js";
import {
  createFixture,
  removeFixture,
  WORKSPACE_TSCONFIG,
  LAYERS_TEMPLATE,
  PROTECTED_KEYS,
  snapshotTree,
} from "../helpers/fixture-factory.js";
import { makeFlags } from "../helpers/test-config.js";

describe("SyncEngine idempotency (ADR-0024 Phase 1.5)", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("sync engine is idempotent on a minimal fixture", async () => {
    fixtureRoot = await createFixture(
      ["alpha", "shared"],
      "hexagen-sync-idempotency-",
    );

    const manifest: Manifest = {
      description: "Test manifest",
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        { name: "alpha", type: "core", depends_on: ["shared"] },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });

    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second sync run must produce a byte-identical file tree",
    );
  });

  it("sync engine is idempotent on a fixture with per-context generator.tsConfig override", async () => {
    fixtureRoot = await createFixture(
      ["beta", "shared"],
      "hexagen-sync-idempotency-",
    );

    const manifest: Manifest = {
      description: "Test manifest",
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        {
          name: "beta",
          type: "core",
          depends_on: ["shared"],
          generator: {
            tsConfig: {
              compilerOptions: {
                emitDeclarationOnly: false,
                jsx: "react-jsx",
              },
            },
          },
        },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical even with per-context tsConfig override",
    );

    const betaTsconfigRaw = await fs.readFile(
      path.join(fixtureRoot, "packages", "beta", "tsconfig.json"),
      "utf8",
    );
    const betaTsconfig = JSON.parse(betaTsconfigRaw) as {
      compilerOptions: Record<string, unknown>;
    };
    assert.strictEqual(
      betaTsconfig.compilerOptions.jsx,
      "react-jsx",
      "per-context jsx override must be present in generated tsconfig",
    );
    assert.strictEqual(
      betaTsconfig.compilerOptions.emitDeclarationOnly,
      false,
      "per-context emitDeclarationOnly override must be present",
    );
  });
});
