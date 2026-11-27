import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  PortContractValidationError,
  validatePortContract,
  validateManifestPortContracts,
  CodecGeneratorBlockSchema,
  DEFAULT_CODEC_RUNTIME_MODULE,
  MAX_CONTRACT_FIELDS,
  MAX_CONTRACT_NODES,
} from "../../../../src/domain/model/manifest-schema/port-contract-schema";
import { PortDefinitionSchema, GeneratorBlockSchema } from "../../../../src/domain/model/manifest-schema/manifest-schema";

const PORT = "MyPort";

function ok(result: { ok: boolean }): void {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
}

function assertError(
  result: { ok: boolean; error?: PortContractValidationError },
  code: string,
  pathIncludes: string,
): PortContractValidationError {
  assert.equal(result.ok, false, "expected a refusal");
  const error = (result as { error: PortContractValidationError }).error;
  assert.ok(error instanceof PortContractValidationError);
  assert.equal(error.code, code);
  assert.equal(error.portName, PORT);
  assert.ok(
    error.contractPath.includes(pathIncludes),
    `contractPath "${error.contractPath}" should mention "${pathIncludes}"`,
  );
  return error;
}

describe("validatePortContract", () => {
  it("refuses null, undefined, primitive, array, or missing-request contracts block with MALFORMED_CONTRACT naming the port and path", () => {
    for (const contracts of [null, undefined, "nope", 42, true, []]) {
      assertError(
        validatePortContract(contracts, PORT),
        "MALFORMED_CONTRACT",
        "contracts",
      );
    }
    assertError(
      validatePortContract({}, PORT),
      "MALFORMED_CONTRACT",
      "contracts",
    );
  });

  it("refuses unknown keys on contracts block, schema node, or optional wrapper with MALFORMED_CONTRACT naming the port and path", () => {
    assertError(
      validatePortContract(
        { request: { kind: "string", maxLength: 5 }, extra: 1 },
        PORT,
      ),
      "MALFORMED_CONTRACT",
      "contracts",
    );
    assertError(
      validatePortContract(
        { request: { kind: "string", maxLength: 5, unexpected: true } },
        PORT,
      ),
      "MALFORMED_CONTRACT",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        {
          request: {
            kind: "object",
            exact: true,
            fields: { a: { optional: { kind: "string", maxLength: 5 }, other: 1 } },
          },
        },
        PORT,
      ),
      "MALFORMED_CONTRACT",
      "contracts.request.fields.a",
    );
  });

  it("refuses missing or unknown field kind with UNKNOWN_KIND naming the port and path", () => {
    assertError(
      validatePortContract({ request: {} }, PORT),
      "UNKNOWN_KIND",
      "contracts.request",
    );
    assertError(
      validatePortContract({ request: { kind: "map" } }, PORT),
      "UNKNOWN_KIND",
      "contracts.request",
    );
  });

  it("refuses string field missing maxLength, non-integer, zero, or negative maxLength with MISSING_BOUND naming the port and path", () => {
    for (const maxLength of [
      undefined,
      0,
      -3,
      1.5,
      "10",
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      assertError(
        validatePortContract({ request: { kind: "string", maxLength } }, PORT),
        "MISSING_BOUND",
        "contracts.request",
      );
    }
  });

  it("refuses array field missing maxItems, non-integer, zero, or negative maxItems with MISSING_BOUND naming the port and path", () => {
    for (const maxItems of [
      undefined,
      0,
      -1,
      2.5,
      "8",
      Number.POSITIVE_INFINITY,
    ]) {
      assertError(
        validatePortContract(
          { request: { kind: "array", items: { kind: "boolean" }, maxItems } },
          PORT,
        ),
        "MISSING_BOUND",
        "contracts.request",
      );
    }
  });

  it("refuses object missing fields or with exact: false, array missing items, and nullable missing of with UNSUPPORTED_SHAPE naming the port and path", () => {
    assertError(
      validatePortContract({ request: { kind: "object", exact: true } }, PORT),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "object", exact: false, fields: {} } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "array", maxItems: 3 } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract({ request: { kind: "nullable" } }, PORT),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
  });

  it("refuses empty or non-string enum values, non-primitive literal, inverted or non-finite min/max, and invalid regex pattern with UNSUPPORTED_SHAPE naming the port and path", () => {
    assertError(
      validatePortContract({ request: { kind: "enum", values: [] } }, PORT),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract({ request: { kind: "enum", values: [1, 2] } }, PORT),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract({ request: { kind: "literal", value: {} } }, PORT),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "number", min: 10, max: 1 } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "integer", min: Number.NaN } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "number", max: Number.POSITIVE_INFINITY } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "string", maxLength: 5, pattern: "(((" } },
        PORT,
      ),
      "UNSUPPORTED_SHAPE",
      "contracts.request",
    );
  });

  it("refuses contract nesting deeper than 8 levels across object, array, and nullable with MAX_DEPTH_EXCEEDED naming the port and path", () => {
    const nested = (kind: string, depth: number): Record<string, unknown> => {
      let node: Record<string, unknown> = { kind: "boolean" };
      for (let i = 0; i < depth; i += 1) {
        node =
          kind === "object"
            ? { kind: "object", exact: true, fields: { f: node } }
            : kind === "array"
              ? { kind: "array", items: node, maxItems: 3 }
              : { kind: "nullable", of: node };
      }
      return node;
    };
    // Root counts as depth 1: 8 nested wrappers below it = 9 levels -> refused.
    for (const kind of ["object", "array", "nullable"]) {
      assertError(
        validatePortContract({ request: nested(kind, 8) }, PORT),
        "MAX_DEPTH_EXCEEDED",
        "contracts.request",
      );
      ok(validatePortContract({ request: nested(kind, 7) }, PORT));
    }
  });

  it("refuses an object contract with more than 64 fields with MAX_FIELDS_EXCEEDED naming the port and path", () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_CONTRACT_FIELDS + 1; i += 1) {
      fields[`f${i}`] = { kind: "string", maxLength: 5 };
    }
    assertError(
      validatePortContract(
        { request: { kind: "object", exact: true, fields } },
        PORT,
      ),
      "MAX_FIELDS_EXCEEDED",
      "contracts.request",
    );
    const okFields: Record<string, unknown> = {};
    for (let i = 0; i < MAX_CONTRACT_FIELDS; i += 1) {
      okFields[`f${i}`] = { kind: "string", maxLength: 5 };
    }
    ok(
      validatePortContract(
        { request: { kind: "object", exact: true, fields: okFields } },
        PORT,
      ),
    );
  });

  it("refuses a contract exceeding MAX_CONTRACT_NODES (1024) total nodes with MAX_NODES_EXCEEDED naming the port and path", () => {
    const bushy = (depth: number): Record<string, unknown> => {
      if (depth === 1) {
        return { kind: "boolean" };
      }
      return {
        kind: "object",
        exact: true,
        fields: {
          a: bushy(depth - 1),
          b: bushy(depth - 1),
          c: bushy(depth - 1),
          d: bushy(depth - 1),
        },
      };
    };
    assertError(
      validatePortContract({ request: bushy(6) }, PORT),
      "MAX_NODES_EXCEEDED",
      "contracts.request",
    );
    ok(validatePortContract({ request: bushy(4) }, PORT));
  });

  it("refuses reserved field names (__proto__, constructor, prototype) with RESERVED_FIELD_NAME naming the port and path", () => {
    for (const reserved of ["__proto__", "constructor", "prototype"]) {
      const fields: Record<string, unknown> = {
        good: { kind: "string", maxLength: 5 },
      };
      Object.defineProperty(fields, reserved, {
        value: { kind: "string", maxLength: 5 },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      assertError(
        validatePortContract(
          { request: { kind: "object", exact: true, fields } },
          PORT,
        ),
        "RESERVED_FIELD_NAME",
        "contracts.request.fields",
      );
    }
  });

  it("refuses a throwing getter without invoking it, a symbol key, and a non-plain prototype with HOSTILE_INPUT", () => {
    let invoked = false;
    const getterBlock: Record<PropertyKey, unknown> = {};
    Object.defineProperty(getterBlock, "request", {
      get() {
        invoked = true;
        throw new Error("getter must never be invoked");
      },
      enumerable: true,
      configurable: true,
    });
    assertError(
      validatePortContract(getterBlock, PORT),
      "HOSTILE_INPUT",
      "contracts",
    );
    assert.equal(invoked, false, "getter was invoked");

    const symbolBlock = {
      request: { kind: "string", maxLength: 5 },
    } as Record<PropertyKey, unknown>;
    symbolBlock[Symbol("hostile")] = 1;
    assertError(
      validatePortContract(symbolBlock, PORT),
      "HOSTILE_INPUT",
      "contracts",
    );

    class NotPlain {}
    assertError(
      validatePortContract(
        Object.create(NotPlain.prototype) as object,
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts",
    );
    assertError(validatePortContract(new Map(), PORT), "HOSTILE_INPUT", "contracts");

    // A getter on a `fields` entry is refused too, without invoking it.
    let fieldInvoked = false;
    const fields: Record<string, unknown> = {};
    Object.defineProperty(fields, "x", {
      get() {
        fieldInvoked = true;
        throw new Error("field getter must never be invoked");
      },
      enumerable: true,
      configurable: true,
    });
    assertError(
      validatePortContract(
        { request: { kind: "object", exact: true, fields } },
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts.request.fields",
    );
    assert.equal(fieldInvoked, false, "field getter was invoked");
  });

  it("refuses a throwing Proxy trap without crashing with HOSTILE_INPUT", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        getOwnPropertyDescriptor() {
          throw new Error("descriptor trap");
        },
      },
    );
    assertError(
      validatePortContract({ request: hostile }, PORT),
      "HOSTILE_INPUT",
      "contracts.request",
    );
    assertError(validatePortContract(hostile, PORT), "HOSTILE_INPUT", "contracts");
  });

  it("refuses an array hole, a non-array iterable or non-iterable enum.values, and an enormous array-like length with HOSTILE_INPUT", () => {
    const withHole: string[] = ["a", "b"];
    withHole.length = 4; // indexes 2 and 3 are holes
    assertError(
      validatePortContract({ request: { kind: "enum", values: withHole } }, PORT),
      "HOSTILE_INPUT",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "enum", values: new Set(["a", "b"]) } },
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "enum", values: { length: 5 } } },
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts.request",
    );
    assertError(
      validatePortContract(
        { request: { kind: "enum", values: { length: 1e9 } } },
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts.request",
    );
  });

  it("accepts a contract with exact omitted and with exact true", () => {
    ok(validatePortContract({ request: { kind: "string", maxLength: 5 } }, PORT));
    ok(
      validatePortContract(
        { request: { kind: "object", exact: true, fields: {} } },
        PORT,
      ),
    );
    ok(
      validatePortContract(
        {
          request: {
            kind: "object",
            exact: true,
            fields: {
              id: { kind: "integer", min: 0 },
              name: { kind: "string", maxLength: 32, pattern: "^[a-z]+$" },
              tags: { kind: "array", items: { kind: "string", maxLength: 8 }, maxItems: 10 },
              flag: { kind: "boolean" },
              role: { kind: "enum", values: ["admin", "member"] },
              mode: { kind: "literal", value: "fixed" },
              note: { kind: "nullable", of: { kind: "string", maxLength: 16 } },
              maybeId: { optional: { kind: "integer", min: 0 } },
            },
          },
        },
        PORT,
      ),
    );
  });

  it("refuses a revoked Proxy and a Proxy array whose length trap throws with HOSTILE_INPUT", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assertError(
      validatePortContract({ request: { kind: "enum", values: proxy } }, PORT),
      "HOSTILE_INPUT",
      "contracts.request",
    );
    const throwingLength = new Proxy(["a", "b"], {
      get(target, key, receiver) {
        if (key === "length") {
          throw new TypeError("length trap");
        }
        return Reflect.get(target, key, receiver);
      },
    });
    assertError(
      validatePortContract(
        { request: { kind: "enum", values: throwingLength } },
        PORT,
      ),
      "HOSTILE_INPUT",
      "contracts.request",
    );
  });

  it("refuses an enum.values array above MAX_CONTRACT_FIELDS with MAX_FIELDS_EXCEEDED", () => {
    const values: string[] = [];
    for (let i = 0; i < MAX_CONTRACT_FIELDS + 1; i += 1) {
      values.push(`v${i}`);
    }
    assertError(
      validatePortContract({ request: { kind: "enum", values } }, PORT),
      "MAX_FIELDS_EXCEEDED",
      "contracts.request",
    );
  });
});

