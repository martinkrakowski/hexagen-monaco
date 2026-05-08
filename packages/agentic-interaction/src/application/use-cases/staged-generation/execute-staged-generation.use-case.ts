import type { SendStructuredRequestPort } from "@hexagen/local-llm/shared";
import type {
  PipelineState,
  ValidationReport,
} from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";
import { ExecutePromptNormalizationUseCase } from "./execute-prompt-normalization.use-case.js";
import { ExecuteDomainExtractionUseCase } from "./execute-domain-extraction.use-case.js";
import { ExecuteContextClassificationUseCase } from "./execute-context-classification.use-case.js";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case.js";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case.js";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case.js";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case.js";

export interface StagedGenerationCallbacks {
  onStageStart?: (stage: number, label: string) => void;
  onStageComplete?: (stage: number, label: string, durationMs: number) => void;
  onChunk?: (stage: number, chunk: string) => void;
  onValidationError?: (stage: number, errors: string[]) => void;
}

type StageResult<T> =
  | { success: true; value: T }
  | { success: false; error: unknown };

export class ExecuteStagedGenerationUseCase {
  private readonly stage0: ExecutePromptNormalizationUseCase;
  private readonly stage1: ExecuteDomainExtractionUseCase;
  private readonly stage2: ExecuteContextClassificationUseCase;
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;

  constructor(llmPort: SendStructuredRequestPort) {
    this.stage0 = new ExecutePromptNormalizationUseCase(llmPort);
    this.stage1 = new ExecuteDomainExtractionUseCase(llmPort);
    this.stage2 = new ExecuteContextClassificationUseCase(llmPort);
    this.stage3 = new ExecutePortMappingUseCase(llmPort);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
  }

  async execute(
    userDescription: string,
    variables: PromptVariables,
    callbacks?: StagedGenerationCallbacks,
  ): Promise<
    | {
        success: true;
        state: PipelineState;
        validation: ValidationReport;
      }
    | { success: false; error: unknown; state?: PipelineState }
  > {
    const state: PipelineState = {};

    const runStage = async <T>(
      stageNum: number,
      label: string,
      fn: () => Promise<StageResult<T>>,
    ): Promise<StageResult<T>> => {
      callbacks?.onStageStart?.(stageNum, label);
      const start = Date.now();
      const result = await fn();
      const duration = Date.now() - start;
      callbacks?.onStageComplete?.(stageNum, label, duration);
      return result;
    };

    // Stage 0: Prompt Normalization
    const s0 = await runStage(0, "Prompt Normalization", () =>
      this.stage0.execute(userDescription, variables, (chunk) =>
        callbacks?.onChunk?.(0, chunk),
      ),
    );
    if (!s0.success) return { success: false, error: s0.error, state };
    state.stage0 = s0.value;

    // Stage 1: Domain Extraction
    const s1 = await runStage(1, "Domain Extraction", () =>
      this.stage1.execute({ stage0: state.stage0 }, (chunk) =>
        callbacks?.onChunk?.(1, chunk),
      ),
    );
    if (!s1.success) return { success: false, error: s1.error, state };
    state.stage1 = s1.value;

    // Stage 2: Context Classification
    const s2 = await runStage(2, "Context Classification", () =>
      this.stage2.execute(
        { stage0: state.stage0, stage1: state.stage1 },
        (chunk) => callbacks?.onChunk?.(2, chunk),
      ),
    );
    if (!s2.success) return { success: false, error: s2.error, state };
    state.stage2 = s2.value;

    // Stage 3: Port Mapping
    const s3 = await runStage(3, "Port Mapping", () =>
      this.stage3.execute({ stage2: state.stage2 }, (chunk) =>
        callbacks?.onChunk?.(3, chunk),
      ),
    );
    if (!s3.success) return { success: false, error: s3.error, state };
    state.stage3 = s3.value;

    // Stage 4: Adapter Assignment
    const s4 = await runStage(4, "Adapter Assignment", () =>
      this.stage4.execute(
        { stage0: state.stage0, stage3: state.stage3 },
        variables,
        (chunk) => callbacks?.onChunk?.(4, chunk),
      ),
    );
    if (!s4.success) return { success: false, error: s4.error, state };
    state.stage4 = s4.value;

    // Stage 5: Manifest Assembly (synchronous)
    callbacks?.onStageStart?.(5, "Manifest Assembly");
    const start5 = Date.now();
    const s5 = this.stage5.execute({
      stage0: state.stage0,
      stage2: state.stage2,
      stage3: state.stage3,
      stage4: state.stage4,
    });
    callbacks?.onStageComplete?.(5, "Manifest Assembly", Date.now() - start5);
    state.stage5 = s5;

    // Stage 6: Validation Review
    const s6 = await runStage(6, "Validation Review", () =>
      this.stage6.execute({ stage5: state.stage5 }, (chunk) =>
        callbacks?.onChunk?.(6, chunk),
      ),
    );
    if (!s6.success) return { success: false, error: s6.error, state };
    state.stage6 = s6.value;

    if (s6.value.errors.length > 0) {
      callbacks?.onValidationError?.(6, s6.value.errors);
    }

    return {
      success: true,
      state,
      validation: s6.value,
    };
  }
}
