# Planning TODOs

A checklist index of outstanding work and the files it references. The detailed
plan for the open items lives in
[generated-output-correctness-followups.md](./generated-output-correctness-followups.md).

_Last updated: 2026-06-06._

## ✅ Done — generated-output-compiles arc

- [x] **#242 → #244** — port/adapter stub naming (`normalizeStubName`)
- [x] **#245 → #247** — adapter ↔ shared-base port resolution
- [x] **#249 → #250** — package-root `src/index.ts` barrel (external mode only)
- [x] **#246 + #248 → #251** — use-case stubs: shared `Result` kernel + `generateUseCaseFromPort` interface/ctor + collision safety
- Guards: `packages/sync/__tests__/integration/generated-stub-typecheck.test.ts`, `.../related-port-resolution.test.ts`, `packages/sync/__tests__/generators/{shared-kernel,port-analyzer-usecase,barrels-recursive}.test.ts`
- Also done (context): [wire-architectural-template-into-generation.md](./wire-architectural-template-into-generation.md), [materialize-cross-context-communication.md](./materialize-cross-context-communication.md), [hydrate-visualizer-with-addons.md](./hydrate-visualizer-with-addons.md)

## ⬜ Remaining

### Track A — compile loose ends → [generated-output-correctness-followups.md](./generated-output-correctness-followups.md)

- [ ] **A1 — issue [#252](https://github.com/martinkrakowski/hexagen-monaco/issues/252) (PARKED, no callers)** — `generateWiring`/`generateTests` use raw `portName`.
  - `packages/sync/src/generators/wiring.ts` (`generateWiring:186`, `generateFake:97-122`, `:216`)
  - `packages/sync/src/generators/test-generator.ts` (`generateTests:32`, `:60`)
  - Activate only when these are wired into a flow; mirror #242/#248.
- [ ] **A2 — stub placement honors `generator.sync.layers.*.folder`** (LOW, pre-existing)
  - `packages/sync/src/domain/services/emission-plan-builder.ts` (~86-105)
  - `packages/sync/src/generators/stubs.ts` (placement ~219, use-case `outPortDir` ~255-261, `tryAnalyzeRelatedPort` probe ~80-82)
  - compare: `packages/sync/src/generators/layer-folders.ts`
- [ ] **A3 — consolidate name normalizers** (cleanup; fold into next `stubs.ts` PR)
  - `packages/sync/src/generators/stubs.ts` (`normalizeStubName:143-165`) vs `packages/sync/src/generators/architecture-files.ts` (`toPascalCase`)

### Track B — AI manifest staged pipeline rewire (separate, larger)

- [ ] Rewire `ExecuteStagedGenerationUseCase` off the mock-grade 4-pass stub.
  - `packages/agentic-interaction/src/application/use-cases/staged-generation/execute-staged-generation.use-case.ts`
  - Plans: [apply-import-generation-pattern-to-ai-flow.md](./apply-import-generation-pattern-to-ai-flow.md), [ai-generating-screen-followups.md](./ai-generating-screen-followups.md)
  - De-risk first: run against a real model, capture where each phase diverges from `wizardToManifest`/`SyncEngine` expectations before changing prompts/wiring.

### Track C — add-on templates expansion (separate)

- [ ] Expand the add-on template catalog (selection/persistence/hydration already shipped #221–#231).
  - Plans: [wire-addon-materializer-into-generation.md](./wire-addon-materializer-into-generation.md), [hydrate-code-view-with-addon-templates.md](./hydrate-code-view-with-addon-templates.md), [surface-addon-warnings-and-errors.md](./surface-addon-warnings-and-errors.md)

### Track D — add NitroJS to the API/backend templates → [add-nitrojs-api-backend-template.md](./add-nitrojs-api-backend-template.md)

- [ ] **Phase 1 (parity)** — add `"nitro"` to the selector: `packages/project-configuration/src/schema.ts:79` enum + `apps/web/features/project-wizard/config.ts:25-30` (`apiFrameworkOptions`).
- [ ] **Phase 2 (materialize)** — Nitro app template in `packages/sync/src/generators/apps-framework-templates.ts` + `AppFramework` (`packages/sync/src/types/manifest/apps.ts:3`); wire `infrastructureTarget` → `deriveApps` (`wizard-to-manifest.ts:483`). De-risk: `nitro prepare` + `tsc` a generated scaffold first (tsconfig/`.nitro`-types is the unknown).
  - Note: `infrastructureTarget` is currently advisory (display/metadata only); the add-on layer already defaults `framework` to `"nitro"`.

## Other planning docs (status not assessed in this pass)

Listed for reference; verify each before acting.

- [ai-generating-screen-followups.md](./ai-generating-screen-followups.md)
- [bounded-context-type-enum-consolidation.md](./bounded-context-type-enum-consolidation.md)
- [github-integration-completion.md](./github-integration-completion.md)
- [github-publish-and-editor-push.md](./github-publish-and-editor-push.md)
- [managed-deploy-compose.md](./managed-deploy-compose.md)
- [migration-storage-hardening.md](./migration-storage-hardening.md)
- [phase-3-7-execution-plan-v1.md](./phase-3-7-execution-plan-v1.md)
- [projects-new-regression-remediation.md](./projects-new-regression-remediation.md)
- [publish-progress-and-ci-scaffolding.md](./publish-progress-and-ci-scaffolding.md)
- [three-plane-system-overview.md](./three-plane-system-overview.md)
- [core-implementation/](./core-implementation/) · [generator-templates/](./generator-templates/)
