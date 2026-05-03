import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import { createLLMRequest, DomainModelId } from "@hexagen/local-llm";
import { z } from "zod";
import type {
  ProjectDescription,
  GeneratedManifest,
  GenerationMetadata,
} from "../../domain/value-objects/index.js";
import { ProjectDescriptionValidator } from "../../domain/value-objects/index.js";
import { createGeneratedManifest } from "../../domain/value-objects/index.js";
import type { ManifestDraftPort } from "../../domain/index.js";
import {
  WORKSPACE_SYSTEM_PROMPT,
  CONTEXT_LIST_SYSTEM_PROMPT,
  PORTS_LIST_SYSTEM_PROMPT,
  ADAPTERS_LIST_SYSTEM_PROMPT,
  compileWorkspacePrompt,
  compileContextListPrompt,
  compilePortsPrompt,
  compileAdaptersPrompt,
  RETRY_PROMPTS,
  type RetryResult,
} from "../../domain/prompts/generate-manifest.prompt.js";
import {
  generateSuggestions,
  detectWarnings,
} from "../../domain/manifest-yaml-extractor.js";
import {
  parseJSON,
  extractArrayFromWrapper,
  renderManifestYaml,
  normalizeDraft,
  draftToManifest,
  coerceRawPorts,
} from "../../domain/index.js";
import { coerceContextType } from "../../domain/manifest/coerce-raw-topology.js";
import type { ManifestDraft } from "../../domain/index.js";

export enum ManifestWarningCategory {
  MISSING_CONTEXTS = "missing-contexts",
  MISSING_PORTS = "missing-ports",
  MISSING_ADAPTERS = "missing-adapters",
}

export interface ManifestWarning {
  category: ManifestWarningCategory;
  context?: string;
  message: string;
  suggestedAction: "clarify" | "retry" | "manual-edit";
}

export interface GenerationDiagnostics {
  totalAttempts: number;
  tokensUsed: number;
  processingTime: number;
  repairApplied: boolean;
  model: string;
}

export interface GenerateManifestFromDescriptionRequest {
  description: ProjectDescription;
}

export interface GenerateManifestFromDescriptionResponse {
  success: boolean;
  manifest?: GeneratedManifest;
  error?: string;
  warnings?: ManifestWarning[];
  diagnostics?: GenerationDiagnostics;
}

export class GenerateManifestFromDescriptionUseCase {
  constructor(private readonly llmPipeline: SendStructuredRequestPort) {}

  private async callWithRetries<T>(
    phase: string,
    systemPrompt: string,
    initialUserPrompt: string,
    retryFactory: (attempt: number) => RetryResult,
    maxTokens: number,
  ): Promise<{
    data: T;
    tokens: number;
    model: string;
    repairApplied: boolean;
    attempts: number;
  }> {
    let tokens = 0;
    let model = "unknown";
    let repairApplied = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      let userPrompt: string;
      if (attempt === 0) {
        userPrompt = initialUserPrompt;
      } else {
        const retryResult = retryFactory(attempt);
        if (retryResult.kind === "clarify") {
          console.log(
            `[manifest-gen] phase=${phase}, attempt=${attempt}, action=clarify`,
          );
          throw new Error(
            `${phase}: clarification needed after ${attempt} attempts`,
          );
        }
        userPrompt = retryResult.content;
      }

      console.log(
        `[manifest-gen] phase=${phase}, attempt=${attempt}, maxTokens=${maxTokens}`,
      );

      const llmRequest = createLLMRequest(
        DomainModelId.QWEN_CODER_3B,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        z.string(),
        {
          temperature: 0.1,
          maxTokens,
        },
      );

      const result = await this.llmPipeline.sendRequest(llmRequest);
      if (!result.success) {
        console.log(
          `[manifest-gen] phase=${phase}, attempt=${attempt}, llmFailed=true`,
        );
        continue;
      }

      tokens += result.value.usage?.totalTokens || 0;
      model = result.value.modelId || model;

      if (!result.value.content) {
        console.log(
          `[manifest-gen] phase=${phase}, attempt=${attempt}, emptyResponse=true`,
        );
        continue;
      }

      const parsed = parseJSON<T>(result.value.content);
      if (parsed.ok) {
        if (parsed.repairApplied) repairApplied = true;
        console.log(
          `[manifest-gen] phase=${phase}, attempt=${attempt}, success=true, repairApplied=${parsed.repairApplied}`,
        );
        return {
          data: parsed.data,
          tokens,
          model,
          repairApplied,
          attempts: attempt + 1,
        };
      }

      console.log(
        `[manifest-gen] phase=${phase}, attempt=${attempt}, parseFailed=true, repairAttempted=${parsed.repairApplied}`,
      );
    }

