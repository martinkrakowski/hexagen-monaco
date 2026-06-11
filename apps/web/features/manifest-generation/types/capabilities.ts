import type { ByokProvider } from "@hexagen/byok";

export type CapabilityProbeResult = {
  provider: ByokProvider;
  hasServerKey: boolean;
  hasByokKey: boolean;
  status: "server_env_key" | "byok_key" | "no_keys_configured" | "unknown";
};

export type CapabilitiesResponse = {
  capabilities: CapabilityProbeResult[];
  canGenerate: boolean;
  /** Web chat/governance model (LLM_MODEL) — what the assistant's Q&A uses. */
  activeModelName?: string;
  /**
   * Head of the resolved staged-generation fallback chain — what manifest
   * generation actually runs on. May differ from activeModelName (it does
   * post-mercury-flip). Absent when no generation provider resolves.
   */
  generationModelName?: string;
};
