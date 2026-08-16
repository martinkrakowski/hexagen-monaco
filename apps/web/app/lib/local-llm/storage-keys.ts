import {
  type DomainModelId,
  parseDomainModelId,
  LEGACY_MODEL_MIGRATION,
} from "@hexagen/local-llm";
import { MODEL_PREFERENCE_KEYS } from "@hexagen/shared";

export const LAST_MODEL_KEY = MODEL_PREFERENCE_KEYS.LAST_MODEL_ID;
export const AUTO_LOAD_KEY = MODEL_PREFERENCE_KEYS.AUTO_LOAD_ENABLED;
export const HAS_ENABLED_KEY = MODEL_PREFERENCE_KEYS.HAS_ENABLED_LOCAL_MODELS;

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
