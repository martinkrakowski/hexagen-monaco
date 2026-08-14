# Remediation backlog

Topologically ordered. A work item may start only when every `depends_on`
finding (and every earlier item it names) is done or explicitly waived.

PR-sized means one bounded context or one app slice per item, unless the
item is an ADR (docs only).

Acceptance criteria are testable. Do not start an item whose ADR is still
open if the item lists an ADR.

Legend: **ADR** = decision first · **PKG** = package code · **WEB** = `apps/web`
· **TOOL** = toolchain.

---

## Wave 0 — Decisions (no production code)

| # | Item | Findings | ADR | Acceptance |
|---|------|----------|-----|------------|
| 0.1 | Accept or rewrite ADR-C1 (port ownership) | HEX-005, HEX-006, HEX-007 | C1 | ADR merged; owning package named per port |
| 0.2 | Accept or rewrite ADR-C2 (in/out folders) | HEX-018, HEX-019 | C2 | ADR merged; sync stub comments match |
| 0.3 | Accept or rewrite ADR-C3 (security BC) | HEX-009 | C3 | ADR merged; keep / fold / delete chosen |
| 0.4 | Accept or rewrite ADR-C4 (empty barrels) | HEX-025 | C4 | ADR merged; frozen-empty vs kernel-real distinguished |
| 0.5 | Accept or rewrite ADR-C5 (LLM catalog) | HEX-012, HEX-020 | C5 | ADR merged; single catalog owner named |
| 0.6 | Accept or rewrite ADR-C6 (TS pin) | MOD-001 | C6 | ADR merged; stay on 5.9.3 **or** scheduled raise |
| 0.7 | Accept or rewrite ADR-C7 (engines.node) | MOD-004 | C7 | ADR merged; 22.7-only **or** CI-on-20 |
| 0.8 | Accept or rewrite ADR-C8 (template errors) | HEX-001 | C8 | ADR merged; domain error union shape named |

---

## Wave 1 — Toolchain honesty (unblocks every later typecheck)

### 1.1 TOOL — Pin agentic-interaction to workspace TypeScript

- **Findings:** MOD-001
- **Depends on:** 0.6 (if C6 chose “stay on 5.9.3”; skip if C6 chose a raise)
- **Scope:** `packages/agentic-interaction/package.json` only
- **Acceptance:**
  - No `typescript` key under that package’s `devDependencies`, or it is
    `workspace:*` / the root range.
  - `yarn workspace @hexagen/agentic-interaction typecheck` uses the same
    `tsc` as `yarn typecheck` (verify with `yarn why typescript`).
  - Any new 5.9.3 errors are fixed in-package or listed as follow-ups —
    do not leave a red typecheck.

### 1.2 TOOL — Remove Jest leftovers

- **Findings:** MOD-003
- **Depends on:** 1.1
- **Scope:** `packages/agentic-interaction` jest.* files, `test:jest`
  script, jest/ts-jest deps; root `jest.setup.js`;
  `packages/ui-projection-compiler/jest.config.cjs`
- **Acceptance:**
  - `rg -l jest.config --glob '!**/node_modules/**'` returns nothing
    required at runtime.
  - `yarn test` still runs via Vitest (ADR-0044).
  - Root `jest.setup.js` is gone or no longer references `jest.fn`.

### 1.3 TOOL — arch-linter onto Vitest + split CLI from library

- **Findings:** GOD-002, MOD-002
- **Depends on:** 0.4 not required
- **Scope:** `tools/arch-linter`
- **Acceptance:**
  - `import "@hexagen/arch-linter"` (or `src/index.ts`) does **not** call
    `checkArchitecturalIntegrity()` or `process.exit`.
  - `package.json` `"test": "vitest run"`.
  - No `from "node:test"` under `__tests__/`.
  - Existing layer/subpath/cross-package tests still pass.
  - `hexagen-lint` bin still runs the CLI.

### 1.4 TOOL — Align published `engines.node` (or add Node 20 CI)

