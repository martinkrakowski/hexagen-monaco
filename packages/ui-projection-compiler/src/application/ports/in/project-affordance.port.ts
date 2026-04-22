import type { Affordance } from "@hexagen/layout-engine";

export interface ProjectedAffordance {
  readonly movable: boolean;
  readonly resizable: boolean;
  readonly connectable: boolean;
  readonly deletable: boolean;
}

export interface ProjectAffordancePort {
  project(affordance: Affordance): ProjectedAffordance;
}
