# Adversarial Architectural Audit Report

**Date:** 2026-04-25
**Mode:** Review & Archeology (Read-Only)
**Source:** Full codebase audit against `docs/architectural-remediation-report-2026-04-24.md`

---

## Part 1: How to Bypass Package Boundaries

The architecture has **12 distinct bypass mechanisms**. Here is how to exploit each:

### Attack 1: tsconfig.base.json path aliases (CRITICAL)

**File:** `tsconfig.base.json:17-68`

Every `@hexagen/*` package resolves to raw `src/` via `paths`. The catch-all at line 62 (`"@hexagen/*": ["./packages/*/src/index.ts"]`) means even packages with no explicit entry get source-level access. The `/*` wildcards on 9 packages allow deep subpath imports like `@hexagen/shared/types/architectural-schemas` bypassing the barrel entirely.

**How to exploit:** Add `import { BoundedContextSchema } from "@hexagen/shared/types/architectural-schemas"` in any app file. TypeScript resolves it directly to `packages/shared/src/types/architectural-schemas.ts`. No lint rule catches this because `lint:arch` only checks the 11 contexts that have `package_rules`.

### Attack 2: Webpack `source` condition (CRITICAL)

**File:** `apps/web/next.config.mjs:90-93`

`conditionNames: ["source", ...]` activates the `"source": "./src/index.ts"` exports condition in 8 packages. Webpack resolves directly to TypeScript source, bypassing `dist/` and the `exports` map.

**How to exploit:** Any package with a `source` condition exposes its full source tree to webpack. Even if the package's `exports` map restricts subpaths, webpack's resolver may reach internal modules via the source condition.

**Affected packages:**

| Package                          | `"source"` Value                              |
| -------------------------------- | --------------------------------------------- |
| `@hexagen/visualization`         | `"./src/index.ts"`                            |
| `@hexagen/project-configuration` | `"./src/index.ts"`, `"./src/index.server.ts"` |
| `@hexagen/local-llm`             | `"./src/index.ts"`                            |
| `@hexagen/web-driver`            | `"./src/index.ts"`                            |
| `@hexagen/messaging`             | `"./src/index.ts"`                            |
| `@hexagen/agentic-interaction`   | `"./src/index.ts"`                            |
| `@hexagen/monaco-orchestration`  | `"./src/index.ts"`                            |
| `@hexagen/project-generation`    | `"./src/index.ts"`                            |

### Attack 3: `ignoreBuildErrors: true` (HIGH)

**File:** `apps/web/next.config.mjs:103`

This silences the last type-level enforcement of export boundaries. Even if a package restricts subpath access in `exports`, TypeScript errors from deep imports are swallowed.

**How to exploit:** Import any internal module from any `@hexagen/*` package. `next build` will not fail.

### Attack 4: 9 bounded contexts have zero `package_rules` (CRITICAL)

**File:** `.architecture/invariants/linter-config.yaml`

`core-domain`, `sync`, `wizard-orchestration`, `monaco-orchestration`, `visualization`, `external-integration`, `persistence`, `deployment`, and `governance` have NO `package_rules` entries. Any cross-package import into or out of these contexts is allowed by default.

**How to exploit:** `import { anything } from "@hexagen/core-domain"` in any package passes `lint:arch`. No boundary is enforced for half the bounded contexts.

### Attack 5: `eslint-plugin-ui` not in manifest (HIGH)

Not declared as a bounded context at all. Receives zero architectural enforcement.

### Attack 6: Jest `moduleNameMapper` (MEDIUM)

5 test configs map `@hexagen/*` to raw `src/`. Tests never validate that a package's `exports` field actually exposes what consumers need. A package could break its barrel and tests would still pass.

**Affected files:**

| File                                              | Mapped Packages                                               |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `packages/ui-projection-compiler/jest.config.cjs` | `core-domain`, `layout-engine`, `shared`                      |
| `packages/transaction-system/jest.config.cjs`     | `core-domain`, `intent-compiler`, `shared`                    |
| `packages/reconciliation-engine/jest.config.cjs`  | `core-domain`, `intent-compiler`, `prompt-compiler`, `shared` |
| `packages/prompt-compiler/jest.config.cjs`        | `core-domain`, `intent-compiler`, `shared`                    |
| `packages/intent-compiler/jest.config.cjs`        | `core-domain`, `shared`                                       |

### Attack 7: Ghost dependency `@hexagen/external-integration` (MEDIUM)

