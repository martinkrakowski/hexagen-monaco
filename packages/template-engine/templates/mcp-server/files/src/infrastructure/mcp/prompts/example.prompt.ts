// @hexagen-server-only
/**
 * Example MCP prompt — a reusable, named message template a client can invoke.
 * A worked stub: wire it onto the server from your composition root and adapt
 * the messages to your domain.
 */
import type { McpServerLike } from "../sdk.js";

type PromptCapableServer = McpServerLike & {
  registerPrompt?: (
    name: string,
    config: { description: string },
    handler: () => {
      messages: Array<{ role: string; content: { type: "text"; text: string } }>;
    },
  ) => void;
};

export function registerExamplePrompt(server: McpServerLike): void {
  (server as PromptCapableServer).registerPrompt?.(
    "example",
    { description: "Replace with a reusable prompt for your domain." },
    () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "Summarize the latest changes." },
        },
      ],
    }),
  );
}
