import type { Result } from "@hexagen/shared";
import { ok } from "@hexagen/shared";
import type {
  PayloadConstructorOptions,
  PayloadConstructorPort,
  PayloadConstructorResult,
} from "../ports/payload-constructor.port.js";

// ---------------------------------------------------------------------------
// Stage 2 Payload Template (Section 6.2)
// ---------------------------------------------------------------------------

const STAGE_2_TEMPLATE = `[ORIGINAL_INSTRUCTION]
{user_prompt}
[/ORIGINAL_INSTRUCTION]

[CONVERSATION_HISTORY]
{truncated_prior_turns}
[/CONVERSATION_HISTORY]

[LOCAL_DRAFT]
{stage_1_output_between_markers}
[/LOCAL_DRAFT]

Review the local draft above in the context of the original instruction. Refine, expand, correct any errors, and produce a final, polished response.`;

// ---------------------------------------------------------------------------
// Token estimation (word count × 1.3, consistent with pre-flight)
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(wordCount * 1.3);
}

// ---------------------------------------------------------------------------
// Marker extraction
// ---------------------------------------------------------------------------

const DRAFT_START_MARKER = "[DRAFT_START]";
const DRAFT_END_MARKER = "[DRAFT_END]";

function extractDraftContent(localDraft: string): {
  content: string;
  hadMarkers: boolean;
} {
  const startIdx = localDraft.indexOf(DRAFT_START_MARKER);
  const endIdx = localDraft.indexOf(DRAFT_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const content = localDraft
      .slice(startIdx + DRAFT_START_MARKER.length, endIdx)
      .trim();
    return { content, hadMarkers: true };
  }

  return { content: localDraft, hadMarkers: false };
}

// ---------------------------------------------------------------------------
// History serialization
// ---------------------------------------------------------------------------

function serializeHistory(
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
): string {
  return history.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
}

// ---------------------------------------------------------------------------
// Payload assembly
// ---------------------------------------------------------------------------

const PLACEHOLDER_MAP: Record<string, 0 | 1 | 2> = {
  "{user_prompt}": 0,
  "{truncated_prior_turns}": 1,
  "{stage_1_output_between_markers}": 2,
};

function assemblePayload(
  userPrompt: string,
  historyText: string,
  draftContent: string,
): string {
  const values = [userPrompt, historyText, draftContent] as const;
  return STAGE_2_TEMPLATE.replace(
    /\{user_prompt\}|\{truncated_prior_turns\}|\{stage_1_output_between_markers\}/g,
    (match) => values[PLACEHOLDER_MAP[match] ?? 0],
  );
}

// ---------------------------------------------------------------------------
// Stage2PayloadConstructorUseCase
// ---------------------------------------------------------------------------

/**
 * Stage2PayloadConstructorUseCase
 *
 * Constructs the Stage 2 payload for cloud dispatch by combining:
 * - The original user prompt
 * - Truncated conversation history
 * - The Stage 1 local draft (extracted from markers if present)
 *
 * Progressive truncation strategy (Section 5 — Stage 2):
 * 1. If estimated tokens > 90% of cloudContextLimit:
 *    a. Truncate localDraft from the end until payload fits within 85% of limit.
 *    b. If still over 90%, truncate history (remove oldest turns first).
 *    c. If still over 90%, drop localDraft entirely and use original prompt + minimal history.
 */
export class Stage2PayloadConstructorUseCase implements PayloadConstructorPort {
  constructPayload(
    options: PayloadConstructorOptions,
  ): Result<PayloadConstructorResult, Error> {
    const { userPrompt, localDraft, history, cloudContextLimit } = options;

    // Step 1: Extract draft content from markers
    const { content: draftContent, hadMarkers } =
      extractDraftContent(localDraft);

    // Step 2: Serialize history
    let currentHistory = [...history];
    let historyText = serializeHistory(currentHistory);

    // Step 3: Assemble initial payload
    let currentDraft = draftContent;
    let payload = assemblePayload(userPrompt, historyText, currentDraft);

    let truncatedDraft = false;
    let truncatedHistory = false;

    const threshold90 = cloudContextLimit * 0.9;
    const threshold85 = cloudContextLimit * 0.85;

    // Step 4: Progressive truncation
    if (estimateTokens(payload) > threshold90) {
      // Step 4a: Truncate draft from the end
      const words = currentDraft.split(/\s+/);
      while (words.length > 0 && estimateTokens(payload) > threshold85) {
        words.pop();
        currentDraft = words.join(" ");
        payload = assemblePayload(userPrompt, historyText, currentDraft);
        truncatedDraft = true;
      }

      // Step 4b: If still over 90%, truncate history (remove oldest turns first)
      if (estimateTokens(payload) > threshold90) {
        while (
          currentHistory.length > 0 &&
          estimateTokens(payload) > threshold90
        ) {
          currentHistory.shift(); // remove oldest turn
          historyText = serializeHistory(currentHistory);
          payload = assemblePayload(userPrompt, historyText, currentDraft);
          truncatedHistory = true;
        }
      }

      // Step 4c: If still over 90%, drop draft entirely
      if (estimateTokens(payload) > threshold90) {
        currentDraft = "";
        truncatedDraft = true;
        // Keep only minimal history (most recent turn if any)
        if (currentHistory.length > 1) {
          currentHistory = currentHistory.slice(-1);
          truncatedHistory = true;
        }
        historyText = serializeHistory(currentHistory);
        payload = assemblePayload(userPrompt, historyText, currentDraft);
      }
    }

    // Emit diagnostic if markers were absent (log-level warning via console)
    if (!hadMarkers && localDraft.trim().length > 0) {
      // Diagnostic: Stage 1 output lacked [DRAFT_START]/[DRAFT_END] markers.
      // Using full output as fallback.
      // (No external logger dependency — this is a pure domain use case.)
    }

    return ok({ payload, truncatedHistory, truncatedDraft }) as Result<
      PayloadConstructorResult,
      Error
    >;
  }
}
