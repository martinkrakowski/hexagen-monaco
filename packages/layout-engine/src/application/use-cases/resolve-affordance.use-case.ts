import type { Affordance } from "../../domain/value-objects/affordance.js";
import type { ResolveAffordancePort } from "../ports/in/resolve-affordance.port.js";

export class ResolveAffordanceUseCase {
  constructor(private readonly resolver: ResolveAffordancePort) {}

  execute(nodeId: string, category: string): Affordance {
    return this.resolver.resolve(nodeId, category);
  }
}
