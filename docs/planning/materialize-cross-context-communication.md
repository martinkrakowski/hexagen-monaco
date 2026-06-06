# Materialize Cross-Context Communication (Phase 3)

**Status:** 3a (event-bus) shipped in #239. Decision C → **C1** (interface-complete, body-stubbed); Decision D → **D1** (provider `domainEvents`; context-name-only fallback); Decision E → **E1** (provider `useCases`; context-name-only fallback). Implementing 3b (network).
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

## Decision E — network request/response DTO source _(resolved: E1)_

The network analog of Decision D: what names the request/response DTOs (and the controller/client methods) the consumer calls on the provider? **E1 (chosen):** the **provider's** declared `useCases` — already a wizard field, `z.array(z.string())`, the same shape as `domainEvents`, already mapped into the manifest as `use_cases`. A REST endpoint _is_ an operation, and `useCases` is the operation vocabulary the wizard already captures, so it is the network-appropriate D1 analog (events : facts :: use-cases : operations). One operation per use-case.

**Contract naming — locked (so fixtures can't drift from code), mirroring D1:**

- **Declared `useCases`:** one operation per use-case, base name `toPascalCase(useCase)` verbatim (deduped). Each operation `<Op>` yields a `<Op>Request` + `<Op>Response` DTO pair in `shared`, and a controller/client method `<opCamel>(request: <Op>Request): Promise<<Op>Response>`.
- **Fallback (no `useCases` declared):** a single generic operation per provider, named from the **provider context name only** — base `${ProviderPascal}` → `${ProviderPascal}Request` + `${ProviderPascal}Response`, deduped per provider. The exact analog of D1's `${Provider}Event`.

**Why this is not in tension with D1.** D1's rationale _rejected_ folding use-case names into the **event-bus fallback** — for event-bus the correct primary vocabulary is `domainEvents` (facts), and use-cases there would be a wrong-shaped _second_ fallback that multiplies event contracts. For network, use-cases are the correct **primary** vocabulary (operations ≈ endpoints), with context-name as the single coarse fallback. Both phases follow one principle: granularity comes from the provider's declared vocabulary; the fallback is one context-named contract. (E2 — generic-per-edge with no `useCases` derivation — rejected for D2's reason: it can't name real operations even when the user declared them.)

**Verified before locking (the analyzer-fidelity risk below).** `generateAdapterFromPort` (ts-morph, single-file analysis) preserves a **single** unresolved cross-package import verbatim — so a network adapter's `request: <Op>Request` / `Promise<<Op>Response>` carry through _and are used_. (A **union** of unresolved imports collapses to `any`, which is why the event-bus publisher adapter's param is `any`; that asymmetry does not affect network's single-typed params.) The class-name argument must be a valid TS identifier — fixed in #239 (`a5f8fd10`): adapter class = `${toPascalCase(portBase)}Adapter`.

## Steps

### 3a — manifest enrichment + event-bus (`wizard-orchestration` + dedicated emitter)

1. **Manifest enrichment — done.** `deriveCrossContextEdges` in `wizardToManifest`: when `crossContextCalls === "event-bus"`, emit a top-level `cross_context` array of edges `{ consumer, provider, transport, events, integrationPattern }` (omitted when empty, so in-process output is byte-identical). Per D1, an edge's `events` are the provider's `domainEvents` (PascalCased) or the `${Provider}Event` fallback. The transport **ports/adapters are NOT injected into the manifest layers** — see step 2 for why.
2. **Dedicated emitter — done.** `generateCrossContext` (`packages/sync`, modeled on `architecture-files.ts`) reads `cross_context` and is the **sole writer** of the transport: bespoke publisher (`publish(event)`) / subscriber (`handle(event)`) port interfaces + shared event contracts in `shared`; `generateAdapterFromPort` derives the adapters from those bespoke ports. **Sole writer because** `generateStubs` would clobber the bespoke content under the web flow's `forceRoot` if the ports were declared in the layers (`safeWriteFileAtomic` only preserves hand-written files when `!forceRoot`) — so they're emitted directly and re-exported by the disk-based pass-2 barrels. Runs after `generateApps`, before the pass-2 barrels.
3. Tests: ✅ manifest enrichment (`cross_context` edges; D1 events + fallback; per-consumer edges; no ports in layers; in-process byte-identical) **+** ✅ emitter (`packages/sync` `cross-context.test.ts`: shared contracts, publisher port has a **real `publish` method — explicitly pinned as not the generic stub**, subscriber `handle`, derived adapters).

### 3b — network (micro-frontend) _(Decision E1)_

4. **Manifest enrichment.** `deriveCrossContextEdges` also handles `crossContextCalls === "network"`: each edge carries `operations` (the provider's use-case bases per E1) instead of `events`, with `transport: "network"`. The edge type becomes a discriminated union on `transport` (`{…, events}` | `{…, operations}`).
5. **Emitter.** `generateCrossContext` dispatches on `edge.transport`. For network edges it aggregates operations per provider/consumer and emits, as the sole writer:
   - `<Op>Request` + `<Op>Response` DTOs in `shared/src/domain/dtos/<Op>.dto.ts`;
   - provider in-port `RestControllerPort` (`rest-controller.in-port.ts`) — one `<opCamel>(request: <Op>Request): Promise<<Op>Response>` method per op — + `RestControllerAdapter`;
   - consumer out-port `ExternalServiceClientPort` (`external-service-client.out-port.ts`) — the mirror methods — + `ExternalServiceClientAdapter`.
     The port-content builder is generalized to multi-method / typed-return; 3a's single-method `publish`/`handle` becomes one case of it.
6. Tests: (a) wizard enrichment — network edges carry `operations` (useCases-derived + the `${Provider}` fallback); micro-frontend is no longer empty. (b) emitter — DTOs + controller/client ports with real multi-method signatures + derived adapters (single-typed params preserved, per the analyzer finding). (c) **divergence** — the same bounded contexts under event-bus vs network emit structurally different transport (publisher/subscriber vs client/controller), with neither leaking into the other (the Decision A1 payoff).

### 3c — integrationPattern (ACL / OHS) + invariant honesty

7. Map `integrationPattern`: `acl` → ACL adapter shape on the consumer; `open-host` → published-language port on the provider.
8. Run the arch-linter on a generated strict project in tests and assert it passes — no `deny_direct_imports` violation, communication present — so the `required_communication` invariant Phase 1 emits now guards real code.

## Risks

- **Contract placement in `shared`.** Putting cross-context DTOs / the bus port in the shared kernel keeps the no-direct-dep rule intact but grows `shared`. Acceptable — it's the conventional shared-kernel role; a generated messaging package is heavier and deferred.
- **Stub bodies vs the arch-linter.** C1 bodies are `TODO`/throw; confirm the arch-linter checks structure (ports, no sibling import), not behaviour, so stubs pass. (Phase 1's `layer-rules.yaml` is import/structure rules — they should.)
- **`generateAdapterFromPort` fidelity.** _Verified (see Decision E):_ it handles multi-method ports and preserves single imported types; only a union of unresolved cross-package types collapses to `any` (event-bus only). Its name argument is emitted verbatim as the class name, so it must be a valid identifier (`${toPascalCase(portBase)}Adapter`).
- **Scope creep toward C2.** Keep the broker / HTTP runtime out — C1 is structure only.

## Out of scope

- C2 (runnable in-memory bus / local HTTP transport).
- Per-edge transport override (e.g. a `networked` peer-mapping inside a modular-monolith template) — transport stays template-level for now.
- New broker / framework choices baked into the generated project.

## Suggested split

- **3a** — event-bus + the `deriveCrossContextPorts` seam + Decision D wiring (self-contained; the bulk).
- **3b** — network (reuses 3a's seam) — delivers strict-enterprise ≠ micro-frontend.
- **3c** — ACL/OHS shaping + the arch-linter-passes test (depends on 3a/3b).
