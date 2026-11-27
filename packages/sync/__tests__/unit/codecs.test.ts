// packages/sync/__tests__/unit/codecs.test.ts
//
// Lane H2 unit tests: file emission, hostile manifest traversal refusals,
// error propagation into SyncEngine, --check convergence, --dry-run, --only
// scoping, and the adversarial-corpus execution of a generated codec.
//
// `@fleet/shared` (Lane H1) is not a workspace dependency here, so the
// fleet-v2 runtime contract is exercised through a matching test double
// (RUNTIME_MODULE_SOURCE) written next to the emitted codec, and the
// test-side adversarial suite (ADVERSARIAL_CORPUS / runAdversarialCorpus)
// lives in this file exactly as the brief allows.

import { describe, expect, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateCodecs } from "../../src/generators/codecs.js";
import { SyncEngine } from "../../src/sync-engine.js";
import type { SyncConfig } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";
import { createSpyLogger, type SpyLogger } from "../helpers/spy-logger.js";
import {
  createFixture,
  removeFixture,
  LAYERS_TEMPLATE,
  WORKSPACE_TSCONFIG,
  PROTECTED_KEYS,
} from "../helpers/fixture-factory.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REQUEST_SCHEMA = {
  kind: "object",
  exact: true,
  fields: {
    id: { kind: "string", maxLength: 8, pattern: "^[a-z]+$" },
    qty: { kind: "integer", min: 0, max: 10 },
    role: { kind: "enum", values: ["admin", "user"] },
    flag: { kind: "boolean" },
  },
} as const;

interface ManifestOptions {
  inPorts?: unknown[];
  outPorts?: unknown[];
  codec?: Record<string, unknown>;
}

function makeManifest(options: ManifestOptions = {}): Manifest {
  const inPorts = options.inPorts ?? [
    { name: "place-order", contracts: { request: REQUEST_SCHEMA } },
  ];
  const outPorts = options.outPorts ?? [{ name: "notify" }];
  const manifest: Record<string, unknown> = {
    description: "Test manifest",
    workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
    generator: {
      sync: {
        layers: LAYERS_TEMPLATE,
        packageJson: { protectedKeys: PROTECTED_KEYS },
      },
    },
    bounded_contexts: [
      {
        name: "alpha",
        type: "core",
        layers: {
          application: {
            ports: { in: inPorts, out: outPorts },
          },
        },
      },
    ],
  };
  if (options.codec) manifest.codec = options.codec;
  return manifest as unknown as Manifest;
}

function makeConfig(
  fixtureRoot: string,
  manifest: Manifest,
  logger: SpyLogger,
  overrides: Partial<SyncConfig> = {},
): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger,
    workspaceRoot: fixtureRoot,
    manifest,
    ...overrides,
  };
}

function expectErrCode(
  result: { success?: boolean; error?: unknown },
  code: string,
): void {
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as { code?: string }).code).toBe(code);
}

// ---------------------------------------------------------------------------
// Fleet-v2 runtime test double (plain ESM, written into the fixture)
// ---------------------------------------------------------------------------