**File:** `apps/web/tsconfig.json:24-26`

Has a tsconfig path alias but is NOT in `apps/web/package.json` dependencies. Accessible through the backdoor.

### Additional bypass infrastructure

| Mechanism                                     | File                       | Lines                                                                 | Severity |
| --------------------------------------------- | -------------------------- | --------------------------------------------------------------------- | -------- |
| `transpilePackages` (15 packages)             | `apps/web/next.config.mjs` | 42-58                                                                 | HIGH     |
| `experimental.externalDir: true`              | `apps/web/next.config.mjs` | 66-69                                                                 | HIGH     |
| Deep subpath wildcard `/*` paths (9 packages) | `tsconfig.base.json`       | 21-22, 25, 27, 29, 33-34, 39-40, 43, 45, 49-50, 53, 57-58, 61, 65, 66 | CRITICAL |
| `.js` → `.ts` extension alias                 | `apps/web/next.config.mjs` | 85-88                                                                 | MEDIUM   |
| `outputFileTracingRoot`                       | `apps/web/next.config.mjs` | 64                                                                    | MEDIUM   |

---

## Part 2: How to Reintroduce UI Semantics

### Attack 8: String-pattern domain classification (CRITICAL)

**File:** `apps/web/features/hexagon-canvas/lib/classify-adapter-label.ts:17-51`

`classifyAdapterLabel()` uses substring matching (`label.includes("sql")`) and positional fallback (`side === "north" ? "API" : "Infrastructure"`) to derive domain categories. Any new adapter framework requires editing UI-layer code.

**How to exploit:** The function already exists and is active. Add a new framework name (e.g., "graphql") and the UI invents its category ("API") without consulting the domain model.

### Attack 9: Dual incompatible category systems (CRITICAL)

**File:** `classify-adapter-label.ts:1-7` vs `visual-variant.ts:3-17`

Two category vocabularies that cannot consume each other:

| `classify-adapter-label.ts` `AdapterCategory` | `visual-variant.ts` `VisualVariantCategory` |
| --------------------------------------------- | ------------------------------------------- |
| "API"                                         | "driving"                                   |
| "UI"                                          | "presentation"                              |
| "Messaging"                                   | (no direct equivalent)                      |
| "Persistence"                                 | "infrastructure"                            |
| "Telemetry"                                   | (no direct equivalent)                      |
| "Infrastructure"                              | "infrastructure"                            |

When the UI classifier produces `"API"`, `BoundedContext.tsx:88` lowercases it to `"api"` which is NOT in `KNOWN_CATEGORIES` — it silently falls through to default. The systems are not just duplicated; they are **misaligned**.

**How to exploit:** Any adapter classified as "API" or "Messaging" by `classifyAdapterLabel` will render with incorrect or default styling because the two category namespaces have no mapping.

### Attack 10: WizardData direct graph construction (CRITICAL)

**File:** `apps/web/features/hexagon-canvas/lib/generate-hexagonal-context-map.ts:12-73`

The entire hexagonal context map is constructed from `WizardData` inside a `lib/` function in the feature layer. `generate-bounded-context-nodes.ts` (321 lines) reads `ctx.entities`, `ctx.useCases`, `ctx.valueObjects`, `ctx.domainEvents`, `ctx.infrastructureTarget`, `ctx.apiFramework`, `ctx.uiFramework`, `ctx.persistenceAdapter`, `ctx.messagingAdapter`, `ctx.telemetryProvider` and converts each into visual nodes with domain-semantic categorization.

**How to exploit:** Add a new domain field to `WizardData` (e.g., `blockchainNetworks`). The UI feature's generator must be updated to render it. The kernel never owns the projection.

### Attack 11: Edge color derivation from domain categories (HIGH)

**File:** `HexagonCanvas.tsx:113-132`

`getEdgeColor()` reads `sourceNode.type === "port"`, then accesses `nodeWithCategory.category`, lowercases it, validates against a local category set, and resolves a hex color. The component does domain-semantic inference at render time.

**How to exploit:** Change a node's `category` string to any value. The component's `isEdgeColorCategory()` check fails silently and falls back to default gray. No type error, no runtime error, just wrong rendering.

### Attack 12: Hexagon side labels hardcoded in JSX (MEDIUM)

**File:** `BoundedContext.tsx:393-426`

`PRESENTATION`, `INFRASTRUCTURE`, `DRIVING`, `DRIVEN` — domain architectural concepts hardcoded as SVG text in a React component.

