import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";
import { GenerateSuggestionUseCase } from "@hexagen/agentic-interaction";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";
import { logger } from "../../../../lib/structured-logger";
import { resolveWebLlmApiKey } from "@/lib/wire.shared";
import { guardMutation } from "@/lib/request-guards";
import {
  analyzeManifest,
  type PortAdapterStatus,
} from "@/lib/governance/manifest-analysis";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Shared types (match existing endpoint response shapes)
// ---------------------------------------------------------------------------

interface Violation {
  id: string;
  type: "error" | "warning" | "info";
  message: string;
  context?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

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

interface RefreshRequestBody {
  manifestYaml: string;
  openFileContent?: string;
}

// ---------------------------------------------------------------------------
// Violations — write manifest to tmpdir, run arch-linter with --manifest
// ---------------------------------------------------------------------------

async function runViolations(manifestYaml: string): Promise<Violation[]> {
  const tmpPath = path.join(
    os.tmpdir(),
    `hexagen-governance-${Date.now()}.yaml`,
  );

  try {
    await writeFile(tmpPath, manifestYaml, "utf-8");

    try {
      await execAsync(`yarn lint:arch --manifest ${tmpPath}`, {
        cwd: process.cwd(),
        timeout: 30000, // 30s timeout to prevent hanging
      });
      return [];
    } catch (error) {
      const err = error as Error & { stderr?: string | Buffer };
      const message = err.stderr ? String(err.stderr) : err.message;
      const errors = message
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return errors.map((msg, idx) => ({
        id: String(idx + 1),
        type: "error" as const,
        message: msg,
        severity: "HIGH" as const,
      }));
    }
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// Suggestions — call GenerateSuggestionUseCase with manifest + open file
// ---------------------------------------------------------------------------

async function runSuggestions(
  manifestYaml: string,
  openFileContent?: string,
): Promise<AISuggestion[]> {
  // WEB_LLM_API_KEY ?? LLM_API_KEY — survives the mercury prod flip
  // (which unsets LLM_API_KEY); see resolveWebLlmApiKey.
  const apiKey = resolveWebLlmApiKey();
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return [];
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
        "You are an architectural assistant. Analyze the manifest and provide suggestions for improving the hexagonal architecture.",
    }),
  });

  let prompt = `Analyze this architecture manifest and suggest improvements:\n\n${manifestYaml}`;
  if (openFileContent) {
    prompt += `\n\n--- Currently open file ---\n${openFileContent}`;
  }

  const result = await useCase.execute({
    prompt,
    context: { projectManifest: manifestYaml },
    maxSuggestions: 5,
  });

  if (!result.success) {
    return [];
  }

  return result.value.map((s) => ({
    id: s.id,
    message: s.message,
    confidence: s.confidence,
    category: s.category,
  }));
}

// ---------------------------------------------------------------------------
// Status — derive port/adapter status from the manifest via the shared
// analyzer, so `refresh` and `governance/status` agree on the same manifest
// (AUD-005). The prior filesystem scan (counting `.ts` files on disk) diverged
// from the manifest-based `status` route; the two now share one implementation.
// ---------------------------------------------------------------------------

function runStatus(manifestYaml: string): PortAdapterStatus[] {
  const analysis = analyzeManifest(manifestYaml);
  return analysis.ok ? analysis.status : [];
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Same-origin + rate-limit gate (D1): this endpoint spawns `yarn lint:arch`
  // (a subprocess) and calls the LLM, so reject cross-origin callers and
  // throttle bursts before doing any of that work.
  const gate = guardMutation(request);
  if (gate) return gate;

  try {
    const body = (await request.json()) as RefreshRequestBody;

    if (!body.manifestYaml) {
      return NextResponse.json(
        { error: "manifestYaml is required" },
        { status: 400 },
      );
    }

    // Violations (shell-lint) and suggestions (LLM) are async; status is a
    // synchronous manifest analysis. Run the async pair concurrently.
    const [violations, suggestions] = await Promise.all([
      runViolations(body.manifestYaml),
      runSuggestions(body.manifestYaml, body.openFileContent),
    ]);
    const portAdapterStatus = runStatus(body.manifestYaml);

    return NextResponse.json({
      violations,
      suggestions,
      portAdapterStatus,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Governance refresh failed";
    logger.error("[governance/refresh] Failed:", { error: message });
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
