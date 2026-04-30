export type ByokProvider = "openai" | "anthropic" | "cohere";

export const BYOK_PROVIDERS: readonly ByokProvider[] = [
  "openai",
  "anthropic",
  "cohere",
] as const;

export function isByokProvider(value: string): value is ByokProvider {
  return BYOK_PROVIDERS.includes(value as ByokProvider);
}
