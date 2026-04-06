import type {
  DomainEvent,
  EventBusPort,
  EventHandler,
} from "@hexagen/messaging";

export class InMemoryEventBusAdapter implements EventBusPort {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  subscribe<T = unknown>(
    eventType: string,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)?.add(handler as EventHandler);

    return () => {
      this.unsubscribe(eventType, handler as EventHandler);
    };
  }

  publish<T = unknown>(event: DomainEvent<T>): void {
    const subscribers = this.handlers.get(event.type);
    if (!subscribers) {
      return;
    }
    for (const handler of subscribers) {
      try {
        handler(event);
      } catch {
        // Ignore subscriber errors to keep event delivery resilient
      }
    }
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}
