export function validateApiKeyFormat(provider: string, key: string): boolean {
  if (!key || key.length < 8) {
    return false;
  }

  if (provider === "openai" && !key.startsWith("sk-")) {
    return false;
  }

  if (provider === "anthropic" && !key.startsWith("sk-ant-")) {
    return false;
  }

  return true;
}

export function isValidProvider(provider: string): boolean {
  return ["openai", "anthropic", "azure", "other"].includes(provider);
}
