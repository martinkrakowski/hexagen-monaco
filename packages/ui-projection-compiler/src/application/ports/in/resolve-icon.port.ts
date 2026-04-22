import type { IconMapping } from "../../../domain/value-objects/icon-mapping.js";

export interface ResolveIconPort {
  resolve(logicalName: string): IconMapping | null;
}
