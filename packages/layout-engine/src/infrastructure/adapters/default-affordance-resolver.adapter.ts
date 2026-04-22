import type {
  Affordance,
  AffordanceSide,
} from "../../domain/value-objects/affordance.js";
import type { ResolveAffordancePort } from "../../application/ports/in/resolve-affordance.port.js";

const CATEGORY_AFFORDANCE_MAP: Record<
  string,
  {
    movable: boolean;
    resizable: boolean;
    connectable: boolean;
    sides: AffordanceSide[];
  }
> = {
  "bounded-context": {
    movable: true,
    resizable: true,
    connectable: true,
    sides: ["north", "south", "east", "west"],
  },
  adapter: {
    movable: true,
    resizable: false,
    connectable: true,
    sides: ["north", "south"],
  },
  port: {
    movable: true,
    resizable: false,
    connectable: true,
    sides: ["east", "west"],
  },
  entity: {
    movable: true,
    resizable: false,
    connectable: true,
    sides: ["north"],
  },
  "use-case": {
    movable: true,
    resizable: false,
    connectable: true,
    sides: ["north"],
  },
  peer: {
    movable: true,
    resizable: true,
    connectable: true,
    sides: ["east", "west"],
  },
};

const DEFAULT_AFFORDANCE: Omit<Affordance, "nodeId"> = {
  movable: true,
  resizable: false,
  connectable: true,
  sides: ["north", "south", "east", "west"],
};

export class DefaultAffordanceResolverAdapter implements ResolveAffordancePort {
  resolve(nodeId: string, category: string): Affordance {
    const config = CATEGORY_AFFORDANCE_MAP[category] ?? DEFAULT_AFFORDANCE;
    return {
      nodeId,
      movable: config.movable,
      resizable: config.resizable,
      connectable: config.connectable,
      sides: config.sides,
    };
  }
}