- **Findings:** MOD-004
- **Depends on:** 0.7
- **Scope:** `packages/sync/package.json`, `tools/arch-linter/package.json`,
  optionally `.github/workflows/*`
- **Acceptance:** Engines field matches the chosen ADR. If 22.7-only, both
  published packages say `>=22.7.0`.

### 1.5 TOOL — Fix ai-pipeline test tsconfig

- **Findings:** MOD-006
- **Depends on:** 1.2
- **Scope:** `packages/ai-pipeline/tsconfig.test.json`
- **Acceptance:** File is deleted **or** inherits ESM/bundler and does not
  list `"types": ["jest"]`. `vitest run` still green.

---

## Wave 2 — Port identity (architecture integrity)

### 2.1 PKG — Single `ProjectConfigurationReadPort`

- **Findings:** HEX-006
- **Depends on:** 0.1
- **Scope:** `packages/project-configuration` (owner), then
  `packages/mcp-server`, `packages/sync` delete their copies
- **Acceptance:**
  - `rg "export interface ProjectConfigurationReadPort"` has **one** hit
    in `src/`.
  - mcp-server and sync `import type { ProjectConfigurationReadPort } from
    "@hexagen/project-configuration"`.
  - Typecheck green.

### 2.2 PKG — Rename the two `FileSystemPort`s

- **Findings:** HEX-007
- **Depends on:** 0.1
- **Scope:** `packages/project-configuration`, `packages/sync`
- **Acceptance:**
  - No `export interface FileSystemPort` remains.
  - Names match ADR-C1 (recommended: `ManifestMergeFsPort`,
    `GeneratorFsPort`).
  - Adapters implement the renamed ports.

### 2.3 PKG — Untangle `ManifestGenerationPort`

- **Findings:** HEX-005, GOD-010
- **Depends on:** 0.1
- **Scope:** `packages/manifest-generation`, `packages/mcp-server`
- **Acceptance:**
  - The name `ManifestGenerationPort` is declared in **one** package.
  - mcp-server’s staged API has a distinct name **or** imports the owner.
  - `generateManifestPipeline` write/event side effects live in a use case,
    not `manifest-generation.adapter.ts` (GOD-010).

### 2.4 PKG — Split the two `SecretVaultPort`s

- **Findings:** HEX-008
- **Depends on:** 0.5 (catalog owner), HEX-012 in 3.2
- **Scope:** `packages/agentic-interaction`
- **Acceptance:**
  - `rg "export interface SecretVaultPort"` has at most one hit, **or**
    the two contracts have distinct names.
  - Barrel does not export both under the same identifier.

---

## Wave 3 — Application I/O and composition roots

### 3.1 PKG — `GenerateProjectUseCase` behind a write port

- **Findings:** HEX-002
- **Depends on:** 2.2
- **Scope:** `packages/project-generation`
- **Acceptance:**
  - `generate-project-use-case.ts` does not import `node:fs` / `node:path`.
  - A unit test runs the use case with an in-memory FS double.
  - Application still does not import `@hexagen/sync` `Manifest` if 3.3
    landed; otherwise track HEX-004 separately.

### 3.2 PKG — Provider catalog out of domain

- **Findings:** HEX-012, HEX-020
- **Depends on:** 0.5
- **Scope:** `packages/local-llm`, `packages/agentic-interaction`,
  `apps/web/app/lib/wire.server.ts`
- **Acceptance:**
  - Domain modules do not contain `https://api.openai.com` or
    `OPENAI_API_KEY` literals.
  - `buildStagedGenerationFallbackChain` is deleted or delegates to the
    catalog owner.
  - wire.server.ts only instantiates adapters.

### 3.3 PKG — Application `Manifest` type leaves `@hexagen/sync`

