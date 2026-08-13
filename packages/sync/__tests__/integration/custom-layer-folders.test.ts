import assert from "node:assert";
import { describe, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { SyncEngine } from "../../src/sync-engine.js";
import { generateStubs } from "../../src/generators/stubs.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";
import { withTempWorkspace } from "../helpers/fs-helpers.js";
import { makeConfig } from "../helpers/test-config.js";
import { createSpyLogger } from "../helpers/spy-logger.js";

/**
 * A2 — stub placement, the emission plan, and the related-port probe must
 * consult `generator.sync.layers` (via the single layer-folder resolver)
 * instead of hardcoding `src/application/...` etc. Pre-A2, a manifest with a
 * custom `application.folder` had `ensureLayerFolders` scaffold `src/app/...`
 * while every stub landed in `src/application/...` — two disjoint trees.
 *
 * F16 — the wizard's layer config names the domain subfolder
 * `value_objects` while stub emission used `domain/value-objects`, so
 * generated packages carried BOTH folders (the underscored one holding only
 * a `.gitkeep`). The resolver normalizes known-site spellings to the ONE
 * kebab-case convention — the form the add-on template payloads and their
 * import specifiers (e.g. `../../domain/value-objects/user-context`)
 * already reference.
 */

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

const makeExternalFlags = (): SyncFlags => ({
  dryRun: false,
  force: true,
  forceRoot: true,
  allowDirty: true,
  strict: false,
  mode: "external",
  logger: silentLogger,
});

// NON-default folders for all three layers, plus the wizard's underscored
// `value_objects` subfolder spelling (F16).
const customLayers = {
  domain: {
    folder: "src/core-domain",
    subfolders: ["entities", "value_objects"],
  },
  application: {
    folder: "src/app",
    subfolders: ["use-cases", "ports/in", "ports/out"],
  },
  infrastructure: { folder: "src/infra", subfolders: ["adapters"] },
};

const manifest: Manifest = {
  system: "acme",
  scope: "acme",
  architecture: "modular-monolith",
  monorepo: {
    packageManager: "yarn@4.12.0",
    workspaces: ["apps/*", "packages/*"],
  },
  generator: {
    sync: {
      layers: customLayers,
      stubs: { enabled: true },
    },
  },
  bounded_contexts: [
    {
      name: "billing",
      type: "core",
      layers: {
        domain: {
          entities: ["Invoice"],
          value_objects: ["Money"],
        },
        application: {
          use_cases: ["charge-card.use-case.ts"],
          ports: {
            in: ["charge-card.in-port.ts"],
            out: ["user-repo.out-port.ts"],
          },
        },
        infrastructure: {
          // Shares the `user-repo` base with the out-port, so the adapter is
          // PORT-DERIVED — its import specifier must point into the custom
          // application folder.
          adapters: ["user-repo.adapter.ts"],
        },
      },
    },
    // The generic use-case stub imports `Result` from `@{scope}/shared`.
    { name: "shared", type: "supporting", layers: { domain: {} } },
  ],
} as unknown as Manifest;

function runTsc(cwd: string, tscConfig: string): void {
  const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  try {
    execFileSync(process.execPath, [tscPath, "-p", tscConfig], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    assert.fail(
      `generated output failed to typecheck:\n${
        err.stdout || err.stderr || err.message
      }`,
    );
  }
}

describe("custom layer folders (A2 — single layer-folder resolver)", () => {
  let target: string | null = null;
  afterEach(async () => {
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
      target = null;
    }
  });

  it("emits every stub into the configured folders with consistent import specifiers, and the tree compiles", async () => {
    target = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-a2-"));
    await new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest,
    }).run();

    const pkg = path.join(target, "packages/billing");

    // 1. Placement — everything under the CONFIGURED folders.
    for (const rel of [
      "src/core-domain/entities/Invoice.ts",
      "src/core-domain/value-objects/Money.vo.ts", // F16: config said value_objects
      "src/app/use-cases/ChargeCard.use-case.ts",
      "src/app/ports/in/ChargeCard.in-port.ts",
      "src/app/ports/out/UserRepo.out-port.ts",
      "src/infra/adapters/UserRepo.adapter.ts",
    ]) {
      await fs.access(path.join(pkg, rel)).catch(() => {
        assert.fail(`expected ${rel} to exist under the configured folders`);
      });
    }

    // 2. NO conventional-tree leakage: pre-A2 stubs ignored the config and
    //    landed in src/application etc., splitting the package in two.
    for (const rel of [
      "src/domain",
      "src/application",
      "src/infrastructure",
      "src/core-domain/value_objects",
    ]) {
      await fs.access(path.join(pkg, rel)).then(
        () => assert.fail(`unexpected conventional dir ${rel} was created`),
        () => undefined,
      );
    }

    // 3. Import specifiers cross the CONFIGURED folders. The adapter is
    //    port-derived (out-ports are emitted before adapters in the plan),
    //    so its import must climb from src/infra into src/app.
    const adapter = await fs.readFile(
      path.join(pkg, "src/infra/adapters/UserRepo.adapter.ts"),
      "utf8",
    );
    assert.match(
      adapter,
      /export class \w+ implements UserRepoPort\b/,
      "adapter resolves its port across custom folders (probe uses the resolver)",
    );
    assert.match(
      adapter,
      /import type \{ UserRepoPort \} from '\.\.\/\.\.\/app\/ports\/out\/UserRepo\.out-port\.js'/,
      "adapter import specifier points into the configured application folder",
    );

    // 4. The real guard — tsc over the full generated billing surface plus
    //    the shared package (Result kernel for the generic use-case stub).
    const tscConfig = path.join(target, "tsconfig.a2check.json");
    await fs.writeFile(
      tscConfig,
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          baseUrl: ".",
          paths: { "@acme/*": ["packages/*/src/index.ts"] },
        },
        include: [
          "packages/billing/src/**/*.ts",
          "packages/shared/src/**/*.ts",
        ],
      }),
    );
    runTsc(target, tscConfig);
  });

  it("resolves the related in-port from the configured folder (use-case probe) and compiles", async () => {
    await withTempWorkspace(
      async ({ workspaceRoot }: { workspaceRoot: string }) => {
        const moduleDir = path.join(workspaceRoot, "packages", "billing");
        // Pre-create the in-port INSIDE the custom application folder so it
        // exists at the use-case's probe time. Pre-A2 the probe hardcoded
        // `src/application/ports/in`, missed this file, and silently
        // degraded the use-case to a generic stub.
        const inDir = path.join(moduleDir, "src", "app", "ports", "in");
        await fs.mkdir(inDir, { recursive: true });
        await fs.writeFile(
          path.join(inDir, "ChargeCard.in-port.ts"),
          "export interface ChargeCardPort {\n  execute(input: string): Promise<void>;\n}\n",
        );

        await generateStubs(
          moduleDir,
          "billing",
          makeConfig(workspaceRoot, manifest, { logger: createSpyLogger() }),
        );

        const uc = await fs.readFile(
          path.join(moduleDir, "src/app/use-cases/ChargeCard.use-case.ts"),
          "utf8",
        );
        assert.match(
          uc,
          /export class \w+ implements ChargeCardPort\b/,
          "use-case resolves its in-port from the configured folder",
        );
        assert.match(
          uc,
          /import type \{ ChargeCardPort \} from '\.\.\/ports\/in\/ChargeCard\.in-port\.js'/,
          "in-port import specifier is relative within the configured folder",
        );
        assert.match(
          uc,
          /import type \{ UserRepoPort \} from '\.\.\/ports\/out\/UserRepo\.out-port\.js'/,
          "out-port injection resolves against the configured folder",
        );

        const tscConfig = path.join(workspaceRoot, "tsconfig.a2uc.json");
        await fs.writeFile(
          tscConfig,
          JSON.stringify({
            compilerOptions: {
              target: "ES2022",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              noEmit: true,
              skipLibCheck: true,
            },
            include: ["packages/billing/src/app/**/*.ts"],
          }),
        );
        runTsc(workspaceRoot, tscConfig);
      },
    );
  });
});

