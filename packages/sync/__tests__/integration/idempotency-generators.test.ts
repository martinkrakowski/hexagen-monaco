import assert from "node:assert";
import { describe, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import type { Manifest } from "../../src/types/manifest.js";
import {
  createFixture,
  createEmptyFixture,
  removeFixture,
  WORKSPACE_TSCONFIG,
  LAYERS_TEMPLATE,
  PROTECTED_KEYS,
  snapshotTree,
} from "../helpers/fixture-factory.js";
import { makeFlags, makeForceRootFlags } from "../helpers/test-config.js";

describe("SyncEngine idempotency — stubs, rootFiles, apps", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("sync engine idempotent on fixture with generator.sync.stubs.enabled and bounded context having port/adapter declarations", async () => {
    fixtureRoot = await createFixture(["orders"], "hexagen-sync-idempotency-");

    const manifest: Manifest = {
      description: "Test manifest",
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
          stubs: {
            enabled: true,
          },
        },
      },
      bounded_contexts: [
        {
          name: "orders",
          type: "core",
          layers: {
            domain: {
              entities: ["Order"],
              value_objects: ["OrderId"],
              ports: { out: ["OrderRepository"] },
            },
            application: {
              use_cases: ["PlaceOrder"],
              ports: { in: ["PlaceOrderCommand"] },
            },
            infrastructure: {
              adapters: ["OrderRepositoryPostgres"],
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
      "second run must be byte-identical with stubs + port/adapter declarations",
    );

    const stubPath = path.join(
      fixtureRoot,
      "packages/orders/src/domain/entities/Order.ts",
    );
    const stubStat = await fs.stat(stubPath).catch(() => null);
    assert.ok(stubStat?.isFile(), "Order entity stub must exist on disk");

    const entitiesBarrel = await fs.readFile(
      path.join(fixtureRoot, "packages/orders/src/domain/entities/index.ts"),
      "utf8",
    );
    assert.ok(
      entitiesBarrel.includes('export * from "./Order.js";'),
      "entities barrel must re-export the Order stub (second-pass barrel regen)",
    );
  });

  it("sync engine idempotent on fixture with monorepo.rootFiles templates", async () => {
    fixtureRoot = await createEmptyFixture();

    const manifest: Manifest = {
      description: "Test manifest",
      system: "idempotent-fixture",
      scope: "idempotent-fixture",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
        rootFiles: {
          packageJson: {
            template:
              '{\n  "name": "{system}",\n  "private": true,\n  "packageManager": "{packageManager}",\n  "workspaces": {workspaces}\n}\n',
          },
          tsConfig: {
            template:
              '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext"\n  }\n}\n',
          },
          turbo: {
            template:
              '{\n  "$schema": "https://turbo.build/schema.json",\n  "tasks": {\n    "build": {}\n  }\n}\n',
          },
        },
      },
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
        },
      },
      bounded_contexts: [],
    };

    const engine = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical with monorepo.rootFiles templates",
    );

    const pkgJson = await fs.readFile(
      path.join(fixtureRoot, "package.json"),
      "utf8",
    );
    assert.ok(
      pkgJson.includes('"name": "idempotent-fixture"'),
      "root package.json must contain interpolated system name",
    );
    const tsconfigBase = await fs.readFile(
      path.join(fixtureRoot, "tsconfig.base.json"),
      "utf8",
    );
    assert.ok(
      tsconfigBase.includes('"target": "ES2022"'),
      "root tsconfig.base.json must reflect manifest template",
    );
    const turboJson = await fs.readFile(
      path.join(fixtureRoot, "turbo.json"),
      "utf8",
    );
    assert.ok(
      turboJson.includes('"$schema": "https://turbo.build/schema.json"'),
      "root turbo.json must reflect manifest template",
    );
  });

  it("sync engine idempotent on fixture with apps[] + generator.sync.apps.frameworks", async () => {
    fixtureRoot = await createEmptyFixture();

    const manifest: Manifest = {
      description: "Test manifest",
      system: "apps-fixture",
      scope: "apps-fixture",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
      },
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
          apps: {
            enabled: true,
            frameworks: {
              "next.js": {
                packageJson: {
                  template:
                    '{\n  "name": "@{system}/{appName}",\n  "private": true,\n  "type": "module"\n}\n',
                },
              },
              fastify: {
                entryPoint: {
                  path: "src/server.ts",
                  template: "// custom fastify entry for {appName}\n",
                },
              },
              "plain-ts": {},
            },
          },
        },
      },
      bounded_contexts: [],
      apps: [
        { name: "web", framework: "next.js" },
        { name: "api", framework: "fastify" },
      ],
    };

    const engine = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine.run();
    const first = await snapshotTree(fixtureRoot);

    const engine2 = new SyncEngine(makeForceRootFlags(), {
      targetRoot: fixtureRoot,
      manifest,
    });
    await engine2.run();
    const second = await snapshotTree(fixtureRoot);

    assert.deepStrictEqual(
      second,
      first,
      "second run must be byte-identical with apps[] + frameworks config",
    );

    const webPkg = await fs.readFile(
      path.join(fixtureRoot, "apps/web/package.json"),
      "utf8",
    );
    assert.ok(
      webPkg.includes('"@apps-fixture/web"'),
      "web app package.json must come from the manifest override",
    );

    const webTsconfig = await fs.stat(
      path.join(fixtureRoot, "apps/web/tsconfig.json"),
    );
    assert.ok(webTsconfig.isFile(), "web app tsconfig.json must exist");

    const webEntry = await fs.stat(
      path.join(fixtureRoot, "apps/web/src/app/page.tsx"),
    );
    assert.ok(
      webEntry.isFile(),
      "web app Next.js entry point (src/app/page.tsx) must exist (built-in fallback)",
    );

    const apiEntry = await fs.readFile(
      path.join(fixtureRoot, "apps/api/src/server.ts"),
      "utf8",
    );
    assert.ok(
      apiEntry.includes("custom fastify entry for api"),
      "api app entry must reflect the manifest-overridden entryPoint",
    );
  });
});
