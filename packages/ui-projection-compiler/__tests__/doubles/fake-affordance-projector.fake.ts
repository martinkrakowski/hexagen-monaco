import type { Affordance } from "@hexagen/layout-engine";
import type {
  ProjectAffordancePort,
  ProjectedAffordance,
} from "../../src/application/ports/in/project-affordance.port.js";

export class FakeAffordanceProjector implements ProjectAffordancePort {
  readonly calls: Affordance[] = [];

  project(affordance: Affordance): ProjectedAffordance {
    this.calls.push(affordance);
    return {
      movable: affordance.movable,
      resizable: affordance.resizable,
      connectable: affordance.connectable,
      deletable: false,
    };
  }
}