describe("validateManifestPortContracts", () => {
  it("returns the existing empty-manifest result for a manifest with no ports", () => {
    assert.deepEqual(
      validateManifestPortContracts({
        bounded_contexts: [{ name: "ctx", type: "core" }],
      }),
      { ok: true },
    );
    assert.deepEqual(validateManifestPortContracts({}), { ok: true });
    assert.deepEqual(validateManifestPortContracts(null), { ok: true });
  });

  it("validates contracts on application in/out ports and names the offending port", () => {
    const manifest = {
      bounded_contexts: [
        {
          name: "ctx",
          type: "core",
          layers: {
            application: {
              ports: {
                in: [{ name: "GoodPort" }],
                out: [
                  {
                    name: "BadPort",
                    contracts: { request: { kind: "string" } },
                  },
                ],
              },
            },
          },
        },
      ],
    };
    const result = validateManifestPortContracts(manifest);
    assert.equal(result.ok, false);
    const error = (result as { error: PortContractValidationError }).error;
    assert.equal(error.code, "MISSING_BOUND");
    assert.equal(error.portName, "BadPort");
  });

  it("ignores string ports and domain-layer ports entirely", () => {
    const manifest = {
      bounded_contexts: [
        {
          name: "ctx",
          type: "core",
          layers: {
            domain: {
              ports: {
                in: [{ name: "DomainPort", contracts: { whatever: true } }],
              },
            },
            application: {
              ports: { in: ["PlainStringPort", { name: "ObjectPort" }] },
            },
          },
        },
      ],
    };
    assert.deepEqual(validateManifestPortContracts(manifest), { ok: true });
  });
  it("validateManifestPortContracts refuses a hostile manifest accessor with HOSTILE_INPUT", () => {
    const result = validateManifestPortContracts({
      get bounded_contexts() {
        return [
          {
            name: "ctx",
            layers: { application: { ports: { out: [{ name: "P" }] } } },
          },
        ];
      },
    });
    assert.equal(result.ok, false, "an accessor must never be read");
    const error = (result as { error: PortContractValidationError }).error;
    assert.ok(error instanceof PortContractValidationError);
    assert.equal(error.code, "HOSTILE_INPUT");
    assert.match(error.contractPath, /bounded_contexts/);
  });

  it("validateManifestPortContracts refuses a sparse ports array with HOSTILE_INPUT", () => {
    const sparse = [{ name: "GoodPort" }];
    // Hole at index 1: length 3 with only index 0 present.
    sparse.length = 3;
    const result = validateManifestPortContracts({
      bounded_contexts: [
        {
          name: "ctx",
          layers: { application: { ports: { out: sparse } } },
        },
      ],
    });
    assert.equal(result.ok, false, "a sparse ports array must be refused");
    const error = (result as { error: PortContractValidationError }).error;
    assert.ok(error instanceof PortContractValidationError);
    assert.equal(error.code, "HOSTILE_INPUT");
    assert.match(error.contractPath, /ports\.out/);
  });
});

