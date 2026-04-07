// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextRequest, NextResponse } from "next/server";
import { getLogger } from "@/lib/wire";
import { getGenerateProject } from "@/lib/wire.project-generation";
import { wizardToManifest } from "@/lib/wizard-to-manifest";
import type { ExportConfig } from "@hexagen/project-generation";
import { getToken } from "next-auth/jwt";

interface GenerateRequestBody {
  wizardData?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  destination?: "archive" | "github";
  githubConfig?: {
    repoName: string;
    isPrivate: boolean;
    owner?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const {
      wizardData,
      manifest,
      destination = "archive",
      githubConfig,
    } = body;

    const finalManifest =
      manifest ||
      (wizardData
        ? wizardToManifest(wizardData)
        : {
            system: "project",
            bounded_contexts: [],
          });

    const exportConfig: ExportConfig = {
      destination,
    };

    if (destination === "github") {
      if (!githubConfig) {
        return NextResponse.json(
          { error: "Missing GitHub configuration" },
          { status: 400 },
        );
      }

      const token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET,
      });

      const accessToken =
        typeof token?.accessToken === "string" ? token.accessToken : null;
      const owner =
        githubConfig.owner ??
        (typeof token?.name === "string" ? token.name : "");

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

      exportConfig.github = {
        token: accessToken,
        owner,
        repoName: githubConfig.repoName,
        isPrivate: githubConfig.isPrivate,
      };
    }

    const useCase = getGenerateProject(destination);
    const result = await useCase.execute({
      manifest: finalManifest,
      exportConfig,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    const { project, destinationUrl, zipBuffer } = result.value;

    // Archive mode — return binary response
    if (destination === "archive" && zipBuffer) {
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${project.name}-${Date.now()}.zip"`,
        },
      });
    }

    // GitHub mode — return the repo URL
    if (destination === "github") {
      return NextResponse.json({
        success: true,
        message: "Project pushed to GitHub",
        repositoryUrl: destinationUrl,
        projectName: project.name,
        fileCount: project.files.size,
      });
    }

    // Fallback
    return NextResponse.json({
      success: true,
      message: "Project generated successfully",
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
