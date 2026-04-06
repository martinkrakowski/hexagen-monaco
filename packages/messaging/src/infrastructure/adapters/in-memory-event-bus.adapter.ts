import type {
  DomainEvent,
  EventBusPort,
  EventHandler,
} from "../../domain/ports/event-bus.port";

export class InMemoryEventBusAdapter implements EventBusPort {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  subscribe<T = unknown>(
    eventType: string,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);

    return () => {
      this.unsubscribe(eventType, handler as EventHandler);
    };
  }

  publish<T = unknown>(event: DomainEvent<T>): void {
    const subscribers = this.handlers.get(event.type);
    if (!subscribers || subscribers.size === 0) {
      return;
    }
    subscribers.forEach((handler) => {
      try {
        handler(event);
      } catch {
        // Handlers must not throw; errors are silently ignored to protect other subscribers
      }
    });
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const subscribers = this.handlers.get(eventType);
    if (subscribers) {
      subscribers.delete(handler);
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
