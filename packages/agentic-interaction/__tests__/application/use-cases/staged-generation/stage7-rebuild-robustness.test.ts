import { test, describe } from "vitest";
import assert from "node:assert";
import {
  coercePortName,
  collectMalformedManifestEntries,
  buildPreDefinedPortMap,
} from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

// Stage-7 production failure: gpt-4o, told to repair port TYPES, emitted ports as
// typed objects (`{ name, type }`) instead of the manifest's bare name strings.
// The rebuild did `name.toLowerCase()` on each entry → threw → the bare `catch {}`
// reported the generic "not a valid manifest" and the repair NEVER applied. These
// pin the coercion (salvage the name) + discard reporting (don't drop silently).

describe("coercePortName — salvage a name from either shape", () => {
  test("bare string passes through (trimmed)", () => {
    assert.strictEqual(
      coercePortName("UserRepositoryPort"),
      "UserRepositoryPort",
    );
    assert.strictEqual(coercePortName("  Spaced  "), "Spaced");
  });

  test("typed object → its name (the prod failure shape)", () => {
    assert.strictEqual(
      coercePortName({ name: "InvoiceRepositoryPort", type: "repository" }),
      "InvoiceRepositoryPort",
    );
    assert.strictEqual(coercePortName({ name: "OrderPort" }), "OrderPort");
  });

  test("genuinely un-nameable → null (caller discards + reports)", () => {
    assert.strictEqual(coercePortName({ type: "repository" }), null);
    assert.strictEqual(coercePortName({ name: "" }), null);
    assert.strictEqual(coercePortName({ name: 123 }), null);
    assert.strictEqual(coercePortName(123), null);
    assert.strictEqual(coercePortName(null), null);
    assert.strictEqual(coercePortName(""), null);
  });
});

// `out` is intentionally `unknown` so a test can pass a non-array slot (scalar /
// object) — the very shapes a repair model emits that used to throw the rebuild.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const manifest = (out: unknown): any => ({
  bounded_contexts: [
    {
      name: "billing",
      layers: {
        application: { ports: { in: ["SubmitInvoicePort"], out } },
        infrastructure: { adapters: [] },
      },
    },
  ],
});

describe("buildPreDefinedPortMap — tolerant rebuild", () => {
  test("a typed-object port is coerced to its name instead of throwing (the regression)", () => {
    const portMap = buildPreDefinedPortMap(
      manifest([
        { name: "InvoiceRepositoryPort", type: "repository" },
        "PaymentPublisherPort",
      ]),
    );
    const out = portMap.contexts[0].out;
    assert.deepStrictEqual(
      out.map((p) => p.name),
      ["InvoiceRepositoryPort", "PaymentPublisherPort"],
    );
    // Type is still inferred from the coerced NAME.
    assert.strictEqual(out[0].type, "repository");
    assert.strictEqual(out[1].type, "publisher");
  });

  test("an un-nameable entry is dropped (not crashed on)", () => {
    const portMap = buildPreDefinedPortMap(
      manifest(["UserRepositoryPort", { type: "repository" }]),
    );
    assert.deepStrictEqual(
      portMap.contexts[0].out.map((p) => p.name),
      ["UserRepositoryPort"],
    );
  });

  test("a scalar (non-list) port slot is salvaged as a single-element list, not thrown on", () => {
    const portMap = buildPreDefinedPortMap(manifest("InvoiceRepositoryPort"));
    assert.deepStrictEqual(
      portMap.contexts[0].out.map((p) => p.name),
      ["InvoiceRepositoryPort"],
    );
  });

  test("an object (wrong-shape) port slot yields no out-ports instead of throwing", () => {
    const portMap = buildPreDefinedPortMap(manifest({ weird: 1 }));
    assert.deepStrictEqual(portMap.contexts[0].out, []);
  });
});

describe("collectMalformedManifestEntries — report, don't silently drop", () => {
  test("salvageable typed objects are NOT reported; un-nameable entries ARE", () => {
    const malformed = collectMalformedManifestEntries(
      manifest([
        { name: "InvoiceRepositoryPort", type: "repository" }, // salvageable
        "PaymentPublisherPort", // fine
        { type: "repository" }, // un-nameable → must be reported
      ]),
    );
    assert.strictEqual(malformed.length, 1);
    assert.strictEqual(malformed[0].context, "billing");
    assert.strictEqual(malformed[0].kind, "out-port");
  });

  test("a fully bare-name manifest reports nothing", () => {
    const malformed = collectMalformedManifestEntries(
      manifest(["UserRepositoryPort"]),
    );
    assert.deepStrictEqual(malformed, []);
  });

  test("a wrong-shape (object) port slot is REPORTED, not thrown on (for…of safety)", () => {
    const malformed = collectMalformedManifestEntries(manifest({ weird: 1 }));
    assert.strictEqual(malformed.length, 1);
    assert.strictEqual(malformed[0].context, "billing");
    assert.strictEqual(malformed[0].kind, "out-port");
  });

  test("a scalar (recoverable) port slot is NOT reported", () => {
    assert.deepStrictEqual(
      collectMalformedManifestEntries(manifest("InvoiceRepositoryPort")),
      [],
    );
  });
});
