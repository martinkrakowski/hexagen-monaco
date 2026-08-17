import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { CanvasGraphLoadUseCase } from "../../src/application/use-cases/canvas-graph-load.use-case.js";
import type { CanvasGraphLoadOutput } from "../../src/application/use-cases/canvas-graph-load.use-case.js";
import type {
  ArchitectureGraphData,
  IArchitectureGraphProviderPort,
} from "../../src/application/ports/out/architecture-graph-provider-port.port.js";
import type { HexagonalMapInput } from "../../src/application/ports/in/hexagonal-map-input.js";
import { HexagonalMapGeneratorAdapter } from "../../src/infrastructure/adapters/hexagonal-map-generator/index.js";
import type { Result } from "../../src/application/result.js";

/**
 * The use case's output contract must describe what it actually returns.
 *
 * `GenerateHexagonalMapPort` returns `RenderableHexagonNode[]` /
 * `RenderableHexagonEdge[]` — graph facts plus React Flow draw instructions.
 * Declaring `CanvasGraphLoadOutput` as the bare domain `HexagonNode[]` still
 * compiled, because renderable is assignable to domain, so nothing anywhere
 * failed; it just silently erased `extent`, `style`, `variant`, edge `type`
 * and `animated` from every caller's view.
 *
 * A runtime assertion alone cannot catch that regression — the objects carry
 * the fields either way, since the use case forwards the generator's arrays by
 * reference. So the guard is the *typed reads* below: `node.style`,
 * `edge.type` and `edge.animated` are resolved against `CanvasGraphLoadOutput`,
 * not against the generator's return type, and narrowing the contract back to
 * `HexagonNode[]` / `HexagonEdge[]` fails `yarn typecheck:test` with
 * "Property 'style' does not exist on type 'HexagonNode'".
 */

/** A provider that fails the test if the generator branch ever consults it. */
const unusedGraphProvider: IArchitectureGraphProviderPort = {
  getArchitectureGraph: (): Promise<Result<ArchitectureGraphData, Error>> => {
    throw new Error(
      "the map branch must not fall through to the architecture graph provider",
    );
  },
};

const map: HexagonalMapInput = {
  contexts: [
    {
      id: "orders",
      name: "Orders",
      coreDomainEntities: ["Order"],
      portConfiguration: {
        inboundPorts: ["rest-controller"],
        outboundPorts: ["database-repository"],
      },
    },
    { id: "billing", name: "Billing" },
  ],
  peers: [],
  peerMappings: [
    {
      consumerContext: "orders",
      providerContext: "billing",
      integrationPattern: "open-host",
    },
  ],
};

describe("CanvasGraphLoadUseCase", () => {
  it("publishes the generator's presentation fields instead of erasing them", async () => {
    const useCase = new CanvasGraphLoadUseCase(
      unusedGraphProvider,
      new HexagonalMapGeneratorAdapter(),
    );

    const result = await useCase.execute({ map });

    assert.equal(result.success, true);
    if (!result.success) return;

    const data: CanvasGraphLoadOutput = result.data;

    const context = data.nodes.find((node) => node.id === "orders");
    assert.ok(context, "expected the Orders bounded-context node");
    // Typed read of a `HexagonNodePresentation` member off the use-case output.
    assert.equal(typeof context.style?.width, "number");

    const mappingEdge = data.edges.find((edge) =>
      edge.id.startsWith("edge-peer-mapping-"),
    );
    assert.ok(mappingEdge, "expected the declared peer-mapping edge");
    // Typed reads of the two `HexagonEdgePresentation` members.
    assert.equal(mappingEdge.type, "smoothstep");
    assert.equal(mappingEdge.animated, true);

    // And the layout annotations, which the old `HexagonNode[]` contract also hid.
    const inbound = data.nodes.find((node) => node.parentId === "orders");
    assert.ok(inbound, "expected at least one node nested in the context");
  });

  it("reports the missing-input case rather than throwing", async () => {
    const useCase = new CanvasGraphLoadUseCase(
      unusedGraphProvider,
      new HexagonalMapGeneratorAdapter(),
    );

    const result = await useCase.execute({});

    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(
      result.error.message,
      /Either projectId or map must be provided/,
    );
  });
});