const RUNTIME_MODULE_SOURCE = `
const BRAND = Symbol("validated");

export function isValidated(value) {
  return typeof value === "object" && value !== null && value[BRAND] === true;
}

function fail(reason, path) {
  return { ok: false, reason, path: path.length > 0 ? path.join(".") : null };
}

function decodeValue(schema, input, path, env) {
  try {
    if (env.isProxy(input)) return fail("not-plain-data", path);
    switch (schema.kind) {
      case "object": {
        if (input === null || typeof input !== "object" || Array.isArray(input)) {
          return fail("wrong-type", path);
        }
        const own = Object.keys(input);
        for (const key of own) {
          if (key === "__proto__" || key === "constructor" || key === "prototype") {
            return fail("reserved-key", [...path, key]);
          }
        }
        for (const key of Object.keys(schema.fields)) {
          if (!Object.prototype.hasOwnProperty.call(input, key)) {
            return fail("missing-key", [...path, key]);
          }
        }
        for (const key of own) {
          if (!(key in schema.fields)) return fail("unknown-key", [...path, key]);
        }
        const out = {};
        for (const key of Object.keys(schema.fields)) {
          // Read through the own data descriptor only: accessor properties are
          // refused WITHOUT invoking the getter (no side effects may run).
          const desc = Object.getOwnPropertyDescriptor(input, key);
          if (desc === undefined) {
            return fail("missing-key", [...path, key]);
          }
          if ("get" in desc || "set" in desc) {
            return fail("not-plain-data", [...path, key]);
          }
          const decoded = decodeValue(
            schema.fields[key],
            desc.value,
            [...path, key],
            env,
          );
          if (!decoded.ok) return decoded;
          out[key] = decoded.value;
        }
        Object.defineProperty(out, BRAND, { value: true });
        Object.freeze(out);
        return { ok: true, value: out };
      }
      case "array": {
        if (!Array.isArray(input)) return fail("wrong-type", path);
        // Never touch input.length via an ordinary property read — the
        // length comes from its own data descriptor (accessors refused
        // without invoking them).
        const lenDesc = Object.getOwnPropertyDescriptor(input, "length");
        if (
          lenDesc === undefined ||
          "get" in lenDesc ||
          "set" in lenDesc ||
          typeof lenDesc.value !== "number"
        ) {
          return fail("not-plain-data", path);
        }
        if (lenDesc.value > schema.maxItems) return fail("out-of-bounds", path);
        const items = [];
        for (let i = 0; i < lenDesc.value; i++) {
          const itemDesc = Object.getOwnPropertyDescriptor(input, String(i));
          if (itemDesc === undefined || "get" in itemDesc || "set" in itemDesc) {
            return fail("not-plain-data", [...path, String(i)]);
          }
          const decoded = decodeValue(
            schema.items,
            itemDesc.value,
            [...path, String(i)],
            env,
          );
          if (!decoded.ok) return decoded;
          items.push(decoded.value);
        }
        Object.freeze(items);
        return { ok: true, value: items };
      }
      case "string": {
        if (typeof input !== "string") return fail("wrong-type", path);
        if (input.length > schema.maxLength) return fail("out-of-bounds", path);
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(input)) {
          return fail("pattern-mismatch", path);
        }
        return { ok: true, value: input };
      }
      case "integer": {
        if (typeof input !== "number" || !Number.isInteger(input)) {
          return fail("wrong-type", path);
        }
        if (
          (schema.min !== undefined && input < schema.min) ||
          (schema.max !== undefined && input > schema.max)
        ) {
          return fail("out-of-bounds", path);
        }
        return { ok: true, value: input };
      }
      case "boolean":
        return typeof input === "boolean"
          ? { ok: true, value: input }
          : fail("wrong-type", path);
      case "enum":
        return schema.values.includes(input)
          ? { ok: true, value: input }
          : fail("not-in-enum", path);
      case "nullable":
        if (input === null) return { ok: true, value: null };
        return decodeValue(schema.of, input, path, env);
      default:
        return fail("wrong-type", path);
    }
  } catch {
    // A hostile getter / trap threw mid-decode — refuse, never propagate.
    return fail("not-plain-data", path);
  }
}

export function createCodec(schemaId, schema, env) {
  return {
    schemaId,
    decode(input) {
      return decodeValue(schema, input, [], env);
    },
  };
}
`;

// ---------------------------------------------------------------------------
// Test-side adversarial suite (H1 double)
// ---------------------------------------------------------------------------

// Incremented by the throwing-getter corpus fixture's getter — the corpus
// test asserts it stays 0 (the no-getter-execution safety rule).
let getterSideEffects = 0;

export const ADVERSARIAL_CORPUS: readonly { id: string; input: unknown }[] = [
  { id: "not-an-object", input: 42 },
  { id: "null-input", input: null },
  { id: "undefined-input", input: undefined },
  { id: "array-where-object", input: [] },
  {
    id: "unknown-key",
    input: { id: "abc", qty: 1, role: "user", flag: true, extra: 1 },
  },
  { id: "missing-key", input: { id: "abc", qty: 1, role: "user" } },
  { id: "wrong-type", input: { id: 5, qty: 1, role: "user", flag: true } },
  {
    id: "out-of-bounds",
    input: { id: "abc", qty: 11, role: "user", flag: true },
  },
  {
    id: "pattern-mismatch",
    input: { id: "!!!", qty: 1, role: "user", flag: true },
  },
  {
    id: "not-in-enum",
    input: { id: "abc", qty: 1, role: "root", flag: true },
  },
  {
    id: "reserved-key",
    input: JSON.parse(
      '{"__proto__": {}, "id": "abc", "qty": 1, "role": "user", "flag": true}',
    ),
  },
  {
    id: "throwing-getter",
    input: {
      get id() {
        // Side effect observable from this test's scope: the no-getter-
        // execution rule forbids the runtime double from tripping this.
        getterSideEffects += 1;
        throw new Error("getter must not crash the codec");
      },
      qty: 1,
      role: "user",
      flag: true,
    },
  },
  {
    id: "hostile-proxy",
    input: new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    ),
  },
  { id: "valid", input: { id: "abc", qty: 1, role: "user", flag: true } },
];

