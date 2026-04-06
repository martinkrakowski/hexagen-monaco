import type { Result } from "@hexagen/shared";
import type {
  Intent,
  IntentBusPort,
  IntentHandler,
} from "../../domain/ports/intent-bus.port";

export class InMemoryIntentBusAdapter implements IntentBusPort {
  private handlers: Map<string, IntentHandler> = new Map();

  register<TInput = unknown, TOutput = unknown>(
    intentType: string,
    handler: IntentHandler<TInput, TOutput>,
  ): void {
    if (this.handlers.has(intentType)) {
      throw new Error(
        `Intent handler already registered for type: ${intentType}`,
      );
    }
    this.handlers.set(intentType, handler as IntentHandler);
  }

  async dispatch<TInput = unknown, TOutput = unknown>(
    intent: Intent<TInput>,
  ): Promise<Result<TOutput>> {
    const handler = this.handlers.get(intent.type);
    if (!handler) {
      return {
        success: false,
        error: new Error(
          `No handler registered for intent type: ${intent.type}`,
        ),
      };
    }

    try {
      const result = (await handler(intent)) as Result<TOutput>;
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  unregister(intentType: string): void {
    this.handlers.delete(intentType);
  }

  listRegistered(): string[] {
    return Array.from(this.handlers.keys());
  }
}
