import type {
  PromptCompilerPort,
  PromptCompileRequest,
} from "../ports/in/prompt-compiler.port";
import type { PromptTemplate } from "../../domain/prompt-template";

export class CompilePromptUseCase {
  constructor(private readonly promptCompilerPort: PromptCompilerPort) {}

  async execute(request: PromptCompileRequest): Promise<PromptTemplate> {
    return this.promptCompilerPort.compile(request);
  }
}
