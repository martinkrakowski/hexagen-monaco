import type { SendStructuredRequestPort } from "@hexagen/local-llm";
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
} from "../../domain/prompts/generate-manifest.prompt.js";
import {
  generateSuggestions,
  detectWarnings,
} from "../../domain/manifest-yaml-extractor.js";
import {
  extractArrayFromWrapper,
  renderManifestYaml,
  normalizeDraft,
  draftToManifest,
  coerceRawPorts,
} from "../../domain/index.js";
import { coerceContextType } from "../../domain/manifest/coerce-raw-topology.js";
import type { ManifestDraft } from "../../domain/index.js";
import {
  ManifestWarningCategory,
  type ManifestWarning,
  type GenerateManifestFromDescriptionRequest,
  type GenerateManifestFromDescriptionResponse,
} from "./generate-manifest-types.js";
import { callWithRetries } from "./llm-retry.js";

export class GenerateManifestFromDescriptionUseCase {
  constructor(private readonly llmPipeline: SendStructuredRequestPort) {}

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
      const workspaceResult = await callWithRetries<{
        name: string;
        description: string;
      }>(
        this.llmPipeline,
        "workspace",
        WORKSPACE_SYSTEM_PROMPT,
        workspacePrompt,
        (attempt) =>
          attempt === 1
            ? RETRY_PROMPTS.workspace.attempt1(request.description.text)
            : RETRY_PROMPTS.workspace.attempt2(request.description.text),
        800,
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
        const contextResult = await callWithRetries<
          Array<{
            name: string;
            type: string;
            description: string;
          }>
        >(
          this.llmPipeline,
          "context-list",
          CONTEXT_LIST_SYSTEM_PROMPT,
          contextPrompt,
          (attempt) =>
            attempt === 1
              ? RETRY_PROMPTS.contextList.attempt1(request.description.text)
              : RETRY_PROMPTS.contextList.attempt2(request.description.text),
          800,
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
          const portsResult = await callWithRetries<{
            in: ManifestDraftPort[];
            out: ManifestDraftPort[];
          }>(
            this.llmPipeline,
            `ports/${ctx.name}`,
            PORTS_LIST_SYSTEM_PROMPT,
            portsPrompt,
            (attempt) =>
              attempt === 1
                ? RETRY_PROMPTS.ports.attempt1(ctx.name, ctx.description)
                : RETRY_PROMPTS.ports.attempt2(ctx.name, ctx.description),
            300,
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
            const adaptersResult = await callWithRetries<
              Array<{ name: string; type: string; implements: string }>
            >(
              this.llmPipeline,
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
              300,
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
