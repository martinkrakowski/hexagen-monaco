import { useCallback } from "react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type {
  HexagonNode,
  HexagonEdge,
  HexagonNodeWithLayout,
} from "@hexagen/visualization";

/**
 * Calculate X coordinate for compass-positioned groups within bounded context
 */
function calculateCompassX(
  side: string,
  parentWidth: number,
  nodeWidth: number,
): number {
  const padding = 30;
  switch (side) {
    case "west":
    case "driving":
      return padding; // Left edge
    case "east":
    case "driven":
      return parentWidth - nodeWidth - padding; // Right edge
    case "north":
    case "south":
    case "presentation":
    case "infrastructure":
      return (parentWidth - nodeWidth) / 2; // Centered horizontally
    default:
      return (parentWidth - nodeWidth) / 2;
  }
}

/**
 * Calculate Y coordinate for compass-positioned groups within bounded context
 */
function calculateCompassY(
  side: string,
  parentHeight: number,
  nodeHeight: number,
): number {
  const padding = 30;
  const topPadding = 60; // Extra space for title bar
  switch (side) {
    case "north":
    case "presentation":
      return topPadding; // Top edge (below title)
    case "south":
    case "infrastructure":
      return parentHeight - nodeHeight - padding; // Bottom edge
    case "west":
    case "east":
    case "driving":
    case "driven":
      return (parentHeight - nodeHeight) / 2; // Centered vertically
    default:
      return (parentHeight - nodeHeight) / 2;
  }
}

/**
 * Layout calculation response
 */
export interface LayoutResponse {
  positions: Array<{
    nodeId: string;
    x: number;
    y: number;
  }>;
}

/**
 * Hexagonal Architecture Layer Priorities
 * Used to enforce left-to-right flow: Adapters -> Ports -> Domain -> Ports -> Adapters
 */
const LAYER_PRIORITY: Record<string, number> = {
  // Primary/Driving side (left)
  "adapter-primary": 0,
  "port-primary": 1,

  // Core domain (center)
  entity: 2,
  "use-case": 2,
  "bounded-context": 2,

  // Secondary/Driven side (right)
  "port-secondary": 3,
  "adapter-secondary": 4,

  // Peers and groups
  peer: 5,
  group: 6,
  inner: 2,
};

interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  type?: string;
  side?: "north" | "south" | "east" | "west";
}

interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

// Instantiate ELK once outside the hook to reuse the instance
const elk = new ELK();

/**
 * Get layer priority for a node based on its type and side
 */
function getLayerPriority(node: LayoutNode): number {
  const type = node.type || "";
  const side = node.side || "";

  if (type === "adapter") {
    return side === "west" || side === "north"
      ? LAYER_PRIORITY["adapter-primary"]
      : LAYER_PRIORITY["adapter-secondary"];
  }

  if (type === "port") {
    return side === "west" || side === "north"
      ? LAYER_PRIORITY["port-primary"]
      : LAYER_PRIORITY["port-secondary"];
  }

  return LAYER_PRIORITY[type] ?? 2;
}

/**
 * Determine the partition lane for hexagonal architecture flow.
 *
 * CRITICAL: ELK's layered algorithm relies on edges to determine positioning.
 * Without explicit partitioning, unconnected nodes clump at (0,0).
 * Partitions force nodes into strict vertical lanes regardless of edges.
 *
 * Lane assignment (left to right):
 * 1 = Primary/Driving Adapters (REST, GraphQL, CLI)
 * 2 = Inbound Ports / Use Cases
 * 3 = Domain (Entities, Aggregates, Value Objects)
 * 4 = Outbound Ports / SPIs
 * 5 = Secondary/Driven Adapters (Database, Message Queue, External APIs)
 */
function getPartitionLane(node: LayoutNode): number {
  const type = node.type || "";
  const side = node.side || "";
  const id = node.id.toLowerCase();

  // Adapters: Lane 1 (primary) or Lane 5 (secondary)
  if (type === "adapter") {
    return side === "west" || side === "north" ? 1 : 5;
  }

  // Ports: Lane 2 (inbound) or Lane 4 (outbound)
  if (type === "port") {
    return side === "west" || side === "north" ? 2 : 4;
  }

  // Use Cases / Application Services
  if (
    type === "use-case" ||
    id.includes("usecase") ||
    id.includes("use-case")
  ) {
    return 2;
  }

  // Domain models (center lane)
  if (type === "entity" || type === "domain" || id.includes("domain")) {
    return 3;
  }

  // Groups: Inherit from their typical content
  if (type === "group") {
    if (id.includes("usecase") || id.includes("use-case")) return 2;
    if (id.includes("domain")) return 3;
  }

  // Bounded contexts and peers: center lane
  if (type === "bounded-context" || type === "peer") {
    return 3;
  }

  // Default to center
  return 3;
}

