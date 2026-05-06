import type { LocalLlmMessagingPort } from "../../application/ports/out/local-llm-messaging.port.js";

const MAX_RETRIES = 2;

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    return match[1].trim();
  }

  return trimmed;
}

export class LocalLlmGenerationAdapter implements LocalLlmMessagingPort {
  constructor(private readonly messagingPort: LocalLlmMessagingPort) {}

  async sendStructuredPrompt(
    userPrompt: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) {
        throw new Error("Aborted");
      }

      try {
        const content = await this.messagingPort.sendStructuredPrompt(
          userPrompt,
          systemPrompt,
          signal,
        );

        if (!content || content.trim() === "") {
          lastError = new Error("Empty response from LLM");
          continue;
        }

        // Strip markdown code fences if present, but preserve
        // NDJSON (multi-line) format — do NOT extract single JSON object.
        const stripped = stripMarkdownFences(content);
        if (!stripped || stripped.trim() === "") {
          lastError = new Error("Could not extract content from response");
          continue;
        }

        return stripped;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === MAX_RETRIES) break;
      }
    }

    throw lastError ?? new Error("Failed to send structured prompt after retries");
  }
}
