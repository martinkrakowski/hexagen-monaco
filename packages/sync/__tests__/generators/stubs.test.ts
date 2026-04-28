import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { generateStubs } from "../../src/generators/stubs.js";
import type { BoundedContext, Manifest } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";

/**
 * Unit tests for `packages/sync/src/generators/stubs.ts`.
 *
 * Contract under test (see module header of stubs.ts):
 *   - Strict opt-in: no-op unless `generator.sync.stubs.enabled === true`.
 *   - No-op when the bounded context is missing or declares no layers.
 *   - Happy-path emission for each layer element kind (entity / value-object /
 *     in-port / out-port / adapter / use-case).
 *   - Hard no-overwrite guarantee: pre-existing files are preserved verbatim.
 *   - Naming cascade: per-context naming override > global naming > built-in default.
 *   - Built-in DEFAULT_TEMPLATES / DEFAULT_NAMING used when manifest omits them.
 *   - Multi-layer runs flatten correctly and produce multiple stubs.
 *
 * Scaffolding conventions mirror the sibling tests in this directory:
 *   - disposable temp workspace per test (mkdtemp / rm recursive)
 *   - silent logger to keep test output clean
 *   - minimal SyncConfig via the makeConfig helper
 */

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

/** No-op logger that satisfies LoggerPort without cluttering test output. */
const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

function makeConfig(workspaceRoot: string, manifest: Manifest): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    mode: "external",
    logger: silentLogger,
    manifest,
    workspaceRoot,
  };
}

/**
 * Count every regular file under `dir`, recursively. Returns 0 when `dir`
 * does not exist (covers the common "no-op should not create src/" assertion).
 */
async function countFilesRecursive(dir: string): Promise<number> {
  let count = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFilesRecursive(full);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

// -----------------------------------------------------------------------------
// Shared fixture: temp workspace scoped to a single bounded-context package.
// -----------------------------------------------------------------------------

let workspaceRoot: string;
let modulePath: string;
const moduleName = "stubs-target";

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-stubs-test-"),
  );
  modulePath = path.join(workspaceRoot, "packages", moduleName);
  await fs.mkdir(modulePath, { recursive: true });
});

afterEach(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// No-op / opt-in behaviour
// -----------------------------------------------------------------------------

describe("generateStubs – no-op cases", () => {
  it("writes nothing when stubs.enabled !== true", async () => {
    const manifest: Manifest = {
      generator: {
        sync: { stubs: { enabled: false } },
      },
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    assert.deepEqual(result.created, []);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.skipped, []);
    assert.equal(result.totalOps, 0);
    assert.equal(
      await countFilesRecursive(path.join(modulePath, "src")),
      0,
      "no stub files should be emitted when stubs.enabled is false",
    );
  });

  it("writes nothing when the generator.sync.stubs section is missing entirely", async () => {
    const manifest: Manifest = {
      // No generator.sync.stubs at all.
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    assert.equal(result.totalOps, 0);
    assert.equal(result.created.length, 0);
    assert.equal(
      await countFilesRecursive(path.join(modulePath, "src")),
      0,
      "no stub files should be emitted without a stubs section",
    );
  });

  it("writes nothing when the bounded context has no layers", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          // layers: undefined
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    assert.equal(result.totalOps, 0);
    assert.equal(result.created.length, 0);
    assert.equal(
      await countFilesRecursive(path.join(modulePath, "src")),
      0,
      "no stub files should be emitted when context.layers is absent",
    );
  });

  it("writes nothing when the bounded context is not declared in the manifest", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: "some-other-ctx",
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);
    assert.equal(result.totalOps, 0);
    assert.equal(result.created.length, 0);
  });
});

// -----------------------------------------------------------------------------
// Happy-path emission — one test per stub kind, verifying:
//   1. the correct filename suffix is produced
//   2. the correct sub-directory is used
//   3. the template body is interpolated with {name}
// -----------------------------------------------------------------------------

