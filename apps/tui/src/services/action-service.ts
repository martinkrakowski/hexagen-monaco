import {
  EnvironmentSecretVaultAdapter,
  ServerLLMAdapter,
  parseJSON,
  resolveApiKey,
  type CloudProviderEndpoint,
  type LLMProviderPort,
  type SecretVaultPort,
} from "@hexagen/agentic-interaction";
import type { ViolationItem } from "../state/use-tui-store.js";
import type { MCPToolCallInput } from "./mcp-client.service.js";

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

/**
 * Provider endpoint the `r` (refactor) binding drives, expressed with the
 * shared `CloudProviderEndpoint` contract so the key name, base URL, model and
 * sampling settings live in one declarative place instead of being scattered
 * through an inlined HTTP call.
 */
export const TUI_REFACTOR_ENDPOINT: CloudProviderEndpoint = {
  providerId: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  apiKeyEnvVar: "OPENAI_API_KEY",
  temperature: 0,
  maxTokens: 1024,
};

/**
 * Builds the shared `LLMProviderPort` implementation for the refactor flow.
 * Returns `null` when no API key is resolvable, which the caller reports as a
 * status message rather than an error.
 *
 * The vault is injectable so tests never depend on ambient `process.env`.
 */
export function createRefactorLLMProvider(
  vault: SecretVaultPort = new EnvironmentSecretVaultAdapter(),
): LLMProviderPort | null {
  const resolved = resolveApiKey(vault, TUI_REFACTOR_ENDPOINT);
  if (!resolved) {
    return null;
  }
  return new ServerLLMAdapter(
    resolved.apiKey,
    resolved.baseUrl,
    String(resolved.model),
  );
}

/**
 * The slice of the MCP client this flow needs. Declared structurally so the
 * remediation logic can be exercised without standing up a stdio transport.
 */
export interface ToolInvoker {
  callTool(input: MCPToolCallInput): Promise<unknown>;
}

interface MCPToolSuggestion {
  tool: string;
  arguments: Record<string, unknown>;
}

/**
 * Narrows the parsed payload to a tool suggestion, or `null` for anything else.
 *
 * `parseJSON` is typed `{ ok: true; data: T }`, but `T` is an assertion about
 * untrusted model output, not a guarantee: `JSON.parse("null")` succeeds, so a
 * model reply of literal `null` arrives as `ok: true` with a `data` that cannot
 * be destructured. Parse the payload as `unknown` and reject every non-object
 * shape here, so a hostile or merely confused reply lands on the same handled
 * "no valid suggestion" path as any other malformed one rather than throwing
 * out of the `r` remediation flow.
 */
function parseToolSuggestion(content: string): MCPToolSuggestion | null {
  const parsed = parseJSON<unknown>(content);

  if (!parsed.ok) {
    return null;
  }

  const payload = parsed.data;
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const { tool, arguments: args } = payload as {
    tool?: unknown;
    arguments?: unknown;
  };
  if (
    typeof tool !== "string" ||
    tool.length === 0 ||
    args === null ||
    typeof args !== "object" ||
    Array.isArray(args)
  ) {
    return null;
  }

  return { tool, arguments: args as Record<string, unknown> };
}

export async function refactorWithAI(
  mcpClient: ToolInvoker,
  violation: ViolationItem,
  llm: LLMProviderPort | null = createRefactorLLMProvider(),
): Promise<string> {
  if (!llm) {
    return `${TUI_REFACTOR_ENDPOINT.apiKeyEnvVar} is not set. Unable to invoke AI refactor.`;
  }

  const completion = await llm.complete({
    model: String(TUI_REFACTOR_ENDPOINT.model),
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
    temperature: TUI_REFACTOR_ENDPOINT.temperature,
    maxTokens: TUI_REFACTOR_ENDPOINT.maxTokens,
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