### Attack 13: `PeerContextNode` relationship label map (MEDIUM)

**File:** `PeerContextNode.tsx:15-22`

Hardcoded `Record<string, string>` mapping domain relationship codes to display labels. The `| string` escape hatch on the `subtype` prop (line 8) makes it effectively untyped.

### Additional UI semantic violations

| #   | File                                              | Lines           | Category                                                      | Severity |
| --- | ------------------------------------------------- | --------------- | ------------------------------------------------------------- | -------- |
| 14  | `lib/generate-bounded-context-nodes.ts`           | 25-321          | Domain-semantic node construction from raw WizardData fields  | Critical |
| 15  | `lib/generate-external-peers.ts`                  | 34-65           | Domain relationship interpretation + magic ID fallback        | High     |
| 16  | `lib/generate-peer-mapping-edges.ts`              | 38-47           | Domain pattern translation + magic ID coupling                | High     |
| 17  | `BoundedContext.tsx`                              | 44-91, 215-258  | Visual variant derived from `data.type` instead of projection | High     |
| 18  | `hooks/useCanvasState.ts`                         | 133-166         | Dual-path: WizardData bypasses application layer              | Critical |
| 19  | `BoundedContext.tsx:44` + `HexagonCanvas.tsx:100` | 44 / 100        | Duplicate CvaVariantResolverAdapter composition roots         | Medium   |
| 20  | Three generator files (cross-file)                | 56 / 60 / 28,31 | `context-${index}` magic string ID coupling                   | High     |

---

## Part 3: How to Misuse Contracts

### Attack 21: `NodeVisualSpec.category` is a free-form string (CRITICAL)

**File:** `packages/core-domain/src/mvk/v1/node-visual-spec.ts:18`

The field is `category?: string` — optional, unvalidated, no constrained vocabulary. The mapper at `default-node-visual-mapper.adapter.ts:38` does `category.toLowerCase() as VisualVariantCategory` — an **unsafe cast** that silently accepts any string.

**How to exploit:** Pass `category: "banana"` in any `NodeVisualSpec`. The `as VisualVariantCategory` cast succeeds at compile time. The `known.includes(normalized)` check at runtime fails silently and falls through to the `kind`-based fallback. No error. No rejection. Just wrong projection.

### Attack 22: `NodeVisualProjection.category` is also free-form (HIGH)

**File:** `packages/ui-projection-compiler/src/application/ports/in/map-node-visual.port.ts:4-9`

The output projection carries `category: string`. The compiler's output has the same weakness as its input — no constrained vocabulary, no guarantee of alignment with `VisualVariantCategory`.

### Attack 23: `NodeVisualStyle` is an empty shell (CRITICAL)

**File:** `packages/visualization/src/domain/model/node-visual-style/node-visual-style.ts:4-6`

The visualization package's render contract is `// TODO: properties from manifest`. No fields. No consumer can use this. Every consumer that needs styling bypasses to `VisualVariant` from `ui-projection-compiler` instead.

**How to exploit:** Because `NodeVisualStyle` is empty, there is no bridge between `NodeVisualProjection` (from `ui-projection-compiler`) and `HexagonNode` (from `visualization`). The two packages define their own models with no published language connecting them. Any code that needs to go from projection to rendered node must do ad-hoc field mapping.

### Attack 24: `DomainASTLike` with `unknown[]` (CRITICAL)

**Files:**

- `packages/reconciliation-engine/src/domain/llm-response.ts:3-10`
- `packages/prompt-compiler/src/domain/prompt-template.ts:3-10`

Both packages define their own `DomainASTLike` with `nodes: unknown[]` and `edges: unknown[]`, shadowing the kernel's `DomainAST` which uses `DomainNode[]`, `DomainEdge[]`, `NodeKind`, `EdgeKind`. Both also redefine `Identifier = string`, shadowing the kernel's branded type.

**How to exploit:** Pass any object in the `nodes` array. No type checking. The reconciliation engine's regex parser at `ast-reconciliation.adapter.ts:34` will still try to match `+ kind:id` patterns in free-form text and create patches with `kind: nodeMatch[1]` — an unvalidated string that becomes a `NodeKind` with no guard.

### Attack 25: `Patch.payload` is `Record<string, unknown>` (HIGH)

**File:** `packages/reconciliation-engine/src/domain/llm-response.ts:34`