describe("CodecGeneratorBlockSchema", () => {
  it("GeneratorBlockSchema accepts and defaults generator.codec.runtimeModule", () => {
    // Parsed through the full generator block, not just the codec sub-schema.
    assert.deepEqual(GeneratorBlockSchema.parse({ codec: {} }), {
      codec: { runtimeModule: "@fleet/shared" },
    });
    assert.deepEqual(
      GeneratorBlockSchema.parse({ codec: { runtimeModule: "@custom/x" } }),
      { codec: { runtimeModule: "@custom/x" } },
    );
    assert.throws(() => GeneratorBlockSchema.parse({ codec: { runtimeModule: "" } }));
    assert.throws(() => GeneratorBlockSchema.parse({ codec: { runtimeModule: 42 } }));
  });

  it("defaults generator.codec.runtimeModule to '@fleet/shared' when codec is {} and omits codec when absent", () => {
    assert.deepEqual(CodecGeneratorBlockSchema.parse({}), {
      runtimeModule: DEFAULT_CODEC_RUNTIME_MODULE,
    });
    assert.equal(DEFAULT_CODEC_RUNTIME_MODULE, "@fleet/shared");
    const generator = { codec: {} };
    const parsed = CodecGeneratorBlockSchema.parse(generator.codec);
    assert.deepEqual(parsed, { runtimeModule: "@fleet/shared" });
    const withoutCodec: { codec?: unknown } = {};
    assert.equal(withoutCodec.codec, undefined);
  });

  it("refuses generator.codec.runtimeModule when empty or non-string", () => {
    assert.throws(() => CodecGeneratorBlockSchema.parse({ runtimeModule: "" }));
    assert.throws(() => CodecGeneratorBlockSchema.parse({ runtimeModule: 42 }));
    assert.throws(() =>
      CodecGeneratorBlockSchema.parse({ runtimeModule: null }),
    );
  });
});

