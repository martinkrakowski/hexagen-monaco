import { NextRequest, NextResponse } from "next/server";
import { InitiateExportUseCase } from "@hexagen/project-generation";
import { getGenerateProject } from "@/lib/wire.project-generation";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import type { Manifest } from "@hexagen/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ZipExportRequest {
  projectId: string;
  manifest?: Manifest;
  wizardData?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ZipExportRequest;

    const manifest =
      body.manifest ??
      (body.wizardData
        ? wizardToManifest(
            body.wizardData as unknown as Parameters<
              typeof wizardToManifest
            >[0],
          )
        : null);

    if (!manifest) {
      return NextResponse.json(
        { error: "Missing manifest or wizardData in request body" },
        { status: 400 },
      );
    }

    const useCase = new InitiateExportUseCase(getGenerateProject);
    const result = await useCase.initiateExport({
      target: "zip",
      workspaceRef: {
        projectId: body.projectId,
        manifest,
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    if ("zip" in result.value) {
      return new NextResponse(new Uint8Array(result.value.zip), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${result.value.filename}"`,
        },
      });
    }

    return NextResponse.json(
      { error: "Unexpected export result shape" },
      { status: 500 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