- **Findings:** HEX-004
- **Depends on:** none (parallel with 3.1)
- **Scope:** `packages/project-generation`, `packages/wizard-orchestration`
- **Acceptance:**
  - `rg "from \"@hexagen/sync\"" packages/project-generation/src/application`
    and `packages/wizard-orchestration/src/application` is empty (adapters
    may still import sync).

### 3.4 WEB — Routes stop constructing adapters

- **Findings:** HEX-003, HEX-016, HEX-034
- **Depends on:** HEX-010 (3.5)
- **Scope:** `apps/web/app/api/manifest/generate/**`,
  `apps/web/app/api/governance/refresh/route.ts`,
  `apps/web/app/api/llm/context/route.ts`, `apps/web/app/lib/wire.server.ts`
- **Acceptance:**
  - Those route files do not `new LLMProviderSelectorAdapter`,
    `new EnvironmentSecretVaultAdapter`, or
    `new InMemoryTransactionManager`.
  - Governance refresh does not `exec("yarn lint:arch")` inline — it calls
    a port.
  - `wire.server.ts` is the only server composition root for these paths.

### 3.5 PKG — Use-case does not `new InMemoryTransactionManager`

- **Findings:** HEX-010
- **Depends on:** none
- **Scope:**
  `packages/agentic-interaction/src/application/use-cases/generate-manifest-from-description.use-case.ts`
- **Acceptance:**
  - Constructor requires `TransactionManagerPort` (tests pass a fake /
    in-memory adapter).
  - Application source does not import `InMemoryTransactionManager`.

### 3.6 PKG — `ValidateTemplatesUseCase` and `ExportGraphImageUseCase` drop I/O

- **Findings:** HEX-014, HEX-015
- **Depends on:** 2.2 for HEX-014
- **Scope:** `packages/template-engine`, `packages/visualization`
- **Acceptance:**
  - Those use-case files do not import `node:fs`, `process.env`,
    `html-to-image`, or call `document.querySelector`.
  - An outbound adapter implements the I/O.
  - HEX-015 use case may still *implement* the inbound port.

### 3.7 PKG — ts-morph stays behind a DTO port

- **Findings:** HEX-013
- **Depends on:** none
- **Scope:** `packages/sync` symbol-reference port +
  `refactoring-impact.use-case.ts`
- **Acceptance:**
  - `symbol-reference-provider.port.ts` does not import `ts-morph`.
  - `RefactoringImpactUseCase` does not `new Project(`.

---

## Wave 4 — Domain honesty and generated output

### 4.1 PKG — Template ports do not import infrastructure errors

- **Findings:** HEX-001, HEX-036
- **Depends on:** 0.8
- **Scope:** `packages/template-engine/templates/**` and the generated
  bundle
- **Acceptance:**
  - `rg "from \"\\.\\./\\.\\./\\.\\./infrastructure" packages/template-engine/templates --glob '**/domain/**'`
    is empty.
  - `AgentRuntimePort` is emitted under `application/ports/in` (or domain),
    not next to Zod HTTP envelopes.
  - Bundle regenerated (`gen:bundle` / template-questions check green).

### 4.2 PKG — Prompts and R-rules leave domain; then split the god use-case

- **Findings:** HEX-011, GOD-001, GOD-009
- **Depends on:** 0.5 not required; HEX-011 before GOD-001
- **Scope:** `packages/agentic-interaction`
- **Acceptance:**
  - `src/domain/prompts/generate-manifest.prompt.ts` no longer owns
    STAGE_* literals **or** the file has moved under `application/`.
  - One R01–R18 catalog is imported by both the Stage-6 prompt and
    `structuralManifestErrors`.
  - `ExecuteStructuredConfigGenerationUseCase` no longer *defines*
    `parseStructuredConfig` / `structuralManifestErrors` (it may re-export
    for one release).
  - Existing staged-generation tests still pass.

### 4.3 PKG — Empty barrels / frozen scaffolds

