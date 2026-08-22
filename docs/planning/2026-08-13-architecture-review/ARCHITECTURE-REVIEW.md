# Architecture Review — HexaGen Monaco

**Mode:** Review & Archeology (read-only). No source was modified except these
review artifacts.

| Artifact            | Role                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `inventory.json`    | Phase 0 ground truth (workspace graph, classifications, metrics) |
| `findings.json`     | Reconciled findings (64), full schema                            |
| `BACKLOG.md`        | Topologically ordered, PR-sized work items                       |
| `ADR-CANDIDATES.md` | Decisions required before code moves                             |
| `COVERAGE.md`       | What was reviewed, sampled, and skipped                          |

**Orchestrator verification.** Every defect sentence in the executive summary
cites a finding ID present in `findings.json`. The coupled-finding graph is
an exact copy of `depends_on` edges (30/30). A6 drafted this report; the
web `tsconfig` row below was corrected against `apps/web/tsconfig.json:12-14`
(`lib` and `jsx` are set — inventory JSONC parse had dropped them).

---

## Executive summary

Phase 2 reconciled 64 findings (0 unevidenced) across hexagonal boundaries,
god-structures, React decomposition, and toolchain coherence. Generated
customer domain ports bind `Result`’s error channel to infrastructure
`FireflyError` / `LLMError`, so the emitted domain cannot compile without
adapter modules (HEX-001). Application use cases perform Node filesystem I/O
and browser DOM / `fetch` / `html-to-image` I/O instead of driving outbound
ports (HEX-002, HEX-014, HEX-015). Manifest HTTP routes and the TUI construct
adapters, domain factories, and `InMemoryTransactionManager` instead of
invoking a pre-wired inbound port (HEX-003, HEX-010, HEX-016, HEX-017).
Homonymous ports have incompatible contracts across contexts:
`ManifestGenerationPort`, `ProjectConfigurationReadPort`, `FileSystemPort`,
and `SecretVaultPort` (HEX-005, HEX-006, HEX-007, HEX-008). Domain catalogs
hard-code vendor HTTP endpoints, API-key env names, LLM prompt literals, and
R-rule text (HEX-011, HEX-012). Sync-generated `export {}` barrels advertise
unused hexagonal layers, and `@hexagen/security` is a hexagonal package
outside `bounded_contexts` (HEX-025, HEX-009). The declared floor is
TypeScript `^5.4.5` / Vitest (ADR-0044) / Node `>=22.7.0`, but
`@hexagen/agentic-interaction` pins TypeScript `^6.0.3`, Jest leftovers
remain, and `@hexagen/arch-linter` still runs `node:test` (MOD-001, MOD-002,
MOD-003).

---

## Toolchain floor

Passed verbatim to every Phase 1 agent. Do not propose features above this
without `requires_toolchain_raise`.

| Item                                               | Value                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (declared / installed)                  | `^5.4.5` / `5.9.3`                                                                                                                                                                                                        |
| Base `compilerOptions` (`tsconfig.base.json`)      | `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`; `lib` / `jsx` unset (lib follows target → ES2022)                                                                                        |
| Web `compilerOptions` (`apps/web/tsconfig.json`)   | `lib: ["dom", "dom.iterable", "esnext"]`, `jsx: "preserve"`, `moduleResolution` inherited `bundler`                                                                                                                       |
| Outlier: `packages/sync`                           | `module` / `moduleResolution: NodeNext`, `target: es2022`, bundler `tsup` (ADR-0009)                                                                                                                                      |
| Outlier: `packages/security`                       | `module` / `moduleResolution: Node16`, `target: ES2022`, `lib: [ES2022]`                                                                                                                                                  |
| Outlier: `apps/tui`                                | `module` / `moduleResolution: NodeNext`, `jsx: react-jsx`                                                                                                                                                                 |
| Outlier: `packages/ai-pipeline/tsconfig.test.json` | `module: commonjs`, `moduleResolution: node`                                                                                                                                                                              |
| Node engines                                       | root `>=22.7.0`; `@hexagen/sync` `>=20`; `@hexagen/arch-linter` `>=20`                                                                                                                                                    |
| CI Node                                            | `capstone.yml` / `sync-integrity.yml` `22.7`; `publish.yml` `22.12.0`; `deploy.yml` docker (no setup-node); `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`                                                                    |
| React / React DOM                                  | `^19.2.4` / installed `19.2.4`                                                                                                                                                                                            |
| Next.js                                            | `^16.1.6` / installed `16.1.6`; webpack (`next dev --webpack` / `next build --webpack`; ADR-0000)                                                                                                                         |
| Package manager                                    | `yarn@4.12.0`                                                                                                                                                                                                             |
| Turbo                                              | `^1.13.3` (`build`, `lint`, `test`, `@hexagen/sync#test`, `typecheck:test`, `dev`, `typecheck`)                                                                                                                           |
| Test runner                                        | Vitest `^4.1.9` / `4.1.9` (ADR-0044)                                                                                                                                                                                      |
| Lint                                               | ESLint `^8.57.0`, `typescript-eslint` `^8.57.0`, `yarn lint:arch` → `@hexagen/arch-linter`, `@hexagen/eslint-plugin-ui`                                                                                                   |
| Allowed without raise                              | ES2022 syntax; TS 5.4/5.5 `satisfies` / const type params; Node 22 `fetch` / `glob` / `require(esm)` (repo uses Vitest — do not switch); React 19 / Next 16 App Router                                                    |
| Requires raise                                     | ES2024 `Object.groupBy` / `Promise.withResolvers` types → `lib` ES2024; ES2025 iterator / Set types → `lib` ES2025; TS 5.7+ compiler flags → declared `typescript` `^5.7`; `using` emit → raise `lib` and confirm bundler |

