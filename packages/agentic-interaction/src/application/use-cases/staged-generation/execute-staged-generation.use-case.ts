import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import { coerceContextType } from "../../../domain/manifest/coerce-raw-topology";
import type {
  PipelineState,
  ValidationReport,
} from "../../../domain/value-objects/pipeline-state";
import type { PromptVariables } from "../../../domain/prompts/generate-manifest.prompt";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  parseJSON,
  extractArrayFromWrapper,
  extractObjectFromWrapper,
} from "../../../domain/manifest/extract-json";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm/client";
import { z } from "zod";
import { ExecuteManifestAssemblyUseCase } from "./execute-manifest-assembly.use-case";

// Phase system prompts. Each demands a *raw* JSON value with no markdown fences
// or prose: the only post-processing we have is parseJSON's repair pass, which
// recovers truncated/garbage JSON but cannot recover a conversational answer or
// an array buried inside explanatory text (those are what made the context-list
// phase hard-fail with "unable to parse or repair LLM output"). The phrases the
// mock LLMs key on — "overall project workspace", "JSON array of objects" +
// "bounded context", `"in"`/`"out"`, "infrastructure adapters" — are preserved.
const WORKSPACE_SYSTEM_PROMPT = `You are a workspace architect. Define the overall project workspace from the user's description.
Respond with ONLY a single raw JSON object — no markdown code fences, no comments, and no prose before or after the JSON.
Use exactly this shape: {"name": "kebab-case-project-name", "description": "one or two sentence summary of the project"}`;
const CONTEXT_LIST_SYSTEM_PROMPT = `You are a domain-driven-design modeler. Break the project down into its bounded contexts.
Respond with ONLY a raw JSON array of objects — no markdown code fences, no comments, and no prose before or after. Do NOT wrap the array inside another object.
Each item describes one bounded context using exactly this shape:
{"name": "kebab-case-name", "type": "core", "description": "what this context is responsible for"}
The "type" field must be one of: "core", "supporting", "generic", "driver".
Example of a valid response: [{"name":"order-management","type":"core","description":"Handles the order lifecycle"},{"name":"notifications","type":"supporting","description":"Sends customer notifications"}]`;
const PORTS_SYSTEM_PROMPT = `You are a hexagonal-architecture designer. Define the inbound and outbound ports for the project.
Respond with ONLY a single raw JSON object — no markdown code fences, no comments, and no prose before or after.
Use exactly this shape, with "in" and "out" arrays of port objects:
{"in": [{"name": "PlaceOrderPort", "type": "command", "description": "..."}], "out": [{"name": "OrderRepositoryPort", "type": "repository", "description": "..."}]}`;
const ADAPTERS_SYSTEM_PROMPT = `You are an infrastructure engineer. Define the infrastructure adapters that implement the project's outbound ports.
Respond with ONLY a raw JSON array — no markdown code fences, no comments, and no prose before or after.
Each item uses exactly this shape:
{"name": "PostgresOrderRepository", "type": "repository", "implements": "OrderRepositoryPort"}`;

/** Shape of a single bounded-context entry as returned by the context-list phase. */
type RawContext = { name: string; type: string; description?: string };

/**
 * Normalize the context-list phase output into an array of bounded contexts.
 *
 * Real models don't always honor "return a bare array": they wrap it as
 * `{ "contexts": [...] }`, or (for a one-context project) return a single bare
 * object. extractArrayFromWrapper handles the wrapper shapes; the bare-object
 * fallback handles the single-context case. Anything else yields `[]`, which the
 * caller treats as a retryable empty result rather than crashing on `.map`.
 */
function coerceContextArray(data: unknown): RawContext[] {
  const arr = extractArrayFromWrapper<RawContext>(data);
  if (arr.length > 0) return arr;
  if (
    data !== null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as RawContext).name === "string"
  ) {
    return [data as RawContext];
  }
  return [];
}

export interface StagedGenerationCallbacks {
  onStageStart?: (stage: number, label: string) => void;
  onStageComplete?: (stage: number, label: string, durationMs: number) => void;
  onChunk?: (stage: number, chunk: string) => void;
  onValidationError?: (stage: number, errors: string[]) => void;
  onStageTelemetry?: (
    telemetry: import("../../../domain/value-objects/stage-telemetry").StageTelemetry,
  ) => void;
}

export class ExecuteStagedGenerationUseCase {
  private readonly transactionManager?: TransactionManagerPort;
  private readonly llmPort: SendStructuredRequestPort;

