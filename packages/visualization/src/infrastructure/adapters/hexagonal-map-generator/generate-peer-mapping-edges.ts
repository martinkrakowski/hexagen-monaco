import type { BoundedContext, PeerMapping } from "@hexagen/shared";
import type {
  HexagonEdge,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

interface GeneratePeerMappingEdgesOptions {
  peerMappings: PeerMapping[];
  boundedContexts: BoundedContext[];
  existingNodes: readonly HexagonNodeWithLayout[];
}

export function generatePeerMappingEdges({
  peerMappings,
  boundedContexts,
  existingNodes,
}: GeneratePeerMappingEdgesOptions): HexagonEdge[] {
  const edges: HexagonEdge[] = [];

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
      style: {
        stroke: "#64748b",
        strokeWidth: "4",
        strokeDasharray: "5,5",
      },
      markerEnd: "url(#arrow)",
    });
  });

  return edges;
}