---

## Conformance scorecard

`layer-rules.yaml` states domain `internal-only` (shared kernels plus
`@hexagen/project-configuration`), application `ports-only` (domain +
`@hexagen/shared` + `@hexagen/core-domain`), and documented composition-root /
driver-slice exceptions for `architecture-graph.ts`,
`apps/web/app/lib/wire.ts`, and `apps/web/features/llm-driver/`. Scores
measure live conformance against those rules and the findings, not the
existence of the rules file.

| Axis                                              | Rating  | Score /10 | Finding IDs                                                                     |
| ------------------------------------------------- | ------- | --------- | ------------------------------------------------------------------------------- |
| Port single-ownership                             | Fail    | 3         | HEX-005, HEX-006, HEX-007, HEX-008                                              |
| Domain purity (no infra/framework)                | Fail    | 4         | HEX-001, HEX-011, HEX-012, HEX-026, HEX-027, HEX-028, HEX-030, HEX-032, HEX-038 |
| Application ports-only                            | Fail    | 3         | HEX-002, HEX-004, HEX-010, HEX-013, HEX-014, HEX-015, HEX-021, HEX-023, HEX-026 |
| Composition-root integrity                        | Fail    | 3         | HEX-003, HEX-010, HEX-016, HEX-017, HEX-019, HEX-020, HEX-033, HEX-034          |
| Empty-barrel / layer honesty                      | Fail    | 4         | HEX-009, HEX-018, HEX-025, HEX-033, HEX-035, HEX-036, HEX-037                   |
| UI presentation-only (DESIGN.md)                  | Partial | 5         | HEX-022, HEX-030, HEX-031, REA-001, REA-002, REA-003                            |
| Toolchain coherence (ADR-0044 / TS pin / engines) | Partial | 4         | MOD-001, MOD-002, MOD-003, MOD-004, MOD-005, MOD-006                            |

**Overall hexagonal score: 4 / 10.** The first five rows are the hexagon;
they average about 3.4. Domain is discernible (`@hexagen/core-domain` MVK,
345 files under `src/domain/`) and ports exist, but ownership collisions,
application I/O, and routes that bypass `wire.*` are systemic rather than
isolated. UI and toolchain rows lift the blended score to 4 because
`@hexagen/ui` and the declared floor are real, even while DESIGN.md and
ADR-0044 are locally violated.

God-structure and React axes are scored in the findings, not as a second
hexagon: the worst gods are the staged-generation use-case (GOD-001) and
the web generation/export hooks (GOD-003–GOD-006). They are decomposition
work that **depends on** port identity (see graph), not a reason to split
adapters to satisfy file length.

---

## Findings by axis

### Hexagonal

**HEX-001** — critical — Generated customer domain ports import infrastructure error types.
Type-only `FireflyError` / `LLMError` imports still name adapter modules from `src/domain/ports`; customer domain cannot compile without vendor error types. The comment claiming “deliberate decoupling” is inverted.
Evidence: `packages/template-engine/templates/adobe-creative-production/files/src/domain/ports/out/creative-production.port.ts:1-4`

