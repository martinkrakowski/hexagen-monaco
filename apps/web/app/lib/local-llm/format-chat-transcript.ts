import type { ChatMessage } from "@hexagen/local-llm";

/**
 * Formats a list of ChatMessage entries as Markdown for download.
 *
 * The output starts with a header line, the export timestamp, and a count of
 * messages. Each message follows as a heading with its role and ISO timestamp
 * (or `time unknown`), then the content unchanged. Empty content is rendered
 * as `(empty)`.
 */
export function formatChatTranscript(
  messages: ChatMessage[],
  exportedAt: Date,
): string {
  const lines: string[] = [];

  lines.push("# Assistant messages stored in this browser");
  lines.push(`Exported ${exportedAt.toISOString()}`);
  lines.push(`Count: ${messages.length}`);

  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) {
      lines.push("(unreadable entry)");
      continue;
    }

    const role =
      msg.role === "user"
        ? "User"
        : msg.role === "assistant"
          ? "Assistant"
          : String(msg.role);

    // A timestamp that is not finite, or is outside the range a Date can hold,
    // makes toISOString() throw; one bad entry must not stop the transcript.
    let timeLabel = "time unknown";
    if (typeof msg.timestamp === "number" && Number.isFinite(msg.timestamp)) {
      const date = new Date(msg.timestamp);
      if (!Number.isNaN(date.getTime())) timeLabel = date.toISOString();
    }

    lines.push(`## ${role} — ${timeLabel}`);

    const content = msg.content;
    if (typeof content !== "string") {
      lines.push("(unreadable)");
    } else if (content.length === 0) {
      lines.push("(empty)");
    } else {
      lines.push(content);
    }
  }

  return lines.join("\n");
}
