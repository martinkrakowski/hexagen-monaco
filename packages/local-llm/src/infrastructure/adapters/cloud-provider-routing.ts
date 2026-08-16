/**
 * Vendor routing table for the cloud providers named in the domain catalog.
 *
 * ADR-0051 (Decision 1): the `domain/` layer keeps provider and model
 * _identities_ only; `baseUrl` is an infrastructure routing fact and lives
 * here. Adding a vendor or rotating an endpoint is an edit to this file, not
 * to `domain/cloud-provider-catalog.ts`.
 *
 * SECURITY BOUNDARY — these URLs are server-side reachability data. They are
 * deliberately absent from the `@hexagen/local-llm/client` subpath (which
 * re-exports only `domain/`), so the browser bundle never carries them.
 *
 * Provenance: hand-maintained, lifted verbatim from the domain catalog's
 * previous `baseUrl` fields. Values sourced from each vendor's public API
 * documentation.
 */
import type { CloudProviderId } from "../../domain/cloud-provider-catalog.js";

export const CLOUD_PROVIDER_BASE_URLS: Readonly<
  Record<CloudProviderId, string>
> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  mistral: "https://api.mistral.ai/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

/**
 * Base URL for a provider id, or `undefined` when the id is unknown.
 *
 * Own-key lookup only: a plain index read would resolve inherited
 * `Object.prototype` members (`toString`, `constructor`, …) and hand back a
 * function where a URL is expected.
 */
export function getCloudProviderBaseUrl(
  providerId: string,
): string | undefined {
  return Object.hasOwn(CLOUD_PROVIDER_BASE_URLS, providerId)
    ? CLOUD_PROVIDER_BASE_URLS[providerId as CloudProviderId]
    : undefined;
}