**HEX-002** — critical — `GenerateProjectUseCase` performs Node filesystem I/O instead of a driven port.
Application imports `node:fs/promises` and `node:path` while also injecting generator/exporter/materializer ports, so generation cannot be exercised without a real filesystem.
Evidence: `packages/project-generation/src/application/generate-project-use-case.ts:17-20`

**HEX-003** — critical — Manifest generate HTTP routes compose adapters, domain factories, and transaction infra.
`generate` / `local` / `spec` / `stage` routes `new` `EnvironmentSecretVaultAdapter`, `LLMProviderSelectorAdapter`, and `InMemoryTransactionManager`, bypassing `wire.server.ts`.
Evidence: `apps/web/app/api/manifest/generate/route.ts:9-17`

**HEX-004** — high — Application ports and mappers are typed on `@hexagen/sync` Manifest.
Generation and wizard contracts cannot compile without the sync CLI package even though Manifest schema is owned by `project-configuration`.
Evidence: `packages/project-generation/src/application/ports/out/external-project-generator.port.ts:1-3`; `packages/wizard-orchestration/src/application/wizard-to-manifest.ts:1-10`

**HEX-005** — high — `ManifestGenerationPort` is owned by two contexts with incompatible contracts.
Same type name, different methods (`execute` vs `generateTopology` / `generateAdapters` / `generateManifestPipeline`); no shared type identity.
Evidence: `packages/manifest-generation/src/application/ports/in/manifest-generation.port.ts:22-26`; `packages/mcp-server/src/application/ports/out/manifest-generation.port.ts:56-60`

**HEX-006** — high — `ProjectConfigurationReadPort` is independently declared in three packages.
Three type identities for one `getManifest()` capability; consumers can implement the wrong copy.
Evidence: `packages/project-configuration/src/application/ports/out/project-configuration-read.port.ts:4-8`; `packages/mcp-server/src/application/ports/out/project-configuration-read.port.ts:4-6`; `packages/sync/src/application/ports/out/project-configuration-read.port.ts:4-8`

**HEX-007** — high — `FileSystemPort` is declared twice with disjoint APIs.
`project-configuration` exposes `readFile` / `mergeManifests`; `sync` exposes `exists` / mkdir-style operations. The two ports are not substitutable; HEX-002 must not silently reuse the wrong one.
Evidence: `packages/project-configuration/src/application/ports/out/file-system.port.ts:1-4`; `packages/sync/src/application/ports/out/file-system.port.ts:9-16`

**HEX-008** — high — Two incompatible `SecretVaultPort` contracts in one package.
Domain `getSecret(envVarName)` and application `getStatus(): Promise<Result<VaultStatus, VaultError>>` share a name; the barrel can export the wrong type.
Evidence: `packages/agentic-interaction/src/domain/provider-config.ts:42-48`; `packages/agentic-interaction/src/application/ports/out/secret-vault-port.port.ts:12-16`

**HEX-009** — high — `@hexagen/security` is a hexagonal package outside manifest `bounded_contexts`.
`ISecretScanner` exists only in `packages/security`; `manifest.yaml` has no security context and `tsconfig.base` omits the package (see also MOD-005).
Evidence: `packages/security/src/application/ports/in/secret-scanner.port.ts:10-15`; `.architecture/manifest.yaml:200-208`

**HEX-010** — high — Application use-case constructs `InMemoryTransactionManager` instead of requiring its port.
`GenerateManifestFromDescriptionUseCase` compiles against a concrete infrastructure adapter and defaults `transactionManager ?? new InMemoryTransactionManager()`; routes then construct another instance (HEX-003).
Evidence: `packages/agentic-interaction/src/application/use-cases/generate-manifest-from-description.use-case.ts:18-44`

**HEX-011** — high — LLM prompt strings, retry policy, and R-rule text live in domain _(also god-structure)_.
Domain owns Stage-0 system prompts and R01–R18 wording that must stay aligned with `structuralManifestErrors` in the 3059-line use-case; `@hexagen/prompt-compiler` already owns application prompt ports.
Evidence: `packages/agentic-interaction/src/domain/prompts/generate-manifest.prompt.ts:76-84`

