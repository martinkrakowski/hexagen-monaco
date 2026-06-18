import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { synthesizeMissingRepositoryPorts } from "../../../src/domain/manifest/synthesize-repository-ports";
import { structuralManifestErrors } from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";
import { validatePortQuality } from "../../../src/domain/services/port-quality-validator";
import type {
  PortMap,
  AdapterBindings,
  ClassifiedContext,
} from "../../../src/domain/value-objects/pipeline-state";

const context = (
  over?: Partial<Pick<ClassifiedContext, "name" | "type" | "aggregateRoots">>,
): Pick<ClassifiedContext, "name" | "type" | "aggregateRoots"> => ({
  name: "InvoicingBilling",
  type: "core",
  aggregateRoots: ["Invoice"],
  ...over,
});

const portMapWithInboundOnly = (): PortMap => ({
  contexts: [
    {
      contextName: "InvoicingBilling",
      in: [{ name: "CreateInvoicePort", type: "command", description: "x" }],
      out: [],
    },
  ],
});

const adapterBindingsForInbound = (): AdapterBindings => ({
  contexts: [
    {
      contextName: "InvoicingBilling",
      adapters: [
        {
          name: "CreateInvoiceController",
          type: "Controller",
          implements: "CreateInvoicePort",
        },
      ],
    },
  ],
});

describe("synthesizeMissingRepositoryPorts", () => {
  it("adds a repository port + adapter for a context missing one", () => {
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      adapterBindingsForInbound(),
      [context()],
    );

    assert.deepStrictEqual(result.synthesized, [
      {
        contextName: "InvoicingBilling",
        portName: "InvoiceRepositoryPort",
        adapterName: "InvoiceRepositoryAdapter",
      },
    ]);

    const out = result.portMap.contexts[0].out;
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].name, "InvoiceRepositoryPort");
    assert.strictEqual(out[0].type, "repository");

    // The adapter binds the new port EXPLICITLY (no name re-inference).
    const adapters = result.adapterBindings.contexts[0].adapters;
    const added = adapters.find((a) => a.name === "InvoiceRepositoryAdapter");
    assert.ok(added);
    assert.strictEqual(added.implements, "InvoiceRepositoryPort");
    assert.strictEqual(added.adapterType, "Repository");
  });

  it("clears R03 without introducing R04 (deterministic gate view)", () => {
    const portMap = portMapWithInboundOnly();
    const bindings = adapterBindingsForInbound();
    const parsed = {
      system: "invoicing-billing",
      scope: "invoicing-billing",
      bounded_contexts: [
        {
          name: "InvoicingBilling",
          type: "core",
          layers: {
            application: { ports: { in: ["CreateInvoicePort"], out: [] } },
            infrastructure: { adapters: ["CreateInvoiceController"] },
          },
        },
      ],
    };

    const before = structuralManifestErrors(portMap, bindings, parsed);
    assert.ok(before.some((e) => e.startsWith("[R03]")));

    const result = synthesizeMissingRepositoryPorts(portMap, bindings, [
      context(),
    ]);
    const after = structuralManifestErrors(
      result.portMap,
      result.adapterBindings,
      parsed,
    );
    assert.ok(!after.some((e) => e.startsWith("[R03]")));
    assert.ok(!after.some((e) => e.startsWith("[R04]")));
  });

  it("falls back to the PascalCase context name when no aggregate is known", () => {
    const result = synthesizeMissingRepositoryPorts(
      {
        contexts: [
          {
            contextName: "invoicing-billing",
            in: [
              { name: "CreateInvoicePort", type: "command", description: "x" },
            ],
            out: [],
          },
        ],
      },
      { contexts: [] },
      [context({ name: "invoicing-billing", aggregateRoots: [] })],
    );
    assert.strictEqual(
      result.synthesized[0].portName,
      "InvoicingBillingRepositoryPort",
    );
    // No adapter-bindings entry existed for the context — one is created.
    assert.strictEqual(result.adapterBindings.contexts.length, 1);
    assert.strictEqual(
      result.adapterBindings.contexts[0].adapters[0].implements,
      "InvoicingBillingRepositoryPort",
    );
  });

  it("skips a context that already has an outbound repository port", () => {
    const result = synthesizeMissingRepositoryPorts(
      {
        contexts: [
          {
            contextName: "InvoicingBilling",
            in: [],
            out: [
              {
                name: "InvoiceRepositoryPort",
                type: "repository",
                description: "x",
              },
            ],
          },
        ],
      },
      { contexts: [] },
      [context()],
    );
    assert.strictEqual(result.synthesized.length, 0);
  });

  it("skips shared-kernel contexts (R03 does not apply)", () => {
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      adapterBindingsForInbound(),
      [context({ type: "shared-kernel" })],
    );
    assert.strictEqual(result.synthesized.length, 0);
  });

  it("avoids a doubled suffix when the aggregate ends in Repository", () => {
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      adapterBindingsForInbound(),
      [context({ aggregateRoots: ["InvoiceRepository"] })],
    );
    assert.strictEqual(result.synthesized[0].portName, "InvoiceRepositoryPort");
  });

  it("does not set forAggregate, so it cannot introduce an R17 error", () => {
    // Fallback path: no known aggregate root for the context.
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      adapterBindingsForInbound(),
      [context({ aggregateRoots: [] })],
    );
    const port = result.portMap.contexts[0].out[0];
    assert.strictEqual(port.forAggregate, undefined);
    // R17 fires only on a forAggregate that is not a known root — verify the
    // synthesized port is clean even when the context has NO known roots.
    const issues = validatePortQuality(
      result.portMap.contexts[0].out,
      "InvoicingBilling",
      [],
    );
    assert.ok(!issues.some((i) => i.rule === "R17"));
  });

  it("reuses a pre-existing adapter that implements the port (no duplicate → no R04)", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "InvoicingBilling",
          adapters: [
            {
              name: "CreateInvoiceController",
              type: "Controller",
              implements: "CreateInvoicePort",
            },
            {
              // A Stage-4 adapter dangling on a port Stage 3 never emitted.
              name: "InvoicePersistenceAdapter",
              type: "Repository",
              implements: "InvoiceRepositoryPort",
            },
          ],
        },
      ],
    };
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      bindings,
      [context()],
    );
    const implementers = result.adapterBindings.contexts[0].adapters.filter(
      (a) => a.implements === "InvoiceRepositoryPort",
    );
    assert.strictEqual(implementers.length, 1);
  });

  it("normalizes a whitespace / lowercase aggregate into a clean name", () => {
    const result = synthesizeMissingRepositoryPorts(
      portMapWithInboundOnly(),
      adapterBindingsForInbound(),
      [context({ aggregateRoots: ["  invoice  "] })],
    );
    assert.strictEqual(result.synthesized[0].portName, "InvoiceRepositoryPort");
  });

  it("skips when a port with the synthesized name already exists", () => {
    const result = synthesizeMissingRepositoryPorts(
      {
        contexts: [
          {
            contextName: "InvoicingBilling",
            in: [],
            // Same name but a mislabeled type, so the repository guard misses it.
            out: [
              {
                name: "InvoiceRepositoryPort",
                type: "publisher",
                description: "x",
              },
            ],
          },
        ],
      },
      { contexts: [] },
      [context()],
    );
    assert.strictEqual(result.synthesized.length, 0);
  });
});
