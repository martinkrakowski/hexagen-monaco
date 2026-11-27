// packages/sync/__tests__/generators/codec-test.test.ts
//
// Lane H3: adversarial codec-test generator.
//
// Contract under test (see the lane brief):
//   - Emission of `<moduleDir>/__tests__/codecs/<PortName>.codec.test.ts`
//     (outside src/, so production barrels and tsconfig.build never see it)
//     using the fleet-v2 runtime API (CodecEnv / DecodeResult /
//     ADVERSARIAL_CORPUS).
//   - Deterministic error-code precedence over untrusted manifest data:
//     HOSTILE_INPUT > MALFORMED_CONTRACT > TIMEOUT_OR_BUDGET > UNKNOWN_TYPE >
//     UNSUPPORTED_NESTED_SHAPE > MISSING_BOUND > MISSING_PATTERN_EXAMPLE >
//     IO_FAILURE.
//   - Hostile-input rule: getters are NEVER invoked (refused through their own
//     property descriptor), detectable Proxies and reflection/trap throws are
//     refused, sparse holes / array-likes / non-iterables / enormous lengths /
//     prototype-polluting keys are refused — each with a typed error.
//   - Failure propagation through SyncEngine (errors > 0, CodecTests row).
//
// Scaffolding conventions mirror stubs.test.ts: disposable temp workspace per
// test (mkdtemp / rm), silent logger, minimal SyncConfig via makeConfig.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeEach, afterEach } from "vitest";
import { types } from "node:util";
import { generateCodecTests } from "../../src/generators/codec-test.js";
import {
  CodecTestGeneratorError,
  installIsProxyDetector,
  synthesizeValidSample,
} from "../../src/domain/services/codec-sample-synthesizer.js";
import { SyncEngine } from "../../src/sync-engine.js";
import type { BoundedContext, Manifest } from "../../src/types/manifest.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";
import {
  createFixture,
  removeFixture,
  WORKSPACE_TSCONFIG,
} from "../helpers/fixture-factory.js";

// -----------------------------------------------------------------------------
// Test helpers (mirroring stubs.test.ts)
// -----------------------------------------------------------------------------

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

// Direct synthesizer calls bypass the generator's module-load seam, so the
// tests install the real detector (util.types.isProxy) themselves — the same
// wiring production gets through src/generators/codec-test.ts.
installIsProxyDetector(types.isProxy);

function makeConfig(workspaceRoot: string, manifest: Manifest): SyncConfig {
  return {
    dryRun: false,
    force: false,
    forceRoot: false,
    allowDirty: true,
    strict: false,
    mode: "external",
    logger: silentLogger,
    manifest,
    workspaceRoot,
  };
}

const SIMPLE_REQUEST = {
  kind: "object",
  exact: true,
  fields: { qty: { kind: "integer", min: 0, max: 5 } },
};

interface ManifestOptions {
  inPorts?: unknown[];
  outPorts?: unknown[];
  /** Placed at generator.codec (H3 read path). */
  codec?: Record<string, unknown>;
  extraContexts?: BoundedContext[];
}

function makeManifest(options: ManifestOptions = {}): Manifest {
  const manifest: Record<string, unknown> = {
    description: "Test manifest",
    workspaceDefaults: { tsConfig: WORKSPACE_TSCONFIG },
    generator: {
      sync: {
        layers: {
          domain: { folder: "src/domain" },
          application: {
            folder: "src/application",
            subfolders: ["ports/in", "ports/out", "use-cases"],
          },
          infrastructure: {
            folder: "src/infrastructure",
            subfolders: ["adapters"],
          },
        },
        packageJson: { protectedKeys: ["scripts"] },
      },
      ...(options.codec ? { codec: options.codec } : {}),
    },
    bounded_contexts: [
      {
        name: "codec-test-target",
        type: "core",
        layers: {
          application: {
            ports: {
              in: options.inPorts ?? [],
              out: options.outPorts ?? [],
            },
          },
        },
      },
      ...(options.extraContexts ?? []),
    ],
  };
  return manifest as unknown as Manifest;
}

function expectErrCode(thrown: unknown, code: string): void {
  assert.ok(
    thrown instanceof CodecTestGeneratorError,
    `expected a CodecTestGeneratorError, got ${String(thrown)}`,
  );
  assert.equal(thrown.code, code);
}

function expectGenErrCode(result: { error?: unknown }, code: string): void {
  assert.ok(result.error instanceof Error, "expected result.error to be set");
  assert.equal((result.error as { code?: string }).code, code);
  assert.ok(
    result.error instanceof CodecTestGeneratorError,
    "expected a CodecTestGeneratorError in GeneratorResult",
  );
}

