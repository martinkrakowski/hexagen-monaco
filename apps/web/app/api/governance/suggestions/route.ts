import { NextResponse } from "next/server";
import { GenerateSuggestionUseCase } from "@hexagen/agentic-interaction";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";

interface AISuggestion {
  id: string;
  message: string;
  confidence: number;
  category:
    | "context-split"
    | "port-definition"
    | "dependency-cleanup"
    | "general";
}

interface SuggestionsRequestBody {
  manifestYaml: string;
  openFileContent?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SuggestionsRequestBody;

    if (!body.manifestYaml) {
      return NextResponse.json(
        { error: "manifestYaml is required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.LLM_API_KEY || "";
    const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.LLM_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json({
        suggestions: [],
        error: "LLM API key not configured",
      });
    }

    const llmProvider = new ServerLLMAdapter(apiKey, baseUrl, model);

    const useCase = new GenerateSuggestionUseCase(llmProvider, {
      generateSuggestions: async () => ({
        success: false,
        error: new Error("Not implemented"),
      }),
      buildSystemPrompt: () => ({
        role: "system",
        content:
          "You are an architectural assistant. Analyze the manifest and provide suggestions.",
      }),
    });

    let prompt = `Analyze this architecture manifest and suggest improvements:\n\n${body.manifestYaml}`;
    if (body.openFileContent) {
      prompt += `\n\n--- Currently open file ---\n${body.openFileContent}`;
    }

    const result = await useCase.execute({
      prompt,
      context: {},
      maxSuggestions: 5,
    });

    if (!result.success) {
      return NextResponse.json({
        suggestions: [],
        error:
          result.error instanceof Error
            ? result.error.message
            : "Failed to generate suggestions",
      });
    }

    const suggestions: AISuggestion[] = result.value.map((s) => ({
      id: s.id,
      message: s.message,
      confidence: s.confidence,
      category: s.category,
    }));

    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error("Governance suggestions error:", err);
    return NextResponse.json(
      { error: "Internal Server Error", suggestions: [] },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      error: "Use POST with manifestYaml and optional openFileContent",
      suggestions: [],
    },
    { status: 405, headers: { Allow: "POST" } },
  );
}
