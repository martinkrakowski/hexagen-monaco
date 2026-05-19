import type { PipelineStep, PipelineStepStatus } from "@hexagen/ai-pipeline";
import type { NLToDomainCommandParserPort } from "@hexagen/ai-pipeline";
import type {
  PromptCompilerPort,
  ArchitectureGraphLike,
  LinterReportLike,
} from "@hexagen/prompt-compiler";
import type { SendStructuredRequestPort } from "@hexagen/local-llm/client";
import type {
  ReconcileUseCase,
  ProjectSpecLike,
} from "@hexagen/reconciliation-engine";
import type { TransactionManagerPort } from "@hexagen/transaction-system";
import { MAX_RETRY_ATTEMPTS } from "../../domain/errors/stage-errors";

const STEP_PARSE = "parse-nl-intent";
const STEP_COMPILE_PROMPT = "compile-prompt";
const STEP_LLM_INFERENCE = "llm-inference";
const STEP_RECONCILE = "reconcile";
const STEP_COMMIT = "commit-patches";

const RETRYABLE_STATUS_CODES = new Set([429, 503]);
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

interface RetryOptions {
  maxAttempts?: number;
  delaysMs?: number[];
  signal?: AbortSignal;
}

class LLMServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "LLMServiceError";
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS;
  const delaysMs = options.delaysMs ?? RETRY_DELAYS_MS;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;

      if (options.signal?.aborted) {
        throw lastError;
      }

      const isRetryable =
        lastError instanceof LLMServiceError &&
        RETRYABLE_STATUS_CODES.has(lastError.statusCode);

      if (!isRetryable || attempt >= maxAttempts) {
        throw lastError;
      }

      const delay = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1];
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

interface ModifyArchitectureDeps {
  readonly nlParser: NLToDomainCommandParserPort;
  readonly promptCompiler: PromptCompilerPort;
  readonly llmSender: SendStructuredRequestPort;
  readonly reconcileUseCase: ReconcileUseCase;
  readonly transactionManager: TransactionManagerPort;
  readonly manifestProvider: () => Promise<ProjectSpecLike>;
  readonly architectureGraphProvider: () => Promise<ArchitectureGraphLike>;
  readonly linterReportProvider: () => Promise<LinterReportLike>;
  readonly signal?: AbortSignal;
  readonly onStepRunning?: (stepName: string) => void;
  readonly onStepComplete?: (
    stepName: string,
    status: PipelineStepStatus,
    durationMs: number | null,
  ) => void;
}

export {
  STEP_PARSE,
  STEP_COMPILE_PROMPT,
  STEP_LLM_INFERENCE,
  STEP_RECONCILE,
  STEP_COMMIT,
  RETRYABLE_STATUS_CODES,
  RETRY_DELAYS_MS,
  withRetry,
  LLMServiceError,
};
export type { RetryOptions, ModifyArchitectureDeps };
