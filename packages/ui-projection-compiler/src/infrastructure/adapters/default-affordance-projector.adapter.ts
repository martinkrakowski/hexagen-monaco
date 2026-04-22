import type { Affordance } from "@hexagen/layout-engine";
import type {
  ProjectAffordancePort,
  ProjectedAffordance,
} from "../../application/ports/in/project-affordance.port.js";

/**
 * DefaultAffordanceProjectorAdapter — projects a layout-level Affordance
 * (movable/resizable/connectable/sides) into a UI-level ProjectedAffordance
 * (movable/resizable/connectable/deletable).
 *
 * Deletability is derived: a node with no connections and no resize constraint
 * is considered deletable.
 */
export class DefaultAffordanceProjectorAdapter implements ProjectAffordancePort {
  project(affordance: Affordance): ProjectedAffordance {
    return {
      movable: affordance.movable,
      resizable: affordance.resizable,
      connectable: affordance.connectable,
      deletable: affordance.movable && !affordance.resizable,
    };
  }
}
