import type { PromptCompilerPort } from "../ports/in/prompt-compiler.port";
import type { PromptTemplate } from "../../domain/prompt-template";

/**
 * Use case for rendering a prompt template with variable overrides.
 * This use case takes a compiled prompt template and renders it with specific
 * variable values to produce the final prompt that will be sent to the LLM.
 */
export class RenderPromptUseCase {
  constructor(private readonly promptCompilerPort: PromptCompilerPort) {}

  async execute(
    template: PromptTemplate,
    overrides?: Record<string, string>,
  ): Promise<{
    systemPrompt: string;
    userPrompt: string;
    variables: Record<string, string>;
  }> {
    return this.promptCompilerPort.render(template, overrides);
  }
}
