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

      // Handle NDJSON: split by lines and parse each object
      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        if (attempt === MAX_RETRIES)
          return { ok: false, error: "Empty response from LLM" };
        continue;
      }

      const rawContexts: Array<{
        name?: string;
        type?: string;
        description?: string;
        status?: string;
        contextType?: string;
      }> = [];

      // Parse each NDJSON line
      for (const line of lines) {
        try {
          const parsed = parseJSON<{
            name?: string;
            type?: string;
            description?: string;
            status?: string;
            contextType?: string;
          }>(line);

          if (!parsed.ok) continue; // Skip malformed lines

          const obj = parsed.data as Record<string, unknown>;

          // Extract accepted contexts (skip rejected/uncertain)
          if (obj.status === "accepted" || (obj.status !== "rejected" && obj.status !== "uncertain")) {
            rawContexts.push({
              name: obj.name as string | undefined,
              type: (obj.contextType || obj.type) as string | undefined,
              description: obj.description as string | undefined,
            });
          }
        } catch {
          // Continue on parsing errors for individual lines
        }
      }

      if (rawContexts.length === 0) {
        if (attempt === MAX_RETRIES) {
          return {
            ok: false,
            error: "No valid bounded contexts found in LLM response",
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
