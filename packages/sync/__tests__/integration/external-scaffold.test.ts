import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

/**
 * End-to-end test for external-mode scaffolding.
 *
 * Constructs the richest manifest fixture the sync pipeline currently
 * accepts — three bounded contexts with hexagonal layers, two apps
 * (Next.js and Fastify), a full `monorepo.rootFiles` / `archInvariants`
 * block, `workspaceDefaults`, stubs enabled, and framework templates for
 * every built-in — and drives `SyncEngine` directly against a fresh temp
 * directory.
 *
 * The primary validation target is the second-barrel-pass contract:
 *
 *   After stubs are emitted at `src/<layer>/<subdir>/<Name>.ts`, the
 *   layer barrel (`src/<layer>/index.ts`) MUST re-export the subdir
 *   barrel, and the subdir barrel MUST re-export the stub file.
 *
 * If the two-phase pipeline ordering ever regresses — e.g. barrels run
 * only before stubs — this test fails on the barrel content assertions
 * below and flags a pipeline bug.
 *
 * This test is fully hermetic:
 *   - Target is `os.tmpdir()`; the host repo is never touched.
 *   - `mode: "external"` short-circuits git / lockfile / preflight /
 *     arch-linter in `sync-engine.ts`.
 *   - `forceRoot: true` + `force: true` mirrors the production external
 *     adapter's flag set so root-level files are written fresh.
 *
 * No architectural invariants are verified here — `runArchLinter` is
 * skipped in external mode by design.
 */

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** No-op logger — keeps test output clean. */
const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

/**
 * Production-equivalent external-mode flag set. Mirrors
 * `ExternalSyncEngineAdapter` (packages/project-generation) — `force` and
 * `forceRoot` are both true because a fresh external target has no
 * user-authored files to protect, and the root-level files live in the
 * protected list in `fs-utils.ts`.
 */
function makeExternalFlags(): SyncFlags {
  return {
    dryRun: false,
    force: true,
    forceRoot: true,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
  };
}

/** Create a fresh empty temp dir — caller owns cleanup. */
async function createEmptyTarget(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hexagen-external-scaffold-"));
}

/** Read a file as UTF-8; throws if the path is absent. */
async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

/** True if `filePath` exists as a regular file. */
async function exists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Recursively count regular files beneath `root`, skipping noise
 * directories (node_modules / .git / .turbo / dist) that should never
 * appear under a freshly scaffolded target anyway.
 */
async function countFiles(root: string): Promise<number> {
  const skip = new Set(["node_modules", ".git", ".turbo", "dist"]);
  let count = 0;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) count += 1;
    }
  }
  await walk(root);
  return count;
}

// -----------------------------------------------------------------------------
// Canonical templates (shared across the fixture manifest)
// -----------------------------------------------------------------------------

/**
 * Workspace-wide tsconfig default. Mirrors the production manifest's
 * `workspaceDefaults.tsConfig` — the per-package generator deep-merges
 * `bounded_contexts[].generator.tsConfig` on top.
 */
