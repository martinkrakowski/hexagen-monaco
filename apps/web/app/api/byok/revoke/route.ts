import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getRevokeKeyUseCase } from "@/lib/byok-wire.js";
import { isByokProvider } from "@hexagen/byok";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (!body.provider || !isByokProvider(body.provider)) {
    return NextResponse.json(
      {
        error:
          "'provider' is required and must be one of: openai, anthropic, cohere",
      },
      { status: 400 },
    );
  }

  const useCase = getRevokeKeyUseCase();
  const result = await useCase.execute({
    userId: session.user.sub,
    provider: body.provider,
    revokedBy: session.user.sub,
  });

  if (!result.success) {
    const status = result.error.kind === "key_not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json({ revoked: true });
}