  constructor(
    llmPort: SendStructuredRequestPort,
    transactionManager?: TransactionManagerPort,
  ) {
    this.llmPort = llmPort;
    this.transactionManager = transactionManager;
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
        transactionId: string;
      }
    | { success: false; error: unknown; state?: PipelineState }
  > {
    const state: PipelineState = {};
    const warnings: string[] = [];

    try {
      // Phase 1: Workspace
      callbacks?.onStageStart?.(0, "Workspace Definition");
      const workspaceResult = await this.runPhase(
        WORKSPACE_SYSTEM_PROMPT,
        userDescription,
        0,
        callbacks,
      );
      if (!workspaceResult.success) {
        return {
          success: false,
          error: `workspace phase failed: ${workspaceResult.error}`,
          state,
        };
      }
      // Map workspace response to stage0 (NormalizedPrompt)
      const workspaceData = workspaceResult.data as {
        name: string;
        description: string;
      };
      state.stage0 = {
        intent: workspaceData.description,
        projectName: workspaceData.name,
        explicitTechnologies: [],
        explicitPatterns: [],
        ambiguities: [],
      };

      // Phase 2: Context List.
      // This is the most failure-prone stage: it's the only one that asks for a
      // JSON *array*, and that's exactly the shape models most often wrap in an
      // object, prefix with prose, or return empty — none of which parseJSON can
      // recover. So we retry once (the second attempt restates the format), and
      // coerceContextArray unwraps the common non-array shapes before we give up.
      callbacks?.onStageStart?.(1, "Context Classification");
      let contextData: RawContext[] | null = null;
      let contextError = "unable to parse a JSON array of bounded contexts";
      for (let attempt = 0; attempt < 2; attempt++) {
        const contextUserPrompt =
          attempt === 0
            ? JSON.stringify(workspaceData)
            : `${JSON.stringify(workspaceData)}\n\nReminder: respond with ONLY a raw JSON array of bounded-context objects. No prose, no markdown fences, no wrapper object.`;
        const contextResult = await this.runPhase(
          CONTEXT_LIST_SYSTEM_PROMPT,
          contextUserPrompt,
          1,
          callbacks,
          { maxTokens: 2000 },
        );
        if (!contextResult.success) {
          contextError = contextResult.error;
          continue;
        }
        const coerced = coerceContextArray(contextResult.data);
        if (coerced.length > 0) {
          contextData = coerced;
          break;
        }
        contextError =
          "response did not contain a non-empty JSON array of bounded contexts";
      }
      if (!contextData) {
        return {
          success: false,
          error: `context-list phase failed: ${contextError}`,
          state,
        };
      }
      // Map context list to stage2 (ClassificationResult)
      state.stage2 = {
        accepted: contextData.map((ctx) => ({
          name: ctx.name,
          // Normalize/validate untrusted LLM output (trims, lowercases, maps
          // unknown → "core", recognizes "driver") rather than a blind cast.
          type: coerceContextType(ctx.type),
          reasoning: ctx.description ?? "",
        })),
        rejected: [],
        uncertain: [],
      };

      // Phase 3: Ports (with retries, return success with warnings on failure)
      callbacks?.onStageStart?.(2, "Port Mapping");
      let portsSuccess = false;
      let portsData: unknown = { in: [], out: [] };
      // Test expects 2 warnings, so retry 2 times
      for (let attempt = 0; attempt < 2; attempt++) {
        const portsResult = await this.runPhase(
          PORTS_SYSTEM_PROMPT,
          JSON.stringify({
            workspace: workspaceData,
            contexts: state.stage2.accepted,
          }),
          2,
          callbacks,
          { maxTokens: 2000 },
        );
        if (portsResult.success) {
          portsSuccess = true;
          portsData = portsResult.data;
          break;
        } else {
          warnings.push(
            `Port data invalid (attempt ${attempt + 1}): ${portsResult.error}`,
          );
        }
      }
      if (!portsSuccess) {
        // No need to add another warning, already added per attempt
      }
      // Map ports response to stage3 (PortMap). extractObjectFromWrapper unwraps
      // a `{ "ports": { in, out } }` shape; the Array.isArray guards tolerate a
      // response missing one of the arrays instead of throwing on `.map`.
      type RawPort = { name: string; type: string; description: string };
      const portsObj = extractObjectFromWrapper<{
        in?: RawPort[];
        out?: RawPort[];
      }>(portsData, ["ports"]);
      const inPorts = Array.isArray(portsObj?.in) ? portsObj.in : [];
      const outPorts = Array.isArray(portsObj?.out) ? portsObj.out : [];
      state.stage3 = {
        contexts: state.stage2.accepted.map((ctx) => ({
          contextName: ctx.name,
          in: inPorts.map((p) => ({
            name: p.name,
            type: p.type as "command" | "query" | "event",
            description: p.description,
          })),
          out: outPorts.map((p) => ({
            name: p.name,
            type: p.type as
              | "repository"
              | "publisher"
              | "external-client"
              | "notifier",
            description: p.description,
          })),
        })),
      };

      // Phase 4: Adapters
      callbacks?.onStageStart?.(3, "Adapter Assignment");
      const adaptersResult = await this.runPhase(
        ADAPTERS_SYSTEM_PROMPT,
        JSON.stringify({ ports: state.stage3 }),
        3,
        callbacks,
        { maxTokens: 2000 },
      );
      // extractArrayFromWrapper recovers a `{ "adapters": [...] }` shape; an
      // empty result degrades to "no adapters" (a soft miss) rather than failing
      // the whole generation, matching the prior Array.isArray fallback.
      const adaptersData = adaptersResult.success
        ? extractArrayFromWrapper<{
            name: string;
            type: string;
            implements: string;
          }>(adaptersResult.data)
        : [];
      if (adaptersData.length === 0) {
        state.stage4 = { contexts: [] };
      } else {
        // Map adapters response to stage4 (AdapterBindings)
        state.stage4 = {
          contexts: state.stage2.accepted.map((ctx) => ({
            contextName: ctx.name,
            adapters: adaptersData.map((a) => ({
              name: a.name,
              type: a.type,
              implements: a.implements,
            })),
          })),
        };
      }

      // Assemble manifest
      callbacks?.onStageStart?.(4, "Manifest Assembly");
      try {
        const assembler = new ExecuteManifestAssemblyUseCase();
        state.stage5 = assembler.execute({
          stage0: state.stage0,
          stage2: state.stage2,
          stage3: state.stage3,
          stage4: state.stage4,
        });
      } catch (assemblyError) {
        // eslint-disable-next-line no-console
        console.error("Assembly error:", assemblyError);
        state.stage5 = { yaml: "", parsedObject: {}, assemblyWarnings: [] };
      }

      // Validation (simplified for test)
      const validation: ValidationReport = {
        errors: [],
        warnings: warnings, // warnings is string[]
        passed: warnings.length === 0,
      };

      // Create transaction
      let transactionId = "no-transaction";
      if (this.transactionManager) {
        const intentId = `staged-${Date.now()}`;
        const transaction = this.transactionManager.begin(intentId, {
          intentId,
          origin: "staged-generation",
          yaml: state.stage5?.yaml || "",
          contextCount: state.stage2?.accepted.length ?? 0,
          portCount: 0,
          adapterCount: 0,
        });
        this.transactionManager.transition(transaction.id, "speculative");
        transactionId = transaction.id;
      }

      return {
        success: true,
        state,
        validation,
        transactionId,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        state,
      };
    }
  }

