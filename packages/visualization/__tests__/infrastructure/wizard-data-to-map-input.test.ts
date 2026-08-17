import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { WizardData } from "@hexagen/project-configuration";

import { wizardDataToHexagonalMapInput } from "../../src/infrastructure/adapters/hexagonal-map-generator/wizard-data-to-map-input.js";
import { generateHexagonalContextMap } from "../../src/infrastructure/adapters/hexagonal-map-generator/generate-hexagonal-context-map.js";

/**
 * The compile-time half of this boundary (the structural assignments and the
 * `keyof` witnesses in `wizard-data-to-map-input.ts`) is enforced by
 * `yarn typecheck`, not by anything below. These cases cover the runtime half:
 * that the projection is a pass-through, and that a map generated through the
 * DTO is the same map as before.
 */

function wizardDocument(): WizardData {
  return {
    boundedContexts: [
      {
        id: "ctx-orders",
        name: "Orders",
        coreDomainEntities: ["Order", "LineItem"],
        valueObjects: ["Money"],
        domainEvents: ["OrderPlaced"],
        useCases: ["PlaceOrder"],
        portConfiguration: {
          inboundPorts: ["rest-controller"],
          outboundPorts: ["relational-db", "message-publisher"],
        },
        infrastructureTarget: "nestjs",
        uiFramework: "Next.js",
        persistenceAdapter: "Prisma",
        messagingAdapter: "BullMQ",
        telemetryProvider: "OpenTelemetry",
      },
    ],
    externalContexts: [
      {
        id: "peer-billing",
        name: "Billing",
        relationshipType: "U",
        entityNames: ["Invoice"],
      },
    ],
    governance: {
      workspaceName: "@acme",
      workspaceTemplate: "modular-monolith",
      packageManager: "yarn",
      topologyStrictness: "flexible",
      namespacePrefix: "@acme",
      namingConventions: {
        contextDirectoryPattern: "packages/",
        adapterSuffix: ".adapter.ts",
      },
    },
    peerMappings: [],
    addOnsAnswers: {},
  } as WizardData;
}

describe("wizardDataToHexagonalMapInput", () => {
  it("passes the three drawn collections straight through", () => {
    const wizardData = wizardDocument();
    const map = wizardDataToHexagonalMapInput(wizardData);

    // Reference equality, not deep equality: the projection must not copy,
    // reorder or re-default anything on its way in.
    assert.equal(map.contexts, wizardData.boundedContexts);
    assert.equal(map.peers, wizardData.externalContexts);
    assert.equal(map.peerMappings, wizardData.peerMappings);
  });

  it("substitutes empty collections for a document missing them", () => {
    const map = wizardDataToHexagonalMapInput({} as WizardData);

    assert.deepEqual(map, { contexts: [], peers: [], peerMappings: [] });
  });

  it("produces a graph the generator can draw the compass from", () => {
    const map = wizardDataToHexagonalMapInput(wizardDocument());
    const { nodes, edges } = generateHexagonalContextMap(map);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    assert.ok(byId.has("ctx-orders"), "the bounded-context hexagon is missing");
    assert.ok(byId.has("peer-billing"), "the external peer is missing");

    // One item per compass side, drawn from a different wizard field each —
    // this is what a renamed field upstream would silently blank.
    const sides = nodes
      .filter((n) => n.type === "adapter")
      .map((n) => `${n.side}:${n.label}`)
      .sort();
    assert.deepEqual(sides, [
      "east:Prisma",
      "east:relational-db",
      "north:Nestjs",
      "north:rest-controller",
      "south:BullMQ",
      "south:OpenTelemetry",
      "south:message-publisher",
      "west:Next.js",
    ]);

    // The peer edge still carries its relationship label.
    assert.ok(
      edges.some((e) => e.label === "U Billing"),
      "the peer relationship edge is missing",
    );
  });

  it("copies stats arrays instead of aliasing the caller's", () => {
    const wizardData = wizardDocument();
    const map = wizardDataToHexagonalMapInput(wizardData);
    const { nodes } = generateHexagonalContextMap(map);

    const hexagon = nodes.find((n) => n.id === "ctx-orders");
    assert.ok(hexagon?.stats);
    assert.deepEqual(hexagon.stats.aggregateItems, ["Order", "LineItem"]);
    assert.notEqual(
      hexagon.stats.aggregateItems,
      wizardData.boundedContexts[0].coreDomainEntities,
      "the produced graph aliases an array the caller still owns",
    );
  });
});
