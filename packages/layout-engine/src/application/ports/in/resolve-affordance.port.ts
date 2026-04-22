import type { Affordance } from "../../../domain/value-objects/affordance.js";

export interface ResolveAffordancePort {
  resolve(nodeId: string, category: string): Affordance;
}
