import type { ChatMessage } from "@hexagen/local-llm";

/**
 * Defines the structured request payload for a server-side LLM chat request.
 */
export interface ServerLLMRequest {
  messages: ChatMessage[];
  // Other potential properties like model, temperature, etc. can be added here.
}

/**
 * Defines the user information passed for authentication and authorization purposes.
 */
export interface ServerLLMUserInfo {
  id: string;
  // Other potential properties like roles, permissions, etc.
}

/**
 * Port for handling server-side LLM chat requests.
 * This acts as the primary entry point into the domain for authenticated, server-originated requests.
 */
export interface ServerLLMRequestPort {
  /**
   * Handles an incoming LLM request from a trusted, authenticated server context.
   * @param request The structured request payload.
   * @param userInfo The identity of the user making the request.
   * @returns A ReadableStream of the LLM response.
   */
  handleRequest(
    request: ServerLLMRequest,
    userInfo: ServerLLMUserInfo,
  ): Promise<ReadableStream<Uint8Array>>;
}