**HEX-012** — high — Domain catalogs hard-code vendor HTTP endpoints and API-key env names.
`CLOUD_PROVIDERS` and `createDefaultFallbackChain` embed `https://api.openai.com/v1` and `OPENAI_API_KEY`; `wire.server.ts` duplicates another fallback chain (HEX-020).
Evidence: `packages/local-llm/src/domain/cloud-provider-catalog.ts:52-58`; `packages/agentic-interaction/src/domain/provider-config.ts:73-81`

**HEX-013** — high — Refactoring impact port and use-case are bound to ts-morph.
`SymbolReferenceProviderPort` returns `SourceFile`; the use-case also `new Project()` and imports `SyntaxKind`, so every consumer must import the compiler host.
Evidence: `packages/sync/src/application/ports/out/symbol-reference-provider.port.ts:1-10`; `packages/sync/src/application/use-cases/refactoring-impact.use-case.ts:1-5`

**HEX-014** — high — `ValidateTemplatesUseCase` talks to `node:fs` and `process.env`.
The use-case ignores `FileEmitterPort` and probes disk/env directly.
Evidence: `packages/template-engine/src/application/use-cases/validate-templates.use-case.ts:1-4`

**HEX-015** — high — `ExportGraphImageUseCase` performs DOM, fetch, and html-to-image I/O.
The inbound-port implementer dynamically imports `html-to-image` and calls `document.querySelector`; application is bound to the browser renderer. (Use case may still implement the inbound port; I/O belongs on an outbound adapter.)
Evidence: `packages/visualization/src/application/use-cases/export-graph-image.ts:8-17`

**HEX-016** — high — Governance refresh route owns shell lint, filesystem, YAML parsing, and LLM adapter construction.
The HTTP handler `exec`s `yarn lint:arch`, reads/writes files, parses YAML, and `new`s `ServerLLMAdapter`.
Evidence: `apps/web/app/api/governance/refresh/route.ts:2-6`

**HEX-017** — high — TUI inlines LLM HTTP, MCP SDK, and filesystem watch instead of driving ports.
`LocalLLMProviderAdapter` inside `action-service.ts` `fetch`es OpenAI directly even though the package already depends on `@hexagen/agentic-interaction`.
Evidence: `apps/tui/src/services/action-service.ts:45-50`

**HEX-018** — high — Driven ports are parked under `application/ports/in` across multiple packages.
Comments assign implementation to infrastructure (scanner, semantic patch, evaluator) while use cases depend on those “in” ports; monaco/wizard `infrastructure/` barrels are `export {}`.
Evidence: `packages/security/src/application/use-cases/secret-sanitization.use-case.ts:8-16`; `packages/monaco-orchestration/src/application/ports/in/apply-semantic-patch.port.ts:1-8`; `packages/wizard-orchestration/src/infrastructure/index.ts:1-1`

**HEX-019** — high — MCP inbound adapters depend on concrete use-case classes, not inbound ports.
`MCPServerAdapterDependencies` types 25 concrete `*UseCase` classes; `domain/index.ts` is an empty barrel.
Evidence: `packages/mcp-server/src/infrastructure/adapters/mcp-server.types.ts:1-6`

**HEX-020** — high — Web composition roots encode discard policy and LLM fallback rules _(also god-structure)_.
`buildStagedGenerationFallbackChain` in `wire.server.ts` hard-codes provider order, model, temperature, and `OPENAI_API_KEY`; discard orchestration lives in `wire.client` subscribe handlers.
Evidence: `apps/web/app/lib/wire.server.ts:223-232`

**HEX-021** — high — Visualization application inbound API is typed on project-configuration `WizardData`.
`GenerateHexagonalMapInput.wizardData` imports a package excluded from application `allowed_imports`; the only granted exception is `architecture-graph.ts`.
Evidence: `packages/visualization/src/application/ports/in/generate-hexagonal-map.port.ts:1-8`

**HEX-022** — high — `ModelSettingsView` owns cache probes, hardware recommend, and semantic loading state _(also react-decomposition)_.
Props include `hasModelInCache` and `isLoading`; the view imports the `@hexagen/local-llm` root barrel (re-exports infrastructure); `application/` is `export {}`. DESIGN.md forbids `isLoading` on presentation components.
Evidence: `packages/model-settings/src/ui/ModelSettingsView.tsx:21-27`; `packages/model-settings/src/application/index.ts:1-3`

