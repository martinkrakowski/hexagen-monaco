import type { PipelineStep, PipelineRun } from "@hexagen/ai-pipeline";
import {
  createPipelineRun,
  createPipelineStep,
  startRun,
  completeRun,
  failRun,
  startStep,
  completeStep,
  failStep,
  updateRunStep,
} from "@hexagen/ai-pipeline";
import type { IntentLineage } from "@hexagen/core-domain";
import type {
  RenderedPrompt,
  ProjectSpecLike as PromptProjectSpecLike,
  PromptCompileRequest,
} from "@hexagen/prompt-compiler";
import type { LLMRequest } from "@hexagen/local-llm/shared";
import { DomainModelId } from "@hexagen/local-llm/shared";
import type {
  Patch,
  StructuredLLMOutput,
  ReconcileRequest,
} from "@hexagen/reconciliation-engine";
import type { Transaction } from "@hexagen/transaction-system";
import type { Result } from "@hexagen/shared";
import type { ModificationResult } from "../ports/in/architecture-modification.port.js";
import {
  STEP_PARSE,
  STEP_COMPILE_PROMPT,
  STEP_LLM_INFERENCE,
  STEP_RECONCILE,
  STEP_COMMIT,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAYS_MS,
  withRetry,
  LLMServiceError,
} from "./modify-architecture-types.js";
import type { ModifyArchitectureDeps } from "./modify-architecture-types.js";

export class ModifyArchitectureUseCase {
  constructor(private readonly deps: ModifyArchitectureDeps) {}

  async execute(
    intent: string,
    manifestPath: string,
    lineage: IntentLineage,
  ): Promise<Result<ModificationResult, Error>> {
    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    let run: PipelineRun = createPipelineRun(runId, intent, [
      createPipelineStep(STEP_PARSE, { intent }),
      createPipelineStep(STEP_COMPILE_PROMPT),
      createPipelineStep(STEP_LLM_INFERENCE),
      createPipelineStep(STEP_RECONCILE),
      createPipelineStep(STEP_COMMIT, { manifestPath }),
    ]);
    run = startRun(run);

    try {
      run = this.advanceStep(run, STEP_PARSE, startStep);
      await this.parseNL(intent);
      run = this.advanceStep(run, STEP_PARSE, completeStep);

      run = this.advanceStep(run, STEP_COMPILE_PROMPT, startStep);
      const renderedPrompt = await this.compilePrompt(intent);
      run = this.advanceStep(run, STEP_COMPILE_PROMPT, completeStep);

      run = this.advanceStep(run, STEP_LLM_INFERENCE, startStep);
      const llmOutput = await this.runLLMInference(renderedPrompt);
      run = this.advanceStep(run, STEP_LLM_INFERENCE, completeStep);

      run = this.advanceStep(run, STEP_RECONCILE, startStep);
      const patches = await this.reconcile(llmOutput, run.id);
      run = this.advanceStep(run, STEP_RECONCILE, completeStep);

      run = this.advanceStep(run, STEP_COMMIT, startStep);
      const txResult = this.beginTransaction(patches, lineage);
      if (!txResult.success) {
        run = this.advanceStep(run, STEP_COMMIT, (s) =>
          failStep(s, txResult.error.message),
        );
        run = failRun(run);
        return { success: false, error: txResult.error };
      }

      run = this.advanceStep(run, STEP_COMMIT, completeStep);
      run = completeRun(run);

      return {
        success: true,
        value: {
          pipelineRunId: run.id,
          patchesApplied: 0,
          lintPassed: null,
          transactionId: txResult.value.id,
          steps: run.steps,
          patches,
        },
      };
    } catch (err) {
      const currentStep = run.steps.find((s) => s.status === "running");
      if (currentStep) {
        run = updateRunStep(run, currentStep.name, (s) =>
          failStep(s, (err as Error).message),
        );
      }
      run = failRun(run);
      return { success: false, error: err as Error };
    }
  }

  private async parseNL(
    intent: string,
  ): Promise<import("@hexagen/core-domain").DomainCommand[]> {
    const result = await this.deps.nlParser.parse(intent);
    if (!result.success) {
      throw new Error(`NL parsing failed: ${result.error.message}`);
    }
    return result.value;
  }

