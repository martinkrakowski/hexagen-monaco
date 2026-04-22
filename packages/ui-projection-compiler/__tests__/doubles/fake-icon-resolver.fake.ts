import type { IconMapping } from "../../src/domain/value-objects/icon-mapping.js";
import type { ResolveIconPort } from "../../src/application/ports/in/resolve-icon.port.js";

export class FakeIconResolver implements ResolveIconPort {
  readonly calls: string[] = [];

  constructor(private readonly mappings: Record<string, IconMapping> = {}) {}

  resolve(logicalName: string): IconMapping | null {
    this.calls.push(logicalName);
    return this.mappings[logicalName] ?? null;
  }
}
