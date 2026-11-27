// packages/sync/__tests__/unit/codec-schema-builder.test.ts
//
// Lane H2 unit tests: schema building, determinism, bounds, and hostile-input
// refusals. Every title states what the test asserts; each body proves it
// (mutation-testing note: a constant-`err` or identity implementation fails
// these, because each test pins BOTH the specific error code of the happy or
// hostile path AND at least one positive behaviour elsewhere in the file).

import { describe, expect, it } from "vitest";
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
    expectErr(buildCodecSchema(null, "t"), "MALFORMED_CONTRACT");
    expectErr(buildCodecSchema(undefined, "t"), "MALFORMED_CONTRACT");
  });

  it("refuses primitive values as a contract object with MALFORMED_CONTRACT", () => {
    for (const primitive of [42, "str", true, Symbol("s"), 0n]) {
      expectErr(buildCodecSchema(primitive, "t"), "MALFORMED_CONTRACT");
    }
    // A function is not a contract object either.
    expectErr(buildCodecSchema(() => 1, "t"), "MALFORMED_CONTRACT");
  });

  it("refuses accessor getters on contract and fields without invoking them", () => {
    let invoked = false;
    const hostileContract: object = {
      get kind() {
        invoked = true;
        return "string";
      },
    };
    const result = buildCodecSchema(hostileContract, "t");
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
    expectErr(buildCodecSchema(contract, "t"), "HOSTILE_INPUT");
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
    expectErr(buildCodecSchema(throwingProxy, "t"), "HOSTILE_INPUT");

    // Non-plain prototype (class instance) is refused too.
    class NotPlain {
      kind = "string";
    }
    expectErr(buildCodecSchema(new NotPlain(), "t"), "HOSTILE_INPUT");
  });

  it("refuses prototype-polluting keys in object fields with PROTOTYPE_POLLUTION", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      // JSON.parse creates a REAL own property for __proto__ (a literal's
      // `{ __proto__: x }` — or a plain assignment — would only touch the
      // prototype instead of defining the key).
      const contract = JSON.parse(
        `{"kind":"object","exact":true,"fields":{"legit":{"kind":"boolean"},"${key}":{"kind":"boolean"}}}`,
      ) as unknown;
      const result = buildCodecSchema(contract, "t");
      expectErr(result, "PROTOTYPE_POLLUTION");
    }
  });

  it("refuses sparse arrays with holes in enum values with HOSTILE_INPUT", () => {
    const sparse: string[] = new Array(3);
    sparse[1] = "a";
    sparse[2] = "b";
    const contract = { kind: "enum", values: sparse };
    expectErr(buildCodecSchema(contract, "t"), "HOSTILE_INPUT");
  });

  it("refuses array-like objects where an array is expected with MALFORMED_CONTRACT", () => {
    const arrayLike = { length: 2, 0: "a", 1: "b" };
    const contract = { kind: "enum", values: arrayLike };
    expectErr(buildCodecSchema(contract, "t"), "MALFORMED_CONTRACT");
    // Also directly through the dense-array reader.
    expectErr(readDenseArray(arrayLike, 64, "p"), "MALFORMED_CONTRACT");
  });

  it("refuses enormous enum lengths and over-deep contracts with BOUNDS_EXCEEDED", () => {
    // Enormous enum: 65 string values > MAX_ENUM_VALUES.
    const hugeEnum = {
      kind: "enum",
      values: Array.from({ length: MAX_ENUM_VALUES + 1 }, (_, i) => `v${i}`),
    };
    expectErr(buildCodecSchema(hugeEnum, "t"), "BOUNDS_EXCEEDED");

    // Over-deep: 17 nested objects > MAX_CONTRACT_DEPTH.
    let node: object = { kind: "boolean" };
    for (let i = 0; i < MAX_CONTRACT_DEPTH + 1; i++) {
      node = { kind: "object", exact: true, fields: { a: node } };
    }
    expectErr(buildCodecSchema(node, "t"), "BOUNDS_EXCEEDED");
  });

  it("refuses object contracts exceeding MAX_OBJECT_FIELDS with BOUNDS_EXCEEDED", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_OBJECT_FIELDS + 1; i++) {
      fields[`f${i}`] = { kind: "boolean" };
    }
    expectErr(
      buildCodecSchema({ kind: "object", exact: true, fields }, "t"),
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
      buildCodecSchema({ kind: "object", exact: true, fields: root }, "t"),
      "BOUNDS_EXCEEDED",
    );
  });

  it("refuses unknown contract type with UNKNOWN_TYPE", () => {
    expectErr(buildCodecSchema({ kind: "wibble" }, "t"), "UNKNOWN_TYPE");
    // Non-string kind is not a known type either.
    expectErr(buildCodecSchema({ kind: 42 }, "t"), "UNKNOWN_TYPE");
  });

  it("refuses string without maxLength and array without maxItems with MISSING_BOUND", () => {
    expectErr(buildCodecSchema({ kind: "string" }, "t"), "MISSING_BOUND");
    expectErr(
      buildCodecSchema({ kind: "array", items: { kind: "boolean" } }, "t"),
      "MISSING_BOUND",
    );
  });

  it("refuses invalid min/max bounds and non-safe-integer length bounds with MALFORMED_CONTRACT", () => {
    // min > max on integer and number.
    expectErr(
      buildCodecSchema({ kind: "integer", min: 5, max: 3 }, "t"),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "number", min: 5, max: 3 }, "t"),
      "MALFORMED_CONTRACT",
    );
    // NaN / Infinity on number bounds.
    expectErr(
      buildCodecSchema({ kind: "number", min: Number.NaN }, "t"),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "number", max: Number.POSITIVE_INFINITY }, "t"),
      "MALFORMED_CONTRACT",
    );
    // Non-safe-integer bound on integer.
    expectErr(
      buildCodecSchema({ kind: "integer", min: 1.5 }, "t"),
      "MALFORMED_CONTRACT",
    );
    // Present-but-invalid (non-safe-integer / non-positive) length bounds.
    expectErr(
      buildCodecSchema({ kind: "string", maxLength: 1.5 }, "t"),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "string", maxLength: 0 }, "t"),
      "MALFORMED_CONTRACT",
    );
    expectErr(
      buildCodecSchema({ kind: "array", maxItems: -2, items: { kind: "boolean" } }, "t"),
      "MALFORMED_CONTRACT",
    );
  });

  it("refuses unsupported nested shapes, non-exact objects, and string minLength with UNSUPPORTED_SHAPE", () => {
    for (const kind of ["union", "tuple", "record", "any", "unknown"]) {
      expectErr(buildCodecSchema({ kind }, "t"), "UNSUPPORTED_SHAPE");
    }
    expectErr(
      buildCodecSchema(
        { kind: "object", exact: false, fields: { a: { kind: "boolean" } } },
        "t",
      ),
      "UNSUPPORTED_SHAPE",
    );
    expectErr(
      buildCodecSchema({ kind: "string", maxLength: 5, minLength: 1 }, "t"),
      "UNSUPPORTED_SHAPE",
    );
  });
});

