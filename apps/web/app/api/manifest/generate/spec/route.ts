import { NextRequest } from "next/server";
import {
  ExecuteStructuredConfigGenerationUseCase,
  type StructuredConfigGenerationCallbacks,
  type StructuredConfigInput,
} from "@hexagen/agentic-interaction";
import type { PromptVariables } from "@hexagen/agentic-interaction";
import { LLMProviderSelectorAdapter } from "@hexagen/agentic-interaction";
import { EnvironmentSecretVaultAdapter } from "@hexagen/agentic-interaction";
import { logger } from "../../../../../lib/structured-logger";

interface SpecRequestBody {
  config: string;
  intent?: string;
  explicitTechnologies?: string[];
  subdomains?: string[];
  classifiedContexts?: Array<{
    name: string;
    type: "core" | "supporting" | "generic" | "shared-kernel";
    reasoning: string;
  }>;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
  preferLocal?: boolean;
}

type NDJSONEvent =
  | { type: "stage-start"; stage: number; label: string }
  | { type: "stage-complete"; stage: number; label: string; durationMs: number }
  | { type: "chunk"; stage: number; data: string }
  | { type: "validation-error"; stage: number; errors: string[] }
  | {
      type: "done";
      yaml: string;
      contextCount: number;
      portCount: number;
      adapterCount: number;
    }
  | { type: "error"; message: string };

export async function POST(request: NextRequest) {
  let body: SpecRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ type: "error", message: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!body.config || typeof body.config !== "string") {
    return new Response(
      JSON.stringify({ type: "error", message: "Missing config" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: NDJSONEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      const callbacks: StructuredConfigGenerationCallbacks = {
        onStageStart: (stage, label) =>
          send({ type: "stage-start", stage, label }),
        onStageComplete: (stage, label, durationMs) =>
          send({ type: "stage-complete", stage, label, durationMs }),
        onChunk: (stage, data) => send({ type: "chunk", stage, data }),
        onValidationError: (stage, errors) =>
          send({ type: "validation-error", stage, errors }),
      };

      try {
        const secretVault = new EnvironmentSecretVaultAdapter();
        const llmAdapter = new LLMProviderSelectorAdapter({
          webLlmAdapter: null,
          preferLocal: body.preferLocal ?? false,
          validateLocalLLM: false,
          fallbackChain: {
            primary: {
              providerId: "openai" as const,
              baseUrl: "https://api.openai.com/v1",
              model: "gpt-4o",
              apiKeyEnvVar: "OPENAI_API_KEY",
              temperature: 0.3,
              maxTokens: 4000,
            },
            fallbacks: [
              {
                providerId: "anthropic" as const,
                baseUrl: "https://api.anthropic.com/v1",
                model: "claude-3-5-sonnet-20241022",
                apiKeyEnvVar: "ANTHROPIC_API_KEY",
                temperature: 0.3,
                maxTokens: 4000,
              },
            ],
          },
          secretVault,
        });

        const useCase = new ExecuteStructuredConfigGenerationUseCase(
          llmAdapter,
        );

        const structuredInput: StructuredConfigInput = {
          intent: body.intent ?? "Imported Structured Config",
          explicitTechnologies: body.explicitTechnologies ?? [],
          subdomains: body.subdomains ?? [],
          classifiedContexts: body.classifiedContexts ?? [],
        };

        const variables: PromptVariables = {
          userDescription: body.intent ?? "Imported Structured Config",
          platform: body.platform,
          deployment: body.deployment,
          additionalContext: body.additionalContext,
        };

        const result = await useCase.execute(
          structuredInput,
          variables,
          callbacks,
        );

        if (result.success) {
          const yaml = result.state.stage5?.yaml || "";
          const ctxCount = result.state.stage2?.accepted.length ?? 0;
          const portCount =
            result.state.stage3?.contexts.reduce(
              (sum, c) => sum + c.in.length + c.out.length,
              0,
            ) ?? 0;
          const adapterCount =
            result.state.stage4?.contexts.reduce(
              (sum, c) => sum + c.adapters.length,
              0,
            ) ?? 0;

          send({
            type: "done",
            yaml,
            contextCount: ctxCount,
            portCount,
            adapterCount,
          });
        } else {
          const msg =
            result.error instanceof Error
              ? result.error.message
              : String(result.error);
          send({ type: "error", message: msg });
        }
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          logger.error("Structured config generation error:", { error });
        }
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
