import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getEncryptKeyUseCase } from "@/lib/byok-wire.js";
import { isByokProvider } from "@hexagen/byok";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { apiKey?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (!body.apiKey || typeof body.apiKey !== "string") {
    return NextResponse.json(
      { error: "'apiKey' is required and must be a string" },
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

  const useCase = getEncryptKeyUseCase();
  const result = await useCase.execute({
    apiKey: body.apiKey,
    provider: body.provider,
    userId: session.user.sub,
  });

  if (!result.success) {
    const status =
      result.error.kind === "invalid_key_format"
        ? 422
        : result.error.kind === "encryption_failed"
          ? 500
          : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  return NextResponse.json(
    {
      ciphertext: result.value.ciphertext,
      provider: result.value.provider,
      keyId: result.value.keyId,
      createdAt: result.value.createdAt,
    },
    { status: 201 },
  );
}
