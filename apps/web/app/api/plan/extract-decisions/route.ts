import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { createLLMProvider, resolveWebLlmApiKey } from "@/lib/wire.shared";
import { enforceDailyQuota } from "../../../../lib/enforce-quota";

// --- Rate Limiter (In-Memory) ---
// Mirrors /api/llm/chat exactly: per-user (or per-IP for anonymous) sliding
// window; the durable free-tier daily cap is enforced separately below.
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;
const userRequestTimestamps = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const timestamps = userRequestTimestamps.get(userId) || [];

  // Filter out timestamps older than the window
  const recentTimestamps = timestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
  );

  if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    return true; // Rate limited
  }

  // Add current request timestamp and update the map
  recentTimestamps.push(now);
  userRequestTimestamps.set(userId, recentTimestamps);
  return false;
}

/** Generous cap on the pasted transcript (same bound as the spec-convert
 * route) — a runaway payload should 400, not be forwarded to the provider. */
const MAX_TRANSCRIPT_CHARS = 200_000;

interface ExtractDecisionsBody {
  transcript?: unknown;
  title?: unknown;
}

const SYSTEM_PROMPT = [
  "You extract FINALIZED decisions from a software-planning transcript.",
  "The transcript is a multi-party brainstorm (several agents and a human).",
  "Produce a concise markdown summary with exactly two sections:",
  "",
  '1. "## Decisions" — the finalized decisions, contracts, and architectural',
  "   commitments the participants actually converged on. One bullet per",
  "   decision, phrased as a commitment. Include agreed names, boundaries,",
  "   and interfaces where the transcript states them.",
  '2. "## Open questions" — points raised but explicitly left unresolved.',
  "",
  "Invent NOTHING: only include items grounded in the transcript. If a",
  'section has no items, keep the heading and write "None recorded.".',
].join("\n");

/**
 * POST /api/plan/extract-decisions — non-streaming LLM pass that distills a
 * planning-layer transcript into a "Decisions" markdown summary.
 *
 * Deliberately mirrors /api/llm/chat's server-key (ENV) path: same model
 * config (LLM_MODEL), same provider wiring (createLLMProvider), same
 * per-user rate limiter, same anonymous free-tier daily quota gate
 * (kind "chat" — an extraction is one chat-sized completion), same error
 * mapping. The BYOK branch is intentionally absent: extraction is a
 * single server-key completion, not a user-keyed streaming chat.
 */
export async function POST(request: NextRequest) {
  let body: ExtractDecisionsBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON in request body" },
      { status: 400 },
    );
  }

  const session = await getServerSession(authOptions);

  // Server-key path only: unauthenticated access is allowed when the operator
  // configured a web LLM key (same opt-in contract as the chat route).
  if (!session?.user?.sub && !resolveWebLlmApiKey()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId =
    session?.user?.sub ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "anon";

  if (isRateLimited(userId)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again in a minute." },
      { status: 429 },
    );
  }

  if (typeof body.transcript !== "string" || !body.transcript.trim()) {
    return NextResponse.json(
      { error: "'transcript' must be a non-empty string." },
      { status: 400 },
    );
  }
  if (body.transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: "Transcript too large." },
      { status: 400 },
    );
  }
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Planning session";

  // Free-tier (unauthenticated) extraction: counts against the same daily chat
  // quota as the governance chat. Signed-in users aren't on the free tier.
  let quotaHeaders: Record<string, string> = {};
  if (!session?.user?.sub) {
    const quota = enforceDailyQuota(request, "chat");
    if (!quota.ok) return quota.response;
    quotaHeaders = quota.headers;
  }

  try {
    const provider = createLLMProvider();
    const result = await provider.complete({
      model: process.env.LLM_MODEL || "gpt-4o-mini",
      // Explicit output budget sized for a long session's summary — without it
      // the adapter's 2048-token default silently truncates the tail (usually
      // "## Open questions") of a large multi-agent transcript's extraction.
      maxTokens: 4096,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Session title: ${title}\n\nTranscript:\n\n${body.transcript}`,
        },
      ],
    });

    if (!result.success) {
      const message =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      // Upstream provider failure → 502 (the provider, not this route, failed).
      return NextResponse.json(
        { error: message },
        { status: 502, headers: quotaHeaders },
      );
    }

    const choice = result.value.choices[0];
    let decisions = choice?.message?.content ?? "";
    if (!decisions.trim()) {
      return NextResponse.json(
        { error: "The model returned an empty response. Please try again." },
        { status: 502, headers: quotaHeaders },
      );
    }
    // The output budget was exhausted mid-summary: don't fail (the partial is
    // still useful and the quota was spent), but never present a cut-off
    // summary as complete.
    if (choice?.finishReason === "length") {
      decisions +=
        "\n\n> ⚠️ This summary was truncated by the model's output limit and may be incomplete.";
    }

    return NextResponse.json({ decisions }, { headers: quotaHeaders });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    // eslint-disable-next-line no-console -- intentional: route-level fallback diagnostic before returning 500 (mirrors /api/llm/chat)
    console.error("[Extract Decisions] Error handling request:", error);
    return NextResponse.json(
      { error: errorMessage },
      { status: 500, headers: quotaHeaders },
    );
  }
}
