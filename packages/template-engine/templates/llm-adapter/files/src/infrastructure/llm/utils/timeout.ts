import { LLMTimeoutError } from "../errors/llm-errors";

export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new LLMTimeoutError(ms);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
