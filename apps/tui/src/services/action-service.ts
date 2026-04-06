import type { ViolationItem } from "../state/use-tui-store.js";
import type { MCPClientService } from "./mcp-client.service.js";

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
  const jsonBlockMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonBlockMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonBlockMatch[0]) as {
      tool?: string;
      arguments?: Record<string, unknown>;
    };

    if (!parsed.tool || !parsed.arguments) {
      return null;
    }

    return {
      tool: parsed.tool,
      arguments: parsed.arguments,
    };
  } catch {
    return null;
  }
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
  const prompt = [
    "You are an architecture fixer.",
    "Return ONLY valid JSON with keys tool and arguments.",
    "Allowed tools: hexagen_audit_boundaries, hexagen_add_dependency, hexagen_create_port, hexagen_create_adapter, hexagen_scaffold_module.",
    "Violation:",
    JSON.stringify(violation, null, 2),
  ].join("\n");

  const completion = await llm.complete({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    maxTokens: 350,
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

  const result = (await mcpClient.callTool({
    name: suggestion.tool,
    arguments: suggestion.arguments,
  })) as { isError?: boolean; content?: Array<{ text?: string }> };

  if (result.isError) {
    return result.content?.[0]?.text ?? "Tool execution failed.";
  }

  return result.content?.[0]?.text ?? "Tool executed successfully.";
}