No typed shape. Any key-value pair is accepted.

### Attack 26: UI constructs `LLMRequest` directly (HIGH)

**File:** `apps/web/features/llm-driver/local-llm/stream-assistant-response.ts:43-52`

The UI builds `LLMRequest` object literals with `id: \`stream-${Date.now()}\``, inline `messages`arrays,`schema: FreeFormStringSchema`, and hardcoded tuning config. The `createLLMRequest()`factory (which could enforce validation) is never imported in`apps/web`.

Additional UI-side LLM construction sites:

| File                                                                               | Lines   | What It Constructs                                       |
| ---------------------------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| `apps/web/features/llm-driver/local-llm/useChatMessages.ts`                        | 171-175 | `LLMRequest["messages"]` array with inline system prompt |
| `apps/web/features/llm-driver/local-llm/useChatMessages.ts`                        | 220-229 | Same pattern for governance messages                     |
| `apps/web/features/governance-assistant/hooks/.../useGovernanceQuestionActions.ts` | 162-168 | Message arrays from conversation thread                  |

**How to exploit:** Change `schema` to any Zod schema. Change `temperature` to any number. The UI has full control over LLM request construction with no application-layer validation.

### Attack 27: REM binding is comment-only (CRITICAL)

**File:** `packages/transaction-system/src/application/use-cases/execute-transaction.use-case.ts:6,12-15`

The JSDoc says "binds intent + REM + lineage" but the actual method signature is `execute(intentId: string, metadata: Record<string, unknown> = {})`. No REM type. No lineage reference. `Transaction.metadata` is `Record<string, unknown>`. `normalizeDomainASTForCache` at `cache-entry.ts:59-63` is a no-op.

**How to exploit:** Put anything in `metadata`. There is no schema. REM is not enforced at any level.

### Attack 28: Prompt-compiler ports accept loose inputs (HIGH)

**File:** `packages/prompt-compiler/src/application/ports/in/generate-zod-schema.port.ts:7-16`

`GenerateZodSchemaRequest` accepts `name: string`, `description: string`, `exampleData: unknown`. Not compiled kernel contracts. `PromptCompileRequest` accepts `governanceRules: string[]` — not a compiled governance object.

**How to exploit:** Pass any string as `name`, any string as `description`, any value as `exampleData`. The compiler has no way to validate these against the kernel's domain model.

### Attack 29: Reconciliation parses free-form text via regex (CRITICAL)

**File:** `packages/reconciliation-engine/src/infrastructure/adapters/ast-reconciliation.adapter.ts:34,44`

`line.match(/\+ (\w+):(\w+)/)` parses LLM free-form text output using regex. The captured `kind` string has no `NodeKind` validation — any word the LLM outputs becomes a "kind".

### Attack 30: Mapper duplicates logic and bypasses kernel enum (HIGH)

**File:** `packages/ui-projection-compiler/src/infrastructure/adapters/default-node-visual-mapper.adapter.ts:60-75`

Instead of using `categoryFromNodeKind()` (which properly switches on the `NodeKind` enum at `visual-variant.ts:29-65`), the adapter casts `NodeKind` to `string` and does lower-case string matching. This duplicates logic and bypasses the kernel's type system.

---

## Part 4: Remaining Bypass Paths

