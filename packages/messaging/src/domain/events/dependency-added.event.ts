import type { DomainEvent } from "../ports/event-bus.port";

export interface DependencyAddedPayload {
  source: string;
  target: string;
  relationship: "depends_on" | "implements" | "uses";
}

export function createDependencyAddedEvent(
  payload: DependencyAddedPayload,
  source: string,
  correlationId?: string,
): DomainEvent<DependencyAddedPayload> {
  return {
    type: "DependencyAdded",
    payload,
    timestamp: Date.now(),
    source,
    correlationId,
  };
}
