// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextResponse } from "next/server";
import { getLogger } from "@/lib/wire";
import { getGenerateProject } from "@/lib/wire.project-generation";
import { wizardToManifest } from "@/lib/wizard-to-manifest";
import path from "node:path";
import os from "node:os";

interface GenerateRequestBody {
  wizardData?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  outputFormat?: "files" | "zip" | "json";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const { wizardData, manifest, outputFormat = "zip" } = body;

    const finalManifest =
      manifest ||
      (wizardData
        ? wizardToManifest(wizardData)
        : {
            system: "project",
            bounded_contexts: [],
          });

    const projectId = `generated-${Date.now()}`;
    const tempDir = path.join(os.tmpdir(), projectId);

    const useCase = getGenerateProject();
    const result = await useCase.execute({
      targetRoot: tempDir,
      manifest: finalManifest,
      outputFormat: outputFormat === "json" ? "files" : "zip",
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    const { project, zipBuffer } = result.value;

    // JSON mode for the Code View — return file map as plain object
    if (outputFormat === "json") {
      const filesObject = Object.fromEntries(project.files);
      return NextResponse.json({ files: filesObject });
    }

    // ZIP mode — return binary response
    if (zipBuffer) {
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${project.name}-${Date.now()}.zip"`,
        },
      });
    }

    // Metadata fallback
    return NextResponse.json({
      success: true,
      message: "Project generated successfully",
      projectId,
      projectName: project.name,
      fileCount: project.files.size,
    });
  } catch (err) {
    const logger = getLogger();
    logger.errorWithException(err, "[api/generate] Failed to generate project");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
