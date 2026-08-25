/**
 * One streamed model turn over `/api/llm/chat` (server-key path: the route
 * uses the server's LLM key and enforces the free-tier daily quota for
 * anonymous sessions — decided open question Q5).
 *
 * Same SSE contract as the accept-view governance chat (the route emits
 * `data: {type:"chunk"|"done"|"error"}` frames); reimplemented here because
 * the feature-isolation rule keeps slices from importing each other's hooks,
 * and the session loop needs a promise-of-full-content shape rather than a
 * message-list hook.
 */
import { fetchWithCsrf } from "@/lib/csrf-fetch";

export type StreamChatResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly error: string; readonly aborted: boolean };

const CHAT_ENDPOINT = "/api/llm/chat";

export interface StreamChatTurnOptions {
  /** The single grounded fold message for this turn. */
  readonly message: string;
  readonly model: string;
  readonly signal: AbortSignal;
  /** Called with the FULL accumulated content after each chunk. */
  readonly onChunk?: (content: string) => void;
}

export async function streamChatTurn(
  options: StreamChatTurnOptions,
): Promise<StreamChatResult> {
  const { message, model, signal, onChunk } = options;
  let content = "";
  let streamError: string | null = null;

  try {
    const response = await fetchWithCsrf(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
        // NOTE: the server-key (non-BYOK) route arm pins the deployment's
        // LLM_MODEL and ignores model/temperature/maxTokens entirely — these
        // fields are honored only by the BYOK proxy arm. Kept for request
        // parity with the governance chat's contract.
        model,
        temperature: 0.7,
        maxTokens: 2048,
      }),
      signal,
    });

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json();
        errorMsg = errorBody.error ?? errorMsg;
      } catch {
        // Ignore JSON parse errors on error responses.
      }
      return { ok: false, error: errorMsg, aborted: false };
    }

    const reader = response.body?.getReader();
    if (!reader)
      return { ok: false, error: "No response body", aborted: false };

    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    // Returns true when a terminal frame (done/error) was seen.
    const handleDataLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) return false;
      let frame: { type?: string; content?: string; message?: string };
      try {
        frame = JSON.parse(trimmed.slice(6));
      } catch {
        return false;
      }
      if (frame.type === "chunk" && frame.content) {
        content += frame.content;
        onChunk?.(content);
        return false;
      }
      if (frame.type === "error") {
        streamError = frame.message ?? "Unknown error";
        return true;
      }
      return frame.type === "done";
    };

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (handleDataLine(line)) {
          done = true;
          break;
        }
      }
    }

    // Flush a trailing frame emitted without a final newline — otherwise a
    // terminal `done`/`error` (or last chunk) could be dropped.
    if (!done) {
      buffer += decoder.decode();
      for (const line of buffer.split("\n")) {
        if (handleDataLine(line)) break;
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "Aborted", aborted: true };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      aborted: false,
    };
  }

  if (streamError) return { ok: false, error: streamError, aborted: false };
  if (content.trim() === "") {
    // Server path retries empty completions and emits an error frame; this
    // catches anything that still slips through — an empty model turn must
    // surface, not stall the session with a blank proposal.
    return {
      ok: false,
      error: "The model returned no response. Please try again.",
      aborted: false,
    };
  }
  return { ok: true, content };
}
