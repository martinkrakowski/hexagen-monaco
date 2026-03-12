// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextResponse } from "next/server";
import { getMonacoPersistence } from "@/lib/wire";
import { MonacoSession } from "@hexagen/monaco-orchestration";
import type { ProjectConfig } from "@hexagen/project-configuration";

// TODO: wire real GenerateProjectUseCase here (use-case from project-generation)
// The project-generation package is built but Turbopack has issues resolving workspace modules
export async function POST(request: Request) {
  try {
    const rawSpec = (await request.json()) as ProjectConfig;

    // Placeholder - replace with real use-case call
    // console.info('Generating project from spec:', rawSpec);

    // Generate project ID (or use real generator later)
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
    // console.error('Generate route error:', err);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
