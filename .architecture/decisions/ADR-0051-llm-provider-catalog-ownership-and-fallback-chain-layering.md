# ADR-0051: LLM Provider-Catalog Ownership and Fallback-Chain Layering

**Date:** 2026-08-14
**Status:** Proposed — amends ADR-0029 (§1.3/§1.4)
**Type:** Architecture
**Relates to:** ADR-0042 (cloud-first LLM execution — that ADR made cloud provider chains the product's primary generation path; this ADR governs _where_ the provider catalog and the chains ADR-0042 made primary may live)

## Context

Cloud LLM execution routes requests through a **provider fallback chain** — a
primary endpoint plus ordered fallbacks, each carrying a vendor `baseUrl`, a
`model` id, and an `apiKeyEnvVar` — resolved against a secret vault at request
time (`packages/agentic-interaction/src/domain/provider-config.ts:60-71`,
`resolveFallbackChain`). Three separate sources currently produce these chains,
and two of them put vendor HTTP endpoints and API-key **environment-variable
names** inside the `domain/` layer:

1. **`@hexagen/local-llm` domain catalog** — `CLOUD_PROVIDERS` hard-codes
   `baseUrl: "https://api.openai.com/v1"` (and every other vendor URL) directly
   in `packages/local-llm/src/domain/cloud-provider-catalog.ts` (`CLOUD_PROVIDERS`
   at line 53, the OpenAI `baseUrl` at line 58). The file itself flags `baseUrl`
   as "server-side only … the client never sees it" (lines 8-11) — an
   infrastructure routing concern living in domain.
2. **`@hexagen/agentic-interaction` domain default chain** —
   `createDefaultFallbackChain()` returns a chain whose endpoints hard-code
   `baseUrl: "https://api.openai.com/v1"`, `model: "gpt-4o-mini"`, and the
   `OPENAI_API_KEY` env-var name in
   `packages/agentic-interaction/src/domain/provider-config.ts:73-98`. This is
   HEX-012: endpoint or secret-name changes force edits to a domain module.
3. **The composition root's env-derived chain** —
   `buildStagedGenerationFallbackChain()` in
   `apps/web/app/lib/wire.server.ts:223-271` reads `LLM_BASE_URL` / `LLM_MODEL`
   / `INCEPTION_MODEL` from `process.env` at call time and assembles the
   staged-generation chain (`gpt-4o` primary, distinct from the domain default's
   `gpt-4o-mini`). The review flagged this third chain as HEX-020 (a duplicate
   to be relocated out of the root).

The 2026-08-14 audit corrected HEX-020: **an env-derived chain assembled in the
composition root is the root doing its job** (reading environment at wiring time
and injecting concrete endpoints), and the "duplicates HEX-012" claim was
factually wrong — `buildStagedGenerationFallbackChain` and
`createDefaultFallbackChain` are genuinely distinct chains with different models
(`gpt-4o` vs `gpt-4o-mini`) and different provenance (env-read vs literal). The
two are confirmed distinct in the current tree: the env-derived builder is a
local `const` at `wire.server.ts:223` (invoked at `:287` and `:296`); the domain
default is imported from `@hexagen/agentic-interaction` at `wire.server.ts:22`
and invoked at exactly one src runtime site, `wire.server.ts:526`. Only the
**subscriber residue** of HEX-020 survives (see Consequences).

Downstream consumers inherit the same domain-in-infrastructure coupling. The TUI
depends on `@hexagen/agentic-interaction` (`apps/tui/package.json:16`) yet
**reimplements** the LLM provider adapter locally, hard-coding
`"https://api.openai.com/v1/chat/completions"` inside a `LocalLLMProviderAdapter`
class in `apps/tui/src/services/action-service.ts:45-67` (HEX-017) instead of
driving the shared catalog/ports. Endpoint changes therefore fan out to three
files across two packages plus the TUI.

This ADR decides who owns the vendor catalog and how per-app chains compose,
without touching the composition-root prerogative the audit affirmed. It governs
HEX-012 and HEX-017; it records the scoped disposition of HEX-020.

## Decision

1. **Provider identity stays in domain; routing data moves to infrastructure.**
   The `domain/` layer keeps only provider and model _identities_ — the
   `CloudProviderId` / `CloudModelId` unions and `ProviderFallbackChain` shape
   already declared in `provider-config.ts:1-32` and `cloud-provider-catalog.ts`.
   The routing facts — `baseUrl`, `apiKeyEnvVar`, and the concrete default chain
   — move to an **infrastructure config adapter** exposed through a port and
   injected. `createDefaultFallbackChain` (currently
   `provider-config.ts:73-98`) is deleted once its consumers migrate; the
   `CLOUD_PROVIDERS` `baseUrl` entries in local-llm move behind the same
   infrastructure seam.

2. **One catalog builder, per-app composition.** There is a single _builder_ of
   the vendor catalog (one infrastructure adapter), not three literal chains.
   Each app (web, TUI, MCP) composes its own chain at its composition root from
   that shared catalog. This preserves per-app latitude (web's staged chain, the
   TUI's chain) while eliminating the duplicated vendor literals.

3. **Env-derived chains remain in the composition root — explicitly.**
   `buildStagedGenerationFallbackChain()` (`wire.server.ts:223-271`) **stays in
   `wire.server.ts`**. Reading `process.env` at wiring time and producing
   concrete endpoints is precisely a composition-root responsibility; it is not
   a duplicate of the domain default and is not relocated. Any future
   env-derived chain (a TUI or MCP equivalent) likewise belongs in that app's
   composition root, not in `domain/`. This is the binding audit correction:
   the HEX-020 headline ("move env-derived chains out of the root") is **not
   adopted**.

4. **Migration order and behavioral floor (implements plan item 5.3(b) → 5.8).**
   The sole runtime consumer of the domain default —
   `cloudConfig?.fallbackChain ?? createDefaultFallbackChain()` at
   `wire.server.ts:526` (the cloud-pipeline default when no explicit chain is
   passed) — migrates onto the injected catalog adapter _first_, then
   `createDefaultFallbackChain` is deleted. The no-`cloudConfig.fallbackChain`
   default path must stay behaviorally covered by a test. The TUI (HEX-017) then
   drives the shared catalog/ports instead of its inline
   `LocalLLMProviderAdapter`, keeping the MCP SDK behind a wire module.

## Consequences

- **Endpoint and secret-name changes stay in infrastructure.** Adding a vendor,
  rotating a `baseUrl`, or renaming an `apiKeyEnvVar` no longer edits a `domain/`
  module. Prompt/stage temperature and model-id tuning that lives on the
  env-derived staged chain continues to happen in the composition root, where it
  already does.
- **The env-derived staged chain is now a documented, deliberate root
  responsibility.** `buildStagedGenerationFallbackChain` and
  `resolveActiveGenerationModel` (which consumes it, `wire.server.ts:284`)
  are unaffected; the `gpt-4o` vs `gpt-4o-mini` divergence between the staged
  chain and the (deleted) domain default is intentional, not drift.
- **HEX-020's only surviving residue is a subscriber extraction, not a
  relocation.** The inline `ProjectDiscarded` purge cascade wired directly in
  `apps/web/app/lib/wire.client.ts:230-234` should be extracted into the existing
  `discardProject` use case. That is a _client_ composition-root cleanup tracked
  separately (plan item 5.3(c)); it does not move any env-derived chain.
- **Adjacent seam, governed elsewhere.** A `SecretVaultPort` contract lives in
  the same domain file (`provider-config.ts:42-49`, a synchronous
  `getSecret(envVarName)` for server-side env access), and a second,
  differently-shaped, differently-_named_ browser-side vault contract —
  `UserSecretVaultPort` — exists in web-driver
  (`packages/web-driver/src/application/ports/user-secret-vault.port.ts`, an
  async vault lifecycle: `getStatus` / `store` / retrieve). (A third
  application-layer `SecretVaultPort` in agentic-interaction,
  `src/application/ports/out/secret-vault-port.port.ts`, is the async vault-state
  contract and is not the same interface as the domain `getSecret` one.)
  Splitting/renaming/reconciling these contracts is HEX-008 (plan item 5.4) and
  depends on this ADR's catalog migration (item 5.3(b)) landing first; it is out
  of scope here but named so the ordering is explicit.
- **Generated projects inherit the corrected doctrine.** Once the catalog is an
  injected infrastructure adapter, scaffolded projects that wire LLM execution
  get "identities in domain, routing in infrastructure, chains composed at the
  root" as the demonstrated pattern rather than the current mixed one.
- **No layer-rules exception is created for vendor URLs.** Option 2 from the
  candidate ("keep catalogs in domain as configuration-as-data and document an
  exception in `layer-rules.yaml`") is **not** taken: vendor `baseUrl` and
  secret env-var names are infrastructure routing facts, not domain artifacts.
  (This is deliberately unlike the HEX-026 YAML-codec disposition, where the
  YAML text _is_ the core domain artifact — that exception is ADR 0.8's, not
  this one's.)