const CORPUS_EXPECT_REFUSED = new Set(
  ADVERSARIAL_CORPUS.filter((e) => e.id !== "valid").map((e) => e.id),
);

export function runAdversarialCorpus(
  codec: { decode: (input: unknown) => unknown },
  env: { isProxy: (value: unknown) => boolean },
  onThrown?: (id: string, thrown: unknown) => void,
): readonly { id: string; refused: boolean }[] {
  return ADVERSARIAL_CORPUS.map((entry) => {
    let refused: boolean;
    try {
      const result = codec.decode(entry.input) as { ok: boolean };
      refused = !result.ok;
    } catch (thrown) {
      // A throw is NOT a refusal — the test title promises refusals happen
      // "without throwing". Report the thrown outcome separately and mark the
      // entry as not refused so a crashing codec fails the corpus assertions.
      onThrown?.(entry.id, thrown);
      refused = false;
    }
    return { id: entry.id, refused };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateCodecs — emission and traversal", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("emits <PortName>.codec.ts into resolved application port dir and skips ports without contracts", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();
    const manifest = makeManifest({
      inPorts: [
        { name: "place-order", contracts: { request: REQUEST_SCHEMA } },
        { name: "no-contracts" }, // contractless sibling port
      ],
    });
    const moduleDir = path.join(fixtureRoot, "packages", "alpha");
    const result = await generateCodecs(
      moduleDir,
      "alpha",
      makeConfig(fixtureRoot, manifest, logger),
    );

    expect(result.error).toBeUndefined();
    const emitted = path.join(
      moduleDir,
      "src/application/ports/in",
      "PlaceOrder.codec.ts",
    );
    expect(result.created).toContain(emitted);
    expect(result.totalOps).toBe(1);
    const content = await fs.readFile(emitted, "utf8");
    expect(content).toContain("export type PlaceOrderRequest = Validated<");
    expect(content).toContain("createPlaceOrderCodec");
    // Contractless port was skipped without error.
    expect(result.created.some((p) => p.includes("NoContracts"))).toBe(false);
    expect(result.created.some((p) => p.includes("Notify"))).toBe(false);
  });

  it("refuses sparse arrays with holes, accessor getters, and throwing Proxy traps in manifest ports with HOSTILE_INPUT", async () => {
    fixtureRoot = await createFixture(["alpha"]);

    // Sparse ports array (hole).
    const sparsePorts: unknown[] = new Array(2);
    sparsePorts[1] = {
      name: "place-order",
      contracts: { request: REQUEST_SCHEMA },
    };
    const sparseResult = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({ inPorts: sparsePorts }),
        createSpyLogger(),
      ),
    );
    expectErrCode(sparseResult, "HOSTILE_INPUT");

    // Accessor getter on the port object (never invoked).
    let getterInvoked = false;
    const accessorPort: object = {
      get contracts() {
        getterInvoked = true;
        return { request: REQUEST_SCHEMA };
      },
    };
    const accessorResult = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({ inPorts: [accessorPort] }),
        createSpyLogger(),
      ),
    );
    expectErrCode(accessorResult, "HOSTILE_INPUT");
    expect(getterInvoked).toBe(false);

    // Ports array whose `length` descriptor lookup throws (hostile Proxy trap).
    const trappingPorts = new Proxy(
      [{ name: "place-order", contracts: { request: REQUEST_SCHEMA } }],
      {
        getOwnPropertyDescriptor() {
          throw new Error("trap");
        },
      },
    );
    const trappingResult = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({ inPorts: trappingPorts }),
        createSpyLogger(),
      ),
    );
    expectErrCode(trappingResult, "HOSTILE_INPUT");
  });

  it("surfaces GeneratorResult.error and SyncEngine errors > 0 for missing port name or malformed contract without skipping", async () => {
    fixtureRoot = await createFixture(["alpha"]);

    // Missing port name (direct generator call).
    const noNameResult = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({
          inPorts: [{ contracts: { request: REQUEST_SCHEMA } }],
          codec: { runtimeModule: "@fleet/shared" },
        }),
        createSpyLogger(),
      ),
    );
    expectErrCode(noNameResult, "MALFORMED_CONTRACT");

    // Malformed contract (string without maxLength) — MISSING_BOUND, no write.
    const badResult = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: { kind: "string" } } },
          ],
          codec: { runtimeModule: "@fleet/shared" },
        }),
        createSpyLogger(),
      ),
    );
    expectErrCode(badResult, "MISSING_BOUND");
    expect(badResult.totalOps).toBe(0);

    // Through SyncEngine: the failure is recorded and errors > 0 (no exit-0
    // masquerade), in external dry-run mode like the other engine tests.
    const logger = createSpyLogger();
    const engine = new SyncEngine(
      {
        dryRun: true,
        force: false,
        forceRoot: false,
        allowDirty: true,
        strict: false,
        mode: "external",
        logger,
      },
      {
        targetRoot: fixtureRoot,
        manifest: makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: { kind: "string" } } },
          ],
          codec: { runtimeModule: "@fleet/shared" },
        }),
      },
    );
    const summary = await engine.run();
    expect(summary.errors).toBeGreaterThan(0);
  });

  it("reports pending Codecs ops under check mode before write and zero ops after convergence", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const manifest = makeManifest({
      codec: { runtimeModule: "@fleet/shared" },
    });

    function engine(dryRun: boolean): SyncEngine {
      return new SyncEngine(
        {
          dryRun,
          force: false,
          forceRoot: false,
          allowDirty: true,
          strict: false,
          mode: "external",
          logger: createSpyLogger(),
        },
        { targetRoot: fixtureRoot as string, manifest },
      );
    }

    // Check mode (dry-run) BEFORE write: the Codecs row reports pending ops.
    const before = await engine(true).run();
    const pendingCodecDrift = (before.files ?? []).filter(
      (f) => f.generator === "Codecs",
    );
    expect(pendingCodecDrift.length).toBeGreaterThan(0);
    expect(pendingCodecDrift.every((f) => f.action === "create")).toBe(true);

    // Real run: writes the codec file.
    const real = await engine(false).run();
    expect(real.created).toBeGreaterThan(0);

    // Check mode AFTER convergence: zero Codecs ops.
    const after = await engine(true).run();
    expect((after.files ?? []).filter((f) => f.generator === "Codecs")).toEqual(
      [],
    );
  });

  it("plans codec creation under dry-run without writing files", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();
    const manifest = makeManifest({
      codec: { runtimeModule: "@fleet/shared" },
    });
    const moduleDir = path.join(fixtureRoot, "packages", "alpha");
    const result = await generateCodecs(
      moduleDir,
      "alpha",
      makeConfig(fixtureRoot, manifest, logger, { dryRun: true }),
    );

    expect(result.error).toBeUndefined();
    const planned = path.join(
      moduleDir,
      "src/application/ports/in",
      "PlaceOrder.codec.ts",
    );
    expect(result.created).toContain(planned);
    // Nothing was written — not even the directory.
    await expect(fs.stat(planned)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(moduleDir, "src/application/ports/in")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("skips out-of-scope codec files when --only excludes the port path", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const logger = createSpyLogger();
    const manifest = makeManifest({
      codec: { runtimeModule: "@fleet/shared" },
    });
    const result = await generateCodecs(
      path.join(fixtureRoot, "packages", "alpha"),
      "alpha",
      makeConfig(fixtureRoot, manifest, logger, {
        only: ["packages/alpha/src/infrastructure/**"],
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.created).toEqual([]);
    const skipped = path.join(
      fixtureRoot,
      "packages/alpha/src/application/ports/in/PlaceOrder.codec.ts",
    );
    expect(result.skipped).toContain(skipped);
    await expect(fs.stat(skipped)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exercises generated codec with ADVERSARIAL_CORPUS via runAdversarialCorpus and returns DecodeResult { ok: false, reason, path } refusals without throwing", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    // Runtime test double lives next to the workspace root; the emitted codec
    // imports it via a relative specifier (codec.runtimeModule).
    const runtimePath = path.join(fixtureRoot, "codec-runtime.mjs");
    await fs.writeFile(runtimePath, RUNTIME_MODULE_SOURCE, "utf8");

    // Point the manifest's runtime module at the test double.
    const moduleDir = path.join(fixtureRoot, "packages", "alpha");
    const codecPath = path.join(
      moduleDir,
      "src/application/ports/in/PlaceOrder.codec.ts",
    );
    const rel = path
      .relative(path.dirname(codecPath), runtimePath)
      .split(path.sep)
      .join("/");
    const runtimeModule = rel.startsWith(".") ? rel : `./${rel}`;

    const result = await generateCodecs(
      moduleDir,
      "alpha",
      makeConfig(
        fixtureRoot,
        makeManifest({ codec: { runtimeModule } }),
        createSpyLogger(),
      ),
    );
    expect(result.error).toBeUndefined();
    expect(result.created).toContain(codecPath);

    // The emitted module imports ONLY from the runtime module.
    const emitted = await fs.readFile(codecPath, "utf8");
    const imports = emitted.split("\n").filter((l) => l.startsWith("import"));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain(runtimeModule);

    const mod = (await import(pathToFileURL(codecPath).href)) as {
      createPlaceOrderCodec: (env: { isProxy: (v: unknown) => boolean }) => {
        decode: (input: unknown) => unknown;
        schemaId: string;
      };
    };
    const env = { isProxy: () => false };
    const codec = mod.createPlaceOrderCodec(env);
    expect(codec.schemaId).toBe("alpha.PlaceOrder");

    // No corpus entry makes the runner throw; every hostile entry is refused,
    // the valid entry decodes.
    const thrown: string[] = [];
    const outcomes = runAdversarialCorpus(codec, env, (id) => thrown.push(id));
    // A codec crash is not a refusal — none may have occurred.
    expect(thrown).toEqual([]);
    // No-getter-execution rule: the throwing getter's side effect must never
    // have run — the double refuses accessor properties without invoking them.
    expect(getterSideEffects).toBe(0);
    expect(outcomes.map((o) => o.id).sort()).toEqual(
      ADVERSARIAL_CORPUS.map((e) => e.id).sort(),
    );
    for (const outcome of outcomes) {
      expect(outcome.refused).toBe(CORPUS_EXPECT_REFUSED.has(outcome.id));
    }

    // Every corpus refusal is a DecodeResult { ok: false, reason, path } —
    // asserted directly rather than inferred from caught exceptions.
    for (const entry of ADVERSARIAL_CORPUS) {
      if (entry.id === "valid") continue;
      const result = codec.decode(entry.input) as {
        ok: boolean;
        reason?: unknown;
        path?: unknown;
      };
      expect(result.ok, entry.id).toBe(false);
      expect(typeof result.reason, entry.id).toBe("string");
      expect(
        result.path === null || typeof result.path === "string",
        entry.id,
      ).toBe(true);
    }

    // DecodeResult refusal shape: { ok: false, reason, path }.
    const refusal = codec.decode({
      id: 5,
      qty: 1,
      role: "user",
      flag: true,
    }) as {
      ok: false;
      reason: string;
      path: string | null;
    };
    expect(refusal.ok).toBe(false);
    expect(typeof refusal.reason).toBe("string");
    expect(refusal.path).toBe("id");

    // Successful decode is a branded, deeply-frozen value.
    const okResult = codec.decode({
      id: "abc",
      qty: 1,
      role: "user",
      flag: true,
    }) as { ok: true; value: Record<string, unknown> };
    expect(okResult.ok).toBe(true);
    expect(Object.isFrozen(okResult.value)).toBe(true);
  });
});

describe("fix round 1 — sanitized layers config", () => {
  let fixtureRoot: string | null = null;

  afterEach(async () => {
    await removeFixture(fixtureRoot);
    fixtureRoot = null;
  });

  it("refuses accessor getters and descriptor-throwing Proxy traps on generator.sync.layers application/folder with HOSTILE_INPUT without invoking them", async () => {
    fixtureRoot = await createFixture(["alpha"]);
    const moduleDir = path.join(fixtureRoot, "packages", "alpha");

    // Accessor on `folder`: the getter must never run, and the value must
    // never be read through ordinary property access inside the resolver.
    let getterInvoked = false;
    const accessorManifest = makeManifest();
    (
      (accessorManifest as unknown as Record<string, unknown>).generator as {
        sync: { layers: unknown };
      }
    ).sync.layers = {
      application: {
        get folder() {
          getterInvoked = true;
          return "src/app";
        },
      },
    };
    const accessorResult = await generateCodecs(
      moduleDir,
      "alpha",
      makeConfig(fixtureRoot, accessorManifest, createSpyLogger()),
    );
    expectErrCode(accessorResult, "HOSTILE_INPUT");
    expect(getterInvoked).toBe(false);

    // A Proxy that throws only when asked for the `application` DESCRIPTOR:
    // ordinary property reads would succeed silently, so only the sanitized
    // descriptor path refuses it — before resolveEmissionDir is ever called.
    const layersTarget = { application: { folder: "src/app" } };
    const proxyManifest = makeManifest();
    (
      (proxyManifest as unknown as Record<string, unknown>).generator as {
        sync: { layers: unknown };
      }
    ).sync.layers = new Proxy(layersTarget, {
      getOwnPropertyDescriptor(_target, key) {
        if (key === "application") throw new Error("application trap");
        return Object.getOwnPropertyDescriptor(layersTarget, key);
      },
    });
    const proxyResult = await generateCodecs(
      moduleDir,
      "alpha",
      makeConfig(fixtureRoot, proxyManifest, createSpyLogger()),
    );
    expectErrCode(proxyResult, "HOSTILE_INPUT");
  });
});
