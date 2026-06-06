import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { SyncEngine } from "../../src/sync-engine.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

/**
 * CI-gap closure for #242. CI typechecks THIS repo's source, never the *output* of
 * a generated project — so non-compiling stub output (doubled extensions like
 * `rest-controller.in-port.ts.in-port.ts`, invalid identifiers like
 * `interface rest-controller.in-port.tsPort`) passed unnoticed. This test
 * generates a project whose manifest carries the exact shape `wizardToManifest`
 * emits — kebab port-type vocabulary, names already carrying the kind extension —
 * and runs the real `tsc` over the generated port/adapter stubs, asserting they
 * compile. Pre-#242-fix this fails (TS1005); post-fix it passes.
 *
 * Extended to the use-case surface (#246/#248): the generic use-case stub imports
 * `Result` from `@{scope}/shared` (now provided by the shared Result kernel,
 * #246), and the port-derived use-case must import its interfaces (#248). Both
 * are now exercised by real `tsc`.
 */

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

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

// Mirrors what wizardToManifest emits: kebab port-type vocabulary, and names that
// ALREADY carry the kind extension (getInboundPortName/getAdapterName). Adapters
// (Prisma/BullMQ) carry only the doubled-extension risk; ports add the
// kebab-identifier risk on top.
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
      layers: {
        domain: { folder: "src/domain" },
        application: {
          folder: "src/application",
          subfolders: ["ports/in", "ports/out"],
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
      name: "billing",
      type: "core",
      layers: {
        application: {
          use_cases: ["charge-card.use-case.ts"],
          ports: {
            in: ["rest-controller.in-port.ts"],
            out: ["relational-db.out-port.ts"],
          },
        },
        infrastructure: {
          adapters: ["Prisma.adapter.ts", "BullMQ.adapter.ts"],
        },
      },
    },
    // The generic use-case stub imports `Result` from `@{scope}/shared`; a shared
    // context must exist for the Result kernel (#246) to be written into it.
    { name: "shared", type: "supporting", layers: { domain: {} } },
  ],
} as unknown as Manifest;

describe("generated stubs typecheck (CI-gap guard, #242)", () => {
  let target: string | null = null;
  afterEach(async () => {
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
      target = null;
    }
  });

  it("emits port/adapter stubs with single extensions + valid identifiers that compile", async () => {
    target = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-242-"));
    await new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest,
    }).run();

    const inDir = path.join(
      target,
      "packages/billing/src/application/ports/in",
    );
    const adapterDir = path.join(
      target,
      "packages/billing/src/infrastructure/adapters",
    );

    // 1. Structural — the kebab/extensioned manifest name was normalized: single
    //    extension, no `…in-port.ts.in-port.ts`.
    const inPortFiles = await fs.readdir(inDir);
    assert.ok(
      inPortFiles.includes("RestController.in-port.ts"),
      `expected RestController.in-port.ts, got ${inPortFiles.join(", ")}`,
    );
    assert.ok(
      !inPortFiles.some((f) => f.includes(".in-port.ts.in-port.ts")),
      "no doubled extension",
    );
    const portText = await fs.readFile(
      path.join(inDir, "RestController.in-port.ts"),
      "utf8",
    );
    assert.match(
      portText,
      /export interface RestControllerPort\b/,
      "interface name is a valid identifier (not rest-controller.in-port.tsPort)",
    );
    const adapterFiles = await fs.readdir(adapterDir);
    assert.ok(
      adapterFiles.includes("Prisma.adapter.ts") &&
        !adapterFiles.some((f) => f.includes(".adapter.ts.adapter.ts")),
      `adapters single-extensioned, got ${adapterFiles.join(", ")}`,
    );

    // 2. The real guard — `tsc --noEmit` over the generated port/adapter surface.
    const tscConfig = path.join(target, "tsconfig.stubcheck.json");
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
        include: [
          "packages/billing/src/application/ports/**/*.ts",
          "packages/billing/src/infrastructure/adapters/**/*.ts",
        ],
      }),
    );

    const tscPath = createRequire(import.meta.url).resolve(
      "typescript/bin/tsc",
    );
    try {
      execFileSync(process.execPath, [tscPath, "-p", tscConfig], {
        cwd: target,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      assert.fail(
        `generated port/adapter stubs failed to typecheck (#242 regression):\n${
          err.stdout || err.stderr || err.message
        }`,
      );
    }
  });

  it("emits a generic use-case stub that compiles against the shared Result kernel (#246)", async () => {
    target = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-246-"));
    await new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest,
    }).run();

    // Fresh pass: the use-case is emitted before its in-port, so it's the GENERIC
    // stub — which imports `Result` from `@{scope}/shared`.
    const uc = await fs.readFile(
      path.join(
        target,
        "packages/billing/src/application/use-cases/ChargeCard.use-case.ts",
      ),
      "utf8",
    );
    assert.match(
      uc,
      /import type \{ Result \} from '@acme\/shared'/,
      "generic use-case imports Result from the shared kernel",
    );

    // #246 — the shared Result kernel exists and is re-exported by the
    // package-root barrel (so `@acme/shared` exports `Result`).
    const sharedRoot = await fs.readFile(
      path.join(target, "packages/shared/src/index.ts"),
      "utf8",
    );
    assert.match(sharedRoot, /export \* from "\.\/domain\/index\.js"/);
    const kernel = await fs.readFile(
      path.join(target, "packages/shared/src/domain/result.ts"),
      "utf8",
    );
    assert.match(kernel, /export type Result<T, E = unknown>/);

    // The real guard: tsc the use-case surface + the shared package together.
    const tscConfig = path.join(target, "tsconfig.uccheck.json");
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
          "packages/billing/src/application/use-cases/**/*.ts",
          "packages/shared/src/**/*.ts",
        ],
      }),
    );
    const tscPath = createRequire(import.meta.url).resolve(
      "typescript/bin/tsc",
    );
    try {
      execFileSync(process.execPath, [tscPath, "-p", tscConfig], {
        cwd: target,
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      assert.fail(
        `generated use-case + shared kernel failed to typecheck (#246 regression):\n${
          err.stdout || err.stderr || err.message
        }`,
      );
    }
  });
});
