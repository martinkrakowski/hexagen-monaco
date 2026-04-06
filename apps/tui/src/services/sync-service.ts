import type { ViolationItem } from "../state/use-tui-store.js";
import type { MCPClientService } from "./mcp-client.service.js";

interface ReadResourceResponse {
  contents: Array<{ text?: string }>;
}

interface LinterReport {
  violations?: ViolationItem[];
  isCompliant?: boolean;
}

export async function loadViolations(
  mcpClient: MCPClientService,
): Promise<{ violations: ViolationItem[]; compliant: boolean }> {
  const response = (await mcpClient.readResource(
    "architecture://linter-report",
  )) as ReadResourceResponse;
  const raw = response.contents?.[0]?.text ?? "{}";
  const report = JSON.parse(raw) as LinterReport;

  return {
    violations: report.violations ?? [],
    compliant: report.isCompliant ?? true,
  };
}
