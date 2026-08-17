import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { WizardData } from "@hexagen/project-configuration";
import { HexagonalMapGeneratorAdapter } from "@hexagen/visualization";

import {
  compileWizardGraph,
  type CompileWizardGraphDeps,
  type NodeVisualMapper,
} from "./compile-wizard-graph";
import type { AddOnMeta } from "./addon-overlay";

/**
 * REA-004's acceptance criterion: `compileWizardGraph` is a pure function with
 * tests. Purity is what these cases exercise — every collaborator is passed in,
 * there is no container, no React and no store, and the real map generator is
 * used rather than a stub so the assertions are about the actual graph.
 */

const META: Record<string, AddOnMeta> = {
  bullmq: { provides: "messaging.out-adapter", scope: "context" },
  docker: { provides: "platform.container", scope: "project" },
};

/** A projection compiler stand-in that records what it was asked about. */
function recordingMapper(): NodeVisualMapper & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    execute(spec) {
      seen.push(spec.nodeId);
      return {
        nodeId: spec.nodeId,
        label: spec.label,
        category: "primary-adapter",
        variant: {
          headerBg: "bg-sky-500",
          bodyBg: "bg-sky-50",
          border: "border-sky-500",
          handleColor: "!bg-sky-500",
          headerText: "text-white",
          hexColor: "#0ea5e9",
        },
      };
    },
  } as NodeVisualMapper & { seen: string[] };
}

function deps(
  overrides: Partial<CompileWizardGraphDeps> = {},
): CompileWizardGraphDeps {
  return {
    generateMap: new HexagonalMapGeneratorAdapter(),
    mapNodeVisual: recordingMapper(),
    templateManifestOf: (id) => META[id],
    addOnDisplayName: (id) => id.toUpperCase(),
    ...overrides,
  };
}

function wizard(overrides: Partial<WizardData> = {}): WizardData {
  return {
    boundedContexts: [
      {
        id: "ctx-orders",
        name: "Orders",
        coreDomainEntities: ["Order"],
        valueObjects: [],
        domainEvents: [],
        useCases: ["PlaceOrder"],
        portConfiguration: { inboundPorts: [], outboundPorts: [] },
        messagingAdapter: "BullMQ",
      },
    ],
    externalContexts: [],
    peerMappings: [],
    addOnsAnswers: {},
    ...overrides,
  } as WizardData;
}

describe("compileWizardGraph", () => {
  it("returns null when the document declares no bounded contexts", () => {
    assert.equal(compileWizardGraph(undefined, deps()), null);
    assert.equal(
      compileWizardGraph(wizard({ boundedContexts: [] }), deps()),
      null,
    );
  });

  it("is deterministic — same input, same graph", () => {
    const first = compileWizardGraph(wizard(), deps());
    const second = compileWizardGraph(wizard(), deps());

    assert.ok(first && second);
    assert.deepEqual(first.nodes, second.nodes);
    assert.deepEqual(first.edges, second.edges);
    assert.deepEqual(first.chips, second.chips);
  });

  it("applies the projection compiler to entity/use-case/port/adapter nodes only", () => {
    const mapNodeVisual = recordingMapper();
    const compiled = compileWizardGraph(wizard(), deps({ mapNodeVisual }));

    assert.ok(compiled);
    const projected = new Set(mapNodeVisual.seen);
    for (const node of compiled.nodes) {
      const shouldProject = ["entity", "use-case", "port", "adapter"].includes(
        node.type,
      );
      assert.equal(
        projected.has(node.id),
        shouldProject,
        `${node.id} (${node.type}) was ${shouldProject ? "not " : ""}projected`,
      );
      assert.equal(
        node.variant !== undefined,
        shouldProject,
        `${node.id} variant presence disagrees with projection`,
      );
    }
    // Anti-vacuity: the loop above is only meaningful if both arms occurred.
    assert.ok(projected.size > 0, "nothing was projected at all");
    assert.ok(
      compiled.nodes.some((n) => n.variant === undefined),
      "every node was projected — the type filter is not being exercised",
    );
  });

  it("still compiles without a projection compiler wired", () => {
    const compiled = compileWizardGraph(
      wizard(),
      deps({ mapNodeVisual: undefined }),
    );

    assert.ok(compiled);
    assert.ok(compiled.nodes.length > 0);
    assert.ok(compiled.nodes.every((n) => n.variant === undefined));
  });

  it("annotates the declared compass adapter rather than drawing a second node", () => {
    const compiled = compileWizardGraph(
      wizard({ addOnsAnswers: { bullmq: {} } }),
      deps(),
    );

    assert.ok(compiled);
    const annotated = compiled.nodes.filter(
      (n) => (n as { addOn?: unknown }).addOn !== undefined,
    );
    assert.equal(annotated.length, 1);
    assert.equal(annotated[0].id, "adapter-ctx-orders-south-BullMQ-0");
    assert.equal(compiled.chips.length, 0, "a context add-on drew a chip");
  });

  it("builds a strip chip for a project-scoped add-on, through the injected name", () => {
    const compiled = compileWizardGraph(
      wizard({ addOnsAnswers: { docker: {} } }),
      deps(),
    );

    assert.ok(compiled);
    assert.deepEqual(
      compiled.chips.map((c) => c.label),
      ["DOCKER"],
    );
  });

  it("carries no add-on overlay back into the wizard document", () => {
    const document = wizard({ addOnsAnswers: { bullmq: {} } });
    const before = JSON.stringify(document);

    compileWizardGraph(document, deps());

    assert.equal(JSON.stringify(document), before);
  });
});