    throw new Error(`${phase}: failed to generate valid JSON after 3 attempts`);
  }

  async execute(
    request: GenerateManifestFromDescriptionRequest,
  ): Promise<GenerateManifestFromDescriptionResponse> {
    try {
      ProjectDescriptionValidator.validate(request.description);

      const startTime = Date.now();
      let totalTokens = 0;
      let totalAttempts = 0;
      let modelUsed = "unknown";
      let anyRepairApplied = false;
      const warnings: ManifestWarning[] = [];

      const variables = {
        userDescription: request.description.text,
        platform: request.description.platform,
        deployment: request.description.deployment,
        additionalContext: request.description.additionalContext,
      };

      // 1. Workspace Pass
      const workspacePrompt = compileWorkspacePrompt(variables);
      const workspaceResult = await this.callWithRetries<{
        name: string;
        description: string;
      }>(
        "workspace",
        WORKSPACE_SYSTEM_PROMPT,
        workspacePrompt,
        (attempt) =>
          attempt === 1
            ? RETRY_PROMPTS.workspace.attempt1(request.description.text)
            : RETRY_PROMPTS.workspace.attempt2(request.description.text),
        800, // Context list: supports ~5 contexts with name/type/description (~700 tokens)
      );
      totalTokens += workspaceResult.tokens;
      totalAttempts += workspaceResult.attempts;
      modelUsed = workspaceResult.model;
      if (workspaceResult.repairApplied) anyRepairApplied = true;

      // 2. Context List Pass
      const contextPrompt = compileContextListPrompt(variables);
      let contexts: Array<{
        name: string;
        type: "core" | "supporting" | "driver" | "shared-kernel";
        description: string;
      }> = [];
      try {
        const contextResult = await this.callWithRetries<
          Array<{
            name: string;
            type: string;
            description: string;
          }>
        >(
          "context-list",
          CONTEXT_LIST_SYSTEM_PROMPT,
          contextPrompt,
          (attempt) =>
            attempt === 1
              ? RETRY_PROMPTS.contextList.attempt1(request.description.text)
              : RETRY_PROMPTS.contextList.attempt2(request.description.text),
          800, // Context list: supports ~5 contexts with name/type/description (~700 tokens)
        );

        const rawContexts = extractArrayFromWrapper<{
          name?: string;
          type?: string;
          description?: string;
        }>(contextResult.data, [
          "contexts",
          "data",
          "items",
          "results",
          "list",
        ]);

        const coercedContexts = rawContexts.map((ctx) => ({
          name: String(ctx.name || "unnamed-context").trim(),
          type: coerceContextType(String(ctx.type || "")),
          description: String(ctx.description || ctx.name || "").trim(),
        }));

        contexts = coercedContexts as Array<{
          name: string;
          type: "core" | "supporting" | "driver" | "shared-kernel";
          description: string;
        }>;
        totalTokens += contextResult.tokens;
        totalAttempts += contextResult.attempts;
        if (contextResult.repairApplied) anyRepairApplied = true;
      } catch {
        warnings.push({
          category: ManifestWarningCategory.MISSING_CONTEXTS,
          message: "Could not generate bounded contexts from the description.",
          suggestedAction: "clarify",
        });
      }

      const draftContexts: Array<{
        name: string;
        type: "core" | "supporting" | "driver" | "shared-kernel";
        description: string;
        ports: { in: ManifestDraftPort[]; out: ManifestDraftPort[] };
        adapters: Array<{ name: string; type: string; implements: string }>;
      }> = [];

      for (const ctx of contexts) {
        // 3. Ports Pass
        const portsPrompt = compilePortsPrompt(
          ctx.name,
          ctx.description,
          ctx.type,
        );
        let ports: { in: ManifestDraftPort[]; out: ManifestDraftPort[] } = {
          in: [],
          out: [],
        };
        try {
          const portsResult = await this.callWithRetries<{
            in: ManifestDraftPort[];
            out: ManifestDraftPort[];
          }>(
            `ports/${ctx.name}`,
            PORTS_LIST_SYSTEM_PROMPT,
            portsPrompt,
            (attempt) =>
              attempt === 1
                ? RETRY_PROMPTS.ports.attempt1(ctx.name, ctx.description)
                : RETRY_PROMPTS.ports.attempt2(ctx.name, ctx.description),
            300, // Ports: supports ~5 in + ~5 out ports per context (~250 tokens)
          );
          ports = coerceRawPorts(portsResult.data) as {
            in: ManifestDraftPort[];
            out: ManifestDraftPort[];
          };
          totalTokens += portsResult.tokens;
          totalAttempts += portsResult.attempts;
          if (portsResult.repairApplied) anyRepairApplied = true;
        } catch {
          warnings.push({
            category: ManifestWarningCategory.MISSING_PORTS,
            context: ctx.name,
            message: `Could not generate ports for context "${ctx.name}". It will have no inbound or outbound ports.`,
            suggestedAction: "clarify",
          });
        }

        // 4. Adapters Pass
        let adapters: Array<{
          name: string;
          type: string;
          implements: string;
        }> = [];
        const allPorts = [...(ports.in || []), ...(ports.out || [])];
        if (allPorts.length > 0) {
          const adaptersPrompt = compileAdaptersPrompt(ctx.name, allPorts);
          try {
            const adaptersResult = await this.callWithRetries<
              Array<{ name: string; type: string; implements: string }>
            >(
              `adapters/${ctx.name}`,
              ADAPTERS_LIST_SYSTEM_PROMPT,
              adaptersPrompt,
              (attempt) =>
                attempt === 1
                  ? RETRY_PROMPTS.adapters.attempt1(
                      ctx.name,
                      allPorts.map((p) => p.name),
                    )
                  : RETRY_PROMPTS.adapters.attempt2(
                      ctx.name,
                      allPorts.map((p) => p.name),
                    ),
              300, // Adapters: supports ~10 adapters for ~10 ports (~250 tokens)
            );
            adapters = adaptersResult.data;
            totalTokens += adaptersResult.tokens;
            totalAttempts += adaptersResult.attempts;
            if (adaptersResult.repairApplied) anyRepairApplied = true;
          } catch {
            warnings.push({
              category: ManifestWarningCategory.MISSING_ADAPTERS,
              context: ctx.name,
              message: `Could not generate adapters for context "${ctx.name}".`,
              suggestedAction: "clarify",
            });
          }
        }

        draftContexts.push({
          name: ctx.name,
          type: ctx.type,
          description: ctx.description,
          ports,
          adapters,
        });
      }

      const draft: ManifestDraft = {
        workspace: workspaceResult.data,
        boundedContexts: draftContexts,
      };

      const normalized = normalizeDraft(draft);
      const manifestObj = draftToManifest(normalized);
      const manifestYaml = renderManifestYaml(manifestObj);

      const processingTime = Date.now() - startTime;
      const suggestions = generateSuggestions(manifestYaml);
      const yamlWarnings = detectWarnings(manifestYaml);

      const metadata: GenerationMetadata = {
        model: modelUsed,
        promptVersion: "1.0.0",
        generatedAt: new Date(),
        processingTime,
        tokensUsed: totalTokens,
      };

      const manifest = createGeneratedManifest(manifestYaml, metadata, {
        suggestions,
        warnings: yamlWarnings,
      });

      return {
        success: true,
        manifest,
        warnings: warnings.length > 0 ? warnings : undefined,
        diagnostics: {
          totalAttempts,
          tokensUsed: totalTokens,
          processingTime,
          repairApplied: anyRepairApplied,
          model: modelUsed,
        },
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error during manifest generation",
      };
    }
  }
}
