export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;
  type?: string;
  side?: "north" | "south" | "east" | "west";
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

export interface LayoutPosition {
  nodeId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const LAYER_PRIORITY: Record<string, number> = {
  "adapter-primary": 0,
  "port-primary": 1,
  entity: 2,
  "use-case": 2,
  "bounded-context": 2,
  "port-secondary": 3,
  "adapter-secondary": 4,
  peer: 5,
  group: 6,
  inner: 2,
};

export function getLayerPriority(node: LayoutNode): number {
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

export function getPartitionLane(node: LayoutNode): number {
  const type = node.type || "";
  const side = node.side || "";
  const id = node.id.toLowerCase();

  if (type === "adapter") {
    return side === "west" || side === "north" ? 1 : 5;
  }

  if (type === "port") {
    return side === "west" || side === "north" ? 2 : 4;
  }

  if (type === "use-case" || id.includes("usecase") || id.includes("use-case")) {
    return 2;
  }

  if (type === "entity" || type === "domain" || id.includes("domain")) {
    return 3;
  }

  if (type === "group") {
    if (id.includes("usecase") || id.includes("use-case")) return 2;
    if (id.includes("domain")) return 3;
  }

  if (type === "bounded-context" || type === "peer") {
    return 3;
  }

  return 3;
}

export function calculateCompassX(
  side: string,
  parentWidth: number,
  nodeWidth: number,
): number {
  const padding = 30;
  switch (side) {
    case "west":
    case "driving":
      return padding;
    case "east":
    case "driven":
      return parentWidth - nodeWidth - padding;
    case "north":
    case "south":
    case "presentation":
    case "infrastructure":
      return (parentWidth - nodeWidth) / 2;
    default:
      return (parentWidth - nodeWidth) / 2;
  }
}

export function calculateCompassY(
  side: string,
  parentHeight: number,
  nodeHeight: number,
): number {
  const padding = 30;
  const topPadding = 60;
  switch (side) {
    case "north":
    case "presentation":
      return topPadding;
    case "south":
    case "infrastructure":
      return parentHeight - nodeHeight - padding;
    case "west":
    case "east":
    case "driving":
    case "driven":
      return (parentHeight - nodeHeight) / 2;
    default:
      return (parentHeight - nodeHeight) / 2;
  }
}

export interface ElkGraphNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  children?: ElkGraphNode[];
  edges?: ElkGraphEdge[];
  layoutOptions?: Record<string, string>;
}

export interface ElkGraphEdge {
  id: string;
  sources: string[];
  targets: string[];
}

export interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  children: ElkGraphNode[];
  edges: ElkGraphEdge[];
}

