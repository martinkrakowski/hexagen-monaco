import {
  type DomainModelId,
  parseDomainModelId,
  LEGACY_MODEL_MIGRATION,
} from "@hexagen/local-llm";

/**
 * localStorage key for remembering the last-used model ID.
 * Stores a DomainModelId enum value (e.g., "qwen-2.5-3b").
 */
export const LAST_MODEL_KEY = "hexagen:local-llm:last-model";

/** localStorage key for the auto-load flag. */
export const AUTO_LOAD_KEY = "hexagen:local-llm:auto-load";

/**
 * localStorage key set to "true" after the user successfully enables
 * Local AI for the first time. Persists indefinitely across cancels
 * and cache clears — controls whether the user sees the first-time
 * OptIn screen or the "requires_model" model-picker after a reset.
 */
export const HAS_ENABLED_KEY = "hexagen:local-llm:has-enabled";

/**
 * Reads LAST_MODEL_KEY, applies any legacy → current id migration
 * (rewriting the stored value in-place), and parses the result as a
 * DomainModelId. Returns null if the stored value is absent or
 * unparseable.
 *
 * Side effect: writes the migrated id back to localStorage when a
 * legacy mapping applies. This keeps subsequent reads cheap and
 * idempotent.
 */
export function readAndMigrateLastModelId(): DomainModelId | null {
  let raw = localStorage.getItem(LAST_MODEL_KEY);
  if (!raw) return null;

  if (raw in LEGACY_MODEL_MIGRATION) {
    const migrated =
      LEGACY_MODEL_MIGRATION[raw as keyof typeof LEGACY_MODEL_MIGRATION];
    localStorage.setItem(LAST_MODEL_KEY, migrated);
    raw = migrated;
  }

  const parsed = parseDomainModelId(raw);
  return parsed.success ? parsed.value : null;
}
