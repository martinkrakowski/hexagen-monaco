/**
 * Provider-specific temperature clamping for request-body builders.
 *
 * Why this exists (empirical probe, 2026-06-10): the Inception Labs API
 * (Mercury diffusion models) accepts temperature only in **[0.5, 1]** and
 * SILENTLY coerces anything outside that range to **0.75** — no error, no
 * response field admitting it. The staged-generation stages send
 * `temperature: 0.1` per-request, so without this clamp every Inception run
 * executes at an effective 0.75 — the *opposite* of the low-temperature
 * determinism the stages intend, and invisibly so.
 *
 * Clamping to the provider floor (0.5) is the closest expressible value to
 * the stages' intent. Scoped by `apiKeyEnvVar === "INCEPTION_API_KEY"` (the
 * same provider-identity key `reasoningBodyFieldFor` uses); every other
 * provider passes through untouched, so existing request bodies stay
 * byte-identical.
 */
export const INCEPTION_TEMPERATURE_MIN = 0.5;
export const INCEPTION_TEMPERATURE_MAX = 1;

/** Use at the body-builder seam:
 * `temperature: clampTemperatureFor(provider, resolvedTemperature)`. */
export function clampTemperatureFor(
  provider: { apiKeyEnvVar: string },
  temperature: number,
): number {
  if (provider.apiKeyEnvVar !== "INCEPTION_API_KEY") return temperature;
  return Math.min(
    Math.max(temperature, INCEPTION_TEMPERATURE_MIN),
    INCEPTION_TEMPERATURE_MAX,
  );
}
