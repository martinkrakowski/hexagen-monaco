import type { PromptCompilerPort } from "../ports/in/prompt-compiler.port";
import type { BuildSystemInstructionPort } from "../ports/in/build-system-instruction.port";
import type { GenerateZodSchemaPort } from "../ports/in/generate-zod-schema.port";
import type { DomainAST, Identifier } from "@hexagen/core-domain";
import type { PromptTemplate } from "../../domain/prompt-template";

/**
 * Use case for compiling a prompt from domain AST, governance rules, and user intent.
 * This use case orchestrates the building of system instructions, structured output schemas,
 * and the final prompt compilation.
 */
export class CompilePromptUseCase {
  constructor(
    private readonly promptCompilerPort: PromptCompilerPort,
    private readonly systemInstructionPort: BuildSystemInstructionPort,
    private readonly zodSchemaPort: GenerateZodSchemaPort,
  ) {}

  async execute(request: {
    name: string;
    domainAST: DomainAST;
    userIntent: string;
    governanceRules: string[];
    templateOverrides?: Record<string, string>;
  }): Promise<PromptTemplate> {
    // Build system instruction from domain AST and governance rules
    const systemInstructionRequest = {
      name: `${request.name}-system-instruction`,
      domainAST: request.domainAST,
      governanceRules: request.governanceRules,
      templateOverrides: request.templateOverrides,
    };
    const systemInstruction = await this.systemInstructionPort.build(
      systemInstructionRequest,
    );

    // Generate structured output schema for the expected LLM response
    // For now, we create a simple schema that validates the response is a string
    // In a real implementation, this would be based on the expected output format
    const schemaRequest = {
      name: `${request.name}-output-schema`,
      description: "Validates that the LLM response is a string",
      exampleData: "",
      templateOverrides: request.templateOverrides,
    };
    const outputSchema = await this.zodSchemaPort.generate(schemaRequest);

    // Compile the prompt using the prompt compiler port
    const compileRequest = {
      name: request.name,
      domainAST: request.domainAST,
      userIntent: request.userIntent,
      governanceRules: request.governanceRules,
      templateOverrides: request.templateOverrides,
    };
    return this.promptCompilerPort.compile(compileRequest);
  }
}
