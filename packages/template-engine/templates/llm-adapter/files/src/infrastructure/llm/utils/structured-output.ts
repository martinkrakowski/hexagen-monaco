import type { ZodSchema } from "zod";
import { LLMParsingError } from "../errors/llm-errors";
import type { LLMClientPort, LLMCallOptions } from "../../../domain/ports/out/llm-client.port";
import type { Result } from "../../../../shared/result";
import type { LLMError } from "../errors/llm-errors";

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

function extractJson(raw: string): string {
  const fenced = JSON_FENCE_RE.exec(raw);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) return raw.slice(start, end + 1);
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) return raw.slice(arrStart, arrEnd + 1);
  return raw.trim();
}

const REPAIR_SYSTEM_PROMPT = `You are a JSON repair assistant. The user will provide a JSON string and a validation error. Return ONLY the corrected JSON with no explanation, no markdown, no code fences.`;

export async function callStructured<T>(
  client: LLMClientPort,
  prompt: string,
  schema: ZodSchema<T>,
  options?: LLMCallOptions,
): Promise<Result<T, LLMError>> {
  const systemPrompt = [
    options?.systemPrompt,
    "Respond with ONLY valid JSON matching the requested schema. No explanation, no markdown.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const callResult = await client.call(prompt, { ...options, systemPrompt });
  if (!callResult.success) return callResult;

  const raw = callResult.value.content;

  let repairReason: string;

  try {
    const parsed = JSON.parse(extractJson(raw));
    const validated = schema.safeParse(parsed);
    if (validated.success) return { success: true, value: validated.data };
    repairReason = `Validation errors:\n${JSON.stringify(validated.error.issues, null, 2)}`;
  } catch (e) {
    repairReason = `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  // One repair attempt — covers both invalid JSON and schema validation failures
  const repairPrompt = `Original response:\n${raw}\n\n${repairReason}\n\nReturn the corrected JSON only.`;
  const repairResult = await client.call(repairPrompt, {
    ...options,
    systemPrompt: REPAIR_SYSTEM_PROMPT,
  });

  if (!repairResult.success) return repairResult;

  try {
    const repaired = JSON.parse(extractJson(repairResult.value.content));
    const revalidated = schema.safeParse(repaired);
    if (revalidated.success) return { success: true, value: revalidated.data };
    return {
      success: false,
      error: new LLMParsingError(
        `Schema validation failed after repair: ${revalidated.error.message}`,
        raw,
      ),
    };
  } catch (e) {
    return {
      success: false,
      error: new LLMParsingError("Repair response is not valid JSON", repairResult.value.content, e),
    };
  }
}
