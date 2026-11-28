// packages/sync/__tests__/unit/codec-schema-builder.test.ts
//
// Lane H2 unit tests: schema building, determinism, bounds, and hostile-input
// refusals. Every title states what the test asserts; each body proves it
// (mutation-testing note: a constant-`err` or identity implementation fails
// these, because each test pins BOTH the specific error code of the happy or
// hostile path AND at least one positive behaviour elsewhere in the file).

import { describe, expect, it } from "vitest";
import { types } from "node:util";
import {
  buildCodecSchema,
  readDenseArray,
  readOwnDataProperty,
  renderCodecModule,
  resolveRuntimeModule,
  CodecGeneratorError,
  MAX_CONTRACT_DEPTH,
  MAX_ENUM_VALUES,
  MAX_OBJECT_FIELDS,
} from "../../src/domain/services/codec-schema-builder.js";

function expectErr(
  result: { success: boolean; error?: unknown },
  code: string,
): CodecGeneratorError {
  expect(result.success).toBe(false);
  const error = result.error as CodecGeneratorError;
  expect(error).toBeInstanceOf(CodecGeneratorError);
  expect(error.code).toBe(code);
  return error;
}

describe("buildCodecSchema — refusals", () => {
  it("refuses null and undefined contract inputs with MALFORMED_CONTRACT", () => {
    expectErr(buildCodecSchema(null, "t", types.isProxy), "MALFORMED_CONTRACT");
    expectErr(
      buildCodecSchema(undefined, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
  });

  it("refuses primitive values as a contract object with MALFORMED_CONTRACT", () => {
    for (const primitive of [42, "str", true, Symbol("s"), 0n]) {
      expectErr(
        buildCodecSchema(primitive, "t", types.isProxy),
        "MALFORMED_CONTRACT",
      );
    }
    // A function is not a contract object either.
    expectErr(
      buildCodecSchema(() => 1, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
  });

  it("refuses accessor getters on contract and fields without invoking them", () => {
    let invoked = false;
    const hostileContract: object = {
      get kind() {
        invoked = true;
        return "string";
      },
    };
    const result = buildCodecSchema(hostileContract, "t", types.isProxy);
    expectErr(result, "HOSTILE_INPUT");
    expect(invoked).toBe(false);

    // Accessor on a nested `fields` entry is refused the same way.
    let fieldGetterInvoked = false;
    const contract = {
      kind: "object",
      exact: true,
      get fields() {
        fieldGetterInvoked = true;
        return {};
      },
    };
    expectErr(buildCodecSchema(contract, "t", types.isProxy), "HOSTILE_INPUT");
    expect(fieldGetterInvoked).toBe(false);
  });

  it("refuses hostile Proxy traps that throw during reflection or length lookup and non-plain prototypes with HOSTILE_INPUT", () => {
    // Proxy whose getOwnPropertyDescriptor trap throws during reflection.
    const throwingProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("trap boom");
        },
      },
    );
    expectErr(
      buildCodecSchema(throwingProxy, "t", types.isProxy),
      "HOSTILE_INPUT",
    );

    // Non-plain prototype (class instance) is refused too.
    class NotPlain {
      kind = "string";
    }
    expectErr(
      buildCodecSchema(new NotPlain(), "t", types.isProxy),
      "HOSTILE_INPUT",
    );
  });

  it("refuses prototype-polluting keys in object fields with PROTOTYPE_POLLUTION", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      // JSON.parse creates a REAL own property for __proto__ (a literal's
      // `{ __proto__: x }` — or a plain assignment — would only touch the
      // prototype instead of defining the key).
      const contract = JSON.parse(
        `{"kind":"object","exact":true,"fields":{"legit":{"kind":"boolean"},"${key}":{"kind":"boolean"}}}`,
      ) as unknown;
      const result = buildCodecSchema(contract, "t", types.isProxy);
      expectErr(result, "PROTOTYPE_POLLUTION");
    }
  });

  it("refuses sparse arrays with holes in enum values with HOSTILE_INPUT", () => {
    const sparse: string[] = new Array(3);
    sparse[1] = "a";
    sparse[2] = "b";
    const contract = { kind: "enum", values: sparse };
    expectErr(buildCodecSchema(contract, "t", types.isProxy), "HOSTILE_INPUT");
  });

  it("refuses array-like objects where an array is expected with MALFORMED_CONTRACT", () => {
    const arrayLike = { length: 2, 0: "a", 1: "b" };
    const contract = { kind: "enum", values: arrayLike };
    expectErr(
      buildCodecSchema(contract, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    // Also directly through the dense-array reader.
    expectErr(
      readDenseArray(arrayLike, 64, "p", types.isProxy),
      "MALFORMED_CONTRACT",
    );
  });

  it("refuses enormous enum lengths and over-deep contracts with BOUNDS_EXCEEDED", () => {
    // Enormous enum: 65 string values > MAX_ENUM_VALUES.
    const hugeEnum = {
      kind: "enum",
      values: Array.from({ length: MAX_ENUM_VALUES + 1 }, (_, i) => `v${i}`),
    };
    expectErr(
      buildCodecSchema(hugeEnum, "t", types.isProxy),
      "BOUNDS_EXCEEDED",
    );

    // Over-deep: 17 nested objects > MAX_CONTRACT_DEPTH.
    let node: object = { kind: "boolean" };
    for (let i = 0; i < MAX_CONTRACT_DEPTH + 1; i++) {
      node = { kind: "object", exact: true, fields: { a: node } };
    }
    expectErr(buildCodecSchema(node, "t", types.isProxy), "BOUNDS_EXCEEDED");
  });

  it("refuses object contracts exceeding MAX_OBJECT_FIELDS with BOUNDS_EXCEEDED", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS + 1; i++) {
      fields[`f${i}`] = { kind: "boolean" };
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: true, fields },
        "t",
        types.isProxy,
      ),
      "BOUNDS_EXCEEDED",
    );
  });

  it("refuses contracts exceeding MAX_TOTAL_NODES with BOUNDS_EXCEEDED", () => {
    // 2-level fan-out: 1 + 64 + (64 * 64) far exceeds 512 nodes; the counter
    // must trip mid-traversal, not after.
    const leaf: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS; i++) {
      leaf[`f${i}`] = { kind: "boolean" };
    }
    const root: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS; i++) {
      root[`g${i}`] = { kind: "object", exact: true, fields: { ...leaf } };
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: true, fields: root },
        "t",
        types.isProxy,
      ),
      "BOUNDS_EXCEEDED",
    );
  });

  it("refuses unknown contract type with UNKNOWN_TYPE", () => {
    expectErr(
      buildCodecSchema({ kind: "wibble" }, "t", types.isProxy),
      "UNKNOWN_TYPE",
    );
    // Non-string kind is not a known type either.
    expectErr(
      buildCodecSchema({ kind: 42 }, "t", types.isProxy),
      "UNKNOWN_TYPE",
    );
  });

  it("refuses string without maxLength and array without maxItems with MISSING_BOUND", () => {
    expectErr(
      buildCodecSchema({ kind: "string" }, "t", types.isProxy),
      "MISSING_BOUND",
    );
    expectErr(
      buildCodecSchema(
        { kind: "array", items: { kind: "boolean" } },
        "t",
        types.isProxy,
      ),
      "MISSING_BOUND",
    );
  });

  it("refuses invalid min/max bounds and non-safe-integer length bounds with MALFORMED_CONTRACT", () => {
    // min > max on integer and number.
    expectErr(
      buildCodecSchema({ kind: "integer", min: 5, max: 3 }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "number", min: 5, max: 3 }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    // NaN / Infinity on number bounds.
    expectErr(
      buildCodecSchema({ kind: "number", min: Number.NaN }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema(
        { kind: "number", max: Number.POSITIVE_INFINITY },
        "t",
        types.isProxy,
      ),
      "MALFORMED_CONTRACT",
    );
    // Non-safe-integer bound on integer.
    expectErr(
      buildCodecSchema({ kind: "integer", min: 1.5 }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    // Present-but-invalid (non-safe-integer / non-positive) length bounds.
    expectErr(
      buildCodecSchema({ kind: "string", maxLength: 1.5 }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "string", maxLength: 0 }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema(
        { kind: "array", maxItems: -2, items: { kind: "boolean" } },
        "t",
        types.isProxy,
      ),
      "MALFORMED_CONTRACT",
    );
  });

  it("refuses unsupported nested shapes, non-exact objects, and string minLength with UNSUPPORTED_SHAPE", () => {
    for (const kind of ["union", "tuple", "record", "any", "unknown"]) {
      expectErr(
        buildCodecSchema({ kind }, "t", types.isProxy),
        "UNSUPPORTED_SHAPE",
      );
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: false, fields: { a: { kind: "boolean" } } },
        "t",
        types.isProxy,
      ),
      "UNSUPPORTED_SHAPE",
    );
    expectErr(
      buildCodecSchema(
        { kind: "string", maxLength: 5, minLength: 1 },
        "t",
        types.isProxy,
      ),
      "UNSUPPORTED_SHAPE",
    );
  });

  it("refuses a specified minLength own property with value undefined as UNSUPPORTED_SHAPE", () => {
    // readOwnDataProperty yields `undefined` for both an absent property and an
    // own data property whose value is undefined — the absence must not be
    // confused with a specified `minLength: undefined`.
    expectErr(
      buildCodecSchema(
        { kind: "string", maxLength: 5, minLength: undefined },
        "t",
        types.isProxy,
      ),
      "UNSUPPORTED_SHAPE",
    );
  });

  it("refuses non-finite numeric literal values with MALFORMED_CONTRACT", () => {
    // NaN and Infinity would render as `null` via JSON.stringify, silently
    // changing the contract's literal value and generated type.
    expectErr(
      buildCodecSchema({ kind: "literal", value: NaN }, "t", types.isProxy),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema(
        { kind: "literal", value: Infinity },
        "t",
        types.isProxy,
      ),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema(
        { kind: "literal", value: -Infinity },
        "t",
        types.isProxy,
      ),
      "MALFORMED_CONTRACT",
    );
    // Finite numbers and the other literal primitives still build.
    expect(
      buildCodecSchema({ kind: "literal", value: 1 }, "t", types.isProxy)
        .success,
    ).toBe(true);
  });

  it("bounds own-key field enumeration with BOUNDS_EXCEEDED before materializing the key list", () => {
    // Plain over-limit object: refused regardless of enumeration strategy.
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS + 1; i++) {
      fields[`f${i}`] = { kind: "boolean" };
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: true, fields },
        "t",
        types.isProxy,
      ),
      "BOUNDS_EXCEEDED",
    );

    // Mutation pin for the bounded pre-scan: the field enumeration below must
    // consult per-key descriptors (the lazy `for...in` scan), so a Proxy that
    // succeeds at ownKeys (getOwnPropertyNames) but throws on every
    // getOwnPropertyDescriptor is refused with HOSTILE_INPUT — the old
    // unmaterialized-key path reported BOUNDS_EXCEEDED without ever looking
    // at a descriptor.
    const target: Record<string, unknown> = { kind: "object", exact: true };
    const hostileFields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS + 1; i++) {
      hostileFields[`f${i}`] = { kind: "boolean" };
    }
    target.fields = new Proxy(hostileFields, {
      getOwnPropertyDescriptor() {
        throw new Error("descriptor trap");
      },
    });
    expectErr(buildCodecSchema(target, "t", types.isProxy), "HOSTILE_INPUT");
  });

  it("propagates HOSTILE_INPUT when the wrapper request property read fails instead of reporting UNKNOWN_TYPE", () => {
    // An accessor (or throwing Proxy trap) on the wrapper's `request`
    // property must surface as HOSTILE_INPUT — never fall through to
    // building the wrapper as a schema and reporting UNKNOWN_TYPE.
    let getterInvoked = false;
    const hostileWrapper: object = {
      get request() {
        getterInvoked = true;
        return { kind: "string", maxLength: 4 };
      },
    };
    const result = buildCodecSchema(hostileWrapper, "t", types.isProxy);
    expectErr(result, "HOSTILE_INPUT");
    expect(getterInvoked).toBe(false);
  });
});

