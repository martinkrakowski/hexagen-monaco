import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readdir } from "fs/promises";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";
import * as yaml from "js-yaml";
import { GenerateSuggestionUseCase } from "@hexagen/agentic-interaction";
import { ServerLLMAdapter } from "@hexagen/agentic-interaction";

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

interface PortAdapterStatus {
  context: string;
  ports: number;
  adapters: number;
  complete: boolean;
}

interface RefreshRequestBody {
  manifestYaml: string;
  openFileContent?: string;
}

// ---------------------------------------------------------------------------
// Violations — write manifest to tmpdir, run arch-linter with --manifest
// ---------------------------------------------------------------------------

function runViolations(manifestYaml: string): Violation[] {
  const tmpPath = path.join(
    os.tmpdir(),
    `hexagen-governance-${Date.now()}.yaml`,
  );

  try {
    writeFileSync(tmpPath, manifestYaml, "utf-8");

    try {
      execSync(`yarn lint:arch --manifest ${tmpPath}`, {
        cwd: process.cwd(),
        stdio: "pipe",
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
      unlinkSync(tmpPath);
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
  const apiKey = process.env.NEXT_PUBLIC_LLM_API_KEY || "";
  const baseUrl =
    process.env.NEXT_PUBLIC_LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

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
// Status — parse manifest YAML, scan packages/ for adapters
// ---------------------------------------------------------------------------

interface ManifestBoundedContext {
  name: string;
  layers?: {
    application?: {
      ports?: {
        in?: unknown[];
        out?: unknown[];
      };
    };
  };
}

async function runStatus(manifestYaml: string): Promise<PortAdapterStatus[]> {
  let boundedContexts: ManifestBoundedContext[] = [];

  try {
    const parsed = yaml.load(manifestYaml) as {
      bounded_contexts?: ManifestBoundedContext[];
    };
    boundedContexts = parsed?.bounded_contexts || [];
  } catch {
    return [];
  }

  const packagesDir = path.join(process.cwd(), "packages");
  let packageNames: string[] = [];

  try {
    packageNames = await readdir(packagesDir);
  } catch {
    return [];
  }

  const status: PortAdapterStatus[] = [];

  for (const ctx of boundedContexts) {
    const ports = ctx.layers?.application?.ports
      ? (ctx.layers.application.ports.in?.length || 0) +
        (ctx.layers.application.ports.out?.length || 0)
      : 0;

    const shortName = ctx.name.replace("@hexagen/", "");
    const hasPackage = packageNames.includes(shortName);
    let adapterCount = 0;

    if (hasPackage) {
      const adapterPath = path.join(
        packagesDir,
        shortName,
        "src",
        "infrastructure",
        "adapters",
      );
      try {
        const files = await readdir(adapterPath);
        adapterCount = files.filter(
          (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
        ).length;
      } catch {
        adapterCount = 0;
      }
    }

    status.push({
      context: ctx.name,
      ports,
      adapters: adapterCount,
      complete: ports > 0 && adapterCount >= Math.ceil(ports / 2),
    });
  }

  return status;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshRequestBody;

    if (!body.manifestYaml) {
      return NextResponse.json(
        { error: "manifestYaml is required" },
        { status: 400 },
      );
    }

    // Run all three analyses. Violations is sync (execSync), the others async.
    const violations = runViolations(body.manifestYaml);
    const [suggestions, portAdapterStatus] = await Promise.all([
      runSuggestions(body.manifestYaml, body.openFileContent),
      runStatus(body.manifestYaml),
    ]);

    return NextResponse.json({
      violations,
      suggestions,
      portAdapterStatus,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Governance refresh failed",
      },
      { status: 500 },
    );
  }
}