/**
 * Convert layout nodes to ELK format with hierarchical grouping.
 *
 * CRITICAL: ELK requires a deeply nested JSON tree structure, not a flat array.
 * React Flow uses flat arrays with parentNode pointers, which ELK ignores.
 * This function transforms the flat structure into proper nested children arrays.
 */
function buildElkGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: "RIGHT" | "DOWN" | "LEFT" | "UP",
): ElkNode {
  // 1. Create a dictionary to hold our ELK-formatted nodes
  const elkNodesById: Record<string, ElkNode> = {};
  const rootChildren: ElkNode[] = [];

  // Track which parent contains which nodes for edge distribution
  const nodeParentMap: Record<string, string> = {};

  // 2. First pass: Initialize all ELK node objects
  nodes.forEach((node) => {
    const isBoundedContext = node.type === "bounded-context";
    const isSubGroup = node.type === "group";
    const priority = getLayerPriority(node);

    elkNodesById[node.id] = {
      id: node.id,
      // CRITICAL: ELK needs exact dimensions. Provide safe fallbacks.
      width: node.width || 150,
      height: node.height || 50,
      children: [], // Initialize empty children array for nesting

      // Apply specific layout options based on node type
      layoutOptions: isBoundedContext
        ? {
            // CRITICAL: Use BOX layout for bounded contexts to enable compass positioning
            // Layered algorithm doesn't support fixed positioning of child groups
            "elk.algorithm": "box",
            "elk.padding": "[top=60,left=30,bottom=30,right=30]",

            // Allow ELK to resize parent boxes dynamically
            "elk.nodeLabels.placement": "INSIDE V_TOP H_LEFT",
            "elk.hierarchyHandling": "INCLUDE_CHILDREN",

            // Spacing
            "elk.spacing.nodeNode": "40",
          }
        : isSubGroup
          ? {
              // Sub-groups use layered for internal organization
              "elk.algorithm": "layered",
              "elk.direction": direction,
              "elk.padding": "[top=40,left=15,bottom=15,right=15]",
              "elk.partitioning.activate": "true",
              "elk.spacing.nodeNode": "30",
              "elk.layered.spacing.nodeNodeBetweenLayers": "40",
            }
          : {
              // Regular nodes get layer priority for hexagonal flow
              "layered.priority": priority.toString(),
            },
    };
  });

  // 2.5. Detect nodes with children and add layout algorithm
  // This is critical for domain nodes that contain entities
  nodes.forEach((node) => {
    const hasChildren = nodes.some((n) => n.parentId === node.id);
    if (
      hasChildren &&
      node.type !== "bounded-context" &&
      node.type !== "group"
    ) {
      // Compound nodes like Domain / Use Cases need their own layout algorithm
      // so ELK can position their nested children instead of leaving them at (0,0).
      const elkNode = elkNodesById[node.id];
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.algorithm": "layered",
        "elk.direction": direction,
        "elk.padding": "[top=20,left=10,bottom=10,right=10]",
        "elk.spacing.nodeNode": "20",
        "elk.layered.spacing.nodeNodeBetweenLayers": "30",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      };
    }
  });

  // 3. Second pass: Build the nested tree structure with explicit compass positioning
  nodes.forEach((node) => {
    const elkNode = elkNodesById[node.id];

    if (node.parentId && elkNodesById[node.parentId]) {
      const parentElkNode = elkNodesById[node.parentId];
      const parentNode = nodes.find((n) => n.id === node.parentId);

      // Track parent relationship for edge distribution
      nodeParentMap[node.id] = node.parentId;

      // For compass-positioned groups, set explicit x,y coordinates and appropriate layout direction
      if (node.side && ["north", "south", "east", "west"].includes(node.side)) {
        const parentWidth = parentNode?.width || 800;
        const parentHeight = parentNode?.height || 600;

        elkNode.x = calculateCompassX(
          node.side,
          parentWidth,
          elkNode.width || 400,
        );
        elkNode.y = calculateCompassY(
          node.side,
          parentHeight,
          elkNode.height || 300,
        );

        // Set inner layout direction based on compass position
        // North/South groups should have horizontal layout (children side by side)
        // East/West groups should have vertical layout (children stacked)
        const northTypes = ["north", "presentation"];
        const southTypes = ["south", "infrastructure"];
        const eastWestTypes = ["east", "west", "driven", "driving"];

        if (northTypes.includes(node.side) || southTypes.includes(node.side)) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT", // Horizontal layout
            "elk.spacing.nodeNode": "20",
            "elk.padding": "[top=20,left=20,bottom=20,right=20]",
          };
        } else if (eastWestTypes.includes(node.side)) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            "elk.algorithm": "layered",
            "elk.direction": "DOWN", // Vertical layout
            "elk.spacing.nodeNode": "20",
            "elk.padding": "[top=20,left=20,bottom=20,right=20]",
          };
        }
      } else {
        // Center elements (Domain, Use Cases) - position in middle-bottom area
        const parentWidth = parentNode?.width || 800;
        const parentHeight = parentNode?.height || 600;
        const nodeId = node.id.toLowerCase();

        // Domain slightly above center, Use Cases slightly below
        if (nodeId.includes("domain")) {
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2 - 60;
        } else if (nodeId.includes("usecase") || nodeId.includes("use-case")) {
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2 + 20;
        } else {
          // Default center positioning
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2;
        }
      }

      // Add as regular child (not port)
      parentElkNode.children!.push(elkNode);
    } else {
      // Top-level node (like a Bounded Context)
      const lane = getPartitionLane(node);
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.partitioning.partition": lane.toString(),
      };

      rootChildren.push(elkNode);
    }
  });

  // 4. Distribute edges to appropriate hierarchy levels.
  // ELK cannot route an edge directly between a compound node and its own descendant,
  // so those parent-child edges are excluded from the layout graph.

  /**
   * Find the lowest common container that can own an edge between two nodes.
   *
   * Important: edge ownership is based on the nodes' parent chains, not the nodes
   * themselves. If one endpoint is a compound node, that node cannot also be the
   * graph that owns the edge because it is not a child of itself.
   *
   * @param sourceId - The source node ID
   * @param targetId - The target node ID
   * @param parentMap - Map of node IDs to their parent IDs
   * @returns The ID of the lowest common container, or 'root' if no common container
   */
  const findLowestCommonContainer = (
    sourceId: string,
    targetId: string,
    parentMap: Record<string, string>,
  ): string => {
    // Edge case: A node connecting to itself
    if (sourceId === targetId) return parentMap[sourceId] || "root";

    // Build the ancestor path for the source node's containers.
    const sourcePath = new Set<string>();
    let currentSource: string | undefined = parentMap[sourceId];

    while (currentSource) {
      sourcePath.add(currentSource);
      currentSource = parentMap[currentSource];
    }
    // Always include root in the path
    sourcePath.add("root");

    // Walk up the target's container path until we hit a shared owner.
    let currentTarget: string | undefined = parentMap[targetId];
    while (currentTarget) {
      if (sourcePath.has(currentTarget)) {
        return currentTarget;
      }
      currentTarget = parentMap[currentTarget];
    }

    // Fallback to root if they exist in completely detached trees
    return "root";
  };

  const isAncestorOf = (
    ancestorId: string,
    nodeId: string,
    parentMap: Record<string, string>,
  ): boolean => {
    let currentParent = parentMap[nodeId];

    while (currentParent) {
      if (currentParent === ancestorId) {
        return true;
      }
      currentParent = parentMap[currentParent];
    }

    return false;
  };

  const edgesByParent: Record<string, LayoutEdge[]> = { root: [] };

  edges.forEach((edge) => {
    // ELK rejects edges from a compound node to its own descendant. React Flow can
    // still render those edges after layout, so skip them here.
    if (
      isAncestorOf(edge.source, edge.target, nodeParentMap) ||
      isAncestorOf(edge.target, edge.source, nodeParentMap)
    ) {
      return;
    }

    const edgeParent = findLowestCommonContainer(
      edge.source,
      edge.target,
      nodeParentMap,
    );

    if (!edgesByParent[edgeParent]) {
      edgesByParent[edgeParent] = [];
    }
    edgesByParent[edgeParent].push(edge);
  });

  // 5. Assign edges to their respective parent nodes
  Object.entries(edgesByParent).forEach(([parentId, parentEdges]) => {
    const elkEdges = parentEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

    if (parentId === "root") {
      // Root level edges
      rootChildren.forEach((child) => {
        if (!child.edges) child.edges = [];
      });
    } else {
      // Add edges to the parent node
      const parentElkNode = elkNodesById[parentId];
      if (parentElkNode) {
        if (!parentElkNode.edges) parentElkNode.edges = [];
        parentElkNode.edges.push(...elkEdges);
      }
    }
  });

  // 6. Return the fully nested ELK Graph structure
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.spacing.nodeNode": "80",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "20",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      // CRITICAL: Tells ELK to route edges intelligently between different parent bounds
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      // Use polyline routing for cleaner edge paths around compound nodes
      "elk.edgeRouting": "POLYLINE",
    },
    children: rootChildren,
    edges:
      edgesByParent["root"]?.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      })) || [],
  };
}