// -----------------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------------

let workspaceRoot: string;
let modulePath: string;
const moduleName = "codec-test-target";

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "hexagen-codec-test-"),
  );
  modulePath = path.join(workspaceRoot, "packages", moduleName);
  await fs.mkdir(modulePath, { recursive: true });
});

afterEach(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

function emptyDirCount(dir: string): Promise<number> {
  return fs
    .readdir(dir)
    .then((entries) => entries.length)
    .catch((err: NodeJS.ErrnoException) =>
      err.code === "ENOENT" ? 0 : Promise.reject(err),
    );
}

// -----------------------------------------------------------------------------
// 1. MALFORMED_CONTRACT
// -----------------------------------------------------------------------------

describe("generateCodecTests refusals", () => {
  it("refuses malformed manifest contracts (null, primitive, missing kind, non-exact object, invalid runtimeModule, or invalid port name) with MALFORMED_CONTRACT", async () => {
    const cases: Array<Record<string, unknown>> = [
      { inPorts: [{ name: "place-order", contracts: { request: null } }] },
      { inPorts: [{ name: "place-order", contracts: { request: 42 } }] },
      { inPorts: [{ name: "place-order", contracts: { request: {} } }] },
      {
        inPorts: [
          {
            name: "place-order",
            contracts: { request: { kind: "object", fields: {} } },
          },
        ],
      },
      { codec: { runtimeModule: "bad module with spaces" } },
      {
        inPorts: [{ name: "../evil", contracts: { request: SIMPLE_REQUEST } }],
      },
      { inPorts: [{ name: "", contracts: { request: SIMPLE_REQUEST } }] },
    ];
    for (const options of cases) {
      const result = await generateCodecTests(
        modulePath,
        moduleName,
        makeConfig(workspaceRoot, makeManifest(options)),
      );
      expectGenErrCode(result, "MALFORMED_CONTRACT");
      assert.equal(result.totalOps, 0, "a refusal plans zero ops");
    }
  });

  // ---------------------------------------------------------------------------
  // 2. UNKNOWN_TYPE
  // ---------------------------------------------------------------------------

  it("refuses an unknown contract field type with UNKNOWN_TYPE", async () => {
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            {
              name: "place-order",
              contracts: { request: { kind: "map", fields: {} } },
            },
          ],
        }),
      ),
    );
    expectGenErrCode(result, "UNKNOWN_TYPE");
    assert.equal(result.totalOps, 0);
  });

  // ---------------------------------------------------------------------------
  // 3. MISSING_BOUND
  // ---------------------------------------------------------------------------

  it("refuses a string or array contract with missing, non-positive, or over-limit bound with MISSING_BOUND", () => {
    const cases: unknown[] = [
      { kind: "string" }, // missing maxLength
      { kind: "string", maxLength: 0 }, // non-positive
      { kind: "string", maxLength: -3 }, // negative
      { kind: "string", maxLength: 65_537 }, // over MAX_STRING_LENGTH_BOUND
      { kind: "string", maxLength: 1.5 }, // non-integer
      { kind: "array", items: { kind: "boolean" } }, // missing maxItems
      { kind: "array", items: { kind: "boolean" }, maxItems: 0 },
      { kind: "array", items: { kind: "boolean" }, maxItems: 10_001 }, // over MAX_ARRAY_ITEMS_BOUND
    ];
    for (const contract of cases) {
      try {
        synthesizeValidSample(contract, "probe");
        assert.fail(`expected MISSING_BOUND for ${JSON.stringify(contract)}`);
      } catch (thrown) {
        expectErrCode(thrown, "MISSING_BOUND");
      }
    }
    // Also through the generator: a MISSING_BOUND contract never writes.
    return generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: { kind: "string" } } },
          ],
        }),
      ),
    ).then((result) => {
      expectGenErrCode(result, "MISSING_BOUND");
      assert.equal(result.totalOps, 0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. UNSUPPORTED_NESTED_SHAPE
  // ---------------------------------------------------------------------------

  it("refuses unsupported nested shapes, depth exceeding MAX_CONTRACT_DEPTH, or inverted numeric bounds (min > max) with UNSUPPORTED_NESTED_SHAPE", () => {
    // Depth 9: nested exact objects one level past MAX_CONTRACT_DEPTH (8).
    let deep: Record<string, unknown> = { kind: "boolean" };
    for (let i = 0; i < 9; i++) {
      deep = { kind: "object", exact: true, fields: { f: deep } };
    }
    const cases: Array<[unknown, string]> = [
      [deep, "depth"],
      [{ kind: "enum", values: [] }, "empty enum"],
      [{ kind: "enum", values: [1, 2] }, "non-string enum"],
      [{ kind: "literal", value: { nested: true } }, "non-primitive literal"],
      [{ kind: "integer", min: 5, max: 1 }, "inverted bounds"],
      [{ kind: "number", min: 2.5, max: -2.5 }, "inverted bounds (number)"],
    ];
    for (const [contract, label] of cases) {
      try {
        synthesizeValidSample(contract, "probe");
        assert.fail(`expected UNSUPPORTED_NESTED_SHAPE for ${label}`);
      } catch (thrown) {
        expectErrCode(thrown, "UNSUPPORTED_NESTED_SHAPE");
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5. MISSING_PATTERN_EXAMPLE
  // ---------------------------------------------------------------------------

  it("refuses a pattern string field without an explicit matching example with MISSING_PATTERN_EXAMPLE", () => {
    const cases: unknown[] = [
      { kind: "string", maxLength: 8, pattern: "^[a-z]+$" }, // example missing
      {
        kind: "string",
        maxLength: 8,
        pattern: "^[a-z]+$",
        example: "ABC", // does not match
      },
      {
        kind: "string",
        maxLength: 8,
        pattern: "^\\d{3}-\\d{4}$",
        example: "12-3456", // partial match only
      },
    ];
    for (const contract of cases) {
      try {
        synthesizeValidSample(contract, "probe");
        assert.fail("expected MISSING_PATTERN_EXAMPLE");
      } catch (thrown) {
        expectErrCode(thrown, "MISSING_PATTERN_EXAMPLE");
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 6. HOSTILE_INPUT (getters are never invoked)
  // ---------------------------------------------------------------------------

  it("refuses null, undefined, non-iterable, wrong primitive, getter, Proxy/trap-throw, array hole, array-like, huge length, and prototype-polluting key with HOSTILE_INPUT without invoking getters", async () => {
    // Getter on a contract property: refused through the descriptor WITHOUT
    // running the accessor — the flag must stay false.
    let getterRan = false;
    const getterContract = {
      kind: "object",
      exact: true,
      get fields() {
        getterRan = true;
        return {};
      },
    };
    try {
      synthesizeValidSample(getterContract, "probe");
      assert.fail("expected HOSTILE_INPUT for the getter contract");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }
    assert.equal(getterRan, false, "the getter must never be invoked");

    // Getter on an enum values element container.
    let valuesGetterRan = false;
    const getterValues = {
      kind: "enum",
      get values() {
        valuesGetterRan = true;
        return ["a"];
      },
    };
    try {
      synthesizeValidSample(getterValues, "probe");
      assert.fail("expected HOSTILE_INPUT for the getter values");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }
    assert.equal(valuesGetterRan, false);

    // Detectable Proxy (util.types.isProxy).
    try {
      synthesizeValidSample(
        new Proxy({ kind: "string", maxLength: 5 }, {}),
        "probe",
      );
      assert.fail("expected HOSTILE_INPUT for the Proxy");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // Reflection/trap throw: getPrototypeOf trap throws.
    const trapping = new Proxy(
      { kind: "string", maxLength: 5 },
      {
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    try {
      synthesizeValidSample(trapping, "probe");
      assert.fail("expected HOSTILE_INPUT for the trap-throwing Proxy");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // Non-plain prototype (class instance).
    class NotPlain {
      kind = "string";
      maxLength = 5;
    }
    try {
      synthesizeValidSample(new NotPlain(), "probe");
      assert.fail("expected HOSTILE_INPUT for the non-plain prototype");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // null / undefined where a plain record is required (fields map).
    for (const fields of [null, undefined]) {
      try {
        synthesizeValidSample({ kind: "object", exact: true, fields }, "probe");
        assert.fail("expected HOSTILE_INPUT for null/undefined fields");
      } catch (thrown) {
        expectErrCode(thrown, "HOSTILE_INPUT");
      }
    }

    // Wrong primitive where a plain record is required (contracts block).
    const primitiveContracts = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({ inPorts: [{ name: "place-order", contracts: 42 }] }),
      ),
    );
    expectGenErrCode(primitiveContracts, "HOSTILE_INPUT");

    // Non-iterable / array-like where an array is required (enum values).
    for (const values of [{ length: 1, 0: "a" }, new Map(), "abc", 7]) {
      try {
        synthesizeValidSample({ kind: "enum", values }, "probe");
        assert.fail("expected HOSTILE_INPUT for the non-array values");
      } catch (thrown) {
        expectErrCode(thrown, "HOSTILE_INPUT");
      }
    }

    // Sparse array hole in enum values.
    const holey: unknown[] = new Array(2);
    holey[1] = "a";
    try {
      synthesizeValidSample({ kind: "enum", values: holey }, "probe");
      assert.fail("expected HOSTILE_INPUT for the array hole");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // Huge length on an input array (ports list beyond MAX_PORTS_PER_CONTEXT).
    const manyPorts = Array.from({ length: 65 }, (_v, i) => ({
      name: `p${i}`,
    }));
    const hugeResult = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({ inPorts: manyPorts as unknown[] }),
      ),
    );
    expectGenErrCode(hugeResult, "HOSTILE_INPUT");

    // Prototype-polluting key (own "__proto__" via JSON.parse).
    const polluting = JSON.parse(
      '{"kind":"object","exact":true,"fields":{"__proto__":{"kind":"boolean"}}}',
    ) as Record<string, unknown>;
    try {
      synthesizeValidSample(polluting, "probe");
      assert.fail("expected HOSTILE_INPUT for the polluting key");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // A hostile port entry (undefined) inside the ports list.
    const undefinedEntry = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(workspaceRoot, makeManifest({ inPorts: [undefined] })),
    );
    expectGenErrCode(undefinedEntry, "HOSTILE_INPUT");
  });

  // ---------------------------------------------------------------------------
  // 7. IO_FAILURE
  // ---------------------------------------------------------------------------

  it("surfaces filesystem write failure as CodecTestGeneratorError IO_FAILURE in GeneratorResult", async () => {
    // A regular file where the __tests__ directory must be created forces the
    // atomic writer's mkdir/read to fail with a non-ENOENT filesystem error.
    await fs.writeFile(path.join(modulePath, "__tests__"), "not a dir", "utf8");
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
          ],
        }),
      ),
    );
    expectGenErrCode(result, "IO_FAILURE");
    assert.equal(result.totalOps, 0);
    assert.ok(result.summary?.includes("CodecTests failed"));
  });

  // ---------------------------------------------------------------------------
  // 8. Defaults + contractless ports
  // ---------------------------------------------------------------------------

  it("defaults runtimeModule to @fleet/shared and min to 0 when omitted and skips ports without contracts", async () => {
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            {
              name: "place-order",
              contracts: { request: { kind: "integer" } }, // no min -> 0
            },
          ],
          outPorts: [{ name: "notify" }, "legacy-string-port"], // no contracts
        }),
      ),
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.created, [
      path.join(modulePath, "__tests__", "codecs", "PlaceOrder.codec.test.ts"),
    ]);
    const content = await fs.readFile(result.created[0], "utf8");
    assert.ok(
      content.includes('from "@fleet/shared"'),
      "runtimeModule must default to @fleet/shared",
    );
    assert.ok(
      content.includes('"qty"') === false &&
        content.includes("VALID_SAMPLE = 0"),
      "an integer without min must synthesize 0",
    );
  });

  // ---------------------------------------------------------------------------
  // 9. TIMEOUT_OR_BUDGET
  // ---------------------------------------------------------------------------

  it("refuses contracts exceeding MAX_CONTRACT_FIELDS, global schema-node budget (deeply branching contract), or serialized-sample byte budget with TIMEOUT_OR_BUDGET without unbounded allocation", async () => {
    // 65 object fields > MAX_CONTRACT_FIELDS (64).
    const wide: Record<string, unknown> = {
      kind: "object",
      exact: true,
      fields: {},
    };
    for (let i = 0; i < 65; i++) {
      (wide.fields as Record<string, unknown>)[`f${i}`] = { kind: "boolean" };
    }
    try {
      synthesizeValidSample(wide, "probe");
      assert.fail("expected TIMEOUT_OR_BUDGET for the wide contract");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }

    // Deeply branching contract: depth stays <= 8 (7 wrappings around the
    // leaf) but the global node budget (MAX_CONTRACT_NODES) blows first
    // because each level references the subtree three times.
    let branching: Record<string, unknown> = { kind: "boolean" };
    for (let i = 0; i < 7; i++) {
      branching = {
        kind: "object",
        exact: true,
        fields: {
          a: branching,
          b: branching,
          c: branching,
        },
      };
    }
    try {
      synthesizeValidSample(branching, "probe");
      assert.fail("expected TIMEOUT_OR_BUDGET for the branching contract");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }

    // Serialized-sample byte budget: a giant literal sample.
    const byteBudget = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            {
              name: "place-order",
              contracts: {
                request: { kind: "literal", value: "x".repeat(9000) },
              },
            },
          ],
        }),
      ),
    );
    expectGenErrCode(byteBudget, "TIMEOUT_OR_BUDGET");
    assert.equal(byteBudget.totalOps, 0, "no file may be written on refusal");
    assert.equal(
      await emptyDirCount(path.join(modulePath, "__tests__", "codecs")),
      0,
      "the codecs directory must not contain any emitted test",
    );
  });

  // ---------------------------------------------------------------------------
  // 10. Deterministic valid samples for every kind
  // ---------------------------------------------------------------------------

  it("synthesizes valid deterministic samples for every supported contract kind (object, array, string, integer, number, boolean, enum, literal, nullable)", () => {
    const contract = {
      kind: "object",
      exact: true,
      fields: {
        g: { kind: "nullable", of: { kind: "string", maxLength: 2 } },
        f: { kind: "literal", value: "lit" },
        e: { kind: "enum", values: ["x", "y"] },
        d: { kind: "boolean" },
        c: { kind: "number" },
        b: { kind: "array", items: { kind: "integer", max: 9 }, maxItems: 3 },
        a: { kind: "string", maxLength: 5 },
      },
    };
    const first = synthesizeValidSample(contract, "probe");
    const second = synthesizeValidSample(contract, "probe");
    assert.deepEqual(second, first, "synthesis must be deterministic");
    assert.deepEqual(first, {
      a: "a",
      b: [0],
      c: 0,
      d: false,
      e: "x",
      f: "lit",
      g: null,
    });

    // Each kind individually.
    assert.deepEqual(
      synthesizeValidSample({ kind: "object", exact: true, fields: {} }, "p"),
      {},
    );
    assert.deepEqual(
      synthesizeValidSample(
        { kind: "array", items: { kind: "boolean" }, maxItems: 4 },
        "p",
      ),
      [false],
    );
    assert.equal(
      synthesizeValidSample({ kind: "string", maxLength: 5 }, "p"),
      "a",
    );
    assert.equal(
      synthesizeValidSample(
        { kind: "string", maxLength: 8, pattern: "^[a-z]+$", example: "abc" },
        "p",
      ),
      "abc",
    );
    assert.equal(synthesizeValidSample({ kind: "integer" }, "p"), 0);
    assert.equal(synthesizeValidSample({ kind: "number" }, "p"), 0);
    // Clamping: no min and a negative max -> max.
    assert.equal(synthesizeValidSample({ kind: "integer", max: -3 }, "p"), -3);
    assert.equal(synthesizeValidSample({ kind: "boolean" }, "p"), false);
    assert.equal(
      synthesizeValidSample({ kind: "enum", values: ["b", "a"] }, "p"),
      "b",
    );
    assert.equal(synthesizeValidSample({ kind: "literal", value: 7 }, "p"), 7);
    assert.equal(
      synthesizeValidSample(
        { kind: "nullable", of: { kind: "string", maxLength: 3 } },
        "p",
      ),
      null,
    );
  });

  // ---------------------------------------------------------------------------
  // 11. Port discovery in both directions
  // ---------------------------------------------------------------------------

  it("discovers contract-bearing ports at context.layers.application.ports.in and .out", async () => {
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
          ],
          outPorts: [
            {
              name: "notify-events",
              contracts: { request: { kind: "string", maxLength: 4 } },
            },
          ],
        }),
      ),
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.created.map((p) => path.basename(p)).sort(), [
      "NotifyEvents.codec.test.ts",
      "PlaceOrder.codec.test.ts",
    ]);
    const notify = await fs.readFile(
      path.join(
        modulePath,
        "__tests__",
        "codecs",
        "NotifyEvents.codec.test.ts",
      ),
      "utf8",
    );
    assert.ok(
      notify.includes("createNotifyEventsCodec"),
      "the out-port test must wire the out-port codec",
    );
  });

  // ---------------------------------------------------------------------------
  // 12. Fleet-v2 runtime API usage in the emitted test
  // ---------------------------------------------------------------------------

  it("generates a codec test using the fleet-v2 CodecEnv, DecodeResult, and ADVERSARIAL_CORPUS API", async () => {
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
          ],
        }),
      ),
    );
    assert.equal(result.error, undefined);
    const content = await fs.readFile(result.created[0], "utf8");
    assert.ok(content.startsWith("// @generated by @hexagen/sync"));
    assert.ok(
      content.includes('import { describe, it, expect } from "vitest"'),
    );
    assert.ok(content.includes('import { types } from "node:util"'));
    assert.ok(
      content.includes(
        'import { ADVERSARIAL_CORPUS, type CodecEnv, type DecodeResult } from "@fleet/shared"',
      ),
    );
    assert.ok(
      content.includes(
        'import { createPlaceOrderCodec } from "../../src/application/ports/place-order.codec.js"',
      ),
    );
    assert.ok(
      content.includes("const env: CodecEnv = { isProxy: types.isProxy };"),
    );
    assert.ok(content.includes("describe.each(ADVERSARIAL_CORPUS)"));
    assert.ok(
      content.includes(
        "const res: DecodeResult<unknown> = codec.decode(entry.build());",
      ),
    );
    assert.ok(content.includes("expect(res.ok).toBe(false);"));
    assert.ok(
      content.includes(
        "if (res.ok) expect(Object.isFrozen(res.value)).toBe(true);",
      ),
    );
    // The synthesized valid sample is embedded for the round-trip test.
    assert.ok(content.includes('"qty": 0'));
  });

  // ---------------------------------------------------------------------------
  // 13. Placement + idempotency
  // ---------------------------------------------------------------------------

  it("emits codec tests under __tests__/codecs/ outside src/ and is idempotent on re-run", async () => {
    const manifest = makeManifest({
      inPorts: [
        { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
      ],
    });
    const first = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(workspaceRoot, manifest),
    );
    assert.equal(first.error, undefined);
    const emitted = path.join(
      modulePath,
      "__tests__",
      "codecs",
      "PlaceOrder.codec.test.ts",
    );
    assert.deepEqual(first.created, [emitted]);
    // Outside src/ — no source tree file was emitted.
    const srcDir = path.join(modulePath, "src");
    const srcExists = await fs
      .stat(srcDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(
      srcExists,
      false,
      "the generator must not create anything under src/",
    );

    const second = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(workspaceRoot, manifest),
    );
    assert.equal(second.error, undefined);
    assert.deepEqual(second.created, [], "no re-creation on a converged tree");
    assert.deepEqual(second.unchanged, [emitted]);
    assert.equal(second.totalOps, 0, "a re-run plans zero ops");
  });

  // ---------------------------------------------------------------------------
  // 14. SyncEngine integration: ops + failure propagation
  // ---------------------------------------------------------------------------

  describe("SyncEngine integration", () => {
    let fixtureRoot: string | null = null;

    afterEach(async () => {
      await removeFixture(fixtureRoot);
      fixtureRoot = null;
    });

    function makeEngine(root: string, manifest: Manifest, dryRun: boolean) {
      return new SyncEngine(
        {
          dryRun,
          force: false,
          forceRoot: false,
          allowDirty: true,
          strict: false,
          mode: "external",
          logger: silentLogger,
        },
        { targetRoot: root, manifest },
      );
    }

    it("records CodecTests ops and surfaces CodecTests failures in SyncRunSummary.errors", async () => {
      fixtureRoot = await createFixture(
        ["codec-test-target"],
        "hexagen-codec-engine-",
      );

      // Baseline: no contract-bearing port -> no CodecTests op.
      const plainManifest = makeManifest({
        inPorts: [{ name: "notify" }],
        outPorts: [],
      });
      const plainSummary = await makeEngine(
        fixtureRoot,
        plainManifest,
        true,
      ).run();
      assert.equal(plainSummary.errors, 0);

      // With a contract-bearing port, the CodecTests row plans a write and
      // the run summary reflects it in totalOps.
      const contractManifest = makeManifest({
        inPorts: [
          { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
        ],
        outPorts: [],
      });
      const contractSummary = await makeEngine(
        fixtureRoot,
        contractManifest,
        true,
      ).run();
      assert.equal(contractSummary.errors, 0);
      assert.ok(
        contractSummary.totalOps > plainSummary.totalOps,
        "the CodecTests op must be recorded in the run summary",
      );

      // A malformed contract must NOT masquerade as a green exit: the
      // CodecTests failure surfaces in SyncRunSummary.errors.
      const failingSummary = await makeEngine(
        fixtureRoot,
        makeManifest({
          inPorts: [
            { name: "place-order", contracts: { request: { kind: "string" } } },
          ],
          outPorts: [],
        }),
        true,
      ).run();
      assert.ok(
        failingSummary.errors > 0,
        "CodecTests failure must surface in errors",
      );
    });

    it("reports invalid module names in the engine's CodecTests traversal as typed failures instead of skipping silently", async () => {
      fixtureRoot = await createFixture(
        ["codec-test-target"],
        "hexagen-codec-fix1-",
      );
      // A path-traversal module name used to be skipped silently — the run
      // stayed green. It must now surface as a CodecTests failure.
      const summary = await makeEngine(
        fixtureRoot,
        makeManifest({
          extraContexts: [
            {
              name: "../evil",
              type: "core",
              layers: { application: { ports: { in: [], out: [] } } },
            } as unknown as BoundedContext,
          ],
        }),
        true,
      ).run();
      assert.ok(
        summary.errors > 0,
        "an invalid module name must surface as a CodecTests failure",
      );
    });

    it("traverses manifest.bounded_contexts through the descriptor boundary in the engine path", async () => {
      fixtureRoot = await createFixture(
        ["codec-test-target"],
        "hexagen-codec-fix1b-",
      );
      // A hostile accessor on manifest.bounded_contexts: the engine path must
      // refuse it through the descriptor boundary (readOwnPlainProperty) and
      // surface a typed CodecTests failure — without the fix, the raw
      // `config.manifest.bounded_contexts` read returns [] silently.
      let getterRan = false;
      const manifest = makeManifest({
        inPorts: [
          { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
        ],
      }) as unknown as Record<string, unknown>;
      Object.defineProperty(manifest, "bounded_contexts", {
        get() {
          getterRan = true;
          return [];
        },
        configurable: true,
        enumerable: true,
      });
      const summary = await makeEngine(
        fixtureRoot,
        manifest as unknown as Manifest,
        true,
      ).run();
      assert.ok(
        summary.errors > 0,
        "a hostile accessor on bounded_contexts must surface as a CodecTests failure",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 15. Pattern budgets (no unrestricted native RegExp.test)
  // ---------------------------------------------------------------------------

  it("refuses invalid regex patterns with MALFORMED_CONTRACT and excessive pattern-size or matching-step budgets with TIMEOUT_OR_BUDGET without running unrestricted native RegExp.test", () => {
    // Invalid syntax.
    for (const pattern of ["[a-", "(?=a)a", "a{2,1}", "*a", "a)", "[z-a]"]) {
      try {
        synthesizeValidSample(
          {
            kind: "string",
            maxLength: 64,
            pattern,
            example: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
          },
          "probe",
        );
        assert.fail(`expected MALFORMED_CONTRACT for pattern ${pattern}`);
      } catch (thrown) {
        expectErrCode(thrown, "MALFORMED_CONTRACT");
      }
    }

    // Pattern-size budget: a pattern longer than MAX_PATTERN_LENGTH.
    const oversized = `^a{1,10}${"b".repeat(300)}$`;
    try {
      synthesizeValidSample(
        { kind: "string", maxLength: 400, pattern: oversized, example: "a" },
        "probe",
      );
      assert.fail("expected TIMEOUT_OR_BUDGET for the oversized pattern");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }

    // Matching-step budget: a catastrophic-backtracking shape
    // ((a+)+ against a non-matching input) exhausts the bounded matcher's
    // step budget instead of running native RegExp.test unbounded.
    try {
      synthesizeValidSample(
        {
          kind: "string",
          maxLength: 64,
          pattern: "(a+)+$",
          example: `${"a".repeat(40)}b`,
        },
        "probe",
      );
      assert.fail("expected TIMEOUT_OR_BUDGET for the backtracking pattern");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }
  });

  // ---------------------------------------------------------------------------
  // 16. Fix round 1 (review findings)
  // ---------------------------------------------------------------------------

  it("refuses a pattern example longer than maxLength (it is not a valid sample)", () => {
    try {
      synthesizeValidSample(
        { kind: "string", maxLength: 1, pattern: "^a+$", example: "aa" },
        "probe",
      );
      assert.fail("expected a refusal for the over-long example");
    } catch (thrown) {
      expectErrCode(thrown, "MISSING_PATTERN_EXAMPLE");
    }
    // The same example within the bound is accepted.
    assert.equal(
      synthesizeValidSample(
        { kind: "string", maxLength: 2, pattern: "^a+$", example: "aa" },
        "probe",
      ),
      "aa",
    );
  });

  it("charges the actual UTF-8 size of the JSON-serialized sample against the byte budget", () => {
    // 8191 ASCII characters: the JS string length (8191) passes the 8192
    // budget but the serialized JSON literal (quotes included) is 8193 bytes.
    try {
      synthesizeValidSample(
        { kind: "literal", value: "a".repeat(8191) },
        "probe",
      );
      assert.fail("expected TIMEOUT_OR_BUDGET for the 8191-char literal");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }
    // Non-ASCII: 4096 "é" characters have a JS length of 4096 but serialize
    // to 8194 UTF-8 bytes.
    try {
      synthesizeValidSample(
        { kind: "literal", value: "é".repeat(4096) },
        "probe",
      );
      assert.fail("expected TIMEOUT_OR_BUDGET for the non-ASCII literal");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }
    // The boundary itself stays accepted: an 8190-char literal serializes to
    // 8192 bytes exactly.
    assert.equal(
      synthesizeValidSample({ kind: "literal", value: "a".repeat(8190) }, "p"),
      "a".repeat(8190),
    );
  });

  it("refuses detectable and revoked Proxies at array boundaries with HOSTILE_INPUT", async () => {
    // Detectable, non-throwing Proxy over an enum values array: reflection
    // would otherwise succeed through the traps.
    try {
      synthesizeValidSample(
        { kind: "enum", values: new Proxy(["a"], {}) },
        "probe",
      );
      assert.fail("expected HOSTILE_INPUT for the Proxy values array");
    } catch (thrown) {
      expectErrCode(thrown, "HOSTILE_INPUT");
    }

    // Same at the generator's ports-list boundary.
    const proxyPorts = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          inPorts: new Proxy(
            [{ name: "place-order", contracts: { request: SIMPLE_REQUEST } }],
            {},
          ),
        }),
      ),
    );
    expectGenErrCode(proxyPorts, "HOSTILE_INPUT");

    // A revoked Proxy throws even from Array.isArray — it must surface as
    // HOSTILE_INPUT, not IO_FAILURE.
    const { proxy, revoke } = Proxy.revocable([{ name: "p" }], {});
    revoke();
    const revoked = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({ inPorts: proxy as unknown as unknown[] }),
      ),
    );
    expectGenErrCode(revoked, "HOSTILE_INPUT");
  });

  it("synthesizes integers inside fractional bounds and refuses bounds containing no integer", () => {
    assert.equal(
      synthesizeValidSample({ kind: "integer", min: 0.5, max: 5 }, "p"),
      1,
    );
    assert.equal(
      synthesizeValidSample({ kind: "integer", max: -0.5 }, "p"),
      -1,
    );
    assert.equal(synthesizeValidSample({ kind: "integer", min: -0.5 }, "p"), 0);
    try {
      synthesizeValidSample({ kind: "integer", min: 0.5, max: 0.5 }, "p");
      assert.fail(
        "expected UNSUPPORTED_NESTED_SHAPE for integer bounds without an integer",
      );
    } catch (thrown) {
      expectErrCode(thrown, "UNSUPPORTED_NESTED_SHAPE");
    }
    // Number contracts keep fractional samples.
    assert.equal(synthesizeValidSample({ kind: "number", min: 0.5 }, "p"), 0.5);
  });

  it("validates pattern syntax and size before the example check (error precedence)", () => {
    // Invalid pattern WITHOUT an example: was MISSING_PATTERN_EXAMPLE, must
    // now be MALFORMED_CONTRACT.
    try {
      synthesizeValidSample(
        { kind: "string", maxLength: 64, pattern: "[a-" },
        "probe",
      );
      assert.fail("expected MALFORMED_CONTRACT");
    } catch (thrown) {
      expectErrCode(thrown, "MALFORMED_CONTRACT");
    }
    // Oversized pattern WITHOUT an example: TIMEOUT_OR_BUDGET.
    try {
      synthesizeValidSample(
        {
          kind: "string",
          maxLength: 400,
          pattern: `^a{1,10}${"b".repeat(300)}$`,
        },
        "probe",
      );
      assert.fail("expected TIMEOUT_OR_BUDGET");
    } catch (thrown) {
      expectErrCode(thrown, "TIMEOUT_OR_BUDGET");
    }
    // A missing example with a VALID pattern is still MISSING_PATTERN_EXAMPLE.
    try {
      synthesizeValidSample(
        { kind: "string", maxLength: 8, pattern: "^[a-z]+$" },
        "probe",
      );
      assert.fail("expected MISSING_PATTERN_EXAMPLE");
    } catch (thrown) {
      expectErrCode(thrown, "MISSING_PATTERN_EXAMPLE");
    }
  });

  it("accepts safe relative runtimeModule specifiers and still refuses traversal", async () => {
    const result = await generateCodecTests(
      modulePath,
      moduleName,
      makeConfig(
        workspaceRoot,
        makeManifest({
          codec: { runtimeModule: "./runtime" },
          inPorts: [
            { name: "place-order", contracts: { request: SIMPLE_REQUEST } },
          ],
        }),
      ),
    );
    assert.equal(result.error, undefined);
    const content = await fs.readFile(result.created[0], "utf8");
    assert.ok(
      content.includes('from "./runtime"'),
      "a safe relative specifier must be accepted",
    );
    for (const bad of ["../evil", "a/../b", "./", "./..", ".hidden"]) {
      const res = await generateCodecTests(
        modulePath,
        moduleName,
        makeConfig(
          workspaceRoot,
          makeManifest({ codec: { runtimeModule: bad } }),
        ),
      );
      expectGenErrCode(res, "MALFORMED_CONTRACT");
    }
  });
});
