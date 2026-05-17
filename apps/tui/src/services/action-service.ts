import type { ViolationItem } from "../state/use-tui-store.js";
import type { MCPClientService } from "./mcp-client.service.js";

export const ALLOWED_REFACTOR_TOOLS = [
  "hexagen_audit_boundaries",
  "hexagen_add_dependency",
  "hexagen_create_port",
  "hexagen_create_adapter",
  "hexagen_scaffold_module",
] as const;

export type AllowedRefactorTool = (typeof ALLOWED_REFACTOR_TOOLS)[number];
const ALLOWED_TOOL_SET = new Set<string>(ALLOWED_REFACTOR_TOOLS);

const REFACTOR_SYSTEM_PROMPT = [
  "You are an architecture fixer for hexagonal DDD projects using the Hexagen toolchain.",
  "When given a DDD boundary violation, you select the correct MCP tool and construct its arguments.",
  'Return ONLY a raw JSON object with exactly two keys: "tool" and "arguments".',
  "Do not explain. Do not add markdown fences. Do not add any text before or after the JSON.",
  `Allowed tools: ${ALLOWED_REFACTOR_TOOLS.join(", ")}.`,
].join("\n");

type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

interface LLMCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}

interface LLMCompletionResponse {
  choices: Array<{ message: { role: "assistant"; content: string } }>;
}

interface LLMProviderPort {
  complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>>;
  streamComplete(request: LLMCompletionRequest): AsyncGenerator<Result<string>>;
}

class LocalLLMProviderAdapter implements LLMProviderPort {
  constructor(private readonly apiKey: string) {}

  async complete(
    request: LLMCompletionRequest,
  ): Promise<Result<LLMCompletionResponse>> {
    try {
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            temperature: request.temperature ?? 0,
            max_tokens: request.maxTokens ?? 350,
          }),
        },
      );

      if (!response.ok) {
        return {
          success: false,
          error: new Error(`LLM request failed: ${response.status}`),
        };
      }

      const payload = (await response.json()) as LLMCompletionResponse;
      return { success: true, value: payload };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async *streamComplete(): AsyncGenerator<Result<string>> {
    yield {
      success: false,
      error: new Error(
        "streamComplete is not implemented in TUI action service",
      ),
    };
  }
}

interface MCPToolSuggestion {
  tool: string;
  arguments: Record<string, unknown>;
}

function parseToolSuggestion(content: string): MCPToolSuggestion | null {
  // Attempt 1: direct parse of the full response
  try {
    const parsed = JSON.parse(content.trim()) as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };
    if (parsed.tool && parsed.arguments) {
      return { tool: parsed.tool, arguments: parsed.arguments };
    }
  } catch {
    // Not clean JSON — try extraction
  }

  // Attempt 2: extract the outermost JSON object by walking braces
  const start = content.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;

  try {
    const extracted = content.slice(start, end + 1);
    const parsed = JSON.parse(extracted) as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };
    if (parsed.tool && typeof parsed.arguments === "object") {
      return { tool: parsed.tool, arguments: parsed.arguments };
    }
  } catch {
    return null;
  }

  return null;
}

export async function refactorWithAI(
  mcpClient: MCPClientService,
  violation: ViolationItem,
): Promise<string> {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return "OPENAI_API_KEY is not set. Unable to invoke AI refactor.";
  }

  const llm = new LocalLLMProviderAdapter(apiKey);

  const completion = await llm.complete({
    model: "gpt-4o",
    messages: [
      { role: "system", content: REFACTOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          "Violation to fix:",
          "<violation>",
          JSON.stringify(violation, null, 2),
          "</violation>",
          "",
          "Return the MCP tool call JSON:",
        ].join("\n"),
      },
    ],
    temperature: 0,
    maxTokens: 1024,
  });

  if (!completion.success) {
    const errorMessage =
      completion.error instanceof Error
        ? completion.error.message
        : String(completion.error);
    return `LLM failed: ${errorMessage}`;
  }

  const content = completion.value.choices[0]?.message?.content ?? "";
  const suggestion = parseToolSuggestion(content);
  if (!suggestion) {
    return "LLM response did not include a valid MCP tool JSON suggestion.";
  }

  if (!ALLOWED_TOOL_SET.has(suggestion.tool)) {
    return (
      `LLM suggested an unknown tool: "${suggestion.tool}". ` +
      `Allowed tools: ${ALLOWED_REFACTOR_TOOLS.join(", ")}.`
    );
  }

  const result = (await mcpClient.callTool({
    name: suggestion.tool,
    arguments: suggestion.arguments,
  })) as { isError?: boolean; content?: Array<{ text?: string }> };

  if (result.isError) {
    return result.content?.[0]?.text ?? "Tool execution failed.";
  }

  return result.content?.[0]?.text ?? "Tool executed successfully.";
}