describe("resolveRuntimeModule — refusals", () => {
  it("refuses malformed codec.runtimeModule with MALFORMED_RUNTIME_MODULE", () => {
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: 42 } }, types.isProxy),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "" } }, types.isProxy),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule(
        { codec: { runtimeModule: "x".repeat(257) } },
        types.isProxy,
      ),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule(
        { codec: { runtimeModule: 'evil";\nimport x from "y' } },
        types.isProxy,
      ),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "a\nb" } }, types.isProxy),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule(
        { codec: { runtimeModule: "a\u0000b" } },
        types.isProxy,
      ),
      "MALFORMED_RUNTIME_MODULE",
    );
  });

  it("refuses accessor getters and non-plain manifest.codec objects in resolveRuntimeModule with HOSTILE_INPUT", () => {
    // Accessor getter on `codec` — must be refused WITHOUT being invoked.
    let invoked = false;
    const hostileManifest: object = {
      get codec() {
        invoked = true;
        return { runtimeModule: "@fleet/shared" };
      },
    };
    expectErr(
      resolveRuntimeModule(hostileManifest, types.isProxy),
      "HOSTILE_INPUT",
    );
    expect(invoked).toBe(false);

    // Accessor on `runtimeModule` itself.
    const hostileCodec: object = {
      get runtimeModule() {
        invoked = true;
        return "@fleet/shared";
      },
    };
    expectErr(
      resolveRuntimeModule({ codec: hostileCodec }, types.isProxy),
      "HOSTILE_INPUT",
    );
    expect(invoked).toBe(false);

    // Non-plain prototype for manifest.codec.
    class CodecCfg {
      runtimeModule = "@fleet/shared";
    }
    expectErr(
      resolveRuntimeModule({ codec: new CodecCfg() }, types.isProxy),
      "HOSTILE_INPUT",
    );

    // Proxy whose descriptor trap throws.
    const throwing = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("boom");
        },
      },
    );
    expectErr(
      resolveRuntimeModule({ codec: throwing }, types.isProxy),
      "HOSTILE_INPUT",
    );
  });

  it("defaults to @fleet/shared when codec or runtimeModule is absent", () => {
    expect(resolveRuntimeModule({}, types.isProxy)).toEqual({
      success: true,
      value: "@fleet/shared",
    });
    expect(resolveRuntimeModule({ codec: {} }, types.isProxy)).toEqual({
      success: true,
      value: "@fleet/shared",
    });
  });
});