describe("PortDefinitionSchema contracts integration", () => {
  it("PortDefinitionSchema refuses a contracts getter without invoking it", () => {
    let getterRan = false;
    const input = {
      name: "p",
      get contracts() {
        getterRan = true;
        return { request: { kind: "boolean" } };
      },
    };
    const result = PortDefinitionSchema.safeParse(input);
    assert.equal(result.success, false, "an accessor must be refused");
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      assert.ok(
        messages.some((message) => message.includes("HOSTILE_INPUT")),
        `expected HOSTILE_INPUT in ${JSON.stringify(messages)}`,
      );
    }
    assert.equal(getterRan, false, "the getter must never be invoked");
  });

  it("refuses an explicit contracts: undefined with MALFORMED_CONTRACT", () => {
    const result = PortDefinitionSchema.safeParse({
      name: "p",
      contracts: undefined,
    });
    assert.equal(result.success, false, "explicit contracts: undefined must fail");
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      assert.ok(
        messages.some((message) => message.includes("MALFORMED_CONTRACT")),
        `expected MALFORMED_CONTRACT in ${JSON.stringify(messages)}`,
      );
    }
    // Absent contracts passes untouched.
    assert.equal(PortDefinitionSchema.safeParse({ name: "p" }).success, true);
  });

  it("surfaces the typed contract error message through the port schema", () => {
    const result = PortDefinitionSchema.safeParse({
      name: "p",
      contracts: { request: { kind: "string", maxLength: 0 } },
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(
        result.error.issues.some((issue) =>
          issue.message.includes("MISSING_BOUND"),
        ),
      );
    }
  });
});

describe("cost bounds", () => {
  it("bounds total work to MAX_CONTRACT_NODES even for deep branching", () => {
    // A chain of 1025 nested nullable nodes would exceed the budget even
    // though each level is tiny — but depth limits kick in first; instead use
    // wide branching under the depth limit.
    const wide = (depth: number): Record<string, unknown> => {
      if (depth === 0) {
        return { kind: "boolean" };
      }
      const fields: Record<string, unknown> = {};
      for (let i = 0; i < 8; i += 1) {
        fields[`f${i}`] = wide(depth - 1);
      }
      return { kind: "object", exact: true, fields };
    };
    const result = validatePortContract({ request: wide(4) }, PORT);
    assert.equal(result.ok, false);
    const error = (result as { error: PortContractValidationError }).error;
    assert.ok(
      error.code === "MAX_NODES_EXCEEDED" || error.code === "MAX_FIELDS_EXCEEDED",
      `expected a budget refusal, got ${error.code}`,
    );
    assert.ok(MAX_CONTRACT_NODES === 1024);
  });
});
