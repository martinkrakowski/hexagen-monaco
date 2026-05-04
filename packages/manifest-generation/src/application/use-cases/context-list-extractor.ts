import type { ContextListEntry } from "@hexagen/agentic-interaction";
import {
  createContextListSchema,
  parseJSON,
  extractArrayFromWrapper,
  coerceContextType,
  CONTEXT_LIST_SYSTEM_PROMPT,
  compileContextListPrompt,
} from "@hexagen/agentic-interaction";
import type { LocalLlmMessagingPort } from "../ports/out/local-llm-messaging.port.js";

const MAX_RETRIES = 2;

async function attemptContextList(
  messagingPort: LocalLlmMessagingPort,
  description: string,
  signal?: AbortSignal,
  onStepDetail?: (detail: string) => void,
  maxContexts?: number,
): Promise<
  { ok: true; contexts: ContextListEntry[] } | { ok: false; error: string }
> {
  const userPrompt = compileContextListPrompt({ userDescription: description });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };

    try {
      onStepDetail?.(
        `Identifying bounded contexts${attempt > 0 ? ` (attempt ${attempt + 1})` : ""}...`,
      );
      const content = await messagingPort.sendStructuredPrompt(
        userPrompt,
        CONTEXT_LIST_SYSTEM_PROMPT,
        signal,
      );
      if (!content) {
        if (attempt === MAX_RETRIES)
          return { ok: false, error: "No response from LLM" };
        continue;
      }

      const parsed =
        parseJSON<Array<{ name: string; type: string; description: string }>>(
          content,
        );
      if (!parsed.ok) {
        const errorMsg = "error" in parsed ? parsed.error : "Unknown error";
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: errorMsg };
        }
        continue;
      }

      const rawContexts = extractArrayFromWrapper<{
        name?: string;
        type?: string;
        description?: string;
      }>(parsed.data, ["contexts", "data", "items", "results", "list"]);

      if (rawContexts.length === 0 && !Array.isArray(parsed.data)) {
        const errorMsg = `Context list: expected array but got object with keys: ${Object.keys(parsed.data as object).join(", ")}`;
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: errorMsg };
        }
        continue;
      }

      const coercedContexts = rawContexts.map(
        (ctx: { name?: string; type?: string; description?: string }) => ({
          name: String(ctx.name || "unnamed-context").trim(),
          type: coerceContextType(String(ctx.type || "")),
          description: String(ctx.description || ctx.name || "").trim(),
        }),
      );

      const result =
        createContextListSchema(maxContexts).safeParse(coercedContexts);
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        if (attempt === MAX_RETRIES) {
          return { ok: false, error: `Context list validation: ${errors}` };
        }
        continue;
      }

      onStepDetail?.(`Found ${result.data.length} bounded contexts`);
      return { ok: true, contexts: result.data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_RETRIES) {
        return { ok: false, error: errorMsg };
      }
    }
  }

  return { ok: false, error: "Failed to generate context list after retries" };
}

export { attemptContextList, MAX_RETRIES };
