import { NextRequest, NextResponse } from "next/server";
import { generateToken } from "../../../../../src/infrastructure/auth/magic-link/token-generator";
import { buildMagicLinkEmail } from "../../../../../src/infrastructure/auth/magic-link/email-templates";
import { sendMagicLinkEmail } from "../../../../../src/infrastructure/auth/magic-link/email-transport";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let email: string;
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || !("email" in body) || typeof body.email !== "string") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    email = body.email.toLowerCase().trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  try {
    const token = await generateToken(email);
    const content = buildMagicLinkEmail(email, token);
    await sendMagicLinkEmail({ to: email, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send magic link";
    console.error("[magic-link] send error:", message);
    return NextResponse.json({ error: "Failed to send magic link" }, { status: 500 });
  }

  // Always return 200 — don't reveal whether the email exists
  return NextResponse.json({ ok: true });
}