**HEX-023** — medium — `PersistenceDomainRegistryPort` exposes concrete storage backends.
`getActiveBackend` returns `"localStorage" | "indexedDB"`; callers must reason about infrastructure products.
Evidence: `packages/shared/src/application/ports/persistence-domain-registry.port.ts:5-9`

**HEX-024** — medium — Model preferences talk to `localStorage` without an application port.
Public helpers call `window.localStorage` and return `null`/`false` instead of `Result`, even though model-preferences is already a `PersistenceDomain`.
Evidence: `packages/shared/src/infrastructure/adapters/model-preference-storage.ts:20-28`

**HEX-025** — medium — Sync-generated empty `export {}` barrels advertise unused hexagonal layers.
31 empty barrels under `packages/**/src`; `core-domain` real contracts live in `mvk/v1`; frozen scaffolds (`architectural-enforcement`, `code-generation`) plus persistence/deployment/runtime/ui/model-settings advertise empty layers. `transaction-system` is frozen but implemented — not a delete target.
Evidence: `packages/core-domain/src/domain/index.ts:1-3`; `packages/architectural-enforcement/src/domain/index.ts:1-4`; `packages/core-domain/src/index.ts:1-1`

**HEX-026** — medium — YAML parse/dump lives in application and domain instead of a codec port.
`js-yaml` is bound into wizard application mapping and manifest-generation domain parsing.
Evidence: `packages/wizard-orchestration/src/application/manifest-parser.ts:1-7`; `packages/manifest-generation/src/domain/services/manifest-view-data-parser.ts:1-4`

**HEX-027** — medium — Template-engine domain imports `node:path`.
`conflictFilePath` and `isContainedRelativePath` bind domain safety rules to Node path APIs.
Evidence: `packages/template-engine/src/domain/conflict-path.ts:1-2`

**HEX-028** — medium — local-llm domain ports and VOs encode WebLLM / WebGPU / IndexedDB mechanics.
`hasModelInCache` documents IndexedDB / Cache API / worker / WebLLM utilities; `WebGPUCapability` carries GPU handles. Only a WebLLM adapter can honor that wording.
Evidence: `packages/local-llm/src/domain/ports/local-llm-provider.port.ts:54-59`; `packages/local-llm/src/domain/ports/webgpu-detector.port.ts:3-12`

**HEX-029** — medium — prompt-compiler infrastructure adapter owns `ChatMessage` and `GovernancePayload` types.
Conversation/governance shapes live next to the adapter; `@hexagen/local-llm` already has a domain `ChatMessage` VO.
Evidence: `packages/prompt-compiler/src/infrastructure/adapters/app-compatibility.adapter.ts:123-127`

**HEX-030** — medium — Domain hexagon node carries React Flow and CSS presentation fields.
`NodeVisualProps` and `extent?: "parent"` fuse graph identity with renderer tokens.
Evidence: `packages/visualization/src/domain/model/hexagon-node/hexagon-node.ts:48-61`

**HEX-031** — medium — Several `@hexagen/ui` public props skip `NoSemanticState`.
DESIGN.md §3.4 requires every `@hexagen/ui` prop type to extend `NoSemanticState<T>`; Dialog, Tabs, Accordion, Skeleton, and CopyButton do not.
Evidence: `packages/ui/src/sections/Dialog.tsx:8-17`

**HEX-032** — medium — intent-compiler topology invariants live in an infrastructure adapter.
`ValidateTopologyUseCase` is a pass-through; acyclic / containment / degree / connected live in `TopologyValidatorAdapter` while domain only holds Gesture/Rejection bags. Runtime already has topology-invariant-guards.
Evidence: `packages/intent-compiler/src/application/use-cases/validate-topology.use-case.ts:5-10`

**HEX-033** — medium — api-gateway is a stub Fastify app that never drives declared package ports.
The only route returns `{ root: true }`; `@hexagen/messaging`, `@hexagen/project-configuration`, and `@hexagen/shared` are declared and never imported.
Evidence: `apps/api-gateway/routes/root.js:1-6`; `apps/api-gateway/package.json:11-16`

**HEX-034** — medium — LLM context route merges the workspace manifest and encodes port-ownership rules inline.
The route imports `project-configuration/server` and `@hexagen/sync` `portName`, then hardcodes governance invariants.
Evidence: `apps/web/app/api/llm/context/route.ts:1-4`

