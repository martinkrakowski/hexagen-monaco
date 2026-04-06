import type { DomainEvent } from "../ports/event-bus.port";

export interface BoundaryViolationPayload {
  ruleId: string;
  severity: "error" | "warning";
  file: string;
  message: string;
  snippet?: string;
}

export function createBoundaryViolatedEvent(
  payload: BoundaryViolationPayload,
  source: string,
  correlationId?: string,
): DomainEvent<BoundaryViolationPayload> {
  return {
    type: "BoundaryViolated",
    payload,
    timestamp: Date.now(),
    source,
    correlationId,
  };
}