export function buildElkGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: "RIGHT" | "DOWN" | "LEFT" | "UP",
): ElkGraph {
  const elkNodesById: Record<string, ElkGraphNode> = {};
  const rootChildren: ElkGraphNode[] = [];
  const nodeParentMap: Record<string, string> = {};

  nodes.forEach((node) => {
    const isBoundedContext = node.type === "bounded-context";
    const isSubGroup = node.type === "group";
    const priority = getLayerPriority(node);

    elkNodesById[node.id] = {
      id: node.id,
      width: node.width || 150,
      height: node.height || 50,
      children: [],
      layoutOptions: isBoundedContext
        ? {
            "elk.algorithm": "box",
            "elk.padding": "[top=60,left=30,bottom=30,right=30]",
            "elk.nodeLabels.placement": "INSIDE V_TOP H_LEFT",
            "elk.hierarchyHandling": "INCLUDE_CHILDREN",
            "elk.spacing.nodeNode": "40",
          }
        : isSubGroup
          ? {
              "elk.algorithm": "layered",
              "elk.direction": direction,
              "elk.padding": "[top=40,left=15,bottom=15,right=15]",
              "elk.partitioning.activate": "true",
              "elk.spacing.nodeNode": "30",
              "elk.layered.spacing.nodeNodeBetweenLayers": "40",
            }
          : {
              "layered.priority": priority.toString(),
            },
    };
  });

  nodes.forEach((node) => {
    const hasChildren = nodes.some((n) => n.parentId === node.id);
    if (hasChildren && node.type !== "bounded-context" && node.type !== "group") {
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

  nodes.forEach((node) => {
    const elkNode = elkNodesById[node.id];

    if (node.parentId && elkNodesById[node.parentId]) {
      const parentElkNode = elkNodesById[node.parentId];
      const parentNode = nodes.find((n) => n.id === node.parentId);

      nodeParentMap[node.id] = node.parentId;

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

        const northTypes = ["north", "presentation"];
        const southTypes = ["south", "infrastructure"];
        const eastWestTypes = ["east", "west", "driven", "driving"];

        if (northTypes.includes(node.side) || southTypes.includes(node.side)) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.spacing.nodeNode": "30",
            "elk.padding": "[top=30,left=30,bottom=30,right=30]",
          };
        } else if (eastWestTypes.includes(node.side)) {
          elkNode.layoutOptions = {
            ...elkNode.layoutOptions,
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.spacing.nodeNode": "30",
            "elk.padding": "[top=30,left=30,bottom=30,right=30]",
          };
        }
      } else {
        const parentWidth = parentNode?.width || 800;
        const parentHeight = parentNode?.height || 600;
        const nodeId = node.id.toLowerCase();

        if (nodeId.includes("domain")) {
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2 - 60;
        } else if (nodeId.includes("usecase") || nodeId.includes("use-case")) {
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2 + 20;
        } else {
          elkNode.x = (parentWidth - (elkNode.width || 150)) / 2;
          elkNode.y = (parentHeight - (elkNode.height || 50)) / 2;
        }
      }

      parentElkNode.children!.push(elkNode);
    } else {
      const lane = getPartitionLane(node);
      elkNode.layoutOptions = {
        ...elkNode.layoutOptions,
        "elk.partitioning.partition": lane.toString(),
      };

      rootChildren.push(elkNode);
    }
  });

  const findLowestCommonContainer = (
    sourceId: string,
    targetId: string,
    parentMap: Record<string, string>,
  ): string => {
    if (sourceId === targetId) return parentMap[sourceId] || "root";

    const sourcePath = new Set<string>();
    let currentSource: string | undefined = parentMap[sourceId];

    while (currentSource) {
      sourcePath.add(currentSource);
      currentSource = parentMap[currentSource];
    }
    sourcePath.add("root");

    let currentTarget: string | undefined = parentMap[targetId];
    while (currentTarget) {
      if (sourcePath.has(currentTarget)) {
        return currentTarget;
      }
      currentTarget = parentMap[currentTarget];
    }

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
    if (
      isAncestorOf(edge.source, edge.target, nodeParentMap) ||
      isAncestorOf(edge.target, edge.source, nodeParentMap)
    ) {
      return;
    }

    const sourceHasParent = !!nodeParentMap[edge.source];
    const targetHasParent = !!nodeParentMap[edge.target];
    if (sourceHasParent !== targetHasParent) {
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

  Object.entries(edgesByParent).forEach(([parentId, parentEdges]) => {
    const elkEdges = parentEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

    if (parentId === "root") {
      rootChildren.forEach((child) => {
        if (!child.edges) child.edges = [];
      });
    } else {
      const parentElkNode = elkNodesById[parentId];
      if (parentElkNode) {
        if (!parentElkNode.edges) parentElkNode.edges = [];
        parentElkNode.edges.push(...elkEdges);
      }
    }
  });

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
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
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

export function extractPositions(elkNode: ElkGraphNode): LayoutPosition[] {
  const positions: LayoutPosition[] = [];

  const traverse = (node: ElkGraphNode) => {
    if (node.id !== "root") {
      positions.push({
        nodeId: node.id,
        x: node.x || 0,
        y: node.y || 0,
        width: node.width,
        height: node.height,
      });
    }

    if (node.children && node.children.length > 0) {
      node.children.forEach(traverse);
    }
  };

  traverse(elkNode);
  return positions;
}