| Bypass                                       | Status     | How to Exploit                                                              |
| -------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| `tsconfig.base.json` `paths`                 | **ACTIVE** | 30+ source-level aliases, catch-all wildcard, 9 deep-subpath wildcards      |
| `next.config.mjs` `source` condition         | **ACTIVE** | 8 packages expose raw `.ts` via exports condition                           |
| `lint:arch` missing rules                    | **ACTIVE** | 9/20 contexts have no `package_rules` — default allow all                   |
| `eslint-plugin-ui` not in manifest           | **ACTIVE** | Zero enforcement on this package                                            |
| `ignoreBuildErrors: true`                    | **ACTIVE** | TypeScript export violations silenced at build                              |
| `NodeVisualSpec.category` free-form          | **ACTIVE** | Any string accepted, unsafe cast in mapper                                  |
| Dual category systems                        | **ACTIVE** | `classifyAdapterLabel` output incompatible with `VisualVariantCategory`     |
| WizardData → graph in UI                     | **ACTIVE** | 5 generator files in `features/hexagon-canvas/lib/`                         |
| `DomainASTLike` type erasure                 | **ACTIVE** | 2 packages shadow kernel with `unknown[]`                                   |
| `LLMRequest` direct construction             | **ACTIVE** | 3 sites in `apps/web` build requests without factory                        |
| REM binding non-existent                     | **ACTIVE** | Comment-only, `metadata: Record<string, unknown>`                           |
| `NodeVisualStyle` empty                      | **ACTIVE** | No bridge between projection and visualization packages                     |
| Dead graph provider stub                     | **ACTIVE** | `ArchitectureGraphProviderAdapter` always returns error                     |
| `FileDropZone` manifest semantics            | **ACTIVE** | `.yaml` acceptance, `manifest.yaml` UI text in generic UI package           |
| `ViewMode` feature vocabulary                | **ACTIVE** | `"visual" \| "code"` in `@hexagen/ui` modules                               |
| `context-${index}` magic strings             | **ACTIVE** | Implicit coupling across 3 generator files                                  |
| Duplicate composition roots                  | **ACTIVE** | 2 `CvaVariantResolverAdapter` instances in canvas components                |
| 3 packages with zero consumers               | **ACTIVE** | `intent-compiler`, `reconciliation-engine`, `transaction-system`            |
| `shared` as schema dumping ground            | **ACTIVE** | 11 context-owned schemas, 0 shared-kernel primitives                        |
| Reconciliation regex parsing                 | **ACTIVE** | Free-form `+ kind:id` text parsing with no `NodeKind` validation            |
| `Patch.payload` untyped                      | **ACTIVE** | `Record<string, unknown>` accepts anything                                  |
| `GroundedPromptAdapter` hardcoded empty data | **ACTIVE** | `boundedContexts: []`, `ports: {}`, `invariants: []`, `filename: "unknown"` |
| `normalizeDomainASTForCache` no-op           | **ACTIVE** | Claims to normalize but returns input unchanged                             |

---

## Part 5: Shared-Kernel Ownership Drift

### `architectural-schemas.ts` — Full Inventory

**File:** `packages/shared/src/types/architectural-schemas.ts` (107 lines)

| Line    | Export                                          | True Owner                       | Drift Reason                                                    |
| ------- | ----------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| 3-8     | `BoundedContextTypeSchema`                      | project-configuration            | Bounded context taxonomy (core/supporting/driver/shared-kernel) |
| 10-14   | `LayerTypeSchema`                               | project-configuration            | Layer classification belongs with project topology              |
| 16-46   | `BoundedContextSchema`                          | project-configuration            | Structural definition of a bounded context                      |
| 48-57   | `ManifestSchema` + `Manifest`                   | project-configuration            | The manifest IS project-configuration's core entity             |
| 59-64   | `GraphNodeSchema`                               | visualization                    | Graph nodes are visualization's domain                          |
| 66-72   | `GraphEdgeSchema`                               | visualization                    | Graph edges are visualization's domain                          |
| 74-78   | `ArchitectureGraphSchema` + `ArchitectureGraph` | visualization                    | Matches `ArchitectureGraphProviderPort` owned by visualization  |
| 80-86   | `BoundaryViolationSchema`                       | sync / architectural-enforcement | Linter violations                                               |
| 88-92   | `DependencyEventSchema`                         | messaging                        | Domain events / dependency events                               |
| 94-100  | `LinterReportSchema` + `LinterReport`           | sync / architectural-enforcement | Linter reports                                                  |
| 102-107 | `ArchitecturalEventSchema`                      | messaging                        | Event-sourced architectural events                              |

**Verdict:** ZERO of the 11 exports belong in the shared kernel. They are all context-specific.

### Duplicate `BoundedContext` types in shared

Two different `BoundedContext` definitions coexist in `@hexagen/shared`:

1. `architectural-schemas.ts:16-46` — `BoundedContextSchema` (Zod schema)
2. `wizard-data.ts:52-116` — `BoundedContext` interface (80-line behemoth with `infrastructureTarget`, `apiFramework`, `uiFramework`, `persistenceAdapter`, `messagingAdapter`, `telemetryProvider`, etc.)

The wizard-specific `BoundedContext` is a projection model, not a shared-kernel primitive. It also exports `deriveActiveContext` (a function) and `ContextUpdateCallback` — neither is a shared-kernel primitive.

### `packages/shared/src/index.ts:55` — Re-export leakage

`export * from "./types/index.js"` transitively re-exports all 11 context-owned schemas through the shared kernel's public API.

---