- **Findings:** HEX-025, HEX-035
- **Depends on:** 0.4, 0.3 (if security folders are involved)
- **Scope:** sync generator + listed packages + `tsconfig.base.json`
- **Acceptance:**
  - `rg '^export \{\s*\}' packages --glob '**/src/**/*.ts'` is 0 **or**
    every remaining hit is waived in the ADR.
  - `architectural-enforcement` / `code-generation` are gone **or**
    documented as non-code placeholders outside `packages/`.
  - `tsconfig.base.json` references match remaining workspace packages
    (including the HEX-009 decision).

### 4.4 PKG — Security package fate

- **Findings:** HEX-009, MOD-005, HEX-018 (security slice)
- **Depends on:** 0.3, 1.4
- **Scope:** `packages/security` and/or `packages/governance`
- **Acceptance:** Matches ADR-C3. If kept: extends `tsconfig.base.json`,
  listed in manifest + references, `ISecretScanner` lives under `ports/out`.
  If folded: package directory removed, one remaining scanner port.

---

## Wave 5 — Inbound/outbound cleanup (after C2)

### 5.1 PKG — Move driven ports to `ports/out`

- **Findings:** HEX-018
- **Depends on:** 0.2, 4.4
- **Scope:** security (if kept), governance, monaco-orchestration,
  wizard-orchestration, project-configuration
- **Acceptance:**
  - Use cases implement inbound ports.
  - Driven contracts are under `ports/out`.
  - monaco/wizard `infrastructure/index.ts` is not `export {}` **or** the
    folder is gone (0.4).

### 5.2 PKG — MCP tools depend on inbound ports

- **Findings:** HEX-019
- **Depends on:** 5.1
- **Scope:** `packages/mcp-server`
- **Acceptance:**
  - `MCPServerAdapterDependencies` does not import `*UseCase` classes.
  - Each tool is typed to an inbound port.

### 5.3 APP — TUI uses the same ports as web

- **Findings:** HEX-017
- **Depends on:** 3.2
- **Scope:** `apps/tui`
- **Acceptance:**
  - No local `class LocalLLMProviderAdapter` fetching
    `api.openai.com` inside `action-service.ts`.
  - LLM/MCP/fs-watch sit behind injected ports.

---

## Wave 6 — Web god-structures and React splits

Do **not** put extracted policy into `@hexagen/ui`.

### 6.1 WEB — Stream reducer (unblocks two hooks)

- **Findings:** GOD-005
- **Depends on:** none
- **Scope:** `apps/web/features/manifest-generation/useStagedGenerationStream.ts`
- **Acceptance:**
  - Pure function(s) apply NDJSON frames and reconnect/timeout policy
    with table tests (no React).
  - Hook only binds the reducer to `fetch`.

### 6.2 WEB — Spec + description generation hooks

- **Findings:** GOD-006, GOD-012, GOD-003
- **Depends on:** 6.1
- **Scope:** `useStagedSpecGeneration.ts`,
  `useStagedManifestGeneration.ts`, `ImportProjectSpecPage.tsx`
- **Acceptance:**
  - `proposePR` is not in the spec-generation hook.
  - Shared progress-binding helper used by both hooks.
  - `ImportProjectSpecPage` is a step router; classification/accept live
    in non-UI modules. Page still behaves the same for generated-manifest
    fast-path, structured-config, and prose.

### 6.3 WEB — Split ExportProvider

- **Findings:** GOD-004, REA-005
- **Depends on:** none (parallel with 6.1)
- **Scope:** `apps/web/app/contexts/ExportContext.tsx`,
  `useProjectGeneration.ts`, `useArchitectureDownload.ts`
- **Acceptance:**
  - ZIP consumers do not subscribe to GitHub dialog state.
  - One `resolveImportedManifestPayload` used by export, generate, and
    architecture-ZIP.
  - Editor push reads `connectedRepo` from the publish context, not a
    second IDB load.

### 6.4 WEB — Planning session finalize extract

