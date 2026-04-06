import type { DomainEvent } from "../ports/event-bus.port";

export interface ModuleScaffoldedPayload {
  moduleName: string;
  layer: "domain" | "application" | "infrastructure";
}

export function createModuleScaffoldedEvent(
  payload: ModuleScaffoldedPayload,
  source: string,
  correlationId?: string,
): DomainEvent<ModuleScaffoldedPayload> {
  return {
    type: "ModuleScaffolded",
    payload,
    timestamp: Date.now(),
    source,
    correlationId,
  };
}
