export const MODEL_PREFERENCE_KEYS = {
  LAST_MODEL_ID: "hexagen:local-llm:last-model",
  AUTO_LOAD_ENABLED: "hexagen:local-llm:auto-load",
  HAS_ENABLED_LOCAL_MODELS: "hexagen:local-llm:has-enabled",
  CLOUD_PROVIDER: "hexagen:manifest-flow:cloud-provider",
  REMEMBER_API_KEY: "hexagen:manifest-flow:remember-api-key",
  SKIP_AI_SETUP: "hexagen:manifest-flow:skip-ai-setup",
  REMEMBER_CHOICE: "hexagen:manifest-flow:remember-choice",
  MODEL_CACHE_METADATA_PREFIX: "hexagen:local-llm:cache-metadata:",
} as const;
