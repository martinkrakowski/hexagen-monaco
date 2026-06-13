/* eslint-disable no-console */
/**
 * Golden-manifest harness.
 *
 * Runs the golden prompts (scripts/golden-prompts.json) through the full 0→6
 * staged-generation pipeline (ExecuteFullStagedGenerationUseCase — the only
 * pipeline since A4 deleted the 4-pass stub) against the real cloud provider
 * chain, judges every successful result with the Stage-6 validation review,
 * and evaluates the absolute quality gates G1–G4 (see golden-harness-lib.ts).
 *
 * Run manually (needs OPENAI_API_KEY, ANTHROPIC_API_KEY, LLM_API_KEY, or
 * INCEPTION_API_KEY):
 *   yarn workspace @hexagen/agentic-interaction golden-harness
 *   npx tsx scripts/golden-manifest-harness.ts [--repeat=N] [--only=id]
 *
 * Writes NDJSON run records and a markdown report to
 * golden-harness-results/ (gitignored). Exits 1 if any gate fails.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { ExecuteFullStagedGenerationUseCase } from "../src/application/use-cases/staged-generation/execute-full-staged-generation.use-case";
import type { Stage1RefinementConfig } from "../src/application/use-cases/staged-generation/execute-domain-extraction.use-case";
import { ExecuteValidationReviewUseCase } from "../src/application/use-cases/staged-generation/execute-validation-review.use-case";
import { LLMProviderSelectorAdapter } from "../src/infrastructure/adapters/llm-provider-selector.adapter";
import { EnvironmentSecretVaultAdapter } from "../src/infrastructure/adapters/environment-secret-vault.adapter";
import type { PromptVariables } from "../src/domain/prompts/generate-manifest.prompt";
import type { PipelineState } from "../src/domain/value-objects/pipeline-state";
import {
  computeStateMetrics,
  judgeFromReport,
  summarize,
  evaluateGates,
  renderMarkdown,
  type GoldenPrompt,
  type RunRecord,
} from "./golden-harness-lib";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = path.join(SCRIPT_DIR, "golden-prompts.json");
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, "..", "golden-harness-results");

interface CliOptions {
  repeat: number;
  only?: string;
}

function parseCli(argv: string[]): CliOptions {
  const options: CliOptions = { repeat: 1 };
  for (const arg of argv) {
    if (arg.startsWith("--repeat=")) {
      // Number(), not parseInt(): "2.5" and "3abc" must be rejected, not
      // silently truncated to 2 / 3.
      const n = Number(arg.slice("--repeat=".length));
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(
          `Invalid --repeat value: ${arg} (expected a positive integer)`,
        );
      }
      options.repeat = n;
    } else if (arg.startsWith("--only=")) {
      options.only = arg.slice("--only=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Same provider chain as the stage route — keep in sync with
 * `createLLMProviderSelector` in apps/web/app/lib/wire.server.ts so the
 * harness measures the pipelines exactly as production serves them. */
