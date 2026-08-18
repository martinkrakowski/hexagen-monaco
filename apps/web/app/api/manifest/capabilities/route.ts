import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getMetadataAdapter } from "@/lib/byok-wire.js";
import type { ByokProvider } from "@hexagen/byok";
import { BYOK_PROVIDERS } from "@hexagen/byok";
import { resolveActiveGenerationModel } from "../../../lib/wire.server";

// getMetadataAdapter (byok-wire) transitively imports SQLite (better-sqlite3) for
// the durable key-metadata store — must run on the Node runtime, not edge.
export const runtime = "nodejs";

export type CapabilityProbeResult = {
  provider: ByokProvider;
  hasServerKey: boolean;
  hasByokKey: boolean;
  status: "server_env_key" | "byok_key" | "no_keys_configured" | "unknown";
};

/**
 * Resolve which tier can provide an API key for the given provider.
 * Tier chain: env keys → BYOK keys → error
 */
function resolveTierForProvider(
  provider: ByokProvider,
  hasServerKey: boolean,
  hasByokKey: boolean,
): CapabilityProbeResult["status"] {
  if (hasServerKey) {
    return "server_env_key";
  }
  if (hasByokKey) {
    return "byok_key";
  }
  return "no_keys_configured";
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.sub;

  // If no session, return minimal capabilities (only server env keys)
  // User may not be authenticated yet; BYOK check requires auth
  if (!userId) {
    // Check for server-side environment keys (public information)
    const serverKeyEnvVars: Record<ByokProvider, string> = {
      openai: process.env.OPENAI_API_KEY ?? "",
      anthropic: process.env.ANTHROPIC_API_KEY ?? "",
      cohere: process.env.COHERE_API_KEY ?? "",
    };

    // Build capability probe result for each provider (env keys only)
    const capabilities: CapabilityProbeResult[] = BYOK_PROVIDERS.map(
      (provider) => {
        const hasServerKey = serverKeyEnvVars[provider].length > 0;
        return {
          provider,
          hasServerKey,
          hasByokKey: false, // Can't check without user context
          status: hasServerKey ? "server_env_key" : "no_keys_configured",
        };
      },
    );

    const generationModelName = resolveActiveGenerationModel() ?? undefined;

    return NextResponse.json({
      capabilities,
      // Generation is possible when a BYOK-probe provider has a key OR the
      // staged-generation fallback chain resolves (e.g. INCEPTION_API_KEY /
      // LLM_API_KEY deployments, which the per-provider probe can't see).
      canGenerate:
        capabilities.some((c) => c.status !== "no_keys_configured") ||
        generationModelName !== undefined,
      // Web chat/governance model (LLM_MODEL) — NOT what serves manifest
      // generation; that's generationModelName below. Kept under its
      // historical name for existing consumers (governance panel badge).
      activeModelName: process.env.LLM_MODEL || "gpt-4o-mini",
      generationModelName,
    });
  }

  // Check if user has any BYOK keys (requires authentication)
  const metadataAdapter = getMetadataAdapter();
  const byokResults = await Promise.all(
    BYOK_PROVIDERS.map((p) => metadataAdapter.findByUserAndProvider(userId, p)),
  );

  const errorResult = byokResults.find((r) => !r.success);
  if (errorResult && !errorResult.success) {
    return NextResponse.json(
      { error: "Unable to check BYOK key status" },
      { status: 500 },
    );
  }

  const hasByokKeyMap = BYOK_PROVIDERS.reduce(
    (acc, p, i) => {
      const res = byokResults[i];
      acc[p] =
        res.success && res.value !== null && res.value.revokedAt === null;
      return acc;
    },
    {} as Record<ByokProvider, boolean>,
  );

  // Check for server-side environment keys
  const serverKeyEnvVars: Record<ByokProvider, string> = {
    openai: process.env.OPENAI_API_KEY ?? "",
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    cohere: process.env.COHERE_API_KEY ?? "",
  };

  // Build capability probe result for each provider
  const capabilities: CapabilityProbeResult[] = BYOK_PROVIDERS.map(
    (provider) => {
      const hasServerKey = serverKeyEnvVars[provider].length > 0;
      const hasByokKey = hasByokKeyMap[provider];
      const status = resolveTierForProvider(provider, hasServerKey, hasByokKey);

      return {
        provider,
        hasServerKey,
        hasByokKey,
        status,
      };
    },
  );

  const generationModelName = resolveActiveGenerationModel() ?? undefined;

  return NextResponse.json({
    capabilities,
    // See the unauthenticated branch above for the canGenerate widening and
    // the activeModelName / generationModelName distinction.
    canGenerate:
      capabilities.some((c) => c.status !== "no_keys_configured") ||
      generationModelName !== undefined,
    activeModelName: process.env.LLM_MODEL || "gpt-4o-mini",
    generationModelName,
  });
}