- **Findings:** GOD-007
- **Depends on:** none
- **Scope:** `apps/web/features/workspace-shell/plan-phase/session/`
- **Acceptance:**
  - `startFinalize` / distill review live in `usePlanningFinalize`.
  - Loop + `settlePendingAppend` stay in `usePlanningSession`.
  - Existing plan-phase tests pass.

### 6.5 WEB — Governance assistant composition

- **Findings:** REA-001, REA-002, REA-006
- **Depends on:** none
- **Scope:** `apps/web/features/governance-assistant/`
- **Acceptance:**
  - Transport/capability fetch is not inside the Q&A view.
  - `showBootSpinner` / `showUnavailable` / … booleans are gone;
    a discriminant selects composed children.
  - `getCapabilities()` runs once per panel mount.

### 6.6 WEB — CodeView boundary

- **Findings:** REA-003
- **Depends on:** 6.3 (shared mapper)
- **Scope:** `apps/web/features/code-view/`
- **Acceptance:**
  - Presentational explorer has no `useProjectGeneration` import.
  - Generation/ZIP hooks live in a boundary component.

### 6.7 WEB — Canvas hook split + visualization DTO

- **Findings:** REA-004, HEX-021, HEX-030
- **Depends on:** HEX-021 (visualization-owned map input)
- **Scope:** `packages/visualization`, `apps/web/features/hexagon-canvas/`
- **Acceptance:**
  - `GenerateHexagonalMapInput` does not import `WizardData`.
  - `HexagonNode` domain type has no `extent` / CSS color fields.
  - `compileWizardGraph` is a pure function with tests.

### 6.8 PKG — Model settings presentation-only

- **Findings:** HEX-022, HEX-031
- **Depends on:** none
- **Scope:** `packages/model-settings`, `packages/ui` Dialog/Tabs/…
- **Acceptance:**
  - `ModelSettingsView` does not call `hasModelInCache` in a `useEffect`.
  - Import path is `@hexagen/local-llm/client`, not the root barrel.
  - Dialog/Tabs/Accordion/Skeleton/CopyButton props extend
    `NoSemanticState`.

---

## Wave 7 — Smaller / leftover items (parallel after Wave 2)

| # | Findings | Notes |
|---|----------|--------|
| 7.1 | HEX-023, HEX-024 | Neutral persistence-backend type; model-prefs port |
| 7.2 | HEX-026 | `ManifestCodecPort` for wizard + manifest-generation |
| 7.3 | HEX-027 | domain path predicates without `node:path` |
| 7.4 | HEX-028 | strip WebLLM/WebGPU wording from local-llm domain ports |
| 7.5 | HEX-029 | move ChatMessage/GovernancePayload out of prompt-compiler infra |
| 7.6 | HEX-032 | topology invariants in domain or `@hexagen/runtime` |
| 7.7 | HEX-033 | wire or delete `apps/api-gateway` |
| 7.8 | HEX-037 | delete empty `*PortAdapter` stubs **or** implement them |
| 7.9 | HEX-038 | stub-template-resolver stops importing `config.js` |
| 7.10 | GOD-008 | extract `deriveApps` / `deriveCrossContextEdges` (after 3.3) |
| 7.11 | GOD-011 | IDB salvage mapper out of the adapter class |
| 7.12 | MOD-007 | `Error.cause` on listed rethrow sites (in-floor) |
| 7.13 | MOD-008 | llm-driver retry must not hang on inner throw |

---

## Explicit non-goals (do not open PRs for these)

- Splitting a file *because* it is long (inventory 3059-loc use-case is
  GOD-001 for **four** responsibilities, not for LOC).
- Moving extracted view-models into `@hexagen/ui`.
- Introducing Vite as the web bundler (ADR-0000).
- Replacing Vitest with Jest (ADR-0044) — Wave 1 goes the other way.
- Raising `tsconfig` `lib` to ES2024/ES2025 for `Object.groupBy` /
  iterator helpers — no finding justified it.
- Deleting `@hexagen/transaction-system` because it is `status: frozen`
  (it is implemented).