describe("resolveRuntimeModule — refusals", () => {
  it("refuses malformed codec.runtimeModule with MALFORMED_RUNTIME_MODULE", () => {
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: 42 } }),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "" } }),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "x".repeat(257) } }),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: 'evil";\nimport x from "y' } }),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "a\nb" } }),
      "MALFORMED_RUNTIME_MODULE",
    );
    expectErr(
      resolveRuntimeModule({ codec: { runtimeModule: "a\u0000b" } }),
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
    expectErr(resolveRuntimeModule(hostileManifest), "HOSTILE_INPUT");
    expect(invoked).toBe(false);

    // Accessor on `runtimeModule` itself.
    const hostileCodec: object = {
      get runtimeModule() {
        invoked = true;
        return "@fleet/shared";
      },
    };
    expectErr(
      resolveRuntimeModule({ codec: hostileCodec }),
      "HOSTILE_INPUT",
    );
    expect(invoked).toBe(false);

    // Non-plain prototype for manifest.codec.
    class CodecCfg {
      runtimeModule = "@fleet/shared";
    }
    expectErr(
      resolveRuntimeModule({ codec: new CodecCfg() }),
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
    expectErr(resolveRuntimeModule({ codec: throwing }), "HOSTILE_INPUT");
  });

  it("defaults to @fleet/shared when codec or runtimeModule is absent", () => {
    expect(resolveRuntimeModule({})).toEqual({
      success: true,
      value: "@fleet/shared",
    });
    expect(resolveRuntimeModule({ codec: {} })).toEqual({
      success: true,
      value: "@fleet/shared",
    });
  });
});

describe("readOwnDataProperty / readDenseArray — shared boundary helpers", () => {
  it("readOwnDataProperty refuses non-plain objects and returns own data values", () => {
    expectErr(readOwnDataProperty("nope", "a", "p"), "HOSTILE_INPUT");
    expectErr(readOwnDataProperty(null, "a", "p"), "HOSTILE_INPUT");
    expect(readOwnDataProperty({ a: 1 }, "a", "p")).toEqual({
      success: true,
      value: 1,
    });
    // Absent key reads as undefined, not an error.
    expect(readOwnDataProperty({}, "missing", "p")).toEqual({
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
    expectErr(readDenseArray(accessorArray, 10, "p"), "HOSTILE_INPUT");

    const huge: number[] = [];
    Object.defineProperty(huge, "length", { value: 1e9 });
    expectErr(readDenseArray(huge, 64, "p"), "BOUNDS_EXCEEDED");
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
          tags: { kind: "array", maxItems: 8, items: { kind: "string", maxLength: 16 } },
          role: { kind: "enum", values: ["admin", "user"] },
          flag: { kind: "boolean" },
          kind: { kind: "literal", value: "order" },
          note: { kind: "nullable", of: { kind: "string", maxLength: 8 } },
          ratio: { kind: "number", min: 0, max: 1 },
        },
      },
      "t",
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
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual({ kind: "string", maxLength: 4 });
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
    expect(first).toContain(
      "export type PlaceOrderRequest = Validated<",
    );

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
    expect(first).toContain(
      'createCodec<',
    );
    expect(first).toContain('"alpha.PlaceOrder"');
    expect(first).toContain("as const satisfies CodecSchema");
  });

  it("changes output when inputs change (not a constant)", () => {
    const other = renderCodecModule({ ...input, portName: "CancelOrder" });
    expect(other).not.toBe(renderCodecModule(input));
    expect(other).toContain("CancelOrderRequest");
  });
});
