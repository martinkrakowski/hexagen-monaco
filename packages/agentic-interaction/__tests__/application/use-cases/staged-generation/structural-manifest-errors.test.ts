import { describe, it } from "node:test";
import assert from "node:assert";
import { structuralManifestErrors } from "../../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import type {
  PortMap,
  AdapterBindings,
} from "../../../../src/domain/value-objects/pipeline-state";

// ── Helpers ──────────────────────────────────────────────────────────────────

function portMap(
  contexts: Array<{
    name: string;
    in?: string[];
    out?: string[];
    outTypes?: string[];
  }>,
): PortMap {
  return {
    contexts: contexts.map((ctx) => ({
      contextName: ctx.name,
      in: (ctx.in ?? []).map((n) => ({
        name: n,
        type: "command" as const,
        description: n,
      })),
      out: (ctx.out ?? []).map((n, i) => ({
        name: n,
        type: (ctx.outTypes?.[i] ?? "repository") as "repository",
        description: n,
      })),
    })),
  };
}

function adapterBindings(
  contexts: Array<{
    name: string;
    adapters: Array<{ name: string; implements: string }>;
  }>,
): AdapterBindings {
  return {
    contexts: contexts.map((ctx) => ({
      contextName: ctx.name,
      adapters: ctx.adapters.map((a) => ({
        name: a.name,
        type: "adapter",
        implements: a.implements,
      })),
    })),
  };
}

function parsedManifest(opts?: {
  system?: string;
  scope?: string;
  contexts?: Array<{ name: string; type?: string; depends_on?: string[] }>;
}): Record<string, unknown> {
  return {
    system: opts?.system ?? "my-system",
    scope: opts?.scope ?? "core",
    bounded_contexts: (opts?.contexts ?? []).map((c) => ({
      name: c.name,
      type: c.type ?? "bounded-context",
      ...(c.depends_on ? { depends_on: c.depends_on } : {}),
    })),
  };
}

// ── R01 (banned context name) ────────────────────────────────────────────────

describe("structuralManifestErrors — R01 banned context name", () => {
  it("no error for a clean name", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "billing",
          in: ["CreateInvoicePort"],
          out: ["InvoiceRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "billing",
          adapters: [
            { name: "CreateInvoiceAdapter", implements: "CreateInvoicePort" },
            { name: "InvoiceRepoAdapter", implements: "InvoiceRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "billing" }] }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R01]")));
  });

  it("R01 for a context name containing 'gateway'", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "payment-gateway",
          in: ["CreatePaymentPort"],
          out: ["PaymentRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "payment-gateway",
          adapters: [
            { name: "A", implements: "CreatePaymentPort" },
            { name: "B", implements: "PaymentRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "payment-gateway" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R01]")));
  });
});

// ── R02 (no inbound port) ────────────────────────────────────────────────────

describe("structuralManifestErrors — R02 no inbound port", () => {
  it("R02 when in array is empty", () => {
    const errs = structuralManifestErrors(
      portMap([{ name: "orders", in: [], out: ["OrderRepositoryPort"] }]),
      adapterBindings([
        {
          name: "orders",
          adapters: [{ name: "A", implements: "OrderRepositoryPort" }],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R02]")));
  });

  it("no R02 for shared-kernel with no ports (R09 territory)", () => {
    const errs = structuralManifestErrors(
      portMap([{ name: "shared", in: [], out: [] }]),
      adapterBindings([]),
      parsedManifest({ contexts: [{ name: "shared", type: "shared-kernel" }] }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R02]")));
  });
});

// ── R03 (no repository port) ─────────────────────────────────────────────────

describe("structuralManifestErrors — R03 no outbound repository port", () => {
  it("R03 when out has only a publisher port", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderEventPublisherPort"],
          outTypes: ["publisher"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderEventPublisherPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R03]")));
  });

  it("no R03 when a repository port is present", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R03]")));
  });
});

// ── R04 / R05 (missing adapters) ─────────────────────────────────────────────

describe("structuralManifestErrors — R04/R05 port has wrong adapter count", () => {
  it("R05 when an inbound port has no adapter", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [{ name: "B", implements: "OrderRepositoryPort" }],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R05]")));
    assert.ok(!errs.some((e) => e.startsWith("[R04]")));
  });

  it("R04 when an outbound port has no adapter", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [{ name: "A", implements: "PlaceOrderPort" }],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R04]")));
    assert.ok(!errs.some((e) => e.startsWith("[R05]")));
  });

  it("R05 when an inbound port has two adapters (≠ 1)", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "PlaceOrderPort" },
            { name: "C", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R05]")));
  });

  it("no R04/R05 when every port has exactly one adapter", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ contexts: [{ name: "orders" }] }),
    );
    assert.ok(
      !errs.some((e) => e.startsWith("[R04]") || e.startsWith("[R05]")),
    );
  });
});

