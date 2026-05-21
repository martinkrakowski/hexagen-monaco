import { MAX_RETRY_ATTEMPTS } from "../errors/stage-errors";

export const STAGE_LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT = `You are a requirements architect. Your job is to convert a loose, unstructured project description into a strict structured JSON configuration.
The output MUST be valid JSON adhering to the StructuredConfig shape.

CRITICAL OUTPUT FORMAT - JSON ONLY.
Do not output markdown. Output ONLY a valid JSON object with the following structure:
{
  "bounded_contexts": [
    {
      "name": "string (kebab-case)",
      "description": "string",
      "type": "core | supporting | generic | shared-kernel"
    }
  ]
}
`;

export function escapeXml(unsafe: string): string {
  return unsafe.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c] as string,
  );
}

export function compileLooseSpecConversionPrompt(
  userDescription: string,
): string {
  return `Convert this loose specification to the required JSON format:\n<user_input>\n${escapeXml(userDescription)}\n</user_input>\n\nOutput JSON:`;
}

export interface LooseSpecRetryContext {
  attempt: number;
  failedOutput: string;
  errorDetail: string;
  originalPrompt: string;
}

export function buildLooseSpecRetryPrompt(ctx: LooseSpecRetryContext): string {
  const truncatedOutput =
    ctx.failedOutput.length > 800
      ? ctx.failedOutput.slice(0, 800) + "\n... [truncated]"
      : ctx.failedOutput;

  return [
    `CORRECTION REQUIRED — Attempt ${ctx.attempt} of ${MAX_RETRY_ATTEMPTS}`,
    ``,
    `Your previous output was rejected for this reason:`,
    `<rejection_reason>`,
    ctx.errorDetail,
    `</rejection_reason>`,
    ``,
    `Your previous output was:`,
    `<failed_output>`,
    truncatedOutput,
    `</failed_output>`,
    ``,
    `The original input that produced this output was:`,
    `<original_input>`,
    ctx.originalPrompt.slice(0, 1000),
    `</original_input>`,
    ``,
    `Format reminder: Output ONLY valid JSON containing a "bounded_contexts" array.`,
    ``,
    `Correct ONLY the invalid portions. Do not regenerate correct objects.`,
    `Output corrected JSON:`,
  ].join("\n");
}
