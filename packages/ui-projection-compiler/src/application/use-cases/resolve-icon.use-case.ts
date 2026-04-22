import type { IconMapping } from "../../domain/value-objects/icon-mapping.js";
import type { ResolveIconPort } from "../ports/in/resolve-icon.port.js";

export class ResolveIconUseCase {
  constructor(private readonly resolver: ResolveIconPort) {}

  execute(logicalName: string): IconMapping | null {
    return this.resolver.resolve(logicalName);
  }
}
