import type {
  MapContextInput,
  MapPeerMappingInput,
} from "../../../application/ports/in/hexagonal-map-input.js";
import type {
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "../../../application/ports/in/renderable-graph.js";

interface GeneratePeerMappingEdgesOptions {
  peerMappings: readonly MapPeerMappingInput[];
  boundedContexts: readonly MapContextInput[];
  existingNodes: readonly RenderableHexagonNode[];
}

export function generatePeerMappingEdges({
  peerMappings,
  boundedContexts,
  existingNodes,
}: GeneratePeerMappingEdgesOptions): RenderableHexagonEdge[] {
  const edges: RenderableHexagonEdge[] = [];

  peerMappings.forEach((mapping, index) => {
    const consumerId = mapping.consumerContext;
    const providerId = mapping.providerContext;

    const consumerIndex = boundedContexts.findIndex((c) => c.id === consumerId);
    const providerIndex = boundedContexts.findIndex((c) => c.id === providerId);

    const consumerNode = existingNodes.find(
      (n) => n.id === consumerId || n.id === `context-${consumerIndex}`,
    );
    const providerNode = existingNodes.find(
      (n) => n.id === providerId || n.id === `context-${providerIndex}`,
    );

    if (!consumerNode || !providerNode) return;

    const consumerCtx = boundedContexts.find((c) => c.id === consumerId);
    const providerCtx = boundedContexts.find((c) => c.id === providerId);
    const patternAbbrev =
      mapping.integrationPattern === "open-host" ? "OHS" : "ACL";

    edges.push({
      id: `edge-peer-mapping-${index}`,
      source: consumerId,
      sourceHandle: "east",
      target: providerId,
      targetHandle: "west",
      label: `${consumerCtx?.name ?? "?"} → ${providerCtx?.name ?? "?"} (${patternAbbrev})`,
      type: "smoothstep",
      animated: true,
      // The `style: { stroke: "#64748b", strokeWidth: "4", strokeDasharray:
      // "5,5" }` and `markerEnd: "url(#arrow)"` that used to be set here were
      // dead: `useCanvasConfig.mapToFlowEdge` builds its own stroke and marker
      // from `isSharedKernel` and the source node's variant, and never reads
      // either field. They went with the CSS fields removed from `HexagonEdge`.
    });
  });

  return edges;
}