describe("readOwnDataProperty / readDenseArray — shared boundary helpers", () => {
  it("readOwnDataProperty refuses non-plain objects and returns own data values", () => {
    expectErr(
      readOwnDataProperty("nope", "a", "p", types.isProxy),
      "HOSTILE_INPUT",
    );
    expectErr(
      readOwnDataProperty(null, "a", "p", types.isProxy),
      "HOSTILE_INPUT",
    );
    expect(readOwnDataProperty({ a: 1 }, "a", "p", types.isProxy)).toEqual({
      success: true,
      value: 1,
    });
    // Absent key reads as undefined, not an error.
    expect(readOwnDataProperty({}, "missing", "p", types.isProxy)).toEqual({
      success: true,
      value: undefined,
    });
  });

  it("readDenseArray refuses accessor indexes and huge lengths before iterating", () => {
    const accessorArray: unknown[] = [1, 2];
    Object.defineProperty(accessorArray, 1, {
      get() {
        throw new Error("getter MUST NOT be invoked");
      },
    });
    expectErr(
      readDenseArray(accessorArray, 10, "p", types.isProxy),
      "HOSTILE_INPUT",
    );

    const huge: number[] = [];
    Object.defineProperty(huge, "length", { value: 1e9 });
    expectErr(readDenseArray(huge, 64, "p", types.isProxy), "BOUNDS_EXCEEDED");
  });
});

