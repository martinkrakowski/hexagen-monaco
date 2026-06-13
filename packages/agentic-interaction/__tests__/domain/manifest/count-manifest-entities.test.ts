import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { countManifestEntities } from "../../../src/domain/manifest/count-manifest-entities";

describe("countManifestEntities", () => {
  test("counts contexts, and ports/adapters at the nested layers path", () => {
    const manifest = {
      bounded_contexts: [
        {
          name: "orders",
          layers: {
            application: {
              ports: {
                in: [{ name: "PlaceOrderPort" }],
                out: [{ name: "OrderRepositoryPort" }, { name: "PaymentPort" }],
              },
            },
            infrastructure: { adapters: [{ name: "OrderRepositoryAdapter" }] },
          },
        },
        {
          name: "billing",
          layers: {
            application: { ports: { in: [{ name: "InvoicePort" }], out: [] } },
            infrastructure: { adapters: [{ name: "A" }, { name: "B" }] },
          },
        },
      ],
    };
    assert.deepEqual(countManifestEntities(manifest), {
      contextCount: 2,
      portCount: 4, // (1 in + 2 out) + (1 in + 0 out)
      adapterCount: 3, // 1 + 2
    });
  });

  test("regression: ports/adapters at the context ROOT count 0 (they live under layers.*)", () => {
    // This is the exact shape execute-structured-config-generation's old inline
    // counter read (`ctx.ports` / `ctx.adapters`). The real manifest nests them
    // under layers.*, so a root reader always saw 0 — the bug this helper fixes.
    const rootShape = {
      bounded_contexts: [
        { ports: { in: [{ x: 1 }], out: [{ x: 2 }] }, adapters: [{ y: 1 }] },
      ],
    };
    assert.deepEqual(countManifestEntities(rootShape), {
      contextCount: 1,
      portCount: 0,
      adapterCount: 0,
    });

    // The same data at the REAL (nested) path is counted.
    const nestedShape = {
      bounded_contexts: [
        {
          layers: {
            application: { ports: { in: [{ x: 1 }], out: [{ x: 2 }] } },
            infrastructure: { adapters: [{ y: 1 }] },
          },
        },
      ],
    };
    assert.deepEqual(countManifestEntities(nestedShape), {
      contextCount: 1,
      portCount: 2,
      adapterCount: 1,
    });
  });

  test("degrades to zeros on empty / missing / malformed input (never throws)", () => {
    const zero = { contextCount: 0, portCount: 0, adapterCount: 0 };
    assert.deepEqual(countManifestEntities({}), zero);
    assert.deepEqual(countManifestEntities(undefined), zero);
    assert.deepEqual(countManifestEntities(null), zero);
    // bounded_contexts not an array
    assert.deepEqual(countManifestEntities({ bounded_contexts: "nope" }), zero);
    // ports.in not an array, missing infrastructure
    assert.deepEqual(
      countManifestEntities({
        bounded_contexts: [{ layers: { application: { ports: { in: "x" } } } }],
      }),
      { contextCount: 1, portCount: 0, adapterCount: 0 },
    );
  });
});