**HEX-035** — medium — `tsconfig.base` references omit six workspace packages that exist on disk.
Missing: `ai-pipeline`, `byok`, `llm-driver`, `manifest-generation`, `model-settings`, `security`.
Evidence: `tsconfig.base.json:19-28`

**HEX-036** — medium — Generated `AgentRuntimePort` is declared inside infrastructure.
Customer inbound port lives next to Zod HTTP envelopes in the Bedrock runtime adapter.
Evidence: `packages/template-engine/templates/bedrock-agentcore-runtime/files/src/infrastructure/agentcore/runtime/payload.ts:42-50`

**HEX-037** — low — project-configuration infrastructure stubs are named as ports without implementing owned interfaces.
`GitProviderPortAdapter` is an empty class; `GitProviderPort` / `AIProviderPort` / `PreviewProviderPort` are not declared in this package’s `application/ports`.
Evidence: `packages/project-configuration/src/infrastructure/external-apis/git-provider-port.adapter.ts:1-2`

**HEX-038** — medium — sync domain stub resolver imports composition-root config and template-engine.
`domain/services` depend on `SyncConfig` (logger + journal) and a `template-engine` re-export.
Evidence: `packages/sync/src/domain/services/stub-template-resolver.ts:10-14`

### God-structure

**GOD-001** — high — Structured-config use-case owns parse, dialect, mapping, R01–R09 gate, and stage orchestration.
3059 loc / cyclomatic complexity 238; 20+ tests import mapping/gate helpers from the use-case file, so parse and the repair gate cannot be exercised without constructing six LLM stages. Flagged for **four responsibilities**, not length.
Evidence: `packages/agentic-interaction/src/application/use-cases/staged-generation/execute-structured-config-generation.use-case.ts:2037-2047`

**GOD-002** — high — arch-linter index is CLI entry, library barrel, and inline layer-policy engine.
`package.json` sets both `bin` and `main` to `dist/index.js`; importing the library executes `checkArchitecturalIntegrity()` and can `process.exit(1)`.
Evidence: `tools/arch-linter/src/index.ts:522-528`

**GOD-003** — high — `ImportProjectSpecPage` owns classification, session persistence, generation orchestration, accept rewrite, and step UI.
The page binds Next router, `sessionStorage`, three generation hooks, pending-manifest store, wizard-orchestration parse, and five step components.
Evidence: `apps/web/features/manifest-generation/ImportProjectSpecPage.tsx:64-67`

**GOD-004** — high — `ExportProvider` mixes ZIP / GitHub / editor-push I/O, IDB persistence, import-manifest policy, and dialog state _(also react-decomposition)_.
ZIP consumers subscribe to GitHub dialog/auth; `githubLink` load is duplicated in `useEditorPush`.
Evidence: `apps/web/app/contexts/ExportContext.tsx:92-101`

**GOD-005** — high — `useStagedGenerationStream` owns HTTP transport, NDJSON protocol, reconnect/timeout, and React view-model.
Spec and description hooks both inherit this mix; protocol changes recompile both.
Evidence: `apps/web/features/manifest-generation/useStagedGenerationStream.ts:281-286`

**GOD-006** — high — `useStagedSpecGeneration` owns engine policy, local pipeline, cloud stream, view-model, and GitOps PR.
One hook is the only surface for `ImportProjectSpecPage` generation and `/api/gitops/propose-pr`.
Evidence: `apps/web/features/manifest-generation/useStagedSpecGeneration.ts:568-573`

**GOD-007** — high — `usePlanningSession` owns the chat loop, persist/reconcile control, and finalize-distill UI.
One long-lived hook owns `generationRef`, `pendingAppendRef`, `distillAbortRef`, `streamChatTurn`, and `FinalizeUiState`.
Evidence: `apps/web/features/workspace-shell/plan-phase/session/usePlanningSession.ts:516-520`

**GOD-008** — medium — `wizardToManifest` composes context mapping, apps topology, transport edges, and scaffold defaults.
Package-manager pins and turbo pipeline change for scaffold policy while `deriveApps` changes for template rules.
Evidence: `packages/wizard-orchestration/src/application/wizard-to-manifest.ts:403-411`

