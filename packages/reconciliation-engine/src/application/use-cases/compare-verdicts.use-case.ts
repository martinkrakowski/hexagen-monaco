import type { CompareVerdictsPort } from "../ports/in/compare-verdicts.port.js";
import type { Verdict } from "../../domain/verdict.js";

export class CompareVerdictsUseCase {
  constructor(private readonly compareVerdictsPort: CompareVerdictsPort) {}

  execute(a: Verdict, b: Verdict): number {
    return this.compareVerdictsPort.compareVerdicts(a, b);
  }
}
