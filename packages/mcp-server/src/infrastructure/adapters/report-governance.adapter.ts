import type {
  ReportGovernancePort,
  InitializeFeatureWorktreeInput,
  InitializeFeatureWorktreeOutput,
  SubmitArchitecturalSpecInput,
  SubmitArchitecturalSpecOutput,
  LogAgentRemediationInput,
  LogAgentRemediationOutput,
  GetFeatureContextInput,
  GetFeatureContextOutput,
} from "../../application/ports/out/report-governance.port.js";
import {
  InitializeFeatureWorktreeUseCase,
  SubmitArchitecturalSpecUseCase,
  LogAgentRemediationUseCase,
  GetFeatureContextUseCase,
  createFeatureId,
  featureIdValue,
  FileSystemReportAdapter,
  timestampValue,
} from "@hexagen/report-governance";

export class ReportGovernanceAdapter implements ReportGovernancePort {
  private readonly initUseCase: InitializeFeatureWorktreeUseCase;
  private readonly specUseCase: SubmitArchitecturalSpecUseCase;
  private readonly remediationUseCase: LogAgentRemediationUseCase;
  private readonly contextUseCase: GetFeatureContextUseCase;

  constructor(private readonly workspaceRoot: string) {
    const repository = new FileSystemReportAdapter();
    this.initUseCase = new InitializeFeatureWorktreeUseCase(repository);
    this.specUseCase = new SubmitArchitecturalSpecUseCase(repository);
    this.remediationUseCase = new LogAgentRemediationUseCase(repository);
    this.contextUseCase = new GetFeatureContextUseCase(repository);
  }

  async initializeFeatureWorktree(
    input: InitializeFeatureWorktreeInput,
  ): Promise<InitializeFeatureWorktreeOutput> {
    const featureId = createFeatureId(input.featureId);
    const result = await this.initUseCase.execute(featureId, this.workspaceRoot);

    if (!result.success) {
      throw result.error;
    }

    return {
      featureId: featureIdValue(featureId),
      phase: result.value.currentPhase,
      manifest: {
        featureId: featureIdValue(result.value.manifest.featureId),
        currentPhase: result.value.manifest.currentPhase,
        phaseHistory: result.value.manifest.phaseHistory.map((transition) => ({
          phase: transition.to,
          timestamp: String(timestampValue(transition.occurredAt)),
        })),
        createdAt: String(timestampValue(result.value.manifest.createdAt)),
        updatedAt: String(timestampValue(result.value.manifest.updatedAt)),
      },
    };
  }

  async submitArchitecturalSpec(
    input: SubmitArchitecturalSpecInput,
  ): Promise<SubmitArchitecturalSpecOutput> {
    try {
      const featureId = createFeatureId(input.featureId);
      const result = await this.specUseCase.execute(
        featureId,
        input.specContent,
        this.workspaceRoot,
      );

      if (!result.success) {
        return {
          featureId: featureIdValue(featureId),
          phase: "02-implementation",
          success: false,
          error: result.error instanceof Error ? result.error.message : String(result.error),
        };
      }

      return {
        featureId: featureIdValue(featureId),
        phase: "02-implementation",
        success: true,
      };
    } catch (err) {
      const featureId = createFeatureId(input.featureId);
      return {
        featureId: featureIdValue(featureId),
        phase: "02-implementation",
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async logAgentRemediation(
    input: LogAgentRemediationInput,
  ): Promise<LogAgentRemediationOutput> {
    try {
      const featureId = createFeatureId(input.featureId);
      const result = await this.remediationUseCase.execute(
        featureId,
        "opencode-agent",
        input.remediationContent,
        this.workspaceRoot,
      );

      if (!result.success) {
        return {
          featureId: featureIdValue(featureId),
          logged: false,
          error: result.error instanceof Error ? result.error.message : String(result.error),
        };
      }

      return {
        featureId: featureIdValue(featureId),
        logged: true,
      };
    } catch (err) {
      const featureId = createFeatureId(input.featureId);
      return {
        featureId: featureIdValue(featureId),
        logged: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getFeatureContext(input: GetFeatureContextInput): Promise<GetFeatureContextOutput> {
    try {
      const featureId = createFeatureId(input.featureId);
      const result = await this.contextUseCase.execute(featureId, this.workspaceRoot);

      if (!result.success) {
        return null;
      }

      if (!result.value) {
        return null;
      }

      return {
        featureId: featureIdValue(result.value.manifest.featureId),
        currentPhase: result.value.currentPhase,
        manifest: {
          featureId: featureIdValue(result.value.manifest.featureId),
          currentPhase: result.value.manifest.currentPhase,
          phaseHistory: result.value.manifest.phaseHistory.map((transition) => ({
            phase: transition.to,
            timestamp: String(timestampValue(transition.occurredAt)),
          })),
          createdAt: String(timestampValue(result.value.manifest.createdAt)),
          updatedAt: String(timestampValue(result.value.manifest.updatedAt)),
        },
        phaseHistory: result.value.manifest.phaseHistory.map((transition) => ({
          from: transition.from,
          to: transition.to,
          occurredAt: timestampValue(transition.occurredAt),
        })),
      };
    } catch {
      return null;
    }
  }
}