**GOD-009** — medium — Port-mapping use-case owns LLM I/O, NDJSON salvage parse, and port/mapping policy.
Mapping tests must instantiate the use-case to reach `extractJsonObjects` / coerce.
Evidence: `packages/agentic-interaction/src/application/use-cases/staged-generation/execute-port-mapping.use-case.ts:181-186`

**GOD-010** — medium — OpenAI manifest adapter is HTTP client, draft pipeline, and write/event side effects.
Application sequencing, I/O, and writes sit behind `ManifestGenerationPort` (HEX-005); the adapter registers bounded contexts and publishes events.
Evidence: `packages/mcp-server/src/infrastructure/adapters/manifest-generation.adapter.ts:36-42`

**GOD-011** — medium — IDB saved-projects adapter mixes CRUD, layer salvage, and legacy provenance inference.
The persistence adapter imports `js-yaml` and the wizard-emitted port-name catalog.
Evidence: `apps/web/app/lib/adapters/idb-saved-projects.adapter.ts:306-308`

**GOD-012** — medium — `useStagedManifestGeneration` duplicates local-pipeline + cloud-stream + view-model ownership.
Parallel god to GOD-006: same stream hook, same progress cells, different client use-case.
Evidence: `apps/web/features/manifest-generation/useStagedManifestGeneration.ts:101-104`

### React-decomposition

**REA-001** — high — `GovernanceAssistantPanel` fetches, owns two LLM transports, and renders Q&A.
Q&A re-renders on engine / cloud / vault / capability changes because transport and presentation share one component.
Evidence: `apps/web/features/governance-assistant/GovernanceAssistantPanel/GovernanceAssistantPanel.tsx:79-87`

**REA-002** — high — Local-mode lifecycle is six overlapping boolean props.
Callers can set multiple `show*` flags; children re-decode mutually exclusive engine states.
Evidence: `apps/web/features/governance-assistant/GovernanceAssistantPanel/types.ts:83-88`

**REA-003** — high — `CodeView` both generates files and renders the explorer.
Explorer UI cannot render or be tested without `useProjectGeneration` / ZIP download hooks.
Evidence: `apps/web/features/code-view/CodeView.tsx:52-61`

**REA-004** — medium — `useCanvasState` mixes store subscription, graph derivation, and mutations.
Any layout I/O tick re-renders mutation callers; wizard→graph derivation is not a pure compile.
Evidence: `apps/web/features/hexagon-canvas/hooks/useCanvasState.ts:216-224`

**REA-005** — medium — Imported-manifest payload mapping is copied in three features.
Export, generate, and architecture-ZIP can diverge on the same fail-closed imported-vs-wizard invariant.
Evidence: `apps/web/app/contexts/ExportContext.tsx:232-241`; `apps/web/features/code-view/hooks/useProjectGeneration.ts:43-50`

**REA-006** — medium — Server model names are fetched and mapped in two sibling views.
Panel footer and settings card can show different names; duplicate `getCapabilities()` client fetch.
Evidence: `apps/web/features/governance-assistant/GovernanceAssistantPanel/LocalModeSettingsView.tsx:44-50`

### Modernization

**MOD-001** — high — `agentic-interaction` ships TypeScript `^6.0.3` against the repo floor (`^5.4.5` / installed `5.9.3`).
Only this workspace declares a second compiler; `@types/node` is `^20` vs root `^22.19.0`. Workspace typecheck can pass on TS 6 while CI’s 5.9.3 fails, or the reverse.
Evidence: `packages/agentic-interaction/package.json:51-58`; `package.json:69-75`

**MOD-002** — high — arch-linter still runs `node:test`; ADR-0044 made Vitest the monorepo runner.
Five `from "node:test"` files, all under `tools/arch-linter/__tests__`; Vitest config, shared setup, and coverage do not apply to the linter that gates the rest of the repo.
Evidence: `tools/arch-linter/package.json:28-33`

**MOD-003** — high — Jest leftover after ADR-0044: live jest configs/deps plus a root `jest.setup.js`.
`test:jest` can still execute a second, stale suite; root `jest.setup.js` will throw if loaded under Vitest.
Evidence: `packages/agentic-interaction/package.json:31-35`; `jest.setup.js:1-6`

