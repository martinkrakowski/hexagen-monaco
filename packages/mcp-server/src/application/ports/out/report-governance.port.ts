export type ReportPhase =
  | "01-blueprint"
  | "02-implementation"
  | "03-verification"
  | "04-remediation";

export interface ReportManifest {
  featureId: string;
  currentPhase: ReportPhase;
  phaseHistory: Array<{ phase: ReportPhase; timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface InitializeFeatureWorktreeInput {
  featureId: string;
}

export interface InitializeFeatureWorktreeOutput {
  featureId: string;
  phase: ReportPhase;
  manifest: ReportManifest;
}

export interface SubmitArchitecturalSpecInput {
  featureId: string;
  specContent: string;
}

export interface SubmitArchitecturalSpecOutput {
  featureId: string;
  phase: ReportPhase;
  success: boolean;
  error?: string;
}

export interface LogAgentRemediationInput {
  featureId: string;
  agentId: string;
  remediationContent: string;
}

export interface LogAgentRemediationOutput {
  featureId: string;
  logged: boolean;
  error?: string;
}

export interface GetFeatureContextInput {
  featureId: string;
}

export interface GetFeatureContextOutputBase {
  featureId: string;
  currentPhase: ReportPhase;
  manifest: ReportManifest;
  phaseHistory: Array<{
    from: ReportPhase | null;
    to: ReportPhase;
    occurredAt: number;
  }>;
}

export type GetFeatureContextOutput = GetFeatureContextOutputBase | null;

export interface ReportGovernancePort {
  initializeFeatureWorktree(
    input: InitializeFeatureWorktreeInput,
  ): Promise<InitializeFeatureWorktreeOutput>;
  submitArchitecturalSpec(
    input: SubmitArchitecturalSpecInput,
  ): Promise<SubmitArchitecturalSpecOutput>;
  logAgentRemediation(
    input: LogAgentRemediationInput,
  ): Promise<LogAgentRemediationOutput>;
  getFeatureContext(
    input: GetFeatureContextInput,
  ): Promise<GetFeatureContextOutput>;
}
