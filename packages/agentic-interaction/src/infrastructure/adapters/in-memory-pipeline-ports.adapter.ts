import type { Result } from "@hexagen/shared";
import type { DomainCommand } from "@hexagen/core-domain";
import type {
  NLToDomainCommandParserPort,
  NLParsingError,
} from "@hexagen/ai-pipeline";
import type {
  PromptCompilerPort,
  PromptCompileRequest,
  PromptTemplate,
  RenderedPrompt,
} from "@hexagen/prompt-compiler";
import type {
  SendStructuredRequestPort,
  LLMRequest,
  LLMResponse,
  DomainModelId,
} from "@hexagen/local-llm";
import { createLLMResponse } from "@hexagen/local-llm";
import type {
  ReconciliationPort,
  ReconcileRequest,
  ReconciliationResult,
} from "@hexagen/reconciliation-engine";
import { createReconciliationResult } from "@hexagen/reconciliation-engine";
import type {
  ManifestMutationPort,
  LintValidationPort,
} from "@hexagen/transaction-system";

export class InMemoryNLParserAdapter implements NLToDomainCommandParserPort {
  constructor(private readonly handler?: (intent: string) => DomainCommand[]) {}

  async parse(
    intent: string,
  ): Promise<Result<DomainCommand[], NLParsingError>> {
    if (this.handler) {
      const commands = this.handler(intent);
      return { success: true, value: commands };
    }
    return {
      success: false,
      error: {
        code: "UNSUPPORTED_INTENT",
        message: `No handler for intent: ${intent}`,
        originalText: intent,
      },
    };
  }
}

export class InMemoryPromptCompilerAdapter implements PromptCompilerPort {
  async compile(request: PromptCompileRequest): Promise<PromptTemplate> {
    return {
      id: `prompt-${Date.now()}`,
      name: request.name,
      systemPrompt: "You are an architecture modification assistant.",
      userPromptTemplate: "{{intent}}",
      variables: [{ name: "intent", description: "User intent" }],
      context: {
        manifest: request.manifest,
        architectureGraph: request.architectureGraph,
        linterReport: request.linterReport,
        userIntent: request.userIntent,
        lineage: [],
      },
      version: 1,
    };
  }

  render(
    template: PromptTemplate,
    overrides: Record<string, string> = {},
  ): RenderedPrompt {
    let userPrompt = template.userPromptTemplate;
    for (const [key, value] of Object.entries(overrides)) {
      userPrompt = userPrompt.replace(new RegExp(`{{${key}}}`, "g"), value);
    }
    return {
      systemPrompt: template.systemPrompt,
      userPrompt,
      variables: overrides,
    };
  }
}

export class InMemoryLLMSenderAdapter implements SendStructuredRequestPort {
  constructor(
    private readonly responseContent: string = JSON.stringify({
      manifest: { boundedContexts: [] },
      architectureGraph: { nodes: [], edges: [] },
      reasoning: "In-memory mock response",
    }),
  ) {}

  async sendRequest(_request: LLMRequest): Promise<Result<LLMResponse>> {
    const response = createLLMResponse(
      "qwen-coder-3b" as unknown as DomainModelId,
      this.responseContent,
      "stop",
    );
    return { success: true, value: response };
  }

  async *streamStructuredRequest(
    _request: LLMRequest,
  ): AsyncGenerator<Result<string>> {
    yield { success: true, value: this.responseContent };
  }
}

export class InMemoryReconciliationAdapter implements ReconciliationPort {
  async reconcile(request: ReconcileRequest): Promise<ReconciliationResult> {
    return createReconciliationResult(
      true,
      [],
      [],
      "In-memory reconciliation: no differences detected",
    );
  }
}

export class InMemoryManifestMutationAdapter implements ManifestMutationPort {
  async applyPatches(
    _patches: unknown[],
    _manifestPath: string,
  ): Promise<Result<void, Error>> {
    return { success: true, value: undefined };
  }

  async restoreFromGit(_manifestPath: string): Promise<Result<void, Error>> {
    return { success: true, value: undefined };
  }
}

export class InMemoryLintValidationAdapter implements LintValidationPort {
  constructor(private readonly alwaysValid = true) {}

  async validateManifest(
    _manifestPath: string,
  ): Promise<Result<{ valid: boolean; errors: string[] }, Error>> {
    return {
      success: true,
      value: { valid: this.alwaysValid, errors: [] as string[] },
    };
  }
}