describe("generateStubs – happy-path emission", () => {
  it("creates an entity stub at src/domain/entities/<Name>.ts", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(modulePath, "src/domain/entities/Order.ts");
    assert.deepEqual(result.created, [expected]);
    assert.equal(result.totalOps, 1);

    const body = await fs.readFile(expected, "utf8");
    assert.match(
      body,
      /export class Order/,
      "entity template must interpolate {name} into a class declaration",
    );
    assert.match(body, /@generated entity stub/);
  });

  it("creates a value-object stub with the .vo.ts suffix", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { value_objects: ["Money"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/domain/value-objects/Money.vo.ts",
    );
    assert.deepEqual(result.created, [expected]);

    const body = await fs.readFile(expected, "utf8");
    assert.match(body, /export class Money/);
    assert.match(body, /@generated value-object stub/);
    assert.match(body, /static create\(value: unknown\)/);
    assert.match(body, /getValue\(\): unknown/);
    assert.match(body, /equals\(other: Money\): boolean/);
  });

  it("creates an in-port stub with the .in-port.ts suffix and interpolated {name}", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            application: { ports: { in: ["PlaceOrder"] } },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/application/ports/in/PlaceOrder.in-port.ts",
    );
    assert.deepEqual(result.created, [expected]);

    const body = await fs.readFile(expected, "utf8");
    assert.match(
      body,
      /export interface PlaceOrderPort/,
      "in-port template must inject {name} into the interface identifier",
    );
    assert.match(body, /@generated in-port stub/);
  });

  it("creates an out-port stub with the .out-port.ts suffix", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            application: { ports: { out: ["OrderRepository"] } },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/application/ports/out/OrderRepository.out-port.ts",
    );
    assert.deepEqual(result.created, [expected]);

    const body = await fs.readFile(expected, "utf8");
    assert.match(body, /export interface OrderRepositoryPort/);
    assert.match(body, /@generated out-port stub/);
  });

  it("creates an adapter stub with the .adapter.ts suffix", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            infrastructure: { adapters: ["PostgresOrderRepository"] },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/infrastructure/adapters/PostgresOrderRepository.adapter.ts",
    );
    assert.deepEqual(result.created, [expected]);

    const body = await fs.readFile(expected, "utf8");
    assert.match(body, /export class PostgresOrderRepositoryAdapter/);
    assert.match(body, /@generated adapter stub/);
  });

  it("creates a use-case stub with the .use-case.ts suffix", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            application: { use_cases: ["PlaceOrder"] },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/application/use-cases/PlaceOrder.use-case.ts",
    );
    assert.deepEqual(result.created, [expected]);

    const body = await fs.readFile(expected, "utf8");
    assert.match(body, /export class PlaceOrderUseCase/);
    assert.match(body, /@generated use-case stub/);
  });
});

// -----------------------------------------------------------------------------
// Safety: hard no-overwrite guarantee
// -----------------------------------------------------------------------------

describe("generateStubs – no-overwrite guarantee", () => {
  it("never overwrites a pre-existing file, even with matching target name", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    // Pre-seed the exact file the generator would produce, with user-authored
    // content that looks nothing like the default template.
    const target = path.join(modulePath, "src/domain/entities/Order.ts");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const userAuthored =
      "// hand-written by the user — MUST NOT be clobbered\n" +
      "export class Order {\n" +
      "  constructor(public readonly id: string) {}\n" +
      "}\n";
    await fs.writeFile(target, userAuthored, "utf8");

    const result = await generateStubs(modulePath, moduleName, config);

    assert.deepEqual(result.created, []);
    assert.deepEqual(result.skipped, [target]);
    assert.equal(result.totalOps, 0);

    const afterContent = await fs.readFile(target, "utf8");
    assert.equal(
      afterContent,
      userAuthored,
      "existing file content must be byte-identical after generator run",
    );
  });

  it("preserves existing files even if force flag is set (stricter than safeWriteFileAtomic)", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: { domain: { entities: ["Order"] } },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);
    config.force = true; // simulate --force / external force=true

    const target = path.join(modulePath, "src/domain/entities/Order.ts");
    await fs.mkdir(path.dirname(target), { recursive: true });
    const userAuthored = "// user code with no @generated marker\n";
    await fs.writeFile(target, userAuthored, "utf8");

    await generateStubs(modulePath, moduleName, config);

    const afterContent = await fs.readFile(target, "utf8");
    assert.equal(
      afterContent,
      userAuthored,
      "force=true must NOT override the stub no-overwrite guarantee",
    );
  });
});

// -----------------------------------------------------------------------------
// Naming cascade & template fallbacks
// -----------------------------------------------------------------------------

