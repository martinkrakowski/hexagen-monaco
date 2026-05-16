import { NextRequest } from "next/server";
import {
  ExecuteStructuredConfigGenerationUseCase,
  type StructuredConfigGenerationCallbacks,
  type StructuredConfigInput,
} from "@hexagen/agentic-interaction";
import type { PromptVariables } from "@hexagen/agentic-interaction";
import { createLLMProviderSelector } from "../../../../lib/wire.server";
import yaml from "js-yaml";
import { logger } from "../../../../../lib/structured-logger";

interface SpecRequestBody {
  config: string;
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
        const llmAdapter = createLLMProviderSelector({
          preferLocal: body.preferLocal ?? false,
          webLlmAdapter: null,
          validateLocalLLM: false,
        });

        const useCase = new ExecuteStructuredConfigGenerationUseCase(
          llmAdapter,
        );

        // Parse body.config into StructuredConfigInput fields
        let parsedConfig: Partial<StructuredConfigInput>;
        try {
          parsedConfig = yaml.load(
            body.config,
          ) as Partial<StructuredConfigInput>;
        } catch {
          send({
            type: "error",
            message: "Config must be valid YAML or JSON",
          });
          return;
        }

        if (!parsedConfig.intent || typeof parsedConfig.intent !== "string") {
          send({
            type: "error",
            message: "Config must contain intent string",
          });
          return;
        }

        const structuredInput: StructuredConfigInput = {
          intent: parsedConfig.intent,
          explicitTechnologies: Array.isArray(parsedConfig.explicitTechnologies)
            ? parsedConfig.explicitTechnologies
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : [],
          subdomains: Array.isArray(parsedConfig.subdomains)
            ? parsedConfig.subdomains
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            : [],
          classifiedContexts: Array.isArray(parsedConfig.classifiedContexts)
            ? parsedConfig.classifiedContexts.filter(
                (item): boolean =>
                  typeof item === "object" &&
                  item !== null &&
                  "name" in item &&
                  typeof (item as { name: unknown }).name === "string" &&
                  "type" in item &&
                  typeof (item as { type: unknown }).type === "string" &&
                  "reasoning" in item &&
                  typeof (item as { reasoning: unknown }).reasoning ===
                    "string",
              )
            : [],
        };

        const variables: PromptVariables = {
          userDescription: parsedConfig.intent,
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
