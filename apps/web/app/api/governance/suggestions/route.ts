import { NextResponse } from "next/server";
import { GenerateSuggestionUseCase } from "@hexagen/agentic-interaction";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";
import { logger } from "../../../../lib/structured-logger";
import { resolveWebLlmApiKey } from "@/lib/wire.shared";
import {
  guardManifestBody,
  guardManifestSize,
  guardOpenFileContentSize,
} from "@/lib/request-guards";

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
    const body = (await request.json()) as unknown;

    // Validate the decoded body shape before trusting the `as` cast below.
    const invalidBody = guardManifestBody(body);
    if (invalidBody) return invalidBody;
    const { manifestYaml, openFileContent } = body as SuggestionsRequestBody;

    const tooLarge = guardManifestSize(manifestYaml);
    if (tooLarge) return tooLarge;

    // The optional open file is appended verbatim to the LLM prompt below — bound
    // its size and reject a non-string before it reaches the prompt.
    const openFileTooLarge = guardOpenFileContentSize(openFileContent);
    if (openFileTooLarge) return openFileTooLarge;

    // WEB_LLM_API_KEY ?? LLM_API_KEY — survives the mercury prod flip
    // (which unsets LLM_API_KEY); see resolveWebLlmApiKey.
    const apiKey = resolveWebLlmApiKey();
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

    let prompt = `Analyze this architecture manifest and suggest improvements:\n\n${manifestYaml}`;
    if (openFileContent) {
      prompt += `\n\n--- Currently open file ---\n${openFileContent}`;
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
    logger.error("Governance suggestions error:", { error: err });
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
