import type { TandemTokenMetadata } from "./tandem-token-metadata.vo.js";

export interface TandemMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  /**
   * Persistent storage field — maps to stage1Draft semantics.
   * Use `visibleContent` for rendering.
   */
  content: string;
  /** Frozen stage 1 draft retained for metadata/append-mode display. */
  stage1Draft?: string;
  /** The field rendered in the UI — overwritten during Stage 3 in overwrite mode. */
  visibleContent?: string;
  /** Current pipeline stage for this message. */
  stage?: "stage1" | "transitioning" | "stage3" | "complete";
  metadata?: {
    isTandem?: boolean;
    tokenMetadata?: TandemTokenMetadata;
    errorLabel?: string;
  };
  timestamp: number;
}
