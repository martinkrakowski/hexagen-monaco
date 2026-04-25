import type { Identifier } from "@hexagen/shared";
import type { DomainModelId } from "../../domain/value-objects/model-id.vo.js";
import type {
  CompiledPromptRequest,
  CompiledPromptAdapterPort,
} from "../../application/ports/in/compiled-prompt-adapter.port.js";
import type { SendStructuredRequestPort } from "../../application/ports/in/send-structured-request.port.js";
import type { LLMRequest } from "../../domain/value-objects/llm-request.vo.js";
import { FreeFormStringSchema } from "../../application/ports/in/send-structured-request.port.js";
import type { ProjectSpec } from "@hexagen/project-configuration";
import type { ArchitectureGraph } from "@hexagen/visualization";
import type { LinterReport } from "@hexagen/governance";

export class CompiledPromptAdapter implements CompiledPromptAdapterPort {
  constructor(
    private readonly sendStructuredRequest: SendStructuredRequestPort,
  ) {}

  async sendCompiledPrompt(request: CompiledPromptRequest): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(
      request.manifest,
      request.architectureGraph,
      request.linterReport,
    );

    const messages: LLMRequest["messages"] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.userIntent },
    ];

    const llmRequest: LLMRequest = {
      id: `compiled-${Date.now()}`,
      modelId: request.modelId,
      messages,
      schema: FreeFormStringSchema,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    };

    const result = await this.sendStructuredRequest.sendRequest(llmRequest);

    if (!result.success) {
      throw result.error ?? new Error("Structured request failed");
    }

    return result.value.content;
  }

  private buildSystemPrompt(
    manifest: ProjectSpec,
    architectureGraph: ArchitectureGraph,
    linterReport: LinterReport,
  ): string {
    return `You are an expert software architect working on a Hexagonal Architecture project.

Project Manifest:
${JSON.stringify(manifest, null, 2)}

Architecture Graph:
${JSON.stringify(architectureGraph, null, 2)}

Governance Report:
${JSON.stringify(linterReport, null, 2)}

Respond with structured JSON output following the specified schema.`;
  }
}
