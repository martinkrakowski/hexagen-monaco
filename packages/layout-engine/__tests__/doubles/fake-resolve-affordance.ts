import type { Affordance } from "../../src/domain/value-objects/affordance.js";
import type { ResolveAffordancePort } from "../../src/application/ports/in/resolve-affordance.port.js";

export class FakeResolveAffordanceAdapter implements ResolveAffordancePort {
  callCount = 0;
  lastNodeId: string | null = null;
  lastCategory: string | null = null;
  private forcedAffordance: Affordance | null = null;

  forceAffordance(affordance: Affordance): void {
    this.forcedAffordance = affordance;
  }

  resolve(nodeId: string, category: string): Affordance {
    this.callCount++;
    this.lastNodeId = nodeId;
    this.lastCategory = category;
    if (this.forcedAffordance) return this.forcedAffordance;
    return {
      nodeId,
      movable: true,
      resizable: true,
      connectable: true,
      sides: ["north", "south", "east", "west"],
    };
  }
}
