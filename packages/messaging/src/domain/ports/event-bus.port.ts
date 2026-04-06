export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void;

export interface EventBusPort {
  subscribe<T = unknown>(
    eventType: string,
    handler: EventHandler<T>,
  ): () => void;
  publish<T = unknown>(event: DomainEvent<T>): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
  clear(): void;
}

export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  source: string;
  correlationId?: string;
}