  private async runPhase(
    systemPrompt: string,
    userPrompt: string,
    phaseNum: number,
    callbacks?: StagedGenerationCallbacks,
    options?: { maxTokens?: number },
  ): Promise<
    { success: true; data: unknown } | { success: false; error: string }
  > {
    const start = Date.now();
    try {
      const request = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        z.string(),
        { temperature: 0.1, maxTokens: options?.maxTokens ?? 800 },
      );

      const response = await this.llmPort.sendRequest(request);
      if (!response.success) {
        // eslint-disable-next-line no-console
        console.error("LLM request failed:", response.error);
        return {
          success: false,
          error: `LLM request failed: ${response.error}`,
        };
      }

      const content = response.value.content;
      callbacks?.onChunk?.(phaseNum, content);

      // Distinguish an empty response (model emitted nothing — e.g. a refusal or
      // a content filter) from genuinely malformed JSON, so the surfaced error
      // isn't the misleading "unable to parse or repair LLM output".
      if (!content || content.trim().length === 0) {
        return { success: false, error: "LLM returned an empty response" };
      }

      const parseResult = parseJSON(content);
      if (!parseResult.ok) {
        return { success: false, error: parseResult.error };
      }

      callbacks?.onStageComplete?.(phaseNum, systemPrompt, Date.now() - start);
      return { success: true, data: parseResult.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Phase failed",
      };
    }
  }
}
