import type { Result } from "@hexagen/shared";

export type IntentHandler<TInput = unknown, TOutput = unknown> = (
  intent: Intent<TInput>,
) => Promise<Result<TOutput>>;

export interface IntentBusPort {
  register<TInput = unknown, TOutput = unknown>(
    intentType: string,
    handler: IntentHandler<TInput, TOutput>,
  ): void;
  dispatch<TInput = unknown, TOutput = unknown>(
    intent: Intent<TInput>,
  ): Promise<Result<TOutput>>;
  unregister(intentType: string): void;
  listRegistered(): string[];
}

export interface Intent<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  correlationId: string;
  metadata?: Record<string, unknown>;
}
