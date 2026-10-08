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
    const role =
      msg.role === "user"
        ? "User"
        : msg.role === "assistant"
          ? "Assistant"
          : msg.role;

    let timeLabel: string;
    if (typeof msg.timestamp === "number" && !Number.isNaN(msg.timestamp)) {
      timeLabel = new Date(msg.timestamp).toISOString();
    } else {
      timeLabel = "time unknown";
    }

    lines.push(`## ${role} — ${timeLabel}`);
    lines.push(msg.content.length === 0 ? "(empty)" : msg.content);
  }

  return lines.join("\n");
}
