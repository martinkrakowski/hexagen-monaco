// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextResponse } from "next/server";
import { getMonacoPersistence } from "@/lib/wire";
import { MonacoSession } from "@hexagen/monaco-orchestration";
import type { ProjectConfig } from "@hexagen/project-configuration";

// TODO: Wire real GenerateProjectUseCase after resolving Turbopack workspace resolution
// The @hexagen/project-generation package builds but Turbopack can't resolve its exports
// Possible fixes:
// 1. Configure package to emit .js files (currently emitDeclarationOnly)
// 2. Use Next.js transpilePackages
// 3. Switch to webpack (next.config.js)
export async function POST(request: Request) {
  try {
    const rawSpec = (await request.json()) as ProjectConfig;

    // Placeholder - replace with real use-case call
    const projectId = "generated-" + Date.now();

    // Save the spec as session content (for persistence round-trip demo)
    const persistence = getMonacoPersistence();
    const session = new MonacoSession(
      projectId,
      JSON.stringify(rawSpec, null, 2),
      "json",
    );
    await persistence.saveSession(session);

    return NextResponse.json({
      success: true,
      message: "Project generation stub completed",
      projectId,
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
