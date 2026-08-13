# Generated-Output Correctness — Follow-ups & Remaining Work

**Status:** The "generated output compiles" arc is **shipped**. This doc captures the loose ends it spawned (Track A, not yet planned elsewhere) and indexes the larger adjacent tracks (B, C) that already have planning docs.
**Update 2026-08-13:** A1 is **obsolete** (its target generators were deleted — see A1). A2/A3 remain valid and are scheduled in `2026-07-25-remaining-work-consolidated-plan.md` (Wave 5). Track B shipped separately (the staged pipeline runs the real model cascade in prod since 2026-06-11).
**Date:** 2026-06-06
**Parent:** Follow-on to [wire-architectural-template-into-generation.md](./wire-architectural-template-into-generation.md) → [materialize-cross-context-communication.md](./materialize-cross-context-communication.md).

## What shipped (context)

Generated projects (the `mode: "external"`, API-driven scaffold from `wizardToManifest` → `SyncEngine.run()`) now typecheck across the stub surface. Each fix closed a CI gap with a real `tsc`-backed test (CI never typechecks generated _output_, only this repo's source):

| Issue      | Fix (merged) | What it made compile                                                                                                                                                                                                         |
| ---------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #242       | #244         | port/adapter stubs — `normalizeStubName` (single point: file stem + identifier; no doubled extension, valid identifier)                                                                                                      |
| #245       | #247         | adapter ↔ shared-base port resolution (normalize both sides of the match)                                                                                                                                                    |
| #249       | #250         | package-root `src/index.ts` barrel so `@{scope}/<pkg>` resolves — **external mode only**                                                                                                                                     |
| #246, #248 | #251         | use-case stubs — shared `Result` kernel (`generateSharedKernel`) + `generateUseCaseFromPort` imports the in-port interface and injects out-ports by resolved interface; collision/alias/reserved-word/relative-import safety |

**Guard tests:** `packages/sync/__tests__/integration/generated-stub-typecheck.test.ts`, `.../related-port-resolution.test.ts`, `packages/sync/__tests__/generators/{shared-kernel,port-analyzer-usecase,barrels-recursive}.test.ts`.

**Recurring lesson baked into all of it:** `SyncEngine`/sync generators run in **two worlds** — `self-regen` (this monorepo's hand-maintained files) vs `external` (generated projects). Any new emitter must be mode-checked or it corrupts the real repo (bit us 3×: #249/#250 package-root barrel, #246 Result kernel). The test helpers default to `external`, so a unit suite can pass while self-regen breaks — always add a self-regen case for anything touching shared/root files.

---

## Track A — compile-correctness loose ends (not yet planned elsewhere)

### A1 — `generateWiring` / `generateTests` use raw `portName` (issue #252)

> **OBSOLETE (2026-08-13).** #318 deleted `wiring.ts` and `test-generator.ts`
> wholesale (`c0970838`) — the never-invoked generators this item targeted no
> longer exist. Issue #252 closed as not-planned. The surviving stub path
> already sanitizes names via `normalizeStubName` (`stubs.ts:157`), which is
> the guardrail this item asked for. If composition-root/test generation
> returns as a product requirement, it should be re-planned fresh (and pick up
> A2's layer resolver), not resurrected from this spec.

**Problem.** The composition-root + in-memory-test-double generator (`generateWiring`) and the test generator (`generateTests`) interpolate **raw** manifest port names into identifiers, class names, and import paths — the same defect class #242/#248 fixed for stubs. For `relational-db.out-port.ts` they emit `export class Fakerelational-db.out-port.ts implements relational-db.out-port.ts` and an import path `'.../relational-db.out-port.ts.port'` (double-suffix + `.port`, not `.out-port`).

**Where.**

- `packages/sync/src/generators/wiring.ts:216` — `context.layers?.application?.ports?.out?.map(portName)`
- `packages/sync/src/generators/wiring.ts:97-122` — `generateFake`: `Fake${portName.replace("Port","")}`, hand-built `'../application/ports/out/${portName.toLowerCase()}.port'`, `class … implements ${portName}`
- `packages/sync/src/generators/test-generator.ts:60` — same `.map(portName)`

**Severity / trigger — PARKED.** Both `generateWiring` (`wiring.ts:186`) and `generateTests` (`test-generator.ts:32`) are **exported with zero callers** anywhere in the repo (not in `SyncEngine` or any CLI command). So this does **not** break live generation today. Fixing un-invoked code now would be speculative — **pick this up only when these generators get wired into a flow** (e.g. an `--with-tests` / composition-root step).

**Approach (mirror #242/#248 when activated).**

1. Normalize via `normalizeStubName` (file stem + identifier) before interpolation.
2. Derive the port **interface** name the way the use-case fix does — `analyzePortFile` the out-port when present, else `${normalizeStubName(raw, outNaming)}Port`; build import paths with `relativeImportSpecifier`, not hand-built `.port` strings.
3. Resolve dirs from `generator.sync.layers` (see A2), not hardcoded `application/ports/out`.

**Acceptance.** A `tsc`-backed guard (extend `generated-stub-typecheck`) over the wiring/test output for a kebab/extensioned manifest passes; the generators are wired into a flow.

---

### A2 — stub placement ignores custom `generator.sync.layers.*.folder`

**Problem.** Stub emission and port resolution hardcode the conventional `src/application/ports/{in,out}`, `src/application/use-cases`, etc., instead of reading the layer config the rest of the system advertises. A manifest that sets `application: { folder: "src/app" }` would have `ensureLayerFolders` create `src/app/...` while stubs land in `src/application/...`.

**Where.**

- `packages/sync/src/domain/services/emission-plan-builder.ts` (~86-105) — hardcoded `subdir` strings
- `packages/sync/src/generators/stubs.ts` — `path.join(moduleDir, "src", subdir, filename)` (~219); the use-case `outPortDir` (~255-261); `tryAnalyzeRelatedPort`'s `application/ports/${portType}` probe (~80-82)
- consumer of the config for comparison: `packages/sync/src/generators/layer-folders.ts`

**Severity — LOW / pre-existing.** Not a correctness bug for the **default** layout (which every manifest and test uses): the use-case, in-port, and out-port are all placed via the _same_ convention, so their mutual relative imports resolve within the generated tree. It only bites if someone sets a custom `folder` — currently nothing does.

**Approach.** Introduce one resolver: `(layerKind, portType) → on-disk dir` from `generator.sync.layers` (fall back to convention). Use it in the emission plan, `stubs.ts` placement, `tryAnalyzeRelatedPort`'s probe, and the A1 wiring/test dirs. Add a test manifest with a non-default `application.folder` asserting file locations **and** emitted import specifiers are consistent (+ tsc).

**Acceptance.** Custom-folder manifest generates a tree that `tsc`-compiles; no hardcoded `application/...` left in stub placement.

---

### A3 — consolidate `normalizeStubName` vs `architecture-files` PascalCase

**Problem.** Two name-normalizers exist with subtly different rules (notably underscore handling): `normalizeStubName` (`packages/sync/src/generators/stubs.ts:143-165`) and the `toPascalCase` used in `architecture-files.ts`. Divergence risks a stub identifier not matching the same name as rendered elsewhere.

**Severity — LOW / cleanup.** No known live mismatch; orthogonal generators. Worth a single shared helper to prevent future drift.

**Approach.** Extract one `toIdentifier`/`normalizeName` helper (decide underscore policy explicitly), use it in both. Unit-test the divergent inputs (kebab, underscore, digit-leading, already-PascalCase, empty).

**Acceptance.** One normalizer; both call sites use it; tests pin the policy.

---

## Track B — AI manifest staged pipeline rewire (separate, larger effort)

**Gap.** The cloud "Generate manifest" path runs `ExecuteStagedGenerationUseCase` (`packages/agentic-interaction/src/application/use-cases/staged-generation/execute-staged-generation.use-case.ts`) — a 4-phase (workspace → contexts → ports → adapters) pipeline whose phase prompts are currently shaped for / keyed on **mock LLMs** (hardened 2026-06-05 to fix a context-list JSON parse hard-fail). The standing follow-up is to rewire it to a richer/real pipeline.

**Already planned — read these first:**

- [apply-import-generation-pattern-to-ai-flow.md](./apply-import-generation-pattern-to-ai-flow.md)
- [ai-generating-screen-followups.md](./ai-generating-screen-followups.md)

**De-risk-first (when picked up).** Run the existing staged use-case against a real model end-to-end and capture where each phase's output diverges from what `wizardToManifest`/`SyncEngine` expect, **before** changing prompts or wiring — same discipline that surfaced the real root causes throughout Track A. Pin findings in the doc before coding.

---

## Track C — add-on templates expansion (separate track)

**Status.** Add-on selection persistence + visualizer/code-view hydration **shipped** (#221–#231, deployed prod 2026-06-05). The noted "next" is expanding the add-on template catalog.

**Already planned — read these first:**

- [wire-addon-materializer-into-generation.md](./wire-addon-materializer-into-generation.md)
- [hydrate-code-view-with-addon-templates.md](./hydrate-code-view-with-addon-templates.md)
- [surface-addon-warnings-and-errors.md](./surface-addon-warnings-and-errors.md)

---

## Suggested order when we return

1. **Nothing is urgent** — the compile arc is complete and the live surface is correct.
2. ~~If generated **tests/composition-root** become a product requirement → A1 (+ A2 alongside, since A1 needs the layer resolver).~~ **A1 obsolete** — its generators were deleted in #318; a future tests/composition-root feature is a fresh plan.
3. Highest _value_ independent of the above → **Track B** (production is wired to a mock-grade stub).
4. A2/A3 are cheap cleanups; fold A3 into whichever PR next touches `stubs.ts`.
