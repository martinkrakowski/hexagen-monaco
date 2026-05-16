import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  PipelineState,
  NormalizedPrompt,
  DomainAnalysis,
  ClassificationResult,
  ClassifiedContext,
  ValidationReport,
} from "../../../domain/value-objects/pipeline-state.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case.js";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case.js";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case.js";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case.js";

/** Lifecycle callbacks emitted during structured config generation */
export interface StructuredConfigGenerationCallbacks {
  onStageStart?: (stage: number, label: string) => void;
  onStageComplete?: (stage: number, label: string, durationMs: number) => void;
  onChunk?: (stage: number, chunk: string) => void;
  onValidationError?: (stage: number, errors: string[]) => void;
}

/** Pre-parsed input for structured config generation */
export interface StructuredConfigInput {
  intent: string;
  explicitTechnologies: string[];
  subdomains: string[];
  classifiedContexts: ClassifiedContext[];
}

/** Build a deterministic DomainAnalysis from parsed structured input */
export function buildDomainAnalysisFromConfig(
  input: StructuredConfigInput,
): DomainAnalysis {
  return {
    verbs: [],
    nouns: [],
    subdomains: input.subdomains,
  };
}

/** Build a deterministic ClassificationResult from parsed structured input */
export function buildClassificationFromConfig(
  input: StructuredConfigInput,
): ClassificationResult {
  return {
    accepted: input.classifiedContexts,
    rejected: [],
    uncertain: [],
  };
}

/** Build a deterministic NormalizedPrompt from parsed structured input */
export function buildNormalizedPromptFromConfig(
  input: StructuredConfigInput,
): NormalizedPrompt {
  return {
    intent: input.intent,
    explicitTechnologies: input.explicitTechnologies,
    explicitPatterns: [],
    ambiguities: [],
  };
}

/**
 * Use case that generates a complete manifest from a pre-parsed structured config.
 * Stages 0–2 are deterministic (derived from input); stages 3–6 use LLM calls.
 */
export class ExecuteStructuredConfigGenerationUseCase {
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;

  constructor(llmPort: SendStructuredRequestPort) {
    this.stage3 = new ExecutePortMappingUseCase(llmPort);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
  }

  async execute(
    input: StructuredConfigInput,
    variables: PromptVariables,
    callbacks?: StructuredConfigGenerationCallbacks,
  ): Promise<
    | {
        success: true;
        state: PipelineState;
        validation: ValidationReport;
      }
    | { success: false; error: unknown; state?: PipelineState }
  > {
    const state: PipelineState = {};

    if (!input.intent) {
      return { success: false, error: "Intent is required" };
    }

    const runStage = async <T>(
      stageNum: number,
      label: string,
      fn: () => Promise<
        { success: true; value: T } | { success: false; error: unknown }
      >,
    ): Promise<
      { success: true; value: T } | { success: false; error: unknown }
    > => {
      callbacks?.onStageStart?.(stageNum, label);
      const start = Date.now();
      const result = await fn();
      const duration = Date.now() - start;
      callbacks?.onStageComplete?.(stageNum, label, duration);
      return result;
    };

    const runDeterministic = <T>(
      stageNum: number,
      label: string,
      fn: () => T,
    ): T => {
      callbacks?.onStageStart?.(stageNum, label);
      const start = Date.now();
      const result = fn();
      const duration = Date.now() - start;
      callbacks?.onStageComplete?.(stageNum, label, duration);
      return result;
    };

    state.stage0 = runDeterministic(0, "Config Parse", () =>
      buildNormalizedPromptFromConfig(input),
    );

    state.stage1 = runDeterministic(1, "Domain Analysis", () =>
      buildDomainAnalysisFromConfig(input),
    );

    state.stage2 = runDeterministic(2, "Context Classification", () =>
      buildClassificationFromConfig(input),
    );

    const s3 = await runStage(3, "Port Mapping", () =>
      this.stage3.execute({ stage2: state.stage2 }, (chunk) =>
        callbacks?.onChunk?.(3, chunk),
      ),
    );
    if (!s3.success) return { success: false, error: s3.error, state };
    state.stage3 = s3.value;

    const s4 = await runStage(4, "Adapter Assignment", () =>
      this.stage4.execute(
        { stage0: state.stage0, stage3: state.stage3 },
        variables,
        (chunk) => callbacks?.onChunk?.(4, chunk),
      ),
    );
    if (!s4.success) return { success: false, error: s4.error, state };
    state.stage4 = s4.value;

    callbacks?.onStageStart?.(5, "Manifest Assembly");
    const start5 = Date.now();
    state.stage5 = this.stage5.execute({
      stage0: state.stage0,
      stage2: state.stage2,
      stage3: state.stage3,
      stage4: state.stage4,
    });
    callbacks?.onStageComplete?.(5, "Manifest Assembly", Date.now() - start5);

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