// ── R06 (cross-context implements) ───────────────────────────────────────────

describe("structuralManifestErrors — R06 cross-context implements", () => {
  it("R06 when an adapter implements a port from another context", () => {
    const pm = portMap([
      {
        name: "billing",
        in: ["CreateInvoicePort"],
        out: ["InvoiceRepositoryPort"],
      },
      { name: "notification", in: ["SendNotificationPort"], out: [] },
    ]);
    const ab = adapterBindings([
      {
        name: "billing",
        adapters: [
          // "implements" points to notification's port — cross-context violation
          { name: "A", implements: "SendNotificationPort" },
          { name: "B", implements: "InvoiceRepositoryPort" },
        ],
      },
      {
        name: "notification",
        adapters: [{ name: "C", implements: "SendNotificationPort" }],
      },
    ]);
    const errs = structuralManifestErrors(
      pm,
      ab,
      parsedManifest({
        contexts: [{ name: "billing" }, { name: "notification" }],
      }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R06]")));
  });

  it("no R06 when all adapters implement ports in their own context", () => {
    const pm = portMap([
      {
        name: "billing",
        in: ["CreateInvoicePort"],
        out: ["InvoiceRepositoryPort"],
      },
    ]);
    const ab = adapterBindings([
      {
        name: "billing",
        adapters: [
          { name: "A", implements: "CreateInvoicePort" },
          { name: "B", implements: "InvoiceRepositoryPort" },
        ],
      },
    ]);
    const errs = structuralManifestErrors(
      pm,
      ab,
      parsedManifest({ contexts: [{ name: "billing" }] }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R06]")));
  });
});

// ── R07 (dangling depends_on) ─────────────────────────────────────────────────

describe("structuralManifestErrors — R07 dangling depends_on", () => {
  it("R07 when depends_on references a non-existent context", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({
        contexts: [{ name: "orders", depends_on: ["ghost-context"] }],
      }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R07]")));
  });

  it("no R07 when depends_on references an existing context", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
        { name: "shared", in: [], out: [] },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({
        contexts: [
          { name: "orders", depends_on: ["shared"] },
          { name: "shared", type: "shared-kernel" },
        ],
      }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R07]")));
  });
});

// ── R08 (workspace incomplete) ───────────────────────────────────────────────

describe("structuralManifestErrors — R08 workspace name/description", () => {
  it("R08 when system is empty", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ system: "", scope: "core" }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R08]")));
  });

  it("R08 when scope is empty", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ system: "my-system", scope: "   " }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R08]")));
  });

  it("R08 names BOTH fields when system and scope are both empty", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ system: "", scope: "" }),
    );
    const r08 = errs.find((e) => e.startsWith("[R08]"));
    assert.ok(r08);
    assert.match(r08!, /system name/);
    assert.match(r08!, /scope/);
    assert.match(r08!, /are empty/); // compound subject → "are", not "is"
  });

  it("no R08 when both system and scope are non-empty", () => {
    const errs = structuralManifestErrors(
      portMap([
        {
          name: "orders",
          in: ["PlaceOrderPort"],
          out: ["OrderRepositoryPort"],
        },
      ]),
      adapterBindings([
        {
          name: "orders",
          adapters: [
            { name: "A", implements: "PlaceOrderPort" },
            { name: "B", implements: "OrderRepositoryPort" },
          ],
        },
      ]),
      parsedManifest({ system: "my-system", scope: "core" }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R08]")));
  });
});

// ── R09 (shared-kernel has ports) ────────────────────────────────────────────

