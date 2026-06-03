// apps/web/app/api/generate/route.ts
// Endpoint to generate a new project from spec

import { NextRequest, NextResponse } from "next/server";
import { createWebLogger } from "@/lib/wire.shared";
import { getGenerateProject } from "@/lib/wire.server";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import type { ExportConfig, AddOnAnswers } from "@hexagen/project-generation";
import { getToken } from "next-auth/jwt";

interface GenerateRequestBody {
  wizardData?: Record<string, unknown>;
  manifest?: Record<string, unknown>;
  destination?: "archive" | "github";
  outputFormat?: "json" | "zip";
  githubConfig?: {
    repoName: string;
    isPrivate: boolean;
    owner?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateRequestBody;
    const { wizardData, manifest, outputFormat = "json", githubConfig } = body;

    // Use outputFormat to determine what to return
    // outputFormat: "json" returns file map, "zip" returns binary
    const destination = body.destination ?? "archive";

    const finalManifest =
      manifest ||
      (wizardData
        ? wizardToManifest(
            wizardData as unknown as Parameters<typeof wizardToManifest>[0],
          )
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

      // token.accessToken and token.login are typed via next-auth.d.ts augmentation.
      const accessToken = token?.accessToken ?? null;
      const owner = githubConfig.owner ?? token?.login ?? "";

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

    // The wizard gathers per-template answers under `addOnsAnswers`; feed them
    // through so the selected add-on templates are merged into the project.
    const addOnsAnswers = (wizardData?.addOnsAnswers ?? {}) as AddOnAnswers;

    const useCase = getGenerateProject(destination);
    const result = await useCase.execute({
      manifest: finalManifest,
      exportConfig,
      addOnsAnswers,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error.message },
        { status: 500 },
      );
    }

    const { project, zipBuffer, warnings, errors } = result.value;

    // Telemetry: record add-on materialization issues once per run (deduped).
    // A bad add-on selection surfaces as `errors` here, not as a failed result —
    // the core project still generated, so the response stays 200 with the
    // issues attached (UI surfacing is deferred to a later PR).
    if (warnings?.length || errors?.length) {
      const dedupe = (xs: string[]) => [...new Set(xs)];
      createWebLogger().warn(
        `[api/generate] add-on materialization — warnings: ${JSON.stringify(
          dedupe(warnings ?? []),
        )}; errors: ${JSON.stringify(dedupe(errors ?? []))}`,
      );
    }

    // ZIP output format — return binary response
    if (outputFormat === "zip" && zipBuffer) {
      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${project.name}-${Date.now()}.zip"`,
        },
      });
    }

    // Default: JSON output — return file map
    const filesObj: Record<string, string> = {};
    project.files.forEach((content, path) => {
      filesObj[path] = content;
    });

    const responseBody: Record<string, unknown> = {
      success: true,
      message: "Project generated successfully",
      projectName: project.name,
      fileCount: project.files.size,
      files: filesObj,
    };
    // Only attach when present, so a no-add-on generation is byte-identical to before.
    if (warnings?.length) responseBody.warnings = warnings;
    if (errors?.length) responseBody.errors = errors;

    return NextResponse.json(responseBody);
  } catch (err) {
    const logger = createWebLogger();
    logger.errorWithException(err, "[api/generate] Failed to generate project");
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
