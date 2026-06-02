import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { GitHubRepositoryWriterAdapter } from "@hexagen/external-integration";
import type { RepositoryLink } from "@hexagen/external-integration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PushGithubRequest {
  projectId: string;
  githubLink: RepositoryLink;
  files: Record<string, string>;
  message?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PushGithubRequest;

    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = token?.accessToken ?? null;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Unauthorized: GitHub session token not found", code: "reauth_required" },
        { status: 401 },
      );
    }

    const { githubLink, files, message } = body;
    if (!githubLink || !githubLink.owner || !githubLink.repo || !files || typeof files !== "object") {
      return NextResponse.json({ error: "Missing githubLink or files (Record<string,string>)" }, { status: 400 });
    }

    const writer = new GitHubRepositoryWriterAdapter();
    const result = await writer.commitFiles(
      githubLink,
      files,
      message || "Update from HexaGen editor",
      accessToken,
    );

    if (!result.success) {
      const err = result.error;
      if (err.code === "auth-failed") {
        return NextResponse.json(
          { error: err.message, code: "reauth_required" },
          { status: 401 },
        );
      }
      return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }

    // Client will use returned sha to update the SavedProject.githubLink.lastCommitSha
    return NextResponse.json({
      success: true,
      commitSha: result.value.commitSha,
      commitUrl: result.value.commitUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