const WORKSPACE_TSCONFIG = {
  extends: "../../tsconfig.base.json",
  compilerOptions: {
    rootDir: "src",
    outDir: "dist",
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: true,
    composite: true,
    tsBuildInfoFile: "./dist/tsconfig.tsbuildinfo",
    paths: {},
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist", ".turbo"],
  references: [] as Array<{ path: string }>,
};

/** generator.sync.layers template consumed by ensureLayerFolders. */
const LAYERS_TEMPLATE = {
  domain: { folder: "src/domain" },
  application: {
    folder: "src/application",
    subfolders: ["ports/in", "ports/out", "use-cases"],
  },
  infrastructure: {
    folder: "src/infrastructure",
    subfolders: ["adapters"],
  },
};

const PROTECTED_KEYS = [
  "private",
  "version",
  "license",
  "scripts",
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "main",
  "module",
  "types",
  "exports",
  "bin",
];

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("SyncEngine end-to-end external scaffold", () => {
  let target: string | null = null;

  afterEach(async () => {
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
      target = null;
    }
  });

  it("scaffolds a complete monorepo from a rich manifest in a single external-mode run", async () => {
    target = await createEmptyTarget();

    // -------------------------------------------------------------------
    // Rich manifest — three bounded contexts (one shared-kernel + two
    // cores with full hexagonal layers), two apps (web + api), full
    // workspaceDefaults / rootFiles / archInvariants, stubs enabled,
    // framework templates for all three built-ins.
    // -------------------------------------------------------------------
    const manifest: Manifest = {
      system: "scaffold-demo",
      scope: "scaffold-demo",
      architecture: "modular-monolith",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
        // Root-level file overrides. Tiny, deterministic templates so
        // assertions below can pin exact content.
        rootFiles: {
          packageJson: {
            template:
              '{\n  "name": "{system}",\n  "private": true,\n  "packageManager": "{packageManager}",\n  "workspaces": {workspaces}\n}\n',
          },
          tsConfig: {
            template:
              '{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "strict": true\n  }\n}\n',
          },
          turbo: {
            template:
              '{\n  "$schema": "https://turbo.build/schema.json",\n  "tasks": { "build": {} }\n}\n',
          },
        },
        // archInvariants — exercises the template-driven path (not
        // built-in) for layer-rules + linter-config + generator.config.
        archInvariants: {
          layerRules: {
            template: "# generated layer rules for {scope}\nscope: {scope}\n",
          },
          linterConfig: {
            template: "# generated linter config for {scope}\nscope: {scope}\n",
          },
          generatorConfig: {
            template:
              "# generator config for {scope}\nversion: 1\nscope: {scope}\n",
          },
        },
      },
      workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
      generator: {
        sync: {
          layers: LAYERS_TEMPLATE,
          packageJson: { protectedKeys: PROTECTED_KEYS },
          // Stubs enabled with built-in templates + naming. Verifies the
          // default cascade end-to-end (manifest declares `enabled: true`
          // only; the rest flows from DEFAULT_TEMPLATES / DEFAULT_NAMING).
          stubs: {
            enabled: true,
          },
          // Apps generator: declare all three built-in frameworks so the
          // resolution path (manifest override → built-in fallback) runs
          // for each. The web and api apps below pick two of them; the
          // `plain-ts` entry is exercised via the generator's fallback
          // table even though no app uses it in this fixture.
          apps: {
            frameworks: {
              "next.js": {},
              fastify: {},
              "plain-ts": {},
            },
          },
        },
      },
      // Three bounded contexts. The shared-kernel has no layers (it's
      // just a types package); the two core contexts carry full
      // hexagonal declarations so stubs are emitted and barrels must
      // re-export them.
      bounded_contexts: [
        { name: "shared", type: "shared-kernel" },
        {
          name: "orders",
          type: "core",
          depends_on: ["shared"],
          layers: {
            domain: {
              entities: ["Order"],
              value_objects: ["OrderId"],
              ports: {
                out: ["OrderRepository"],
              },
            },
            application: {
              use_cases: ["PlaceOrder"],
              ports: {
                in: ["PlaceOrderCommand"],
              },
            },
            infrastructure: {
              adapters: ["OrderRepositoryPostgres"],
            },
          },
        },
        {
          name: "billing",
          type: "core",
          depends_on: ["shared"],
          layers: {
            domain: {
              entities: ["Invoice"],
              value_objects: ["Money"],
              ports: {
                out: ["PaymentGateway"],
              },
            },
            application: {
              use_cases: ["IssueInvoice"],
              ports: {
                in: ["IssueInvoiceCommand"],
              },
            },
            infrastructure: {
              adapters: ["StripePaymentGateway"],
            },
          },
        },
      ],
      apps: [
        { name: "web", framework: "next.js" },
        { name: "api", framework: "fastify" },
      ],
    };

    // -------------------------------------------------------------------
    // Run the engine directly — no wrapping adapter.
    // -------------------------------------------------------------------
    const engine = new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest,
    });
    await engine.run();

    // -------------------------------------------------------------------
    // 1. Root files — manifest-driven templates
    // -------------------------------------------------------------------
    const rootPkg = await readUtf8(path.join(target, "package.json"));
    assert.ok(
      rootPkg.includes('"name": "scaffold-demo"'),
      "root package.json must interpolate {system}",
    );
    assert.ok(
      rootPkg.includes('"packageManager": "yarn@4.12.0"'),
      "root package.json must interpolate {packageManager}",
    );

    const rootTs = await readUtf8(path.join(target, "tsconfig.base.json"));
    assert.ok(
      rootTs.includes('"target": "ES2022"'),
      "root tsconfig.base.json must reflect manifest template",
    );

    const rootTurbo = await readUtf8(path.join(target, "turbo.json"));
    assert.ok(
      rootTurbo.includes('"$schema": "https://turbo.build/schema.json"'),
      "root turbo.json must reflect manifest template",
    );

    // -------------------------------------------------------------------
    // 2. .architecture/**
    // -------------------------------------------------------------------
    const manifestYaml = path.join(target, ".architecture/manifest.yaml");
    assert.ok(
      await exists(manifestYaml),
      ".architecture/manifest.yaml must exist (external + fresh target)",
    );

    const layerRules = await readUtf8(
      path.join(target, ".architecture/invariants/layer-rules.yaml"),
    );
    assert.ok(
      layerRules.includes("scope: scaffold-demo"),
      "layer-rules.yaml must come from the manifest template + be interpolated",
    );

    const linterConfig = await readUtf8(
      path.join(target, ".architecture/invariants/linter-config.yaml"),
    );
    assert.ok(
      linterConfig.includes("scope: scaffold-demo"),
      "linter-config.yaml must come from the manifest template",
    );

    const generatorConfig = await readUtf8(
      path.join(target, ".architecture/generator.config.yaml"),
    );
    assert.ok(
      generatorConfig.includes("scope: scaffold-demo"),
      "generator.config.yaml must come from the manifest template",
    );

    // -------------------------------------------------------------------
    // 3. Bounded-context scaffolding
    // -------------------------------------------------------------------
    // All three packages must have package.json / tsconfig.json /
    // eslint.config.js / three layer barrels.
    for (const bc of ["shared", "orders", "billing"]) {
      const bcRoot = path.join(target, "packages", bc);
      assert.ok(
        await exists(path.join(bcRoot, "package.json")),
        `packages/${bc}/package.json must exist`,
      );
      assert.ok(
        await exists(path.join(bcRoot, "tsconfig.json")),
        `packages/${bc}/tsconfig.json must exist`,
      );
      assert.ok(
        await exists(path.join(bcRoot, "eslint.config.js")),
        `packages/${bc}/eslint.config.js must exist`,
      );
      for (const layer of ["domain", "application", "infrastructure"]) {
        assert.ok(
          await exists(path.join(bcRoot, "src", layer, "index.ts")),
          `packages/${bc}/src/${layer}/index.ts barrel must exist`,
        );
      }
    }

    // -------------------------------------------------------------------
    // 4. Stub files — exact paths per DEFAULT_NAMING (stubs.ts)
    // -------------------------------------------------------------------
    const expectedStubs: Array<[string, string]> = [
      // orders
      ["orders", "src/domain/entities/Order.ts"],
      ["orders", "src/domain/value-objects/OrderId.vo.ts"],
      ["orders", "src/domain/ports/out/OrderRepository.out-port.ts"],
      ["orders", "src/application/use-cases/PlaceOrder.use-case.ts"],
      ["orders", "src/application/ports/in/PlaceOrderCommand.in-port.ts"],
      [
        "orders",
        "src/infrastructure/adapters/OrderRepositoryPostgres.adapter.ts",
      ],
      // billing
      ["billing", "src/domain/entities/Invoice.ts"],
      ["billing", "src/domain/value-objects/Money.vo.ts"],
      ["billing", "src/domain/ports/out/PaymentGateway.out-port.ts"],
      ["billing", "src/application/use-cases/IssueInvoice.use-case.ts"],
      ["billing", "src/application/ports/in/IssueInvoiceCommand.in-port.ts"],
      [
        "billing",
        "src/infrastructure/adapters/StripePaymentGateway.adapter.ts",
      ],
    ];
    for (const [bc, rel] of expectedStubs) {
      const abs = path.join(target, "packages", bc, rel);
      assert.ok(await exists(abs), `stub must exist at packages/${bc}/${rel}`);
    }

    // -------------------------------------------------------------------
    // 5. CRITICAL: barrels re-export stubs (second-pass barrel contract)
    // -------------------------------------------------------------------
    // The pipeline ordering is:
    //   (i)  first barrel pass (stubs do not exist yet)
    //   (ii) stubs emitted
    //   (iii) second barrel pass — must pick up the stub files
    //
    // If the second pass is skipped or runs in the wrong order, the
    // deepest barrel (e.g. src/domain/entities/index.ts) stays as an
    // empty `export {};` and the stub is unreachable from the package
    // root barrel chain. This block pins the expected content.
    //
    // For ONE bounded context we check the full chain:
    //   src/domain/index.ts                   → re-exports ./entities/index.js
    //   src/domain/entities/index.ts          → re-exports ./Order.js
    //   src/domain/ports/index.ts             → re-exports ./out/index.js
    //   src/domain/ports/out/index.ts         → re-exports ./OrderRepository.out-port.js
    //   src/application/index.ts              → re-exports ./use-cases/index.js + ./ports/index.js
    //   src/application/use-cases/index.ts    → re-exports ./PlaceOrder.use-case.js
    //   src/infrastructure/index.ts           → re-exports ./adapters/index.js
    //   src/infrastructure/adapters/index.ts  → re-exports ./OrderRepositoryPostgres.adapter.js
    //
    // For the other BC we only spot-check the deepest layer to keep
    // the test readable — duplicated assertions would not add signal.

    const ordersDomainBarrel = await readUtf8(
      path.join(target, "packages/orders/src/domain/index.ts"),
    );
    assert.ok(
      ordersDomainBarrel.includes('export * from "./entities/index.js";'),
      "orders src/domain/index.ts must re-export entities barrel (BROKEN if second-pass barrels did not run)",
    );

    const ordersEntitiesBarrel = await readUtf8(
      path.join(target, "packages/orders/src/domain/entities/index.ts"),
    );
    assert.ok(
      ordersEntitiesBarrel.includes('export * from "./Order.js";'),
      "orders src/domain/entities/index.ts must re-export Order stub (PRIMARY pipeline-ordering check)",
    );

    const ordersPortsOutBarrel = await readUtf8(
      path.join(target, "packages/orders/src/domain/ports/out/index.ts"),
    );
    assert.ok(
      ordersPortsOutBarrel.includes(
        'export * from "./OrderRepository.out-port.js";',
      ),
      "orders out-port barrel must re-export OrderRepository.out-port stub",
    );

    const ordersAppBarrel = await readUtf8(
      path.join(target, "packages/orders/src/application/index.ts"),
    );
    assert.ok(
      ordersAppBarrel.includes('export * from "./use-cases/index.js";'),
      "orders src/application/index.ts must re-export use-cases barrel",
    );

    const ordersUseCasesBarrel = await readUtf8(
      path.join(target, "packages/orders/src/application/use-cases/index.ts"),
    );
    assert.ok(
      ordersUseCasesBarrel.includes(
        'export * from "./PlaceOrder.use-case.js";',
      ),
      "orders use-cases barrel must re-export PlaceOrder use-case stub",
    );

    const ordersInfraBarrel = await readUtf8(
      path.join(target, "packages/orders/src/infrastructure/index.ts"),
    );
    assert.ok(
      ordersInfraBarrel.includes('export * from "./adapters/index.js";'),
      "orders src/infrastructure/index.ts must re-export adapters barrel",
    );

    const ordersAdaptersBarrel = await readUtf8(
      path.join(target, "packages/orders/src/infrastructure/adapters/index.ts"),
    );
    assert.ok(
      ordersAdaptersBarrel.includes(
        'export * from "./OrderRepositoryPostgres.adapter.js";',
      ),
      "orders adapters barrel must re-export OrderRepositoryPostgres adapter stub",
    );

    // Spot check on billing — deepest adapter barrel re-export.
    const billingAdaptersBarrel = await readUtf8(
      path.join(
        target,
        "packages/billing/src/infrastructure/adapters/index.ts",
      ),
    );
    assert.ok(
      billingAdaptersBarrel.includes(
        'export * from "./StripePaymentGateway.adapter.js";',
      ),
      "billing adapters barrel must re-export StripePaymentGateway adapter stub",
    );

    // -------------------------------------------------------------------
    // 6. Apps
    // -------------------------------------------------------------------
    // Next.js app
    const webPkg = await readUtf8(path.join(target, "apps/web/package.json"));
    assert.ok(
      webPkg.includes('"@scaffold-demo/web"'),
      "web app package.json must embed system-scoped name",
    );
    assert.ok(
      await exists(path.join(target, "apps/web/tsconfig.json")),
      "web app tsconfig.json must exist",
    );
    const webEntry = await readUtf8(
      path.join(target, "apps/web/src/app/page.tsx"),
    );
    assert.ok(
      webEntry.includes("HomePage"),
      "web app Next.js entry point must contain the HomePage scaffold",
    );

    // Fastify app
    const apiPkg = await readUtf8(path.join(target, "apps/api/package.json"));
    assert.ok(
      apiPkg.includes('"@scaffold-demo/api"'),
      "api app package.json must embed system-scoped name",
    );
    assert.ok(
      await exists(path.join(target, "apps/api/tsconfig.json")),
      "api app tsconfig.json must exist",
    );
    const apiEntry = await readUtf8(path.join(target, "apps/api/src/index.ts"));
    assert.ok(
      apiEntry.includes("fastify"),
      "api app Fastify entry point must import fastify",
    );

    // -------------------------------------------------------------------
    // 7. File-count sanity check
    // -------------------------------------------------------------------
    // Expected minimum file count (bounded-context barrels count each
    // nested index.ts separately). We assert a lower bound rather than
    // an exact count so a future additive change (e.g. an extra barrel
    // for a new subdir) doesn't make this test flaky — the expected
    // floor is derived from the fixture:
    //
    //   Root       : package.json, tsconfig.base.json, turbo.json         =  3
    //   .architecture: manifest.yaml + invariants/layer-rules.yaml
    //                + invariants/linter-config.yaml
    //                + generator.config.yaml                              =  4
    //   packages/shared   : package.json + tsconfig.json + eslint.config.js
    //                     + 3 layer barrels                               =  6
    //   packages/orders   : package.json + tsconfig.json + eslint.config.js
    //                     + 3 layer barrels + 6 stubs + at least 5 inner
    //                     barrels (entities, value-objects, ports,
    //                     ports/out, use-cases, ports/in, adapters)       = 20+
    //   packages/billing  : same shape as orders                          = 20+
    //   apps/web          : package.json + tsconfig.json + page.tsx       =  3
    //   apps/api          : package.json + tsconfig.json + index.ts       =  3
    //
    // Lower bound: 59. We assert ≥55 for a small safety margin against
    // minor ordering changes in the barrel generator's empty-dir
    // policy.
    const total = await countFiles(target);
    assert.ok(
      total >= 55,
      `expected at least 55 generated files, got ${total} — pipeline may be truncated`,
    );
  });
});
