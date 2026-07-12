import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { synthesizeMissingInboundPorts } from "../../../src/domain/manifest/synthesize-inbound-ports";
import type {
  PortMap,
  AdapterBindings,
  ClassifiedContext,
} from "../../../src/domain/value-objects/pipeline-state";

const context = (
  over?: Partial<Pick<ClassifiedContext, "name" | "type">>,
): Pick<ClassifiedContext, "name" | "type"> => ({
  name: "image-domain",
  type: "core",
  ...over,
});

const outOnlyPortMap = (contextName = "image-domain"): PortMap => ({
  contexts: [
    {
      contextName,
      in: [],
      out: [{ name: "UpscalePort", type: "external-client", description: "x" }],
    },
  ],
});

const emptyBindings = (contextName = "image-domain"): AdapterBindings => ({
  contexts: [{ contextName, adapters: [] }],
});

describe("synthesizeMissingInboundPorts", () => {
  it("adds a command port + adapter for a context with no inbound ports", () => {
    const result = synthesizeMissingInboundPorts(
      outOnlyPortMap(),
      emptyBindings(),
      [context()],
    );
    const ctx = result.portMap.contexts[0];
    assert.equal(ctx.in.length, 1);
    // Name derivation must match the accept view's client fixer exactly
    // (toPascalCase(context) + "CommandPort") so its minimum-interface branch
    // finds nothing left to silently patch after import.
    assert.equal(ctx.in[0].name, "ImageDomainCommandPort");
    assert.equal(ctx.in[0].type, "command");
    const adapters = result.adapterBindings.contexts[0].adapters;
    assert.deepEqual(
      adapters.map((a) => [a.name, a.implements]),
      [["ImageDomainCommandAdapter", "ImageDomainCommandPort"]],
    );
    assert.equal(result.synthesized.length, 1);
  });

  it("skips shared-kernel contexts (R02 does not apply)", () => {
    const result = synthesizeMissingInboundPorts(
      outOnlyPortMap("types"),
      emptyBindings("types"),
      [context({ name: "types", type: "shared-kernel" })],
    );
    assert.equal(result.synthesized.length, 0);
    assert.equal(result.portMap.contexts[0].in.length, 0);
  });

  it("skips contexts that already have an inbound port", () => {
    const portMap: PortMap = {
      contexts: [
        {
          contextName: "web-ui",
          in: [
            {
              name: "UploadFilesCommandPort",
              type: "command",
              description: "x",
            },
          ],
          out: [],
        },
      ],
    };
    const result = synthesizeMissingInboundPorts(
      portMap,
      emptyBindings("web-ui"),
      [context({ name: "web-ui", type: "supporting" })],
    );
    assert.equal(result.synthesized.length, 0);
    assert.equal(result.portMap, portMap, "inputs returned unchanged");
  });

  it("appends the adapter to at most ONE entry when a context appears twice", () => {
    const bindings: AdapterBindings = {
      contexts: [
        { contextName: "image-domain", adapters: [] },
        { contextName: "image-domain", adapters: [] },
      ],
    };
    const result = synthesizeMissingInboundPorts(outOnlyPortMap(), bindings, [
      context(),
    ]);
    const copies = result.adapterBindings.contexts.flatMap((c) =>
      c.adapters.filter((a) => a.name === "ImageDomainCommandAdapter"),
    );
    assert.equal(copies.length, 1);
  });

  it("creates a fresh bindings entry when the context has none", () => {
    const result = synthesizeMissingInboundPorts(
      outOnlyPortMap(),
      { contexts: [] },
      [context()],
    );
    assert.equal(result.adapterBindings.contexts.length, 1);
    assert.equal(
      result.adapterBindings.contexts[0].adapters[0].implements,
      "ImageDomainCommandPort",
    );
  });

  it("does not duplicate when the port name already exists in the context", () => {
    const portMap: PortMap = {
      contexts: [
        {
          contextName: "image-domain",
          in: [],
          out: [
            {
              name: "ImageDomainCommandPort",
              type: "external-client",
              description: "misclassified but present",
            },
          ],
        },
      ],
    };
    const result = synthesizeMissingInboundPorts(portMap, emptyBindings(), [
      context(),
    ]);
    assert.equal(result.synthesized.length, 0, "left as an advisory instead");
  });
});