**MOD-004** — medium — Published packages advertise Node `>=20` while the repo/CI floor is `>=22.7.0`.
CI is Node 22.7 / 22.12 (ADR-0036 assumes Node 22); npm will not refuse Node 20 installs of `hexagen` / `hexagen-lint`.
Evidence: `packages/sync/package.json:6-9`; `tools/arch-linter/package.json:6-9`

**MOD-005** — medium — `@hexagen/security` is Node16 / ESM-with-`.js` while the monorepo floor is bundler.
Does not extend `tsconfig.base.json`; `main` points at `src/index.ts`; Node16 requires `.js` specifiers at emit time while bundler consumers resolve `.ts` source.
Evidence: `packages/security/tsconfig.json:1-8`

**MOD-006** — medium — `ai-pipeline` `tsconfig.test.json` is CommonJS + `@types/jest` while the package is ESM Vitest.
Only `commonjs`/`node` test config in the repo; tests import from `vitest`, so CJS + Jest types will mis-type `import.meta` and Vitest globals.
Evidence: `packages/ai-pipeline/tsconfig.test.json:1-10`

**MOD-007** — medium — catch-and-rethrow stringifies the original error and drops `Error.cause`.
`Error.cause` is in the ES2022 floor; the same repo already uses `{ cause }` in `idb-saved-projects.adapter.ts`. Stack, errno, and nested fetch failures are lost.
Evidence: `apps/web/app/lib/manifest-generation/capability-cache.ts:52-57`

**MOD-008** — medium — Retry helper wraps an already-thenable in `new Promise` and can hang if the inner call throws.
No reject path; a sync throw inside `setTimeout` is unhandled and the outer Promise stays pending.
Evidence: `packages/llm-driver/src/application/use-cases/cloud-connection.use-case.ts:113-126`

---

## Coupled finding graph

`A → B` means A is blocked by B (exact `depends_on` from `findings.json`).

- HEX-002 → HEX-007
- HEX-003 → HEX-010
- HEX-008 → HEX-012
- HEX-014 → HEX-007
- HEX-016 → HEX-003
- HEX-017 → HEX-012
- HEX-018 → HEX-009
- HEX-019 → HEX-018
- HEX-020 → HEX-012
- HEX-024 → HEX-023
- HEX-034 → HEX-003
- HEX-034 → HEX-006
- HEX-035 → HEX-009
- HEX-036 → HEX-001
- GOD-001 → HEX-011
- GOD-003 → GOD-006
- GOD-006 → GOD-005
- GOD-008 → HEX-004
- GOD-010 → HEX-005
- GOD-012 → GOD-005
- REA-002 → REA-001
- REA-004 → HEX-021
- REA-005 → GOD-004
- REA-005 → REA-003
- REA-006 → REA-001
- MOD-002 → GOD-002
- MOD-003 → MOD-001
- MOD-005 → HEX-009
- MOD-005 → MOD-004
- MOD-006 → MOD-003

Sequencing notes already on the graph: GOD-010 must wait for HEX-005 (do not
split the MCP manifest adapter until the port has a single owner); HEX-002 /
HEX-014 must wait for HEX-007 (do not silently reuse the wrong
`FileSystemPort`). Architecture integrity outranks decomposition aesthetics.

PR-sized execution order is in `BACKLOG.md`. Decisions that must precede
code are in `ADR-CANDIDATES.md`.

---

## What we did not treat as a smell

- **File length alone.** Phase 2 killed size-only / style-only modernization
  (`var`→`const`, `for`→`for-of`, `enum`→union without a correctness
  benefit). Long files appear here only when they also concentrate unrelated
  responsibilities (GOD-001’s parse + dialect + gate + stage orchestration,
  not the 3059-line count by itself).
- **Frozen-but-implemented `transaction-system`.** The empty-barrel /
  frozen-package conflict was merged as HEX-025:
  `architectural-enforcement` and `code-generation` are empty scaffolds;
  `transaction-system` is frozen but implemented and is not a delete target.
- **Documented `layer-rules.yaml` exceptions.** These are accepted leaks,
  not findings: `packages/visualization/src/domain/model/architecture-graph/architecture-graph.ts`
  (shared-kernel-level `BoundedContextTypeSchema` after Phase 4 schema
  migration); `apps/web/app/lib/wire.ts` (composition root; AR-9);
  `apps/web/features/llm-driver/` (driver-slice React hook + provider glue,
  not a separate workspace package).

---

Ready to move to Develop mode when you say `develop [feature]`.
