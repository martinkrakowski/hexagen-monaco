import type { IconMapping } from "../../domain/value-objects/icon-mapping.js";
import {
  DEFAULT_ICON_MAPPINGS,
  findIconMapping,
} from "../../domain/value-objects/icon-mapping.js";
import type { ResolveIconPort } from "../../application/ports/in/resolve-icon.port.js";

/**
 * DefaultIconResolverAdapter — resolves logical icon names to a Lucide icon
 * name + color token pair. Pure data lookup; no React imports.
 */
export class DefaultIconResolverAdapter implements ResolveIconPort {
  constructor(
    private readonly mappings: ReadonlyArray<IconMapping> = DEFAULT_ICON_MAPPINGS,
  ) {}

  resolve(logicalName: string): IconMapping | null {
    return findIconMapping(this.mappings, logicalName);
  }
}
