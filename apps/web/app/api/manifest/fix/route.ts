import { NextRequest, NextResponse } from "next/server";
import {
  FixManifestViolationUseCase,
  HolisticManifestRepairUseCase,
  LLMProviderSelectorAdapter,
  EnvironmentSecretVaultAdapter,
} from "@hexagen/agentic-interaction";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { manifestYaml, contextYaml, violationMessage, isCrossContext } =
      body;

    if (!violationMessage) {
      return NextResponse.json(
        { success: false, error: "Missing violation message" },
        { status: 400 },
      );
    }

    if (isCrossContext && !manifestYaml) {
      return NextResponse.json(
        { success: false, error: "Missing manifestYaml for cross-context fix" },
        { status: 400 },
      );
    }

    if (!isCrossContext && !contextYaml) {
      return NextResponse.json(
        { success: false, error: "Missing contextYaml for targeted fix" },
        { status: 400 },
      );
    }

    // Set up dependencies
    const secretVault = new EnvironmentSecretVaultAdapter();
    const selectorAdapter = new LLMProviderSelectorAdapter({
      webLlmAdapter: null,
      preferLocal: false,
      validateLocalLLM: false,
      fallbackChain: {
        primary: {
          providerId: "openai" as const,
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o",
          apiKeyEnvVar: "OPENAI_API_KEY",
          temperature: 0.1,
          maxTokens: 4000,
        },
        fallbacks: [
          {
            providerId: "anthropic" as const,
            baseUrl: "https://api.anthropic.com/v1",
            model: "claude-3-5-sonnet-20241022",
            apiKeyEnvVar: "ANTHROPIC_API_KEY",
            temperature: 0.1,
            maxTokens: 4000,
          },
        ],
      },
      secretVault,
    });

    let patchedYaml: string | undefined;

    if (isCrossContext) {
      const useCase = new HolisticManifestRepairUseCase(selectorAdapter);
      const result = await useCase.execute({
        fullManifestYaml: manifestYaml,
        violationMessage,
      });

      if (!result.success || !result.patchedYaml) {
        return NextResponse.json(
          { success: false, error: result.error || "Holistic fix failed" },
          { status: 500 },
        );
      }
      patchedYaml = result.patchedYaml;
    } else {
      const useCase = new FixManifestViolationUseCase(selectorAdapter);
      const result = await useCase.execute({
        contextYaml,
        violationMessage,
      });

      if (!result.success || !result.patchedYaml) {
        return NextResponse.json(
          { success: false, error: result.error || "Targeted fix failed" },
          { status: 500 },
        );
      }
      patchedYaml = result.patchedYaml;
    }

    return NextResponse.json({ success: true, patchedYaml }, { status: 200 });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error in manifest fix route:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
