# Import round-trip integrity — remediation plan (items 1–4)

**Status:** Proposed (2026-07-21) · **Owner:** Martin
**Driver:** The alvaro-ai field test (#407–#411) fixed the import _pipeline_; this
plan fixes what happens to an imported project _after_ acceptance. Four items,
each traced to code before planning (4-way adversarially-verified trace,
main @ `76fa5bd1`): (1) the wizard round-trip destroys imported manifests —
and, the trace's reshaping discovery, **every export/generation path already
consumes the degraded projection today**, so the damage was never gated on
pressing Next; (2) the Stage-6 judge reports R04/R05 globally across contexts
against per-context rules, minting phantom errors and burning a Stage-7 call
per dialect import; (3) the accept view's client auto-fixer is the last silent
mutator in the flow and pads redundant ports/adapters into accepted manifests;
(4) the generating step spins forever when the NDJSON stream ends without a
terminal frame (the 660-second prod spinner).

---

## Item 1 — Imported projects: the wizard round-trip is lossy and the loss is already live

### Current state (grounded)

- **Parse (accept):** `parseManifestToWizardData`
  (`packages/wizard-orchestration/src/application/manifest-parser.ts:31-206`)
  maps an imported manifest into `WizardData`. Named ports are filtered against
  the 8 checkbox catalog literals (`:138-173`) — real imported names never
  match, so `portConfiguration` is empty; context `type` is dropped entirely;
  `depends_on`, `apps[]`, `context_mappings`, `relationships`, `invariants`,
  `governance`, `planes`, `monorepo`/`generator` blocks are never read;
  `domainEvents`/`peerMappings`/`externalContexts` are hardcoded `[]`
  (`:93,:176-177`); `uiFramework`/`infrastructureTarget` are hardcoded
  `""`/`"plain-ts"` (`:90,:94-95`).
- **Rebuild:** `wizardToManifest`
  (`packages/wizard-orchestration/src/application/wizard-to-manifest.ts:235-493`)
  reconstructs the entire manifest from wizard fields only: ports from
  checkboxes (`:438-443`), adapters from the persistence/messaging pickers
  (`:444-449`), `type` from `name.includes("shared")` (`:436,:471`) — so
  `supporting`/`generic`/`driver` become `core` and a shared-kernel not named
  `*shared*` loses its type _and_ triggers synthetic `shared`-context injection
  (`:293-326`) — `depends_on` reset (`:451-467`), hardcoded `monorepo` +
  `generator` blocks (`:347-433`), `apps` re-derived from the degraded
  `plain-ts` fields (`:434,:532-618`).
- **The reshaping discovery — exports are already degraded:** every export and
  generation path consumes the `wizardToManifest` projection, never the saved
  manifest — most send `wizardData` and let the routes fall back to
  `wizardToManifest`; `handleGenerate` converts client-side and sends the
  result as `manifest`; the architecture-zip converts client-side with no
  route at all:
  - ZIP export: `ExportContext.exportZip` sends `{projectId, wizardData}`
    (`apps/web/app/contexts/ExportContext.tsx:211-215`) →
    `body.manifest ?? wizardToManifest(body.wizardData)`
    (`apps/web/app/api/export/zip/route.ts:21-29`) — **the `body.manifest`
    branch already exists and is never used**.
  - GitHub scaffold publish: same shape (`ExportContext.tsx:308-318` →
    `apps/web/app/api/export/github/route.ts:52-60`).
  - Code-view generate/download: `useProjectGeneration.ts:40-48,111-117` →
    `apps/web/app/api/generate/route.ts:33-42`; architecture-zip is
    client-side `wizardToManifest` (`useArchitectureDownload.ts:17`).
  - `handleGenerate` on a loaded imported project mints a **new** project that
    is degraded from birth (`useProjectGenerationFlow.ts:42-77`).
- **The autosave clobber (destroys the last rich copy):** in edit mode,
  `handleNext` (`useProjectLifecycle.ts:139-163`) and `handleSaveAndNew`
  (`:205-226`) write `updateProject(id, formValues,
JSON.stringify(wizardToManifest(formValues)))` — the only two `updateProject`
  callers. Two defects in one line: the rich `manifestYaml` is replaced by the
  degraded projection, and the field flips from YAML text to `JSON.stringify`
  output (survives only because JSON ⊂ YAML for the `yaml.load` consumers).
- **Who reads the saved `manifestYaml` today:** only the governance assistant
  (`wizard/layout.tsx:43`, `useProjectLifecycle.ts:191` →
  `GovernancePanelWrapper.tsx:36-40` → `/api/governance/*`). That is why the
  degradation went unnoticed: the one consumer of the rich copy is the one
  surface that still looked right.

Full loss inventory (parse-loss vs rebuild-loss per field) lives in the trace;
the summary: **name, description, entities, value_objects, use_cases, and the
7 exact-literal catalog adapters survive; everything else architectural is
lost or corrupted** — and even catalog matches survive exactly one generation
(the rebuild renames them, e.g. `Prisma` → `Prisma.adapter.ts`).

### Fix — Phase A (stopgap, this plan): manifest-as-source-of-truth for imported projects

The saved record already holds both artifacts; the fix is to stop letting the
degraded projection overwrite or impersonate the rich one.

1. **Origin marker.** Add `manifestSource: "imported" | "wizard"` to
   `ProjectConfig`/formState (schema default `"wizard"` so legacy records and
   wizard-authored flows are untouched). `parseManifestToWizardData` sets
   `"imported"`; nothing else sets it. Persisted via existing formState
   round-trip (`normalizeLoadedProjects` preserves unknown keys — proven in
   #404).
2. **Autosave guard.** In `handleNext`/`handleSaveAndNew`, when
   `formState.manifestSource === "imported"`: update `formState` only and
   **keep the existing `manifestYaml`** (change `updateProject` call to pass
   the loaded project's current `manifestYaml`, or add an
   `updateProjectFormState` variant). The rich copy becomes durable.
3. **Exports send the manifest.** In `ExportContext` (ZIP + GitHub scaffold)
   and `useProjectGeneration`: when the active project is imported, include a
   `manifest:` field in the payload — the `body.manifest ?? …` fallbacks
   already accept it, so the server change is zero. Two mechanics to get
   right: the routes type `manifest` as a **parsed `Manifest` object**, not
   YAML text (`export/zip/route.ts:13` → forwarded as-is into
   `InitiateExportUseCase`), so the client parses the saved YAML before
   sending; and `useArchitectureDownload` has no route at all — its fix is a
   client-side swap (dump the saved manifest instead of
   `wizardToManifest(wizardData)`, `useArchitectureDownload.ts:12-33`).
   Wizard-authored projects keep the live-first `wizardData` path (#222)
   unchanged.
4. **Ports step honesty.** When `manifestSource === "imported"`, the
   port-configuration step renders a read-only "ports are managed by the
   imported manifest" banner (listing the real named ports per context from a
   light manifest parse) instead of the misleading empty checkboxes; same
   banner pattern for the persistence/messaging pickers.
5. **`handleGenerate` parity:** generation from an imported project sends the
   saved manifest, not `wizardToManifest(formValues)`.

What Phase A deliberately does NOT do: make wizard edits (entities, use-cases,
add-ons) flow back into the imported manifest. Those edits still land in
formState and take effect for wizard-authored fields; for imported projects the
manifest stays authoritative for architecture until Phase B.

### Fix — Phase B (follow-up, separately scoped): true round-trip

Named-structure passthrough on formState (`importedArchitecture` carrying
ports-with-types, context types, `depends_on`, adapters, apps,
context_mappings) that `wizardToManifest` re-emits and merges with wizard
fields, making the checkboxes additive and edits bidirectional. Large: touches
`ProjectConfig` schema, parser, rebuilder, completeness analysis
(`analyzeManifestCompleteness`), preview panes, and codegen assumptions. Not
started here; Phase A makes it non-urgent.

---

## Item 2 — Stage-6 judge: scope R04/R05 per context (prompt + deterministic recount)

### Current state (grounded)

- The judge prompt's R04/R05 Checks quantify over **all** of
  `<adapter_bindings>` with no same-context scoping
  (`generate-manifest.prompt.ts:596-600`), while R06 explicitly says "the SAME
  context's entry" (`:602-603`). The grounding sections are grouped per context
  (`:737-792`) but nothing tells the judge the counting scope. No R04/R05
  few-shot exists (`:644-650` covers R06/R10/R15/R13/R18). The prod alvaro
  findings ("implemented by 2 adapters … (context 'image-domain') and …
  (context 'real-esrgan')") are LLM improvisation on that ambiguity — the
  seeding design (#411) legitimately places shared port names in multiple
  contexts, so every dialect import now bakes this bait.
- The deterministic gate counts per context
  (`execute-structured-config-generation.use-case.ts:1758-1773,:1830-1847`)
  but **its output reaches the user-facing report only on the accepted-repair
  path** (`:2868-2873`); on the default path the judge's findings are the only
  user-visible R04/R05 channel (`finalReport = s6.value`, `:2565-2566`).
  **A bare discard filter would therefore silently lose genuine same-context
  violations** — the fix must be discard **+ recompute**, the established
  R01/R16-18 house pattern (`execute-validation-review.use-case.ts:292-316`).
- Import-cycle constraint: `execute-structured-config-generation` imports
  `execute-validation-review` (`:38-41`), so the review use-case cannot import
  `structuralManifestErrors` back. The per-context counting must be extracted
  into a shared domain helper.

### Fix

1. **Prompt (suspenders):** reword R04/R05 Checks to mirror R06's proven
   same-context phrasing, plus one disambiguation line: a port name appearing
   in another context's entry is counted separately — cross-context sharing is
   the single-ownership advisory's job, not R04/R05.
2. **Deterministic recount (belt):** new
   `packages/agentic-interaction/src/domain/manifest/port-adapter-coverage.ts`
   exporting the per-context count logic; `structuralManifestErrors` refactors
   onto it (behavior-identical), and `execute-validation-review` adds
   `R04|R05` to the discard regexes (`:283-284`) and appends the deterministic
   per-context findings (guarded on `state.stage3 && state.stage4`;
   shared-kernel exemption and empty-`implements` skip preserved).
3. **Effect on Stage 7:** scoped-out phantoms no longer inflate
   `baselineReport.errors`, so dialect imports stop triggering no-op GPT-4o
   repair calls (`:2621` gate).

---

## Item 3 — Accept-view auto-fixer: gate on the server report, disclose the rest

### Current state (grounded)

- `ManifestPreview` runs `applyDeterministicFix` to fixpoint on mount and on
  every store write (`ManifestPreview.tsx:120-148`, re-armed via ref reset
  `:121-124`), silently committing through `onYamlChange` →
  `pendingManifest.updateYaml` (`ManifestAcceptPage.tsx:338`). The persisted
  YAML is the padded store copy — the `onApprove(localManifestYaml)` argument
  is **dead** on the accept page (`handleApprove` discards it,
  `ManifestAcceptPage.tsx:151-154`); the interception seam is the loop /
  `onYamlChange`, not approve.
- The parser flags "Unconnected Ports"/"Zero Adapters" from name-containment
  on a name-only YAML (`manifest-view-data-parser.ts:249-274`) — it cannot see
  server-side declared bindings, so alvaro-class manifests get padded
  (`portToAdapterName` synthesis, `manifest-violation-fixer.ts` Zero-Adapters/
  Unconnected classes) with adapters that duplicate real ones and can violate
  global R12 uniqueness (fixture repro, re-run and confirmed: `StorageAdapter`
  ×3, `JobQueueAdapter` ×2, plus fabricated
  `WebUiCommandPort`/`WebUiRepositoryPort` on the UI context — `web-ui`,
  emitted `type: supporting` — which legitimately declared none). Matcher
  parity alone fixes none of these — the bindings were declared, not
  inferrable.
- The pipeline's `done` frame carries the server `ValidationReport`, but the
  accept store drops it today (`usePendingManifest` has no report field), so
  the accept view has no way to know the server already validated + synthesized.

### Fix

1. **Plumb the report:** `usePendingManifest` gains
   `validationReport: ValidationReport | null` (both `set()` callers; import
   flow has it in scope at `ImportProjectSpecPage.tsx:638`; prompt flow
   re-exposes `stream.validationReport` through `useStagedManifestGeneration`).
2. **Gate the loop:** `ManifestPreview` skips the auto-fix loop when a server
   report is present. The fixer stays live for report-less YAML (hand-edited
   or legacy paths) — it exists for a reason there.
3. **Mandatory companion — `hasFailures` must not dead-end approve:** with the
   fixer gated, the parser's connectivity heuristics would flag alvaro-class
   manifests as FAIL and disable the approve button
   (`ManifestPreview.tsx:159`, `ManifestAcceptPage.tsx:65-66`). When a report
   is present: the Validation tab renders the **server** report (errors,
   warnings, advisories, disclosed adjustments), parser connectivity items are
   downgraded to advisory, and `hasFailures` keys on Invalid-YAML + server
   `passed === false` only.
4. **Disclosure for the remaining fixer paths:** when the fixer does run
   (report-less YAML), surface an "adjustments applied" list instead of silent
   mutation — same disclosure standard the server pipeline now meets.
5. **Include the parser's `:232` overwrite bug**
   (`manifest-view-data-parser.ts:226-232` — a later out-port whose base
   cross-contains an already-matched adapter's base steals that adapter's
   `implements` in the parser's view model) in this PR's test scope; combined
   with the fixer's exact-base skip (`manifest-violation-fixer.ts:244-255`) it
   can strand a FAIL item unfixable.

---

## Item 4 — Generating step: no more silent stream death

### Current state (grounded)

- Single reader loop for staged generation:
  `useStagedGenerationStream.ts:276-284`. On `reader.read() → done` without a
  terminal frame the loop breaks **silently**: no error state, `phase` stays
  `stage-N`, `generate()` resolves normally (`:449-452`).
- The residual-buffer flush (`:407-433`) exists but only parses a residual
  `done` frame — a residual `error` frame is dropped — and writes only the
  local result object, not React state.
- The existing 300s inactivity watchdog (`READ_TIMEOUT_MS`, `:214,:266-273`)
  cancels the reader — which funnels into the **same silent path**.
- Two symptom profiles: the import flow has a backstop error box
  (`ImportProjectSpecPage.tsx:337-345,:366-373`) but the spinner + timer keep
  running beside it (`ThinkingBlock.tsx:367` hides only for idle/failed); the
  **prompt flow is the true forever-hang** — `GenerateWithAi.tsx:75-79` gates
  the screen only on `generationError`, generation is fire-and-forget
  (`:135-139`), so premature end parks it in "generating" indefinitely.

### Fix

1. **Terminal-frame accounting in the hook:** track `sawTerminalFrame`
   (in-loop done/error + flush); on reader end without one → `phase: "failed"`
   - `generationError` with retry-oriented copy (must not contain the
     substring `"No cloud LLM API keys configured"` — special-cased at
     `ImportProjectSpecPage.tsx:328`).
2. **Fix the flush:** parse residual `error` frames too; make the flush write
   React state, not just the local result.
3. **Tag watchdog cancels** (`timedOut` flag before `reader.cancel()`) for a
   distinct "no data received for 300s" message; keep the user-cancel
   early-return first so cancel stays phase `"idle"`.
4. **Surface retry:** prompt flow's Try Again card already exists
   (`GenerateWithAi.tsx:325-343`) and now becomes reachable; import flow adds
   a Retry button beside Go Back — or finally consumes the dead
   `stream.retry()` (`useStagedGenerationStream.ts:491-496`, interface
   `:119`; no non-test caller anywhere), which additionally requires
   re-exposing `retry` through `useStagedSpecGeneration` (its return block at
   `:563-583` doesn't pass it through today).
5. **Noted, out of scope:** 8 other hand-rolled `getReader()` loops in
   apps/web share the silent-end exposure (`useLooseSpecConversion`,
   `useGovernanceChat`, `usePipelineStreaming`, …). Extracting a shared
   hardened reader is a follow-up once this shape is proven here.

---

## PR slicing and order

| PR         | Scope                                                                                                                        | Size | Risk                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| **PR-1**   | Item 2: prompt scoping + `port-adapter-coverage` helper + discard-and-recompute                                              | S    | Low (server-only; house pattern)                                                     |
| **PR-2**   | Item 4: stream terminal-frame accounting + flush fix + watchdog tagging + retry surfaces                                     | S–M  | Low (client-only; existing test harness)                                             |
| **PR-3**   | Item 3: report plumbing + fixer gate + `hasFailures` companion + disclosure                                                  | M    | Medium (accept-view UX; the companion is what keeps approve alive)                   |
| **PR-4**   | Item 1 Phase A: `manifestSource` flag + autosave guard + exports-send-manifest + ports-step banner + `handleGenerate` parity | M    | Medium (cross-cutting but additive; wizard-authored flows untouched by construction) |
| PR-5 (opt) | Item 1 Phase B: full named-structure passthrough                                                                             | L    | Scoped separately when wanted                                                        |

Order rationale: PR-1/PR-2 are small, independent, and immediately stop the
phantom-error + silent-hang classes; PR-3's report plumbing is also what PR-4's
accept-flow verification uses; PR-4 is the data-integrity payload. If only one
thing ships first, **PR-4's autosave guard (steps 1–2) can be cherry-picked as
a minimal data-loss stopper** — it is two functions and a schema default.

## Verification

- **PR-1:** unit tests on the shared helper (behavior-parity with
  `structuralManifestErrors` pinned); validation-review tests: judge-emitted
  cross-context R04 discarded + same-context violation recomputed (fake-LLM
  harness at `__tests__/use-cases/staged-generation/execute-validation-review.test.ts`);
  alvaro fixture chain asserts zero R04/R05 in the final report.
- **PR-2:** extend `useStagedGenerationStream.test.ts` (existing
  `createMockReadableStream` harness): stream end without done → failed +
  error; residual done without trailing newline → success; residual error
  frame → error; watchdog cancel → distinct message; user cancel → idle.
- **PR-3:** ManifestPreview tests: report present → no mutation, approve
  enabled, server report rendered; report absent → fixer runs + adjustments
  disclosed. Fixture: alvaro dialect YAML (padded-name assertions keyed to the
  fixture repro — `StorageAdapter`×3 — not the prod run's LLM-dependent names).
- **PR-4:** wizard round-trip regression: import fixture → accept → Next
  through every step → saved `manifestYaml` byte-identical; export payload
  contains `manifest:` for imported projects; wizard-authored project payloads
  unchanged (live-first #222 pinned); governance panel still reads the rich
  manifest. Manual: vellum-shaped 16-context import, walk all steps, export
  ZIP, diff against source.

## Risks

- **PR-3's companion is not optional:** gating the fixer without re-keying
  `hasFailures` bricks the approve button for exactly the manifests the server
  now validates best.
- **Item 2 discard-without-recompute would regress** genuine same-context
  findings (judge is the only default-path channel today).
- **Phase A forks behavior on `manifestSource`** — every new consumer must ask
  "imported or authored?"; keep the fork count low (5 sites listed) and
  documented, or Phase B pressure grows.
- The autosave guard changes `updateProject` semantics for imported projects;
  the #404 clobber-safety analysis (same-instance writes) still applies.

## Out of scope

Binding-aware client matching (needs `implements` in the emitted YAML — the
#400 durable fix, its own project) · shared hardened stream reader across the
8 sibling hooks · Stage-7 routing (deterministic-fixable classes skip LLM
repair) · R03 breadth policy (repository-port synthesis on non-core contexts)
· the Vellum F1–F21 remediation
([2026-07-07-vellum-generation-findings-and-remediation](./2026-07-07-vellum-generation-findings-and-remediation.md)).

## Related

- [2026-07-11-import-hardening-and-review-summary-ux](./2026-07-11-import-hardening-and-review-summary-ux.md)
  — the #407–#410 arc this continues.
- #411 (alvaro RCA fixes) — the pipeline-side fixes; this plan is the
  post-acceptance side.
- `docs/planning/project-planning-layers.md` — the provenance arc; unaffected,
  but PR-4's autosave guard touches the same `useProjectLifecycle` seam as the
  Plan-phase layer mutations (#405).
