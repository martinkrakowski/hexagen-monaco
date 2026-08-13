import { describe, it } from "vitest";
import assert from "node:assert";
import {
  buildPortAdapterCounts,
  portCoverageErrorsForContext,
  portAdapterCoverageErrors,
} from "../../../src/domain/manifest/port-adapter-coverage";
import type {
  AdapterBindings,
  ContextPorts,
  PortMap,
} from "../../../src/domain/value-objects/pipeline-state";

const port = (
  name: string,
  type: "command" | "repository" = "command",
): ContextPorts["in"][number] => ({
  name,
  type,
  description: `${name} does something meaningful for the domain`,
});

describe("buildPortAdapterCounts", () => {
  it("counts adapters per normalized context and per port name", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "InvoiceManagement",
          adapters: [
            { name: "A1", type: "Repository", implements: "InvoiceRepoPort" },
            { name: "A2", type: "Repository", implements: "InvoiceRepoPort" },
            { name: "A3", type: "Controller", implements: "CreateInvoicePort" },
          ],
        },
      ],
    };
    const counts = buildPortAdapterCounts(bindings);
    // Pascal contextName normalizes to kebab — same keying the structural gate uses.
    const ctx = counts.get("invoice-management");
    assert.ok(ctx);
    assert.strictEqual(ctx.get("InvoiceRepoPort"), 2);
    assert.strictEqual(ctx.get("CreateInvoicePort"), 1);
  });

  it("skips adapters with an empty implements (unbound, not a binding)", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "billing",
          adapters: [
            { name: "UnboundAdapter", type: "Repository", implements: "" },
          ],
        },
      ],
    };
    const counts = buildPortAdapterCounts(bindings);
    assert.strictEqual(counts.get("billing")?.size, 0);
  });

  it("keeps counts separate per context for a shared port name", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "image-domain",
          adapters: [
            {
              name: "S3Storage",
              type: "Repository",
              implements: "StoragePort",
            },
          ],
        },
        {
          contextName: "real-esrgan",
          adapters: [
            {
              name: "FsStorage",
              type: "Repository",
              implements: "StoragePort",
            },
          ],
        },
      ],
    };
    const counts = buildPortAdapterCounts(bindings);
    assert.strictEqual(counts.get("image-domain")?.get("StoragePort"), 1);
    assert.strictEqual(counts.get("real-esrgan")?.get("StoragePort"), 1);
  });
});

describe("portCoverageErrorsForContext", () => {
  it("emits R04 for an outbound port with 0 adapters (message parity with the structural gate)", () => {
    const ctx: ContextPorts = {
      contextName: "billing",
      in: [],
      out: [port("InvoiceRepositoryPort", "repository")],
    };
    const errs = portCoverageErrorsForContext(ctx, new Map());
    assert.deepStrictEqual(errs, [
      "[R04] Outbound port 'InvoiceRepositoryPort' in 'billing' has 0 adapters (expected 1).",
    ]);
  });

  it("emits R05 for an inbound port with 2 adapters", () => {
    const ctx: ContextPorts = {
      contextName: "billing",
      in: [port("CreateInvoicePort")],
      out: [],
    };
    const errs = portCoverageErrorsForContext(
      ctx,
      new Map([["CreateInvoicePort", 2]]),
    );
    assert.deepStrictEqual(errs, [
      "[R05] Inbound port 'CreateInvoicePort' in 'billing' has 2 adapters (expected 1).",
    ]);
  });

  it("emits nothing when every port has exactly one adapter", () => {
    const ctx: ContextPorts = {
      contextName: "billing",
      in: [port("CreateInvoicePort")],
      out: [port("InvoiceRepositoryPort", "repository")],
    };
    const errs = portCoverageErrorsForContext(
      ctx,
      new Map([
        ["CreateInvoicePort", 1],
        ["InvoiceRepositoryPort", 1],
      ]),
    );
    assert.deepStrictEqual(errs, []);
  });
});

describe("portAdapterCoverageErrors", () => {
  const portMap: PortMap = {
    contexts: [
      {
        contextName: "image-domain",
        in: [port("UpscaleImagePort")],
        out: [port("StoragePort", "repository")],
      },
      {
        contextName: "real-esrgan",
        in: [],
        out: [port("StoragePort", "repository")],
      },
    ],
  };

  it("no findings when each context covers its own same-named port (cross-context sharing is not R04)", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "image-domain",
          adapters: [
            {
              name: "S3Storage",
              type: "Repository",
              implements: "StoragePort",
            },
            {
              name: "UpscaleCtrl",
              type: "Controller",
              implements: "UpscaleImagePort",
            },
          ],
        },
        {
          contextName: "real-esrgan",
          adapters: [
            {
              name: "FsStorage",
              type: "Repository",
              implements: "StoragePort",
            },
          ],
        },
      ],
    };
    assert.deepStrictEqual(
      portAdapterCoverageErrors(portMap, bindings, new Set()),
      [],
    );
  });

  it("finds a genuine same-context violation even when another context covers the same port name", () => {
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "image-domain",
          adapters: [
            {
              name: "S3Storage",
              type: "Repository",
              implements: "StoragePort",
            },
            {
              name: "UpscaleCtrl",
              type: "Controller",
              implements: "UpscaleImagePort",
            },
          ],
        },
        // real-esrgan declares no adapter for ITS StoragePort — the global
        // count is 1, but the per-context count is 0: this must be reported.
        { contextName: "real-esrgan", adapters: [] },
      ],
    };
    const errs = portAdapterCoverageErrors(portMap, bindings, new Set());
    assert.deepStrictEqual(errs, [
      "[R04] Outbound port 'StoragePort' in 'real-esrgan' has 0 adapters (expected 1).",
    ]);
  });

  it("exempts shared-kernel contexts (R09's territory)", () => {
    const skMap: PortMap = {
      contexts: [
        {
          contextName: "shared-types",
          in: [port("BogusPort")],
          out: [],
        },
      ],
    };
    const bindings: AdapterBindings = { contexts: [] };
    assert.deepStrictEqual(
      portAdapterCoverageErrors(skMap, bindings, new Set(["shared-types"])),
      [],
    );
    // Sanity: without the exemption the same input WOULD report.
    assert.strictEqual(
      portAdapterCoverageErrors(skMap, bindings, new Set()).length,
      1,
    );
  });

  it("skips contexts with a non-string contextName (fail-safe on malformed state)", () => {
    const badMap = {
      contexts: [{ contextName: undefined, in: [port("XPort")], out: [] }],
    } as unknown as PortMap;
    assert.deepStrictEqual(
      portAdapterCoverageErrors(badMap, { contexts: [] }, new Set()),
      [],
    );
  });

  it("treats an empty-implements adapter as no binding (port still uncovered)", () => {
    const map: PortMap = {
      contexts: [
        {
          contextName: "billing",
          in: [],
          out: [port("InvoiceRepositoryPort", "repository")],
        },
      ],
    };
    const bindings: AdapterBindings = {
      contexts: [
        {
          contextName: "billing",
          adapters: [{ name: "Unbound", type: "Repository", implements: "" }],
        },
      ],
    };
    const errs = portAdapterCoverageErrors(map, bindings, new Set());
    assert.strictEqual(errs.length, 1);
    assert.ok(errs[0].startsWith("[R04]"));
  });
});
