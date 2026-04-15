import { NextResponse } from "next/server";
import { GenerateSuggestionUseCase } from "@hexagen/agentic-interaction";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";
import { readFile } from "fs/promises";
import path from "path";

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

export async function GET() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_LLM_API_KEY || "";
    const baseUrl =
      process.env.NEXT_PUBLIC_LLM_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json({
        suggestions: [],
        error: "LLM API key not configured",
      });
    }

    const llmProvider = new ServerLLMAdapter(apiKey, baseUrl, model);

    const manifestPath = path.join(
      process.cwd(),
      ".architecture",
      "manifest.yaml",
    );
    let manifestContent = "";
    try {
      manifestContent = await readFile(manifestPath, "utf-8");
    } catch {
      manifestContent = "No manifest found";
    }

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

    const result = await useCase.execute({
      prompt: `Analyze this architecture manifest and suggest improvements:\n\n${manifestContent}`,
      context: {},
      maxSuggestions: 5,
    });

    if (!result.success) {
      const errorMessage =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      return NextResponse.json({
        suggestions: [],
        error: errorMessage,
      });
    }

    const suggestions: AISuggestion[] = result.value.map((s) => ({
      id: s.id,
      message: s.message,
      confidence: s.confidence,
      category: s.category,
    }));

    return NextResponse.json({ suggestions });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate suggestions",
      },
      { status: 500 },
    );
  }
}
