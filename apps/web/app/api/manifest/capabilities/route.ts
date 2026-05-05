import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth.js";
import { getMetadataAdapter } from "@/lib/byok-wire.js";
import type { ByokProvider } from "@hexagen/byok";
import { BYOK_PROVIDERS } from "@hexagen/byok";

export type CapabilityProbeResult = {
  provider: ByokProvider;
  hasServerKey: boolean;
  hasByokKey: boolean;
  status: "server_env_key" | "byok_key" | "no_keys_configured" | "unknown";
};

/**
 * Resolve which tier can provide an API key for the given provider.
 * Tier chain: env keys → BYOK keys → error
 *
 * Note: `hasByokKey` is an aggregate across ALL providers (returns true if user has ANY BYOK key).
 * This means if a user has only an OpenAI BYOK key, the Anthropic row will incorrectly show `hasByokKey: true`.
 * For Phase 1, this is acceptable because `canGenerate` (top-level) is the source of truth for button gating.
 * Phase 2 will refine per-provider cardinality tracking if multi-key support is added.
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

  // If no session, return minimal capabilities (only server env keys)
  // User may not be authenticated yet; BYOK check requires auth
  if (!session || !session.user?.sub) {
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

    return NextResponse.json({
      capabilities,
      canGenerate: capabilities.some((c) => c.status !== "no_keys_configured"),
    });
  }

  // Check if user has any BYOK keys (requires authentication)
  const metadataAdapter = getMetadataAdapter();
  const byokResult = await metadataAdapter.hasKeys(session.user.sub);

  if (!byokResult.success) {
    return NextResponse.json(
      { error: byokResult.error.message },
      { status: 500 },
    );
  }

  const hasByokKeys = byokResult.value;

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
      const status = resolveTierForProvider(
        provider,
        hasServerKey,
        hasByokKeys,
      );

      return {
        provider,
        hasServerKey,
        hasByokKey: hasByokKeys,
        status,
      };
    },
  );

  return NextResponse.json({
    capabilities,
    canGenerate: capabilities.some((c) => c.status !== "no_keys_configured"),
  });
}