describe("one value-objects folder (F16)", () => {
  let target: string | null = null;
  afterEach(async () => {
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
      target = null;
    }
  });

  it("produces exactly ONE value-objects folder for the wizard's underscored layer config", async () => {
    target = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-f16-"));
    // The exact wizardToManifest layer config (default folders, underscored
    // `value_objects` subfolder) plus a shared context declaring a VO — the
    // shape that produced BOTH `value_objects/` (.gitkeep only) and
    // `value-objects/` (real files) in generated projects.
    const wizardManifest: Manifest = {
      system: "acme",
      scope: "acme",
      architecture: "modular-monolith",
      monorepo: {
        packageManager: "yarn@4.12.0",
        workspaces: ["apps/*", "packages/*"],
      },
      generator: {
        sync: {
          layers: {
            domain: {
              folder: "src/domain",
              subfolders: ["entities", "value_objects"],
            },
            application: {
              folder: "src/application",
              subfolders: ["use-cases", "ports/in", "ports/out"],
            },
            infrastructure: {
              folder: "src/infrastructure",
              subfolders: ["adapters"],
            },
          },
          stubs: { enabled: true },
        },
      },
      bounded_contexts: [
        {
          name: "shared",
          type: "supporting",
          layers: { domain: { value_objects: ["UserContext"] } },
        },
      ],
    } as unknown as Manifest;

    await new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest: wizardManifest,
    }).run();

    const domainDir = path.join(target, "packages/shared/src/domain");
    const entries = await fs.readdir(domainDir);

    assert.ok(
      entries.includes("value-objects"),
      `expected value-objects/ in ${entries.join(", ")}`,
    );
    assert.ok(
      !entries.includes("value_objects"),
      "the underscored twin folder must NOT be scaffolded",
    );

    // The real VO stub lives in the ONE folder (not just a .gitkeep).
    const vo = await fs.readFile(
      path.join(domainDir, "value-objects/UserContext.vo.ts"),
      "utf8",
    );
    assert.match(vo, /export class UserContext\b/);
  });
});