  private async compilePrompt(intent: string): Promise<RenderedPrompt> {
    const manifest = await this.deps.manifestProvider();
    const architectureGraph = await this.deps.architectureGraphProvider();
    const linterReport = await this.deps.linterReportProvider();

    const request: PromptCompileRequest = {
      name: "architecture-modification",
      manifest: manifest as unknown as PromptProjectSpecLike,
      architectureGraph,
      linterReport,
      userIntent: intent,
    };
    const template = await this.deps.promptCompiler.compile(request);
    return this.deps.promptCompiler.render(template);
  }

  private async runLLMInference(
    renderedPrompt: RenderedPrompt,
  ): Promise<StructuredLLMOutput> {
    const { z } = await import("zod");
    const structuredOutputSchema = z.object({
      manifest: z.object({
        boundedContexts: z
          .array(z.object({ id: z.string(), name: z.string() }))
          .optional(),
        externalContexts: z.array(z.unknown()).optional(),
        governance: z.unknown().optional(),
        peerMappings: z.array(z.unknown()).optional(),
      }),
      architectureGraph: z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            type: z.string(),
            status: z.string().optional(),
          }),
        ),
        edges: z.array(
          z.object({
            source: z.string(),
            target: z.string(),
            relationship: z.string(),
            isValid: z.boolean(),
            violationReason: z.string().optional(),
          }),
        ),
      }),
      reasoning: z.string(),
    });

    const llmRequest: LLMRequest = {
      id: `llm-req-${Date.now()}`,
      modelId: DomainModelId.QWEN_CODER_3B,
      messages: [
        { role: "system", content: renderedPrompt.systemPrompt },
        { role: "user", content: renderedPrompt.userPrompt },
      ],
      schema: structuredOutputSchema,
      signal: this.deps.signal,
    };

    const executeLlmCall = async () => {
      const result = await this.deps.llmSender.sendRequest(llmRequest);
      if (!result.success) {
        const errMsg =
          result.error instanceof Error
            ? result.error.message
            : String(result.error);
        const statusCode = (result.error as Error & { statusCode?: number })
          ?.statusCode;
        if (typeof statusCode === "number") {
          throw new LLMServiceError(
            `LLM inference failed: ${errMsg}`,
            statusCode,
          );
        }
        throw new Error(`LLM inference failed: ${errMsg}`);
      }
      return result.value;
    };

    const result = await withRetry(executeLlmCall, {
      maxAttempts: MAX_RETRY_ATTEMPTS,
      delaysMs: RETRY_DELAYS_MS,
      signal: this.deps.signal,
    });

    const parsed = structuredOutputSchema.safeParse(JSON.parse(result.content));
    if (!parsed.success) {
      throw new Error(
        `LLM output schema validation failed: ${parsed.error.message}`,
      );
    }
    return parsed.data as StructuredLLMOutput;
  }

  private async reconcile(
    llmOutput: StructuredLLMOutput,
    intentId: string,
  ): Promise<Patch[]> {
    const currentManifest = await this.deps.manifestProvider();
    const linterReport = await this.deps.linterReportProvider();
    const request: ReconcileRequest = {
      structuredOutput: llmOutput,
      currentManifest,
      intentId,
    };
    const result = await this.deps.reconcileUseCase.execute(
      request,
      undefined,
      linterReport,
    );
    if (!result.success) {
      throw new Error(`Reconciliation failed: ${result.errors.join("; ")}`);
    }
    return result.patches;
  }

  private beginTransaction(
    patches: Patch[],
    lineage: IntentLineage,
  ): Result<Transaction, Error> {
    const transaction = this.deps.transactionManager.begin(lineage.intentId, {
      intentId: lineage.intentId,
      origin: lineage.origin,
      patches,
    });
    this.deps.transactionManager.transition(transaction.id, "speculative");
    return { success: true, value: transaction };
  }

  private advanceStep(
    run: PipelineRun,
    stepName: string,
    updater: (step: PipelineStep) => PipelineStep,
  ): PipelineRun {
    const preStep = run.steps.find((s) => s.name === stepName);
    const startTime = preStep?.startTime ?? Date.now();
    run = updateRunStep(run, stepName, (s) => ({
      ...updater(s),
      startTime: s.startTime ?? startTime,
    }));
    const postStep = run.steps.find((s) => s.name === stepName);
    if (postStep?.status === "running") {
      this.deps.onStepRunning?.(stepName);
    } else if (
      postStep?.status === "completed" ||
      postStep?.status === "failed"
    ) {
      this.deps.onStepComplete?.(
        stepName,
        postStep.status,
        postStep.endTime ? postStep.endTime - startTime : null,
      );
    }
    return run;
  }
}

export type { ModifyArchitectureDeps } from "./modify-architecture-types.js";
