import type { TandemTokenMetadata } from "./tandem-token-metadata.vo.js";

export interface TandemMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  stage1Draft?: string;
  metadata?: {
    isTandem?: boolean;
    tokenMetadata?: TandemTokenMetadata;
    errorLabel?: string;
  };
  timestamp: number;
}
