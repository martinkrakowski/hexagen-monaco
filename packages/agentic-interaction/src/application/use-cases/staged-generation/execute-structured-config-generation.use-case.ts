import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  DomainAnalysis,
  ClassificationResult,
  AssembledManifest,
  NormalizedPrompt,
} from "../../../domain/value-objects/pipeline-state.js";
import { ExecutePortMappingUseCase } from "./execute-port-mapping.use-case.js";
import { ExecuteAdapterAssignmentUseCase } from "./execute-adapter-assignment.use-case.js";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case.js";
import { ExecuteValidationReviewUseCase } from "./execute-validation-review.use-case.js";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt.js";

export interface StructuredConfigGenerationCallbacks {
  onProgress?: (stage: number, durationMs: number) => void;
  onError?: (stage: number, error: string, durationMs?: number) => void;
  onChunk?: (chunk: string) => void;
}

export type StructuredConfigInput = {
  rawConfig: string;
  options: Record<string, unknown>;
};

type StructuredConfig = {
  bounded_contexts: Array<{ id: string; name: string }>;
  use_cases: Array<{ id: string; name: string; context_id: string }>;
  context_mappings: Array<{
    source_context_id: string;
    target_context_id: string;
    mapping_type: string;
  }>;
};

type StageResult<T> =
  | { success: true; value: T }
  | { success: false; error: unknown };

export function buildNormalizedPromptFromConfig(
  config: StructuredConfig,
): NormalizedPrompt {
  return {
    intent: `Structured config with contexts: ${config.bounded_contexts.map((c) => c.name).join(", ")}`,
    explicitTechnologies: [],
    explicitPatterns: [],
    ambiguities: [],
  };
}

export function buildDomainAnalysisFromConfig(
  config: StructuredConfig,
): DomainAnalysis {
  return {
    verbs: config.use_cases.map((uc) => uc.name),
    nouns: config.bounded_contexts.map((ctx) => ctx.name),
    subdomains: config.bounded_contexts.map((ctx) => ctx.name),
  };
}

export function buildClassificationFromConfig(
  config: StructuredConfig,
): ClassificationResult {
  return {
    accepted: config.bounded_contexts.map((ctx) => ({
      name: ctx.name,
      type: "core" as const,
      reasoning: "Extracted from structured config",
    })),
    rejected: [],
    uncertain: [],
  };
}

export class ExecuteStructuredConfigGenerationUseCase {
  private readonly stage3: ExecutePortMappingUseCase;
  private readonly stage4: ExecuteAdapterAssignmentUseCase;
  private readonly stage5: ExecuteManifestAssemblyUseCase;
  private readonly stage6: ExecuteValidationReviewUseCase;
  private readonly cache = new Map<string, AssembledManifest>();

  constructor(llmPort: SendStructuredRequestPort) {
    this.stage3 = new ExecutePortMappingUseCase(llmPort);
    this.stage4 = new ExecuteAdapterAssignmentUseCase(llmPort);
    this.stage5 = new ExecuteManifestAssemblyUseCase();
    this.stage6 = new ExecuteValidationReviewUseCase(llmPort);
  }

  async execute(
    rawConfig: string,
    callbacks?: StructuredConfigGenerationCallbacks,
  ): Promise<StageResult<AssembledManifest>> {
    // Idempotency check
    const cached = this.cache.get(rawConfig);
    if (cached) {
      return { success: true, value: cached };
    }

    // Stage 0: Parse config + build NormalizedPrompt (synchronous, deterministic)
    const s0Start = Date.now();
    callbacks?.onProgress?.(0, 0);
    let config: StructuredConfig;
    let normalizedPrompt: NormalizedPrompt;
    try {
      config = JSON.parse(rawConfig) as StructuredConfig;
      normalizedPrompt = buildNormalizedPromptFromConfig(config);
    } catch {
      const durationMs = Date.now() - s0Start;
      callbacks?.onError?.(
        0,
        "Failed to parse structured config: only JSON format is supported",
        durationMs,
      );
      return {
        success: false,
        error: new Error(
          "Failed to parse structured config: only JSON format is supported",
        ),
      };
    }
    const s0Duration = Date.now() - s0Start;
    callbacks?.onProgress?.(0, s0Duration);

    // Stage 1: Build DomainAnalysis (synchronous, deterministic)
    const s1Start = Date.now();
    callbacks?.onProgress?.(1, 0);
    buildDomainAnalysisFromConfig(config);
    const s1Duration = Date.now() - s1Start;
    callbacks?.onProgress?.(1, s1Duration);

    // Stage 2: Build ClassificationResult (synchronous, deterministic)
    const s2Start = Date.now();
    callbacks?.onProgress?.(2, 0);
    const classification = buildClassificationFromConfig(config);
    const s2Duration = Date.now() - s2Start;
    callbacks?.onProgress?.(2, s2Duration);

    // Stage 3: Port Mapping
    const s3Start = Date.now();
    callbacks?.onProgress?.(3, 0);
    const s3 = await this.stage3.execute(
      {
        stage0: normalizedPrompt,
        stage1: buildDomainAnalysisFromConfig(config),
        stage2: classification,
      },
      callbacks?.onChunk,
    );
    const s3Duration = Date.now() - s3Start;
    if (!s3.success) {
      callbacks?.onError?.(3, String(s3.error), s3Duration);
      return { success: false, error: s3.error };
    }
    callbacks?.onProgress?.(3, s3Duration);

    // Stage 4: Adapter Assignment
    const s4Start = Date.now();
    callbacks?.onProgress?.(4, 0);
    const variables: PromptVariables = {
      userDescription: JSON.stringify(config),
    };
    const s4 = await this.stage4.execute(
      {
        stage0: normalizedPrompt,
        stage2: classification,
        stage3: s3.value.portMap,
        contextMappings: s3.value.contextMappings,
      },
      variables,
      callbacks?.onChunk,
    );
    const s4Duration = Date.now() - s4Start;
    if (!s4.success) {
      callbacks?.onError?.(4, String(s4.error), s4Duration);
      return { success: false, error: s4.error };
    }
    callbacks?.onProgress?.(4, s4Duration);

    // Stage 5: Manifest Assembly (synchronous, returns AssembledManifest directly)
    const s5Start = Date.now();
    callbacks?.onProgress?.(5, 0);
    const assembledManifest = this.stage5.execute({
      stage0: normalizedPrompt,
      stage2: classification,
      stage3: s3.value.portMap,
      stage4: s4.value,
    });
    const s5Duration = Date.now() - s5Start;
    callbacks?.onProgress?.(5, s5Duration);

    // Stage 6: Validation Review
    const s6Start = Date.now();
    callbacks?.onProgress?.(6, 0);
    const s6 = await this.stage6.execute(
      { stage5: assembledManifest },
      callbacks?.onChunk,
    );
    const s6Duration = Date.now() - s6Start;
    if (!s6.success) {
      callbacks?.onError?.(6, String(s6.error), s6Duration);
      return { success: false, error: s6.error };
    }
    callbacks?.onProgress?.(6, s6Duration);

    // Cache successful result
    this.cache.set(rawConfig, assembledManifest);

    return { success: true, value: assembledManifest };
  }
}
