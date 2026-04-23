import type { Result } from "@hexagen/shared";

export interface GovernanceDecision {
  id: string;
  title: string;
  filename: string;
  content: string;
}

export interface LayerRule {
  layer: string;
  accessRule: string;
  allowedImports: string[];
}

export interface GovernanceInvariants {
  layerRules: LayerRule[];
  crossPackageRules: Array<{
    package: string;
    cannotImport?: string[];
    allowedImports?: string[];
  }>;
}

export interface LinterConfigEntry {
  name: string;
  allowedImports: string[];
}

export interface WorkspaceContext {
  systemName: string;
  scope: string;
  architecture: string;
  workspaceTemplate: string;
  boundedContextCount: number;
  appCount: number;
  packageManager: string;
  buildTool: string;
}

export interface GovernanceReadPort {
  getDecisions(): Promise<Result<GovernanceDecision[]>>;
  getInvariants(): Promise<Result<GovernanceInvariants>>;
  getLinterConfig(): Promise<Result<LinterConfigEntry[]>>;
  getWorkspaceContext(): Promise<Result<WorkspaceContext>>;
}
