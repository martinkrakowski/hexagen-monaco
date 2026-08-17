import {
  GenerateSuggestionUseCase,
  ServerLLMAdapter,
} from "@hexagen/agentic-interaction";
import { resolveWebLlmApiKey } from "../../wire.shared";
import type {
  SuggestionOutcome,
  SuggestionPort,
  SuggestionRequest,
} from "../ports";

/**
 * The only implementation of {@link SuggestionPort}: prompt the configured
 * cloud model for architectural suggestions.
 *
 * HEX-016's LLM adapter. The copies that used to live in each route had
 * drifted, exactly as the status/violations copies AUD-005 collapsed had:
 *
 *   - `refresh` passed `context: { projectManifest }`, `suggestions` passed
 *     `context: {}`;
 *   - their system prompts differed;
 *   - and, the defect that matters, `refresh` mapped BOTH "no API key" and "the
 *     provider failed" to `suggestions: []` with no error, while `suggestions`
 *     reported them. A 503 from the provider therefore rendered in the refresh
 *     response as a clean manifest with nothing to suggest.
 *
 * One implementation, one outcome type, and `unavailable` is a value the
 * caller has to handle. The unified system prompt is `refresh`'s — the more
 * specific of the two, and the one that names the architecture style both
 * endpoints exist to advise on.
 */

const SYSTEM_PROMPT =
  "You are an architectural assistant. Analyze the manifest and provide suggestions for improving the hexagonal architecture.";

const MAX_SUGGESTIONS = 5;

export class LlmSuggestionAdapter implements SuggestionPort {
  constructor(
    private readonly resolveApiKey: () => string = resolveWebLlmApiKey,
    private readonly readEnv: (name: string) => string | undefined = (name) =>
      process.env[name],
  ) {}

  async suggest(request: SuggestionRequest): Promise<SuggestionOutcome> {
    // WEB_LLM_API_KEY ?? LLM_API_KEY — survives the mercury prod flip (which
    // unsets LLM_API_KEY); see resolveWebLlmApiKey.
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      // Preserved verbatim: the governance panel surfaces this string, and the
      // `suggestions` route contract test pins it.
      return { kind: "unavailable", reason: "LLM API key not configured" };
    }

    const baseUrl = this.readEnv("LLM_BASE_URL") || "https://api.openai.com/v1";
    const model = this.readEnv("LLM_MODEL") || "gpt-4o-mini";

    const useCase = new GenerateSuggestionUseCase(
      new ServerLLMAdapter(apiKey, baseUrl, model),
      {
        // `GenerateSuggestionUseCase` never calls `generateSuggestions` — it
        // drives the LLM port directly and only uses `buildSystemPrompt`. The
        // stub is required by `SuggestionEnginePort`'s shape, not by any code
        // path; both former copies carried the identical placeholder.
        generateSuggestions: async () => ({
          success: false,
          error: new Error("Not implemented"),
        }),
        buildSystemPrompt: () => ({ role: "system", content: SYSTEM_PROMPT }),
      },
    );

    let prompt = `Analyze this architecture manifest and suggest improvements:\n\n${request.manifestYaml}`;
    if (request.openFileContent) {
      prompt += `\n\n--- Currently open file ---\n${request.openFileContent}`;
    }

    const result = await useCase.execute({
      prompt,
      context: { projectManifest: request.manifestYaml },
      maxSuggestions: MAX_SUGGESTIONS,
    });

    if (!result.success) {
      return {
        kind: "unavailable",
        reason:
          result.error instanceof Error
            ? result.error.message
            : "Failed to generate suggestions",
      };
    }

    return {
      kind: "suggestions",
      suggestions: result.value.map((s) => ({
        id: s.id,
        message: s.message,
        confidence: s.confidence,
        category: s.category,
      })),
    };
  }
}
