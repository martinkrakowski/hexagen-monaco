export interface Affordance {
  readonly nodeId: string;
  readonly movable: boolean;
  readonly resizable: boolean;
  readonly connectable: boolean;
  readonly sides: readonly AffordanceSide[];
}

export type AffordanceSide = "north" | "south" | "east" | "west";
