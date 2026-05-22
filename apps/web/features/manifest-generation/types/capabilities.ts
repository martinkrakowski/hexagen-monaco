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
  activeModelName?: string;
};
