import type { Affordance } from "@hexagen/layout-engine";
import type {
  ProjectAffordancePort,
  ProjectedAffordance,
} from "../ports/in/project-affordance.port.js";

export class ProjectAffordanceUseCase {
  constructor(private readonly projector: ProjectAffordancePort) {}

  execute(affordance: Affordance): ProjectedAffordance {
    return this.projector.project(affordance);
  }
}
