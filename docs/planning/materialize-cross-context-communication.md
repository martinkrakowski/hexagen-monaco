# Materialize Cross-Context Communication (Phase 3)

**Status:** Proposed — Decision C resolved → **C1** (interface-complete, body-stubbed). Decision D (event/DTO contract source) open.
**Date:** 2026-06-06
**Parent:** [`wire-architectural-template-into-generation.md`](./wire-architectural-template-into-generation.md) (Phase 3). Phases 1 (#235) + 2 (#236) shipped; the `generateApps` traversal guard shipped (#237). Decision A resolved → **A1** (keep all three templates, differentiate now).

## Goal

Make the architectural template produce **structurally different generated code** per `crossContextCalls`, so strict-enterprise (`event-bus`) ≠ micro-frontend (`network`) ≠ modular-monolith (`in-process`). Post Phase 1/2 the strict templates differ only in dropped `depends_on` + advisory `.architecture/invariants` YAML — **no transport is generated**. This phase makes the templates honestly distinct, and makes the `required_communication` invariant Phase 1 already emits enforceable against real code.

## Grounding — most of the machinery already exists

Like Phase 2 (which reused the apps generator), Phase 3 is **primarily manifest enrichment in `wizardToManifest`**, with `generateStubs` doing the file emission:

| Building block                                                                                                     | State today                                                                                                                       | Phase 3 use                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `peerMappings` `{ consumerContext, providerContext, integrationPattern: open-host \| acl, communicationBoundary }` | captured by the wizard; `wizardToManifest` uses them **only** for `depends_on`                                                    | the set of cross-context edges to scaffold transport for                          |
| manifest port vocabulary                                                                                           | in: `event-listener`, `rest-controller`, …; out: `message-publisher`, `external-service-client`, … (a fixed enum — already valid) | declare the transport ports per edge — **no schema change**                       |
| `generateStubs` / `generateAdapterFromPort` (`packages/sync`)                                                      | scaffolds a port file + an adapter that implements that port's interface                                                          | emit the publisher/subscriber/client/controller + adapter from the injected ports |
| `template.rules.crossContextCalls`                                                                                 | drives Phase 1 `depends_on` gating + the `.architecture` YAML                                                                     | drives **which** transport to scaffold                                            |
| `messaging` pkg `EventBusPort` (publish/subscribe) + `DomainEvent`                                                 | hexagen-monaco's own bus                                                                                                          | reference shape for the generated event-bus port                                  |

## Design

For a strict template, for each `peerMapping` edge (consumer → provider):

**`event-bus`** (strict-enterprise):

- consumer (publisher): out-port `message-publisher` + adapter (`generateAdapterFromPort` implements the publish interface; body is a `// TODO: publish via your broker` per C1).
- provider (subscriber): in-port `event-listener` + handler.
- shared event contract (DTO + bus port interface) lives in the **`shared` kernel** — both contexts already `depends_on` shared, so publisher/subscriber agree without a direct cross-context dep (preserving the strict no-sibling-import rule).

**`network`** (micro-frontend):

- consumer: out-port `external-service-client` + adapter (HTTP client; body `// TODO: call <provider> endpoint`).
- provider: in-port `rest-controller` + handler (endpoint stub).
- request/response DTOs in `shared`.

**`integrationPattern` shaping:** `acl` → the consumer adapter is an anti-corruption layer (translates the provider's contract to the consumer's domain); `open-host` → the provider exposes a published-language port.

modular-monolith (`in-process`) — unchanged (direct `depends_on` imports, as today).

## Decision C — transport realism _(resolved: C1)_

**C1 (chosen):** interface-complete, body-stubbed. Generate ports + port-derived adapters + event/DTO contracts, wired into package deps; the boundary compiles and satisfies the arch-linter's `required_communication`; the concrete broker/HTTP call is a marked `TODO`. Delivers the differentiator (each template emits structurally distinct, compiling, lint-valid code) at a tractable size. **C2** (runnable in-memory bus / local HTTP) is a deliberate follow-up — it bakes in runtime choices and is out of scope here.

## Decision D — event/DTO contract source _(open)_

The manifest's `bounded_contexts` don't carry event/DTO names today (`wizardToManifest` maps entities / VOs / use-cases / ports / adapters, **not** `domainEvents`). Event-bus/network contracts need names:

- **D1 (recommended):** map the provider's `domainEvents` (already a wizard field) into the manifest and name the contract(s) from them; fall back to a single generic `<Provider>Event` / `<Provider>Request` when none are declared. Small, additive (one array on the manifest BC + the mapping).
- **D2:** scaffold a single generic contract per edge regardless of `domainEvents` (no manifest change); enrich later.

## Steps

### 3a — manifest enrichment + event-bus (`wizard-orchestration`, reusing `generateStubs`)

1. Add a `deriveCrossContextPorts` step in `wizardToManifest`: when `templateRules.crossContextCalls === "event-bus"`, for each edge inject the publisher out-port + adapter (consumer) and the `event-listener` in-port + handler (provider) into the respective bounded contexts' `layers`.
2. Emit the shared event contract (DTO + bus port interface) into the `shared` kernel context.
3. (Decision D) map `domainEvents` into the manifest BC and name the contract(s) from them.
4. Tests: a strict-enterprise project with one edge emits the publisher/subscriber port + adapter referencing the shared contract; modular-monolith output is byte-identical; an edge-free project emits no transport.

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