/**
 * Extract positions and dimensions from ELK layout result.
 *
 * CRITICAL: ELK returns relative coordinates (children are 0,0 relative to parent's top-left).
 * React Flow ALSO expects relative coordinates for child nodes.
 * DO NOT add parent offsets to children - they should remain relative.
 *
 * IMPORTANT: With partitioning active, parent nodes (Bounded Contexts, Groups) will
 * expand dynamically to contain their children. We MUST capture and return these
 * new dimensions so React Flow can render the expanded boundaries correctly.
 */
function extractPositions(elkNode: ElkNode): Array<{
  nodeId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}> {
  const positions: Array<{
    nodeId: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
  }> = [];

  // Recursive function to walk the ELK tree
  const traverse = (node: ElkNode) => {
    // Skip the 'root' node itself
    if (node.id !== "root") {
      positions.push({
        nodeId: node.id,
        // ELK's x/y are already perfectly formatted for React Flow's relative positioning
        // For root-level nodes: absolute coordinates
        // For child nodes: relative to parent (0,0 = parent's top-left)
        x: node.x || 0,
        y: node.y || 0,
        // CRITICAL: Capture the newly calculated bounds for groups/contexts
        // ELK expands these dynamically when partitioning spreads children horizontally
        width: node.width,
        height: node.height,
      });
    }

    // Recursively extract children
    if (node.children && node.children.length > 0) {
      node.children.forEach(traverse);
    }
  };

  traverse(elkNode);
  return positions;
}

