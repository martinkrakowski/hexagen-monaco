# Materialize Cross-Context Communication (Phase 3)

**Status:** Proposed — Decision C → **C1** (interface-complete, body-stubbed); Decision D → **D1** (provider `domainEvents`; context-name-only fallback). Ready for 3a.
**Date:** 2026-06-06
**Parent:** [`wire-architectural-template-into-generation.md`](./wire-architectural-template-into-generation.md) (Phase 3). Phases 1 (#235) + 2 (#236) shipped; the `generateApps` traversal guard shipped (#237). Decision A resolved → **A1** (keep all three templates, differentiate now).

## Goal

Make the architectural template produce **structurally different generated code** per `crossContextCalls`, so strict-enterprise (`event-bus`) ≠ micro-frontend (`network`) ≠ modular-monolith (`in-process`). Post Phase 1/2 the strict templates differ only in dropped `depends_on` + advisory `.architecture/invariants` YAML — **no transport is generated**. This phase makes the templates honestly distinct, and makes the `required_communication` invariant Phase 1 already emits enforceable against real code.

## Grounding — most of the machinery already exists

Like Phase 2 (which reused the apps generator), Phase 3 is **manifest enrichment in `wizardToManifest`** plus a **dedicated transport emitter** (modeled on `architecture-files.ts`). The generic per-kind stub _templates_ can't model a recognizable event-bus vs network boundary — they'd emit identical `{name}Port` / `{name}Adapter` stubs — so the emitter writes **bespoke ports** with real interfaces, and `generateAdapterFromPort` derives the adapters from those (bespoke where the shape matters, reuse where it's mechanical):

| Building block                                                                                                     | State today                                                                                                                       | Phase 3 use                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `peerMappings` `{ consumerContext, providerContext, integrationPattern: open-host \| acl, communicationBoundary }` | captured by the wizard; `wizardToManifest` uses them **only** for `depends_on`                                                    | the set of cross-context edges to scaffold transport for                                                                                     |
| manifest port vocabulary                                                                                           | in: `event-listener`, `rest-controller`, …; out: `message-publisher`, `external-service-client`, … (a fixed enum — already valid) | declare the transport ports per edge — **no schema change**                                                                                  |
| `generateAdapterFromPort` (`packages/sync`)                                                                        | derives an adapter implementing a given port's interface                                                                          | reused to derive adapters from the emitter's bespoke ports (the generic stub templates are NOT reused — they can't differentiate transports) |
| `template.rules.crossContextCalls`                                                                                 | drives Phase 1 `depends_on` gating + the `.architecture` YAML                                                                     | drives **which** transport to scaffold                                                                                                       |
| `messaging` pkg `EventBusPort` (publish/subscribe) + `DomainEvent`                                                 | hexagen-monaco's own bus                                                                                                          | reference shape for the generated event-bus port                                                                                             |

## Design

For a strict template, for each `peerMapping` edge (consumer → provider):

**`event-bus`** (strict-enterprise):

- **provider (publisher):** out-port `message-publisher` + adapter — publishes the provider's own domain events. The contract is the provider's events (D1), so the **provider** is the publisher. Body is a `// TODO: publish via your broker` per C1.
- **consumer (subscriber):** in-port `event-listener` + handler — subscribes to the provider's events.
- shared event contract (DTO + bus port interface) lives in the **`shared` kernel** — both contexts already `depends_on` shared, so publisher/subscriber agree without a direct cross-context dep (preserving the strict no-sibling-import rule).

**`network`** (micro-frontend):

- consumer: out-port `external-service-client` + adapter (HTTP client; body `// TODO: call <provider> endpoint`).
- provider: in-port `rest-controller` + handler (endpoint stub).
- request/response DTOs in `shared`.

**`integrationPattern` shaping:** `acl` → the consumer adapter is an anti-corruption layer (translates the provider's contract to the consumer's domain); `open-host` → the provider exposes a published-language port.

modular-monolith (`in-process`) — unchanged (direct `depends_on` imports, as today).

## Decision C — transport realism _(resolved: C1)_

**C1 (chosen):** interface-complete, body-stubbed. Generate ports + port-derived adapters + event/DTO contracts, wired into package deps; the boundary compiles and satisfies the arch-linter's `required_communication`; the concrete broker/HTTP call is a marked `TODO`. Delivers the differentiator (each template emits structurally distinct, compiling, lint-valid code) at a tractable size. **C2** (runnable in-memory bus / local HTTP) is a deliberate follow-up — it bakes in runtime choices and is out of scope here.

## Decision D — event/DTO contract source _(resolved: D1)_

The manifest's `bounded_contexts` don't carry event/DTO names today (`wizardToManifest` maps entities / VOs / use-cases / ports / adapters, **not** `domainEvents`). **D1:** map the **provider's** `domainEvents` (already a wizard field) into the manifest BC (one new array — small, additive) and name the generated contract(s) from them.

**Contract naming — locked (so fixtures can't drift from code):**

- **Declared `domainEvents`:** one contract per event, named `toPascalCase(domainEvent)` **verbatim** (no suffix) — e.g. `InvoiceIssued`, `PaymentReceived`.
- **Fallback (no `domainEvents` declared):** a single generic contract derived from the **provider context name only — _not_ the use-case name**: `${ProviderPascal}Event` (event-bus); `${ProviderPascal}Request` + `${ProviderPascal}Response` (network). One contract **per provider**, deduped across multiple edges into the same provider.
- **`ProviderPascal`** = the provider context name PascalCased to a valid TS identifier (split on non-alphanumerics, capitalize each segment), reusing the `toPascalCase` helper in `packages/sync/src/generators/architecture-files.ts`. e.g. `billing → Billing`, `order-management → OrderManagement`.

Rationale for the context-name-only fallback: it's a deterministic _placeholder_ the user refines by declaring real `domainEvents`. Folding in use-case names would need use-cases to exist (a second fallback layer), multiply the contract into N-per-use-case ports, and make fixtures depend on use-case config — the exact drift this locks out. Granularity comes from `domainEvents`, not the fallback.

(D2 — generic-per-edge with no manifest change — rejected: it can't name real events even when the user declared them.)

## Steps

### 3a — manifest enrichment + event-bus (`wizard-orchestration` + dedicated emitter)

1. **Manifest enrichment — done.** `deriveCrossContextEdges` in `wizardToManifest`: when `crossContextCalls === "event-bus"`, each peer edge makes the **provider** a publisher (`message-publisher` out-port + adapter) and the **consumer** a subscriber (`event-listener` in-port + adapter), merged into each context's `layers`; the edges are emitted as a top-level `cross_context` array (omitted when empty, so in-process output is byte-identical). Per D1, an edge's `events` are the provider's `domainEvents` (PascalCased) or the `${Provider}Event` fallback.
2. **Dedicated emitter — next.** A `packages/sync` generator (modeled on `architecture-files.ts`) reads `cross_context` and writes the **bespoke** publisher/subscriber port interfaces + the shared event contracts into `shared`; `generateAdapterFromPort` then derives the adapters. Ordered before `generateStubs` in `SyncEngine.run`.
3. Tests: ✅ manifest enrichment (provider publishes / consumer subscribes; D1 events + fallback; dedup; in-process byte-identical). Pending: the emitter produces recognizable publisher/subscriber code + the shared contract.

### 3b — network (micro-frontend)

5. Same derivation for `crossContextCalls === "network"`: consumer `external-service-client` out-port + adapter, provider `rest-controller` in-port + handler, DTOs in `shared`.
6. Tests: a micro-frontend edge emits client/controller; a direct assertion that **strict-enterprise and micro-frontend now diverge** in generated transport (the Decision A1 payoff).

### 3c — integrationPattern (ACL / OHS) + invariant honesty

7. Map `integrationPattern`: `acl` → ACL adapter shape on the consumer; `open-host` → published-language port on the provider.
8. Run the arch-linter on a generated strict project in tests and assert it passes — no `deny_direct_imports` violation, communication present — so the `required_communication` invariant Phase 1 emits now guards real code.

## Risks

- **Contract placement in `shared`.** Putting cross-context DTOs / the bus port in the shared kernel keeps the no-direct-dep rule intact but grows `shared`. Acceptable — it's the conventional shared-kernel role; a generated messaging package is heavier and deferred.
- **Stub bodies vs the arch-linter.** C1 bodies are `TODO`/throw; confirm the arch-linter checks structure (ports, no sibling import), not behaviour, so stubs pass. (Phase 1's `layer-rules.yaml` is import/structure rules — they should.)
- **`generateAdapterFromPort` fidelity.** It derives the adapter from the port interface; verify it handles the publisher/client port signatures cleanly, else fall back to a per-kind template.
- **Scope creep toward C2.** Keep the broker / HTTP runtime out — C1 is structure only.

## Out of scope

- C2 (runnable in-memory bus / local HTTP transport).
- Per-edge transport override (e.g. a `networked` peer-mapping inside a modular-monolith template) — transport stays template-level for now.
- New broker / framework choices baked into the generated project.

## Suggested split

- **3a** — event-bus + the `deriveCrossContextPorts` seam + Decision D wiring (self-contained; the bulk).
- **3b** — network (reuses 3a's seam) — delivers strict-enterprise ≠ micro-frontend.
- **3c** — ACL/OHS shaping + the arch-linter-passes test (depends on 3a/3b).
