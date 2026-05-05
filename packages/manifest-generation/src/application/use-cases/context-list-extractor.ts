import type { ContextListEntry } from "@hexagen/agentic-interaction";
import {
  createContextListSchema,
  parseJSON,
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

      const rawContexts: Array<{
        name?: string;
        type?: string;
        description?: string;
        status?: string;
        contextType?: string;
      }> = [];

      // Try parsing as full JSON first (array or object wrapper)
      // LLMs often ignore "NDJSON" instruction and return pretty JSON array
      const fullParsed = parseJSON<unknown>(content);
      let items: unknown[] = [];

      if (fullParsed.ok) {
        const data = fullParsed.data;
        if (Array.isArray(data)) {
          items = data;
        } else if (typeof data === "object" && data !== null) {
          // Check for wrapped array: { contexts: [...] } or similar
          const obj = data as Record<string, unknown>;
          for (const key of ["contexts", "data", "items", "results", "list"]) {
            if (Array.isArray(obj[key])) {
              items = obj[key] as unknown[];
              break;
            }
          }
          // Don't wrap single object - let it fall through to NDJSON parsing
          // to ensure multi-line NDJSON responses are properly parsed
        }
      }

      // Fallback: parse as NDJSON (one object per line)
      if (items.length === 0) {
        const lines = content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        for (const line of lines) {
          const parsed = parseJSON<Record<string, unknown>>(line);
          if (parsed.ok) {
            items.push(parsed.data);
          }
        }
      }

      // Process items: filter accepted contexts
      for (const item of items) {
        if (typeof item !== "object" || item === null) continue;
        const obj = item as Record<string, unknown>;

        // Accept if status is "accepted" OR if no status field (assume accepted)
        const hasStatus = "status" in obj;
        if (!hasStatus || obj.status === "accepted") {
          rawContexts.push({
            name: obj.name as string | undefined,
            type: (obj.contextType || obj.type) as string | undefined,
            description: (obj.description || obj.reasoning) as
              | string
              | undefined,
          });
        }
      }

      if (rawContexts.length === 0) {
        if (attempt === MAX_RETRIES) {
          return {
            ok: false,
            error:
              "The AI could not identify any valid bounded contexts from your description. Try providing more details about your system's business domains and responsibilities.",
          };
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
