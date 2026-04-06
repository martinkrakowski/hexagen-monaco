import type { NavigationItem } from "../state/use-tui-store.js";
import type { MCPClientService } from "./mcp-client.service.js";

interface ReadResourceResponse {
  contents: Array<{ text?: string }>;
}

interface ManifestDoc {
  bounded_contexts?: Array<{
    name: string;
    type?: string;
    depends_on?: string[];
  }>;
}

export async function loadNavigationTree(
  mcpClient: MCPClientService,
): Promise<NavigationItem[]> {
  const response = (await mcpClient.readResource(
    "architecture://manifest",
  )) as ReadResourceResponse;
  const raw = response.contents?.[0]?.text ?? "{}";
  const manifest = JSON.parse(raw) as ManifestDoc;

  return (manifest.bounded_contexts ?? []).map((context) => ({
    id: context.name,
    label: context.name,
    type: context.type ?? "supporting",
    dependsOn: context.depends_on ?? [],
  }));
}

export function deriveRulesForDomain(item: NavigationItem | undefined) {
  if (!item) {
    return [];
  }

  return [
    {
      id: `${item.id}-rule-1`,
      text: "Domain must not import infrastructure",
    },
    {
      id: `${item.id}-rule-2`,
      text: "Ports must be owned by one bounded context",
    },
    {
      id: `${item.id}-rule-3`,
      text: `Depends on: ${item.dependsOn.join(", ") || "none"}`,
    },
  ];
}
