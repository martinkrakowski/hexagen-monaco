import type { WizardData } from "@hexagen/shared";
import type { HexagonNode, HexagonEdge } from "@hexagen/visualization";

/**
 * Extension of the domain HexagonNode to include layout-specific metadata.
 * These fields ride along in state and are used by HexagonNode to determine
 * handle placement and scale. Not part of the core domain model.
 */
export type HexagonNodeWithLayout = HexagonNode & {
  isRoot?: boolean;
  side?: "north" | "south" | "east" | "west";
  category?: string;
};

type Side = "north" | "south" | "east" | "west";

const SIDE_MAP: Record<string, Side> = {
  apiFramework: "east",
  uiFramework: "north",
  messagingAdapter: "north",
  webhookEndpoints: "north",
  persistenceAdapter: "south",
  telemetryProvider: "south",
  externalApiPorts: "west",
  llmProviders: "west",
  blockchainNetworks: "west",
  authenticationProvider: "west",
  emailService: "west",
  paymentGateway: "west",
  storageProvider: "west",
  searchService: "west",
};

// Fields intentionally excluded from the strategic context map.
// rootName drives the central node label; entities/useCases are tactical
// detail that belongs inside a bounded context, not on the map itself.
const STRATEGIC_MAP_EXCLUDED = new Set(["rootName", "entities", "useCases"]);

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const centerX = 2000;
  const centerY = 2000;
  const orbitRadius = 450;
  const stackGap = 180;

  // Central root node — 400px component, centered at (centerX, centerY)
  nodes.push({
    id: "root-core",
    label: wizardData.rootName?.trim() || "Project Root",
    type: "bounded-context",
    position: { x: centerX - 200, y: centerY - 200 },
    isRoot: true,
  });

  // Grouping pass — only SIDE_MAP keys are included
  const groups: Record<Side, { key: string; val: string | string[] }[]> = {
    north: [],
    south: [],
    east: [],
    west: [],
  };

  Object.entries(wizardData).forEach(([key, value]) => {
    const side = SIDE_MAP[key];
    if (value && side) {
      groups[side].push({ key, val: value as string | string[] });
    } else if (value && !STRATEGIC_MAP_EXCLUDED.has(key) && process.env.NODE_ENV === "development") {
      console.warn(
        `[layout-engine] WizardData key "${key}" has a value but no SIDE_MAP entry — it will not appear on the context map. Add it to SIDE_MAP to include it.`,
      );
    }
  });

  // Positioning and edge generation — deterministic cardinal stacking
  (Object.entries(groups) as [Side, { key: string; val: string | string[] }[]][]).forEach(
    ([side, items]) => {
      items.forEach((item, index) => {
        const total = items.length;
        const offset = (index - (total - 1) / 2) * stackGap;

        let tx = centerX;
        let ty = centerY;

        if (side === "east") { tx += orbitRadius; ty += offset; }
        else if (side === "west") { tx -= orbitRadius; ty += offset; }
        else if (side === "north") { tx += offset; ty -= orbitRadius; }
        else if (side === "south") { tx += offset; ty += orbitRadius; }

        const displayVal = Array.isArray(item.val)
          ? item.val.join(", ")
          : String(item.val);
        const category = item.key.replace(/([A-Z])/g, " $1").trim();

        // Satellite node — 160px component, centered at (tx, ty)
        nodes.push({
          id: item.key,
          label: displayVal,
          category,
          type: "bounded-context",
          position: { x: tx - 80, y: ty - 80 },
          side,
          isRoot: false,
        });

        edges.push({
          id: `edge-${item.key}`,
          source: item.key,
          target: "root-core",
          targetHandle: side,
          type: "smoothstep",
        });
      });
    },
  );

  return { nodes, edges };
}
