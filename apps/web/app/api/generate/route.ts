// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextResponse } from "next/server";
import { getLogger } from "@/lib/wire";
import { getGenerateProject } from "@/lib/wire.project-generation";
import { wizardToManifest } from "@/lib/wizard-to-manifest";
import type { ExportConfig } from "@hexagen/project-generation";

interface GenerateRequestBody {
  wizardData?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  destination?: "archive" | "github";
  githubConfig?: {
    repoName: string;
    isPrivate: boolean;
  };
}

export async function POST(request: Request) {
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

    if (destination === "github" && githubConfig) {
      // TODO: Inject from session when NextAuth is configured
      // const session = await getServerSession(authOptions);
      // const token = session?.accessToken;
      // const owner = session?.user?.name;
      exportConfig.github = {
        token: process.env.GITHUB_TOKEN ?? "",
        owner: process.env.GITHUB_OWNER ?? "",
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