/**
 * Hook for ELK layout calculation in the main thread.
 *
 * Uses async yielding to prevent UI freezing while maintaining
 * compatibility with Next.js (avoids Web Worker issues).
 *
 * The 10ms yield allows React to paint loading states before
 * ELK calculation begins (~100ms for typical graphs).
 */
export function useElkLayout() {
  /**
   * Calculate layout for the given nodes and edges.
   * Returns a promise that resolves with the calculated positions.
   *
   * The async yield ensures the UI can update (show loading spinner)
   * before the synchronous ELK calculation blocks the main thread.
   */
  const calculateLayout = useCallback(
    async (
      nodes: HexagonNode[],
      edges: HexagonEdge[],
      direction: "RIGHT" | "DOWN" | "LEFT" | "UP" = "RIGHT",
    ): Promise<LayoutResponse> => {
      // 1. Yield to the React render cycle
      // This gives the browser a frame to paint the "Calculating layout..." spinner
      // before the ELK algorithm temporarily blocks the main thread
      await new Promise((resolve) => setTimeout(resolve, 10));

      try {
        // Convert to layout request format
        const layoutNodes: LayoutNode[] = nodes.map((node) => {
          const layoutNode = node as HexagonNodeWithLayout;
          return {
            id: node.id,
            width: layoutNode.style?.width ?? 180,
            height: layoutNode.style?.height ?? 100,
            parentId: layoutNode.parentId,
            type: node.type,
            side: layoutNode.side,
          };
        });

        const layoutEdges: LayoutEdge[] = edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
        }));

        // 2. Build ELK graph structure
        const elkGraph = buildElkGraph(layoutNodes, layoutEdges, direction);

        // 3. Run the calculation (synchronous, ~100ms for typical graphs)
        const layoutedGraph = await elk.layout(elkGraph);

        // 4. Extract positions
        const positions = extractPositions(layoutedGraph);

        return { positions };
      } catch (error) {
        console.error("ELK layout calculation failed:", error);
        throw new Error(
          `ELK layout failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [],
  );

  return {
    calculateLayout,
  };
}

// Made with Bob
