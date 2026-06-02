import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import type { RepositoryLink } from "@hexagen/external-integration";
import { getRepositoryWriter } from "@/lib/wire.server";

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
        {
          error: "Unauthorized: GitHub session token not found",
          code: "reauth_required",
        },
        { status: 401 },
      );
    }

    const { githubLink, files, message } = body;
    const hasValidFiles =
      !!files &&
      typeof files === "object" &&
      !Array.isArray(files) &&
      Object.values(files).every((value) => typeof value === "string");
    if (
      !githubLink ||
      !githubLink.owner ||
      !githubLink.repo ||
      !hasValidFiles
    ) {
      return NextResponse.json(
        { error: "Missing githubLink or files (Record<string,string>)" },
        { status: 400 },
      );
    }

    // Write authorization is enforced by GitHub against the session's OAuth
    // token: a token lacking push access to githubLink.owner/repo gets 401/403,
    // which we surface below as `reauth_required`. The SavedProject (and its
    // githubLink) lives only in the client's IDB, so there is no server-side
    // ownership record to additionally check against.
    // Defensive: only accept a string message from the untrusted body; fall
    // back otherwise so a malformed payload can't reach the writer as a non-string.
    const commitMessage =
      typeof message === "string" && message.trim()
        ? message
        : "Update from HexaGen editor";
    const writer = getRepositoryWriter();
    const result = await writer.commitFiles(
      githubLink,
      files,
      commitMessage,
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
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 500 },
      );
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