function createLLMAdapter(): LLMProviderSelectorAdapter {
  return new LLMProviderSelectorAdapter({
    webLlmAdapter: null,
    preferLocal: false,
    validateLocalLLM: false,
    fallbackChain: {
      primary: {
        providerId: "openai" as const,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o",
        apiKeyEnvVar: "OPENAI_API_KEY",
        temperature: 0.3,
        maxTokens: 4000,
      },
      fallbacks: [
        {
          providerId: "anthropic" as const,
          baseUrl: "https://api.anthropic.com/v1",
          model: "claude-3-5-sonnet-20241022",
          apiKeyEnvVar: "ANTHROPIC_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
        {
          providerId: "openai" as const,
          baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
          model: process.env.LLM_MODEL || "gpt-4o-mini",
          apiKeyEnvVar: "LLM_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
        {
          providerId: "inception" as const,
          baseUrl: "https://api.inceptionlabs.ai/v1",
          model: process.env.INCEPTION_MODEL || "mercury-2",
          apiKeyEnvVar: "INCEPTION_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
      ],
    },
    secretVault: new EnvironmentSecretVaultAdapter(),
  });
}

/** Stage-1 draft→refine cascade, same env contract as the stage route
 * (createStage1RefinerConfig in wire.server.ts): active only when
 * STAGE1_REFINER_API_KEY is set, so harness runs can measure the cascade
 * with the exact wiring prod would use. */
function createStage1Refinement(): Stage1RefinementConfig | null {
  if (!process.env.STAGE1_REFINER_API_KEY) return null;
  const mode =
    process.env.STAGE1_REFINER_MODE === "escalation" ? "escalation" : "always";
  const model = process.env.STAGE1_REFINER_MODEL || "openai/gpt-4o";
  console.log(`Stage-1 refiner: ${model} (mode: ${mode})\n`);
  return {
    mode,
    port: new LLMProviderSelectorAdapter({
      webLlmAdapter: null,
      preferLocal: false,
      validateLocalLLM: false,
      fallbackChain: {
        primary: {
          providerId: "openai" as const,
          baseUrl:
            process.env.STAGE1_REFINER_BASE_URL ||
            "https://openrouter.ai/api/v1",
          model,
          apiKeyEnvVar: "STAGE1_REFINER_API_KEY",
          temperature: 0.3,
          maxTokens: 4000,
        },
        fallbacks: [],
      },
      secretVault: new EnvironmentSecretVaultAdapter(),
    }),
  };
}

function assertApiKeyPresent(): void {
  const vault = new EnvironmentSecretVaultAdapter();
  const keys = [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "LLM_API_KEY",
    "INCEPTION_API_KEY",
  ];
  if (!keys.some((key) => vault.getSecret(key) !== null)) {
    console.error(`No LLM API key configured. Set one of: ${keys.join(", ")}.`);
    process.exit(1);
  }
}

async function runOne(
  llm: LLMProviderSelectorAdapter,
  judge: ExecuteValidationReviewUseCase,
  prompt: GoldenPrompt,
  stage1Refinement: Stage1RefinementConfig | null,
): Promise<RunRecord> {
  const variables: PromptVariables = {
    userDescription: prompt.description,
    platform: prompt.platform,
    deployment: prompt.deployment,
    additionalContext: prompt.additionalContext,
  };
  // Fresh transaction manager per run — same lifecycle as the stage route,
  // and it keeps run timings independent.
  const transactionManager = new InMemoryTransactionManager();

  const start = Date.now();
  let success = false;
  let state: PipelineState | undefined;
  let error: string | undefined;

  try {
    const useCase = new ExecuteFullStagedGenerationUseCase(
      llm,
      transactionManager,
      stage1Refinement ? { stage1Refinement } : undefined,
    );
    const result = await useCase.execute(prompt.description, variables);
    success = result.success;
    if (result.success) state = result.state;
    else
      error =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  const durationMs = Date.now() - start;

  const record: RunRecord = {
    promptId: prompt.id,
    success,
    durationMs,
    ...(error !== undefined ? { error } : {}),
  };

  if (success && state) {
    record.metrics = computeStateMetrics(state);
    // The Stage-6 review judges the final state. Judging time is deliberately
    // NOT part of durationMs — it is measurement apparatus, not pipeline cost.
    const verdict = await judge.execute(state);
    if (verdict.success) {
      record.judge = judgeFromReport(verdict.value);
    } else {
      console.warn(
        `  judge failed for ${prompt.id}: ${verdict.error instanceof Error ? verdict.error.message : String(verdict.error)}`,
      );
    }
  }

  return record;
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  assertApiKeyPresent();

  const prompts: GoldenPrompt[] = JSON.parse(
    fs.readFileSync(PROMPTS_PATH, "utf8"),
  );
  const selected = options.only
    ? prompts.filter((p) => p.id === options.only)
    : prompts;
  if (selected.length === 0) {
    console.error(
      `No prompts selected${options.only ? ` (unknown --only=${options.only})` : ""}.`,
    );
    process.exit(1);
  }

  const llm = createLLMAdapter();
  const judge = new ExecuteValidationReviewUseCase(llm);
  const stage1Refinement = createStage1Refinement();
  const totalRuns = selected.length * options.repeat;
  console.log(
    `Golden harness: ${selected.length} prompt(s) × ${options.repeat} repeat(s) = ${totalRuns} run(s)\n`,
  );

  // Sequential on purpose: keeps provider rate limits calm and timings clean.
  const runs: RunRecord[] = [];
  let runNumber = 0;
  for (const prompt of selected) {
    for (let i = 0; i < options.repeat; i++) {
      runNumber++;
      process.stdout.write(`[${runNumber}/${totalRuns}] ${prompt.id} … `);
      const record = await runOne(llm, judge, prompt, stage1Refinement);
      runs.push(record);
      console.log(
        record.success
          ? `ok ${record.durationMs}ms (${record.metrics?.contextCount ?? 0} ctx, judge ${record.judge ? (record.judge.passed ? "pass" : "fail") : "n/a"})`
          : `ERROR ${record.durationMs}ms — ${record.error}`,
      );
    }
  }

  const summaryData = summarize(runs);
  const gates = evaluateGates(summaryData);
  // One clock read: the report's "Generated:" line and the output file
  // stamps name the same instant (renderMarkdown itself is pure).
  const generatedAt = new Date().toISOString();
  const report = renderMarkdown(summaryData, gates, runs, generatedAt);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const ndjsonPath = path.join(OUTPUT_DIR, `run-${stamp}.ndjson`);
  const reportPath = path.join(OUTPUT_DIR, `report-${stamp}.md`);
  fs.writeFileSync(
    ndjsonPath,
    runs.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  fs.writeFileSync(reportPath, report);

  console.log(`\n=== Quality gates (full pipeline) ===`);
  for (const gate of gates) {
    console.log(
      `${gate.passed ? "✅" : "❌"} ${gate.id} ${gate.description} — ${gate.detail}`,
    );
  }
  console.log(`\nRun records: ${ndjsonPath}`);
  console.log(`Report:      ${reportPath}`);

  if (gates.some((gate) => !gate.passed)) {
    console.error(`\nGate failure ⇒ investigate before the next release.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