describe("generateStubs – naming cascade and fallbacks", () => {
  it("per-context naming override wins over the global naming template", async () => {
    const context: BoundedContext = {
      name: moduleName,
      layers: { domain: { entities: ["Order"] } },
      generator: {
        stubs: {
          naming: { entity: "{name}.entity.ts" },
        },
      },
    };
    const manifest: Manifest = {
      generator: {
        sync: {
          stubs: {
            enabled: true,
            // Global naming also customised — per-context must still win.
            naming: { entity: "{name}.global.ts" },
          },
        },
      },
      bounded_contexts: [context],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expected = path.join(
      modulePath,
      "src/domain/entities/Order.entity.ts",
    );
    assert.deepEqual(result.created, [expected]);

    // Confirm the global-only file path was NOT produced.
    const globalPath = path.join(
      modulePath,
      "src/domain/entities/Order.global.ts",
    );
    let globalExists = true;
    try {
      await fs.stat(globalPath);
    } catch {
      globalExists = false;
    }
    assert.equal(
      globalExists,
      false,
      "per-context naming must replace global naming, not coexist with it",
    );
  });

  it("falls back to DEFAULT_TEMPLATES and DEFAULT_NAMING when manifest omits both", async () => {
    const manifest: Manifest = {
      // Enabled but with no templates / naming sections — built-in defaults
      // must still produce exactly the canonical stub files.
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            domain: {
              entities: ["Order"],
              value_objects: ["Money"],
            },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const entityPath = path.join(modulePath, "src/domain/entities/Order.ts");
    const voPath = path.join(
      modulePath,
      "src/domain/value-objects/Money.vo.ts",
    );

    assert.equal(result.created.length, 2);
    assert.ok(
      result.created.includes(entityPath),
      "default naming must place entity at src/domain/entities/<Name>.ts",
    );
    assert.ok(
      result.created.includes(voPath),
      "default naming must place value object at src/domain/value-objects/<Name>.vo.ts",
    );

    const entityBody = await fs.readFile(entityPath, "utf8");
    const voBody = await fs.readFile(voPath, "utf8");
    assert.match(
      entityBody,
      /@generated entity stub/,
      "default entity template body must be used",
    );
    assert.match(
      voBody,
      /@generated value-object stub/,
      "default value-object template body must be used",
    );
  });
});

// -----------------------------------------------------------------------------
// Multi-layer run
// -----------------------------------------------------------------------------

describe("generateStubs – multi-layer run", () => {
  it("emits stubs for all three layers in a single run", async () => {
    const manifest: Manifest = {
      generator: { sync: { stubs: { enabled: true } } },
      bounded_contexts: [
        {
          name: moduleName,
          layers: {
            domain: {
              entities: ["Order"],
              value_objects: ["Money"],
              ports: { in: ["DomainIn"], out: ["DomainOut"] },
            },
            application: {
              use_cases: ["PlaceOrder"],
              ports: { in: ["AppIn"], out: ["AppOut"] },
            },
            infrastructure: {
              adapters: ["PostgresOrderRepository"],
            },
          },
        },
      ],
    };
    const config = makeConfig(workspaceRoot, manifest);

    const result = await generateStubs(modulePath, moduleName, config);

    const expectedPaths = [
      path.join(modulePath, "src/domain/entities/Order.ts"),
      path.join(modulePath, "src/domain/value-objects/Money.vo.ts"),
      path.join(modulePath, "src/domain/ports/in/DomainIn.in-port.ts"),
      path.join(modulePath, "src/domain/ports/out/DomainOut.out-port.ts"),
      path.join(modulePath, "src/application/use-cases/PlaceOrder.use-case.ts"),
      path.join(modulePath, "src/application/ports/in/AppIn.in-port.ts"),
      path.join(modulePath, "src/application/ports/out/AppOut.out-port.ts"),
      path.join(
        modulePath,
        "src/infrastructure/adapters/PostgresOrderRepository.adapter.ts",
      ),
    ];

    assert.equal(
      result.created.length,
      expectedPaths.length,
      "one stub per declared element should be created",
    );
    assert.equal(result.totalOps, expectedPaths.length);

    // Order-independent set equality.
    assert.deepEqual(
      [...result.created].sort(),
      [...expectedPaths].sort(),
      "every expected stub file must be created",
    );

    // Confirm each file actually landed on disk.
    for (const p of expectedPaths) {
      await fs.stat(p); // throws if missing
    }
  });
});
