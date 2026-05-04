import type { ToolDefinition } from "./tool-definition.js";
import { auditBoundariesTool } from "./audit-boundaries.js";
import { scaffoldModuleTool } from "./scaffold-module.js";
import { addDependencyTool } from "./add-dependency.js";
import { createPortTool } from "./create-port.js";
import { createAdapterTool } from "./create-adapter.js";
import { removePortTool } from "./remove-port.js";
import { removeContextTool } from "./remove-context.js";
import { createContextTool } from "./create-context.js";
import { diffManifestTool } from "./diff-manifest.js";
import { initializeFeatureWorktreeTool } from "./initialize-feature-worktree.js";
import { submitArchitecturalSpecTool } from "./submit-architectural-spec.js";
import { logAgentRemediationTool } from "./log-agent-remediation.js";
import { getTransactionTool } from "./get-transaction.js";
import { listTransactionsTool } from "./list-transactions.js";
import { acceptTransactionTool } from "./accept-transaction.js";
import { rejectTransactionTool } from "./reject-transaction.js";
import { generateTopologyTool } from "./generate-topology.js";
import { generateAdaptersTool } from "./generate-adapters.js";
import { generateManifestPipelineTool } from "./generate-manifest-pipeline.js";

const allTools: ToolDefinition[] = [
  auditBoundariesTool,
  scaffoldModuleTool,
  addDependencyTool,
  createPortTool,
  createAdapterTool,
  removePortTool,
  removeContextTool,
  createContextTool,
  diffManifestTool,
  initializeFeatureWorktreeTool,
  submitArchitecturalSpecTool,
  logAgentRemediationTool,
  getTransactionTool,
  listTransactionsTool,
  acceptTransactionTool,
  rejectTransactionTool,
  generateTopologyTool,
  generateAdaptersTool,
  generateManifestPipelineTool,
];

export const toolRegistry: Map<string, ToolDefinition> = new Map(
  allTools.map((tool) => [tool.name, tool]),
);

export { allTools };
