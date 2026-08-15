import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getProxyRequestUseCase } from "@/lib/byok-wire.js";
import { isByokProvider } from "@hexagen/byok";

// Reaches SQLite (better-sqlite3, via byok-wire) — must run on the Node runtime,
// not edge.
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    ciphertext?: string;
    provider?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  if (!body.ciphertext || typeof body.ciphertext !== "string") {
    return NextResponse.json(
      { error: "'ciphertext' is required and must be a string" },
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

  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json(
      { error: "'payload' is required and must be an object" },
      { status: 400 },
    );
  }

  const useCase = getProxyRequestUseCase();
  const result = await useCase.execute({
    ciphertext: body.ciphertext,
    provider: body.provider,
    payload: body.payload,
    userId: session.user.sub,
  });

  if (!result.success) {
    const errorKind = result.error.kind;
    const status =
      errorKind === "key_revoked"
        ? 403
        : errorKind === "invalid_ciphertext" ||
            errorKind === "decryption_failed"
          ? 400
          : errorKind === "provider_error"
            ? (result.error.statusCode ?? 502)
            : 500;
    return NextResponse.json({ error: result.error.message }, { status });
  }

  const response: Record<string, unknown> = { data: result.value.data };
  if (result.value.rotatedCiphertext) {
    response.rotatedCiphertext = result.value.rotatedCiphertext;
  }
  return NextResponse.json(response);
}
