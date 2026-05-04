/* eslint-disable no-console */
/**
 * Standalone benchmark script for manifest generation validation.
 * Run manually: npx tsx scripts/benchmark-manifest-generation.ts
 *
 * Outputs newline-delimited JSON to benchmark-results.ndjson
 */

import * as fs from "fs";
import * as path from "path";
import { GenerateManifestFromDescriptionUseCase } from "../src/application/use-cases/generate-manifest-from-description.use-case.js";
import type { SendStructuredRequestPort } from "@hexagen/local-llm";
import type { LLMRequest } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

interface BenchmarkRun {
  runId: number;
  success: boolean;
  attempt: number;
  tokens: number;
  time: number;
  model: string;
  repairApplied: boolean;
  errorCategory?: string;
  warningCategories: string[];
}

function createMockLLMPipeline(): SendStructuredRequestPort {
  return {
    sendRequest: async (
      _request: LLMRequest, // eslint-disable-line @typescript-eslint/no-unused-vars
    ): Promise<
      Result<{
        content: string;
        modelId: string;
        usage?: { totalTokens: number };
      }>
    > => {
      const contexts = [
        {
          name: "order-management",
          type: "core",
          description: "Manages customer orders",
        },
        {
          name: "inventory",
          type: "supporting",
          description: "Tracks product inventory",
        },
      ];
      const content = JSON.stringify(contexts);
      return {
        success: true,
        value: {
          content,
          modelId: "qwen-coder-3b",
          usage: { totalTokens: 150 },
        },
      };
    },
    streamStructuredRequest: async function* () {
      yield { success: true, value: "" };
    },
  } as unknown as SendStructuredRequestPort;
}

async function benchmarkManifestGeneration(runs: number = 50): Promise<void> {
  const useCase = new GenerateManifestFromDescriptionUseCase(
    createMockLLMPipeline(),
  );
  const results: BenchmarkRun[] = [];
  const desc =
    "Build me a blog platform with user accounts and post management";

  for (let i = 0; i < runs; i++) {
    const startTime = Date.now();
    try {
      const response = await useCase.execute({
        description: {
          text: desc,
          platform: "Node.js",
          deployment: "Cloud-native",
        } as Record<string, string>,
      });

      results.push({
        runId: i + 1,
        success: response.success,
        attempt: response.diagnostics?.totalAttempts || 0,
        tokens: response.diagnostics?.tokensUsed || 0,
        time: Date.now() - startTime,
        model: response.diagnostics?.model || "unknown",
        repairApplied: response.diagnostics?.repairApplied || false,
        warningCategories:
          response.warnings?.map(
            (w) => `${w.context || "global"}:${w.category}`,
          ) ?? [],
      });
    } catch (e) {
      results.push({
        runId: i + 1,
        success: false,
        attempt: 0,
        tokens: 0,
        time: Date.now() - startTime,
        model: "unknown",
        repairApplied: false,
        errorCategory: e instanceof Error ? e.message : "unknown",
        warningCategories: [],
      });
    }

    if ((i + 1) % 10 === 0) {
      console.log(`Progress: ${i + 1}/${runs}`);
    }
  }

  const output = results.map((r) => JSON.stringify(r)).join("\n");
  const outputPath = path.resolve("benchmark-results.ndjson");
  fs.writeFileSync(outputPath, output);

  const successCount = results.filter((r) => r.success).length;
  const repairCount = results.filter((r) => r.repairApplied).length;
  const avgTime = results.reduce((sum, r) => sum + r.time, 0) / runs;
  const avgTokens = results.reduce((sum, r) => sum + r.tokens, 0) / runs;

  console.log(`\n=== Benchmark Results ===`);
  console.log(`Success Rate: ${((successCount / runs) * 100).toFixed(1)}%`);
  console.log(
    `Repair Applied: ${repairCount} runs (${((repairCount / runs) * 100).toFixed(1)}%)`,
  );
  console.log(`Avg Time: ${avgTime.toFixed(0)}ms`);
  console.log(`Avg Tokens: ${avgTokens.toFixed(0)}`);
  console.log(`\nDetailed results written to ${outputPath}`);
}

const runCount = parseInt(process.argv[2] || "50", 10);
benchmarkManifestGeneration(runCount).catch(console.error);
