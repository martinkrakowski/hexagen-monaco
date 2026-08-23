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
} from "../helpers/fixture-factory.js";
import { makeFlags } from "../helpers/test-config.js";

describe("SyncEngine idempotency — expected artifacts", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("sync engine creates the expected artifacts on first run", async () => {
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
        {
          name: "alpha",
          type: "core",
          depends_on: ["shared"],
          layers: {
            domain: { entities: ["Alpha"] },
            application: { use_cases: ["DoAlpha"] },
            infrastructure: { adapters: ["AlphaAdapter"] },
          },
        },
      ],
    };

    const engine = new SyncEngine(makeFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();

    // alpha's layers carry only .gitkeep placeholders (no source file), so no
    // alpha layer has exportable content and no alpha layer barrel is
    // emitted (ADR-0050; emitter fixed 2026-08-23 — it used to write
    // `export {};` stubs there, which this list pinned). The package-root
    // src/index.ts stub is what keeps tsc from TS18003. shared's domain has
    // a real source file (result.ts), so its domain barrel is real and stays.
    const expectedFiles = [
      "packages/alpha/package.json",
      "packages/alpha/tsconfig.json",
      "packages/alpha/src/index.ts",
      "packages/alpha/src/domain/.gitkeep",
      "packages/shared/package.json",
      "packages/shared/tsconfig.json",
      "packages/shared/src/index.ts",
      "packages/shared/src/domain/result.ts",
      "packages/shared/src/domain/index.ts",
    ];
    const mustNotExist = [
      "packages/alpha/src/domain/index.ts",
      "packages/alpha/src/application/index.ts",
      "packages/alpha/src/infrastructure/index.ts",
    ];

    for (const rel of expectedFiles) {
      const abs = path.join(fixtureRoot, rel);
      const stat = await fs.stat(abs).catch(() => null);
      assert.ok(stat?.isFile(), `expected generated file to exist: ${rel}`);
    }
    for (const rel of mustNotExist) {
      const abs = path.join(fixtureRoot, rel);
      const stat = await fs.stat(abs).catch(() => null);
      assert.strictEqual(
        stat,
        null,
        `empty layer barrel must not be emitted: ${rel}`,
      );
    }

    // shared has no `layers:` content. The Result kernel still owns
    // src/domain; 6.7(a) must not emit unused application/infrastructure.
    for (const layer of ["application", "infrastructure"]) {
      const unused = path.join(fixtureRoot, "packages", "shared", "src", layer);
      const stat = await fs.stat(unused).catch(() => null);
      assert.equal(
        stat,
        null,
        `unused shared ${layer} folder must not be emitted (6.7(a))`,
      );
    }
  });

  it("sync engine emits tsconfig references derived from depends_on", async () => {
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

    const raw = await fs.readFile(
      path.join(fixtureRoot, "packages", "alpha", "tsconfig.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as {
      references?: Array<{ path: string }>;
    };
    assert.deepStrictEqual(
      parsed.references,
      [{ path: "../shared" }],
      "alpha tsconfig must contain a reference to ../shared derived from depends_on",
    );
  });
});
