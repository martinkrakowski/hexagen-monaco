import type { MCPServerAdapterDependencies } from "../mcp-server.types.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: (
    deps: MCPServerAdapterDependencies,
  ) => Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }>;
}

const resources: ResourceDefinition[] = [
  {
    uri: "architecture://manifest",
    name: "Architecture Manifest",
    description: "HexaGen architecture manifest",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getManifestResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://manifest",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://graph",
    name: "Architecture Graph",
    description: "Bounded context dependency graph",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getGraphResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://graph",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://linter-report",
    name: "Architecture Linter Report",
    description: "Latest architecture lint report",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getLinterReportResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://linter-report",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://decisions",
    name: "Architecture Decisions",
    description: "ADR documents from .architecture/decisions/",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getDecisionsResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://decisions",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://invariants",
    name: "Architecture Invariants",
    description: "Layer rules and cross-package boundaries",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getInvariantsResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://invariants",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://linter-config",
    name: "Linter Configuration",
    description: "Package-level linter rules",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getLinterConfigResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://linter-config",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: "architecture://workspace-context",
    name: "Workspace Context",
    description: "High-level workspace metadata",
    mimeType: "application/json",
    read: async (deps) => {
      const result = await deps.getWorkspaceContextResourceUseCase.execute();
      if (!result.success) throw result.error;
      return {
        contents: [
          {
            uri: "architecture://workspace-context",
            mimeType: "application/json",
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    },
  },
];

export const resourceRegistry: Map<string, ResourceDefinition> = new Map(
  resources.map((r) => [r.uri, r]),
);

export { resources };
