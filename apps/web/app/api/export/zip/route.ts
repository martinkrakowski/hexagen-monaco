import { NextRequest, NextResponse } from "next/server";
import { InitiateExportUseCase } from "@hexagen/project-generation";
import { getGenerateProject } from "@/lib/wire.server";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import { readAddOnAnswers } from "@/lib/add-on-answers";
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

    const addOnsAnswers = readAddOnAnswers(body.wizardData);
    if (addOnsAnswers === null) {
      return NextResponse.json(
        { error: "Invalid addOnsAnswers payload" },
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
      addOnsAnswers,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    if ("zip" in result.value) {
      const headers: Record<string, string> = {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${result.value.filename}"`,
      };
      // The binary body can't carry a notices payload, so surface the COUNTS as
      // sideband headers — the full detail lives in the project's
      // HEXAGEN-ADDON-NOTICES.md (PR 3a sidecar). The client uses these to flip
      // the success strip to amber and point at that file.
      if (result.value.warnings?.length) {
        headers["X-Hexagen-Addon-Warnings"] = String(
          result.value.warnings.length,
        );
      }
      if (result.value.errors?.length) {
        headers["X-Hexagen-Addon-Errors"] = String(result.value.errors.length);
      }
      return new NextResponse(new Uint8Array(result.value.zip), {
        status: 200,
        headers,
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