describe("buildCodecSchema — valid schemas", () => {
  it("builds a nested exact-object literal with sorted-capable fields and bounds", () => {
    const result = buildCodecSchema(
      {
        kind: "object",
        exact: true,
        fields: {
          id: { kind: "string", maxLength: 32, pattern: "^[a-z]+$" },
          qty: { kind: "integer", min: 0, max: 10 },
          tags: {
            kind: "array",
            maxItems: 8,
            items: { kind: "string", maxLength: 16 },
          },
          role: { kind: "enum", values: ["admin", "user"] },
          flag: { kind: "boolean" },
          kind: { kind: "literal", value: "order" },
          note: { kind: "nullable", of: { kind: "string", maxLength: 8 } },
          ratio: { kind: "number", min: 0, max: 1 },
        },
      },
      "t",
      types.isProxy,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.kind).toBe("object");
      if (result.value.kind === "object") {
        expect(Object.keys(result.value.fields).sort()).toEqual([
          "flag",
          "id",
          "kind",
          "note",
          "qty",
          "ratio",
          "role",
          "tags",
        ]);
      }
    }
  });

  it("unwraps a { request: <schema> } port contract wrapper", () => {
    const result = buildCodecSchema(
      { request: { kind: "string", maxLength: 4 } },
      "t",
      types.isProxy,
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.value).toEqual({ kind: "string", maxLength: 4 });
  });
});