## Part 6: Linter Coverage Gaps

### Bounded contexts with NO `package_rules` (default-allow all imports)

1. `core-domain`
2. `sync`
3. `wizard-orchestration`
4. `monaco-orchestration`
5. `visualization`
6. `external-integration`
7. `persistence`
8. `deployment`
9. `governance`

Only **11 of 20** bounded contexts have `package_rules` entries in `linter-config.yaml`.

### Packages not in manifest at all

- `eslint-plugin-ui` — absent from `bounded_contexts`, zero enforcement

---

## Part 7: Dead Stubs and Aspirational Packages

| Package                                         | Has Real Code   | Has Runtime Consumers                                                | Verdict                                  |
| ----------------------------------------------- | --------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| `intent-compiler`                               | Yes             | **NONE**                                                             | Effectively a stub in runtime graph      |
| `reconciliation-engine`                         | Yes             | **NONE**                                                             | Effectively a stub in runtime graph      |
| `transaction-system`                            | Yes             | **NONE**                                                             | Effectively a stub in runtime graph      |
| `layout-engine`                                 | Yes             | 1 indirect consumer (`ui-projection-compiler` for type imports only) | Half-stub — no direct app-layer consumer |
| `web-driver` `ArchitectureGraphProviderAdapter` | Yes             | Always returns error                                                 | Dead stub — no working graph provider    |
| `visualization` `ExportGraphImageUseCase`       | Yes             | Returns `{success: false, error: "Export not yet implemented"}`      | Unimplemented stub                       |
| `visualization` `NodeVisualStyle`               | Empty interface | No consumer possible                                                 | Empty placeholder                        |
| `visualization` `GraphLayoutOptions`            | Empty interface | No consumer possible                                                 | Empty placeholder                        |

---

## Part 8: `@hexagen/ui` Feature-Semantic Leakage

### `FileDropZone.tsx` — Manifest-specific behavior

| Line   | Evidence                                                                  |
| ------ | ------------------------------------------------------------------------- |
| 18     | `accept = ".yaml,.yml"` — default is YAML-only, manifest-specific         |
| 26-28  | `if (!file.name.match(/\.(ya?ml)$/i))` — hardcoded YAML validation        |
| 83     | `aria-label="Upload manifest YAML file -- click or drop to browse"`       |
| 99-103 | `Drop a <code>manifest.yaml</code> file here` — hardcodes "manifest.yaml" |

### `ViewToggle.tsx` — Feature-specific vocabulary

| Line | Evidence                                                                                  |
| ---- | ----------------------------------------------------------------------------------------- |
| 6    | `export type ViewMode = "visual" \| "code";` — editor/canvas-specific discriminated union |

Both are re-exported through the `@hexagen/ui` barrel, violating the "projection layer isolated from semantic state" constraint.

---

## Part 9: Critical Architectural Smells

1. **The published language is a fiction.** `NodeVisualSpec.category` is `string`. `NodeVisualStyle` is empty. There is no bridge between `ui-projection-compiler` output and `visualization` input. The "published language" the remediation report demands does not exist in executable form.

2. **Boundaries are cosmetic.** `lint:arch` green means nothing — 9 of 20 contexts have no rules, and `ignoreBuildErrors: true` silences the type checker. The architecture is "well-described but bypassable" exactly as the remediation report states.

3. **React is the domain authority.** The 5 generator files in `features/hexagon-canvas/lib/` perform all semantic compilation that should belong to the GR-AST → MVK → RRP → REM path. React classifies adapters, colors edges, generates graph structure, and maps domain fields to visual properties.

4. **The AI pipeline is unbound.** UI constructs `LLMRequest` directly. Prompt-compiler accepts `unknown` and `string[]`. Reconciliation parses free-form regex. REM is a comment. The governance claims in the manifest are not reflected in runtime behavior.

5. **The shared kernel is a dumping ground.** All 11 schemas in `architectural-schemas.ts` belong to other contexts. Two different `BoundedContext` types coexist. The shared kernel enables cross-context coupling instead of preventing it.

---

## Appendix: Violation Severity Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 11    |
| HIGH     | 13    |
| MEDIUM   | 7     |
| LOW      | 1     |

**Total active bypass paths: 32**

---

_This audit confirms the remediation report's central thesis: the repository does not need a new architecture. It needs the declared architecture to become the only executable path. Until the Phase 0 boundary enforcement is completed, every other improvement builds on untrustworthy ground._
