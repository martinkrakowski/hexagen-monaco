import { ok, err } from "@hexagen/shared";
import type {
  AISuggestion,
  SuggestionEnginePort,
  SuggestionRequest,
} from "../../domain/ports/suggestion-engine.port";
import type {
  LLMProviderPort,
  LLMMessage,
} from "../../domain/ports/llm-provider.port";
import type { Result } from "@hexagen/shared";

interface ParsedSuggestion {
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

export class GenerateSuggestionUseCase {
  constructor(
    private readonly llmProvider: LLMProviderPort,
    private readonly suggestionEngine: SuggestionEnginePort,
  ) {}

  async execute(request: SuggestionRequest): Promise<Result<AISuggestion[]>> {
    const systemPrompt = this.suggestionEngine.buildSystemPrompt(
      request.context,
    );
    const userPrompt = request.prompt;

    const messages: LLMMessage[] = [
      systemPrompt,
      { role: "user", content: userPrompt },
    ];

    const response = await this.llmProvider.complete({
      model: "",
      messages,
      temperature: 0.7,
      maxTokens: 2048,
    });

    if (!response.success) {
      return err(response.error);
    }

    const content = response.value.choices[0]?.message?.content;
    if (!content) {
      return err(new Error("No response content from LLM"));
    }

    const suggestions = this.parseSuggestions(
      content,
      request.maxSuggestions ?? 5,
    );
    return ok(suggestions);
  }

  private parseSuggestions(content: string, max: number): AISuggestion[] {
    const suggestions: AISuggestion[] = [];

    const lines = content.split("\n").filter((line) => line.trim());
    let id = 1;

    for (const line of lines) {
      if (suggestions.length >= max) break;

      const parsed = this.parseLine(line);
      if (parsed) {
        suggestions.push({
          id: String(id++),
          message: parsed.message,
          confidence: parsed.confidence,
          category: parsed.category,
          actionable: parsed.confidence > 70,
        });
      }
    }

    if (suggestions.length === 0) {
      suggestions.push({
        id: "1",
        message: content.slice(0, 200),
        confidence: 50,
        category: "general",
        actionable: false,
      });
    }

    return suggestions;
  }

  private parseLine(line: string): ParsedSuggestion | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const messageMatch = trimmed.match(/[-*]?\s*(.+)/);
    if (!messageMatch) return null;

    const message = messageMatch[1].trim();

    let category: ParsedSuggestion["category"] = "general";
    if (message.toLowerCase().includes("split")) category = "context-split";
    else if (message.toLowerCase().includes("port"))
      category = "port-definition";
    else if (message.toLowerCase().includes("dependency"))
      category = "dependency-cleanup";

    const confidenceMatch = message.match(/\((\d+)%\)/);
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1], 10) : 50;

    return { message, confidence, category };
  }
}