describe("renderCodecModule — deterministic fleet-v2 output", () => {
  const schema = buildCodecSchema(
    {
      kind: "object",
      exact: true,
      fields: {
        zebra: { kind: "string", maxLength: 8 },
        alpha: { kind: "integer", min: 0 },
        mid: { kind: "enum", values: ["b", "a"] },
      },
    },
    "t",
    types.isProxy,
  );
  if (!schema.success) throw new Error("fixture schema must build");

  const input = {
    portName: "PlaceOrder",
    schemaId: "alpha.PlaceOrder",
    runtimeModule: "@fleet/shared",
    schema: schema.value,
  };

  it("renders deterministic module with @generated header, sorted keys, Validated Request type, and create<PortName>Codec(env: CodecEnv): Codec<TsType>", () => {
    const first = renderCodecModule(input);
    const second = renderCodecModule({ ...input });
    // Byte-deterministic: two renders of equal input are identical.
    expect(first).toBe(second);

    // Generated header.
    expect(first).toContain("// @generated by @hexagen/sync");

    // Only import is from the runtime module.
    const importLines = first.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain('@fleet/shared"');
    expect(importLines[0]).toContain("createCodec");

    // Validated<...> branded request type.
    expect(first).toContain("export type PlaceOrderRequest = Validated<");

    // Sorted keys (code-point order) in the emitted type AND schema literal:
    // a buggy unsorted render would place zebra before alpha.
    const alphaPos = first.indexOf("alpha");
    const midPos = first.indexOf("mid");
    const zebraPos = first.indexOf("zebra");
    expect(alphaPos).toBeGreaterThan(-1);
    expect(alphaPos).toBeLessThan(midPos);
    expect(midPos).toBeLessThan(zebraPos);
    // Same ordering in the quoted schema-literal keys.
    const litAlpha = first.indexOf('"alpha"');
    const litMid = first.indexOf('"mid"');
    const litZebra = first.indexOf('"zebra"');
    expect(litAlpha).toBeGreaterThan(-1);
    expect(litAlpha).toBeLessThan(litMid);
    expect(litMid).toBeLessThan(litZebra);

    // Factory signature matches the fleet-v2 runtime contract.
    expect(first).toContain(
      "export function createPlaceOrderCodec(env: CodecEnv): Codec<",
    );
    expect(first).toContain("createCodec<");
    expect(first).toContain('"alpha.PlaceOrder"');
    expect(first).toContain("as const satisfies CodecSchema");
  });

  it("changes output when inputs change (not a constant)", () => {
    const other = renderCodecModule({ ...input, portName: "CancelOrder" });
    expect(other).not.toBe(renderCodecModule(input));
    expect(other).toContain("CancelOrderRequest");
  });
});