describe("structuralManifestErrors — R09 shared-kernel has ports", () => {
  it("R09 when a shared-kernel context has inbound ports", () => {
    const errs = structuralManifestErrors(
      portMap([{ name: "shared-types", in: ["SomePort"], out: [] }]),
      adapterBindings([]),
      parsedManifest({
        contexts: [{ name: "shared-types", type: "shared-kernel" }],
      }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R09]")));
  });

  it("no R09 when a shared-kernel context has no ports", () => {
    const errs = structuralManifestErrors(
      portMap([{ name: "shared-types", in: [], out: [] }]),
      adapterBindings([]),
      parsedManifest({
        contexts: [{ name: "shared-types", type: "shared-kernel" }],
      }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R09]")));
  });

  it("R02/R03 are NOT emitted for shared-kernel (R09 is the only rule)", () => {
    // R02 and R03 require ports — they must be suppressed for shared-kernels
    // so they don't double-count as separate violations.
    const errs = structuralManifestErrors(
      portMap([{ name: "shared-types", in: [], out: [] }]),
      adapterBindings([]),
      parsedManifest({
        contexts: [{ name: "shared-types", type: "shared-kernel" }],
      }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R02]")));
    assert.ok(!errs.some((e) => e.startsWith("[R03]")));
  });
});

// ── Portless contexts (present in the manifest, absent from portMap) ──────────

describe("structuralManifestErrors — portless contexts", () => {
  it("R02 + R03 for a non-shared-kernel context with no ports", () => {
    // buildPreDefinedPortMap drops portless contexts; the checker must still
    // flag them (a portless context has no inbound port and no repository port).
    const errs = structuralManifestErrors(
      portMap([]), // portless → absent from portMap
      adapterBindings([]),
      parsedManifest({ contexts: [{ name: "orphaned" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R02]")));
    assert.ok(errs.some((e) => e.startsWith("[R03]")));
  });

  it("R01 for a portless context with a banned name", () => {
    const errs = structuralManifestErrors(
      portMap([]),
      adapterBindings([]),
      parsedManifest({ contexts: [{ name: "payment-gateway" }] }),
    );
    assert.ok(errs.some((e) => e.startsWith("[R01]")));
  });

  it("no R02/R03/R09 for a portless shared-kernel (valid)", () => {
    const errs = structuralManifestErrors(
      portMap([]),
      adapterBindings([]),
      parsedManifest({
        contexts: [{ name: "shared-types", type: "shared-kernel" }],
      }),
    );
    assert.ok(!errs.some((e) => e.startsWith("[R02]")));
    assert.ok(!errs.some((e) => e.startsWith("[R03]")));
    assert.ok(!errs.some((e) => e.startsWith("[R09]")));
  });
});

// ── Determinism across runs ───────────────────────────────────────────────────

describe("structuralManifestErrors — determinism", () => {
  it("identical inputs always produce identical outputs", () => {
    const pm = portMap([
      {
        name: "billing",
        in: ["CreateInvoicePort"],
        out: ["InvoiceRepositoryPort"],
      },
    ]);
    const ab = adapterBindings([
      {
        name: "billing",
        adapters: [{ name: "A", implements: "CreateInvoicePort" }],
      },
    ]);
    const manifest = parsedManifest({ contexts: [{ name: "billing" }] });

    const run1 = structuralManifestErrors(pm, ab, manifest);
    const run2 = structuralManifestErrors(pm, ab, manifest);
    assert.deepStrictEqual(run1, run2);
  });

  it("adding a correct adapter reduces R04 error count by exactly 1", () => {
    const pm = portMap([
      { name: "orders", in: ["PlaceOrderPort"], out: ["OrderRepositoryPort"] },
    ]);
    const abBefore = adapterBindings([
      {
        name: "orders",
        adapters: [{ name: "A", implements: "PlaceOrderPort" }],
      },
    ]);
    const abAfter = adapterBindings([
      {
        name: "orders",
        adapters: [
          { name: "A", implements: "PlaceOrderPort" },
          { name: "B", implements: "OrderRepositoryPort" },
        ],
      },
    ]);
    const manifest = parsedManifest({ contexts: [{ name: "orders" }] });

    const before = structuralManifestErrors(pm, abBefore, manifest);
    const after = structuralManifestErrors(pm, abAfter, manifest);
    assert.strictEqual(before.filter((e) => e.startsWith("[R04]")).length, 1);
    assert.strictEqual(after.filter((e) => e.startsWith("[R04]")).length, 0);
    assert.strictEqual(after.length, before.length - 1);
  });
});
