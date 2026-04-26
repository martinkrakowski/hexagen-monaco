import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { InitiateExportUseCase } from "@hexagen/project-generation";
import { getGenerateProject } from "@/lib/wire.project-generation";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import type { Manifest } from "@hexagen/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GitHubExportRequest {
  projectId: string;
  repoName: string;
  isPrivate: boolean;
  owner?: string;
  manifest?: Manifest;
  wizardData?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GitHubExportRequest;

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = token?.accessToken ?? null;
    const tokenOwner = token?.login ?? "";
    const owner = body.owner ?? tokenOwner;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Unauthorized: GitHub session token not found" },
        { status: 401 },
      );
    }

    if (!owner) {
      return NextResponse.json(
        { error: "Missing GitHub repository owner" },
        { status: 400 },
      );
    }

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
      target: "github",
      workspaceRef: {
        projectId: body.projectId,
        manifest,
      },
      repoConfig: {
        token: accessToken,
        owner,
        repoName: body.repoName,
        isPrivate: body.isPrivate,
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    if ("destinationUrl" in result.value) {
      return NextResponse.json({
        success: true,
        destinationUrl: result.value.destinationUrl,
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
