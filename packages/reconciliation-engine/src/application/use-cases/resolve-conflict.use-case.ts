import type { ResolveConflictPort } from "../ports/in/resolve-conflict.port.js";
import type { Patch } from "../../domain/llm-response.js";

export class ResolveConflictUseCase {
  constructor(private readonly resolveConflictPort: ResolveConflictPort) {}

  execute(patchA: Patch, patchB: Patch): Patch {
    return this.resolveConflictPort.resolveConflict(patchA, patchB);
  }
}
