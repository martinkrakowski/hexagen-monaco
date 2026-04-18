/**
 * Chat message value object — persisted conversation history entry.
 * Includes UI-specific fields (id, timestamp) alongside core message content.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
