import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { InitiateExportUseCase } from "@hexagen/project-generation";
import { getGenerateProject } from "@/lib/wire.server";
import { wizardToManifest } from "@hexagen/wizard-orchestration";
import type { Manifest } from "@hexagen/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GitHubExportRequest {
  projectId: string;
  repoName: string;
  isPrivate: boolean;
  owner?: string;
  commitMessage?: string;
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
        {
          error: "Unauthorized: GitHub session token not found",
          code: "reauth_required",
        },
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
        commitMessage: body.commitMessage,
      },
    });

    if (!result.success) {
      const message = result.error.message;
      // Map a downstream GitHub auth failure (revoked/expired token → 401/403)
      // to reauth_required so the UI prompts a re-login, mirroring
      // /api/push/github. The "(401)"/"(403)" shape is emitted by
      // GitHubGitDataClient/GitHubExporterAdapter error messages.
      if (/\((401|403)\)/.test(message)) {
        return NextResponse.json(
          { error: message, code: "reauth_required" },
          { status: 401 },
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if ("destinationUrl" in result.value) {
      const destinationUrl = result.value.destinationUrl;
      // Return githubLink details so client can persist on SavedProject (client IDB only).
      // lastCommitSha is null post-initial-publish (updated by subsequent /api/push/github).
      // branch is the repo's ACTUAL default branch (the exporter resolves it and
      // commits there); editor push commits back to this branch, so it must not
      // be hardcoded — falling back to "main" only if the exporter didn't report it.
      const branch = result.value.defaultBranch ?? "main";
      const githubLink = {
        owner,
        repo: body.repoName,
        branch,
        defaultBranch: branch,
        lastCommitSha: null as string | null,
        htmlUrl: destinationUrl,
      };
      return NextResponse.json({
        success: true,
        destinationUrl,
        githubLink,
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
