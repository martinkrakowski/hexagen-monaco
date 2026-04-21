import { Identifier } from "@hexagen/shared";

export class Gesture {
  public readonly id: Identifier;
  public readonly type: string;
  public readonly payload: Record<string, unknown>;
  public readonly lineage: string;

  constructor(id: Identifier, type: string, payload: Record<string, unknown>, lineage: string = "") {
    this.id = id;
    this.type = type;
    this.payload = payload;
    this.lineage = lineage;
  }
}