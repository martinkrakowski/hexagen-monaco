import type {
  AuditBoundariesInput,
  AuditBoundariesOutput,
  AuditBoundariesToolUseCase,
} from "../../application/use-cases/audit-boundaries-tool.use-case.js";

export class AuditBoundariesToolAdapter {
  constructor(private readonly useCase: AuditBoundariesToolUseCase) {}

  async execute(
    input: AuditBoundariesInput = {},
  ): Promise<AuditBoundariesOutput> {
    return this.useCase.execute(input);
  }
}
