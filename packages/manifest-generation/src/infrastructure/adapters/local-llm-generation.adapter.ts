import type { LocalLlmMessagingPort } from "../../application/ports/out/local-llm-messaging.port.js";

const MAX_RETRIES = 2;

function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();

  const codeBlockMatch = trimmed.match(
    /```(?:json)?\s*([\s\S]*?)```/,
  );
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    return jsonObjectMatch[0].trim();
  }

  const jsonArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    return jsonArrayMatch[0].trim();
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

        const extracted = extractJsonFromText(content);
        if (!extracted) {
          lastError = new Error("Could not extract JSON from response");
          continue;
        }

        return extracted;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === MAX_RETRIES) break;
      }
    }

    throw lastError ?? new Error("Failed to send structured prompt after retries");
  }
}
