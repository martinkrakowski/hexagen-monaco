/**
 * ADR-0051 layering pins for the cloud provider catalog.
 *
 * Decision 1: "Provider identity stays in domain; routing data moves to
 * infrastructure." The domain catalog may name providers and models; the
 * vendor `baseUrl` is a routing fact and lives behind the infrastructure
 * seam (`infrastructure/adapters/cloud-provider-routing.ts`).
 *
 * These are structural pins, not behavioural ones — the catalog has no
 * runtime `baseUrl` consumer in this repo (the web chat route derives its
 * endpoint from `LLM_BASE_URL`, not from this table). They exist so the
 * routing literals cannot silently drift back into `domain/`.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  CLOUD_PROVIDERS,
  getClientProviders,
} from "../../src/domain/cloud-provider-catalog.js";
import {
  CLOUD_PROVIDER_BASE_URLS,
  getCloudProviderBaseUrl,
} from "../../src/infrastructure/adapters/cloud-provider-routing.js";
import * as packageRoot from "../../src/index.js";
import * as clientSubpath from "../../src/client/index.js";

describe("cloud provider catalog layering (ADR-0051 §Decision 1)", () => {
  it("carries no vendor routing data in the domain catalog", () => {
    for (const provider of CLOUD_PROVIDERS) {
      assert.equal(
        Object.hasOwn(provider, "baseUrl"),
        false,
        `domain catalog entry "${provider.id}" still carries a baseUrl`,
      );
    }
  });

  it("keeps no vendor URL literal anywhere in the domain catalog projection", () => {
    // Guards against a baseUrl smuggled under another key name (e.g. `url`,
    // `endpoint`) — a rename would defeat the hasOwn pin above.
    const serialized = JSON.stringify(CLOUD_PROVIDERS);
    assert.equal(
      /https?:\/\//.test(serialized),
      false,
      `domain catalog still serializes a vendor URL: ${serialized}`,
    );
  });

  it("routes every domain-known provider from the infrastructure table", () => {
    for (const provider of CLOUD_PROVIDERS) {
      const baseUrl = getCloudProviderBaseUrl(provider.id);
      assert.ok(
        baseUrl,
        `no infrastructure baseUrl registered for provider "${provider.id}"`,
      );
      assert.match(baseUrl, /^https:\/\//);
    }
  });

  it("pins the vendor endpoints the domain catalog used to hard-code", () => {
    // Byte-for-byte the values that lived in domain before the move, so the
    // relocation cannot be claimed while quietly rewriting an endpoint.
    assert.deepEqual(
      { ...CLOUD_PROVIDER_BASE_URLS },
      {
        openai: "https://api.openai.com/v1",
        anthropic: "https://api.anthropic.com/v1",
        mistral: "https://api.mistral.ai/v1",
        google: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
    );
  });

  it("returns undefined for unknown ids and for inherited Object keys", () => {
    assert.equal(getCloudProviderBaseUrl("not-a-provider"), undefined);
    // A bare property read on a plain object would hand back Object.prototype
    // members; the lookup must be own-key only.
    assert.equal(getCloudProviderBaseUrl("toString"), undefined);
    assert.equal(getCloudProviderBaseUrl("constructor"), undefined);
  });

  it("keeps the routing table off BOTH package entry points", () => {
    // The routing module is deep-import-only. Neither entry point may
    // re-export it: `./client` is browser-facing by contract, and the package
    // root's barrel chain (src/index.ts -> infrastructure/index.ts ->
    // adapters/index.ts) is imported by 26 "use client" modules. This package
    // sets no `sideEffects: false`, so a bundler cannot be relied on to prove
    // unused constants away.
    //
    // Asserted against the real module namespaces, not the barrel source
    // text, so an `export *` chain added anywhere upstream is caught too.
    for (const [name, ns] of [
      ["package root", packageRoot],
      ["./client subpath", clientSubpath],
    ] as const) {
      const exported = ns as unknown as Record<string, unknown>;
      assert.equal(
        "CLOUD_PROVIDER_BASE_URLS" in exported,
        false,
        `${name} re-exports CLOUD_PROVIDER_BASE_URLS`,
      );
      assert.equal(
        "getCloudProviderBaseUrl" in exported,
        false,
        `${name} re-exports getCloudProviderBaseUrl`,
      );
      // Catch a rename or a differently-shaped re-export of the same data.
      const vendorUrlCarrier = Object.entries(exported).find(([, value]) =>
        /https?:\/\//.test(JSON.stringify(value ?? null) ?? ""),
      );
      assert.equal(
        vendorUrlCarrier?.[0],
        undefined,
        `${name} exports a value carrying a vendor URL: ${vendorUrlCarrier?.[0]}`,
      );
    }
  });

  it("still exposes the full provider list to the client, unchanged", () => {
    // getClientProviders() was the baseUrl-stripping projection. After the
    // move it is an identity projection, but its contract — id, displayName,
    // available, models — must be intact for the two settings views.
    const clientProviders = getClientProviders();
    assert.equal(clientProviders.length, CLOUD_PROVIDERS.length);
    for (const [i, entry] of clientProviders.entries()) {
      const source = CLOUD_PROVIDERS[i]!;
      assert.equal(entry.id, source.id);
      assert.equal(entry.displayName, source.displayName);
      assert.equal(entry.available, source.available);
      assert.deepEqual(entry.models, source.models);
      assert.equal(Object.hasOwn(entry, "baseUrl"), false);
    }
  });
});
