// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextResponse } from "next/server";
import { getMonacoPersistence, getLogger } from "@/lib/wire";
import { MonacoSession } from "@hexagen/monaco-orchestration";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { getGenerateProject } from "@/lib/wire.project-generation";
import type { Manifest } from "@hexagen/sync";
import path from "node:path";
import os from "node:os";

interface GenerateRequestBody {
  config: ProjectConfig;
  manifest?: Manifest;
  outputFormat?: "files" | "zip";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const { config, manifest, outputFormat = "zip" } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, message: "Missing project config" },
        { status: 400 },
      );
    }

    const projectId = `generated-${Date.now()}`;
    const tempDir = path.join(os.tmpdir(), projectId);

    const useCase = getGenerateProject();
    const result = await useCase.execute({
      targetRoot: tempDir,
      manifest: manifest ?? {
        system: config.boundedContexts?.[0]?.name ?? "project",
        boundedContexts: config.boundedContexts ?? [],
      },
      outputFormat,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.error.message },
        { status: 500 },
      );
    }

    const { project, zipBuffer } = result.value;

    // Save session metadata for persistence
    const persistence = getMonacoPersistence();
    const session = new MonacoSession(
      projectId,
      JSON.stringify(config, null, 2),
      "json",
    );
    await persistence.saveSession(session);

    // Return ZIP buffer as binary response if requested
    if (zipBuffer) {
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${project.name}-${Date.now()}.zip"`,
        },
      });
    }

    // Otherwise return JSON metadata
    return NextResponse.json({
      success: true,
      message: "Project generated successfully",
      projectId,
      projectName: project.name,
      fileCount: project.files.size,
      hasZip: !!zipBuffer,
    });
  } catch (err) {
    const logger = getLogger();
    logger.errorWithException(err, "[api/generate] Failed to generate project");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
