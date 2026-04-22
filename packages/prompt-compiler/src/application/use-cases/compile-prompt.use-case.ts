import type { PromptCompilerPort } from "../ports/in/prompt-compiler.port";
import type { DomainAST } from "@hexagen/core-domain";
import type { PromptTemplate } from "../../domain/prompt-template";

export class CompilePromptUseCase {
  constructor(private readonly promptCompilerPort: PromptCompilerPort) {}

  async execute(request: {
    name: string;
    domainAST: DomainAST;
    userIntent: string;
    governanceRules: string[];
    templateOverrides?: Record<string, string>;
  }): Promise<PromptTemplate> {
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