describe("fix round 1 — hostile-input regressions", () => {
  it("refuses a Proxy whose getPrototypeOf trap throws with HOSTILE_INPUT instead of escaping reflection", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("getPrototypeOf trap");
        },
      },
    );

    // readOwnDataProperty: the plainness check itself must be trap-catching.
    const propResult = readOwnDataProperty(hostile, "kind", "t", types.isProxy);
    expect(propResult.success).toBe(false);
    expect((propResult as { error?: { code: string } }).error?.code).toBe(
      "HOSTILE_INPUT",
    );

    // resolveRuntimeModule: manifest reading must convert the same trap.
    const modResult = resolveRuntimeModule(hostile, types.isProxy);
    expect(modResult.success).toBe(false);
    expect((modResult as { error?: { code: string } }).error?.code).toBe(
      "HOSTILE_INPUT",
    );

    // buildCodecSchema: a throwing getPrototypeOf trap anywhere in the
    // contract tree is refused, never thrown out of the builder.
    expect(() => buildCodecSchema(hostile, "t", types.isProxy)).not.toThrow();
    const schemaResult = buildCodecSchema(hostile, "t", types.isProxy);
    expect(schemaResult.success).toBe(false);
    expect((schemaResult as { error?: { code: string } }).error?.code).toBe(
      "HOSTILE_INPUT",
    );
  });

  it("refuses a Proxy that throws only when asked for the minLength descriptor with HOSTILE_INPUT (not treated as absent)", () => {
    // A valid string schema EXCEPT the minLength descriptor read throws.
    const target: Record<string, unknown> = {
      kind: "string",
      maxLength: 8,
    };
    const hostile = new Proxy(target, {
      getOwnPropertyDescriptor(_t, key) {
        if (key === "minLength") throw new Error("minLength trap");
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    const result = buildCodecSchema(hostile, "t", types.isProxy);
    expect(result.success).toBe(false);
    expect((result as { error?: { code: string } }).error?.code).toBe(
      "HOSTILE_INPUT",
    );
  });

  it("refuses non-enumerable own field schemas with HOSTILE_INPUT (count cannot be established cheaply)", () => {
    // JSON-origin manifests never carry non-enumerable own properties, and no
    // reflection API enumerates them lazily — so the trust boundary refuses a
    // fields object carrying ANY, detected as a mismatch between the bounded
    // for...in enumerable pre-scan and the total own-key count.
    const fields: Record<string, unknown> = {
      visible: { kind: "string", maxLength: 4 },
    };
    Object.defineProperty(fields, "hidden", {
      value: { kind: "integer", min: 0, max: 5 },
      enumerable: false,
      writable: true,
      configurable: true,
    });
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: true, fields },
        "t",
        types.isProxy,
      ),
      "HOSTILE_INPUT",
    );
  });

  it("refuses a fields object exceeding MAX_OBJECT_FIELDS via non-enumerable own keys with HOSTILE_INPUT before the key list is trusted", () => {
    // > MAX_OBJECT_FIELDS non-enumerable own keys are invisible to the
    // for...in pre-scan; the pre-scan/enumerated-count comparison must refuse
    // them rather than materializing and processing the full key list.
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS + 1; i++) {
      Object.defineProperty(fields, `h${i}`, {
        value: { kind: "boolean" },
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: true, fields },
        "t",
        types.isProxy,
      ),
      "HOSTILE_INPUT",
    );
  });
});
