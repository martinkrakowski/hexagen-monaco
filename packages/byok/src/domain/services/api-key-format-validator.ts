import type { Result } from "@hexagen/shared";
import type { ByokProvider } from "../value-objects/provider.vo.js";

const PROVIDER_PATTERNS: Record<ByokProvider, RegExp> = {
  openai: /^sk-[A-Za-z0-9]{32,}$/,
  anthropic: /^sk-ant-[A-Za-z0-9-]{32,}$/,
  cohere: /^[A-Za-z0-9]{40}$/,
};

export function validateApiKeyFormat(
  apiKey: string,
  provider: ByokProvider,
): Result<
  void,
  { kind: "invalid_key_format"; message: string; provider: string }
> {
  const pattern = PROVIDER_PATTERNS[provider];
  if (!pattern.test(apiKey)) {
    return {
      success: false,
      error: {
        kind: "invalid_key_format",
        message: `API key does not match expected format for ${provider}`,
        provider,
      },
    };
  }
  return { success: true, value: undefined };
}
