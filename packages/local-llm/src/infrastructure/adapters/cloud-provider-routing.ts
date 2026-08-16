/**
 * Vendor routing table for the cloud providers named in the domain catalog.
 *
 * ADR-0051 (Decision 1): the `domain/` layer keeps provider and model
 * _identities_ only; `baseUrl` is an infrastructure routing fact and lives
 * here. Adding a vendor or rotating an endpoint is an edit to this file, not
 * to `domain/cloud-provider-catalog.ts`.
 *
 * SECURITY BOUNDARY — these URLs are server-side reachability data, and this
 * module is reachable by deep import only. It is deliberately absent from
 * BOTH package entry points: the `@hexagen/local-llm/client` subpath
 * (re-exports `domain/` only) and the package root (whose barrel chain
 * `src/index.ts -> infrastructure/index.ts -> adapters/index.ts` is imported
 * by 26 `"use client"` modules; this package sets no `sideEffects: false`, so
 * a bundler cannot be relied on to prove the constants away). A future
 * server-side consumer should deep-import this file, or be given a `./server`
 * subpath — not a re-export from the browser-facing barrel.
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
