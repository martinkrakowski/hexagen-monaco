# Project planning layers — interactive brainstorming sessions (Phase 3)

**Status:** exploratory (2026-07-01 · revised 2026-07-06 after full codebase review) · **Owner:** Martin
**Driver:** Phase 1 ([project-planning-layers](./project-planning-layers.md))
_captures_ a brainstorm that happened elsewhere. Phase 3 makes the app _run_ it —
a multi-agent propose→critique→revise planning session that ends by generating
the manifest. That closes the whole loop inside HexaGen: **idea → in-app
brainstorm → manifest → governance**, every stage stored as a project layer.
This is where the product stops being "an importer with a governance chat" and
becomes _governed planning provenance_ — a genuinely novel surface none of the
adjacent tools have.

> This is a multi-week effort and **not** planned for build yet. It exists so the
> Phase 1 schema is shaped correctly and the eventual work has a spine to critique.

---

## What Phases 1 & 2 already give us

- **The turn schema is append-ready.** `ProjectLayer.turns: ProjectLayerTurn[]`
  (`{ id, author, content, at? }`) was chosen precisely so a live session
  _appends_ turns rather than reshaping storage, and `turn.id` gives streaming
  reconciliation and provenance a durable anchor. A v1 pasted archive and a
  Phase-3 live session are the same record; only the ingestion path differs.
  (Phase 3 does still need _additive_ fields — see Storage below; "append-ready"
  is not "schema-complete".)
- **The Plan phase view** already renders authored markdown turns
  (`PlanPhaseView` → `PlanTurnList` over `ChatMarkdown`). A live session just
  streams turns into the same view.
- **Provenance links** (Phase 2) already connect Plan ↔ Architecture, so a
  generated manifest can point back at the session that produced it.

---

## The session model

A brainstorm layer gains a lightweight lifecycle (the app's own dog-fooding of the
hexagonal state-machine pattern the Vellum manifest describes):

```
idle → proposing → critiquing → revising ⇄ critiquing → converged → finalizing → done
                                    │
                                    └─ human turn (steer / constrain / approve) at any point
```

- **proposing** — a "proposer" model expands the seed prompt into a first plan.
- **critiquing** — a distinct "critic" model attacks it (structural flaws,
  hand-waving, cut list) — exactly the role the pasted Grok↔Claude transcript
  played.
- **revising** — the proposer folds the critique into a tighter version.
- The loop repeats until **converged** (a bounded max-rounds cap, à la the demo's
  `maxAttempts`, so it can't run forever) or the human ends it.
- **finalizing** — extract the locked contracts/decisions and hand them to manifest
  generation.

The **human is a first-class author** — they can inject a turn to steer, add a
constraint, or force convergence. Every model turn _and_ human turn lands in
`layers[].turns` with its `author`, so the stored artifact is the honest record of
who said what.

The lifecycle must be **recoverable from storage**: after a mid-session reload
the app has to know whether the session converged, died at round 3, or is
waiting on a human turn. That is a persisted `layer.status`, not something
re-derived from prose — reconstructing machine state from free-text turns is
exactly the "vibe" failure mode the risks section warns against.

---

## Multi-agent orchestration

Reuses existing infrastructure where the reuse is real — with two corrections
from the review:

- **The chat path pins one global model.** The server chat route constructs
  `HandleServerChatUseCase` with `process.env.LLM_MODEL` once and ignores the
  client-requested model — "configurable" means configurable _per deployment_,
  not per role. Two roles therefore need **new (modest) config plumbing**, not
  reuse: `HandleServerChatUseCase` takes its model per instance and
  `ServerLLMAdapter` honors `request.model`, so the work is a two-model config
  surface + wiring. The actual precedent for per-role model/key configs is the
  **staged-pipeline wiring** (`createLLMProviderSelector`, the Stage-6
  reviewer/validator configs) — the orchestrator will reuse the pipeline's LLM
  plumbing at least as much as the chat route.
- A small **orchestrator** (a typed reducer, _not_ a LangGraph gesture — the
  transcript's own warning) owns the state machine, the round cap, the
  turn-appending, and the terminal condition. It emits turns; the Plan view
  streams them (the SSE accumulation pattern from `useGovernanceChat`). Note the
  current SSE protocol carries only `chunk`/`error`/`done` frames — a
  multi-turn session needs turn-boundary/author framing on top.
- **Grounding folds** (the governance-chat single-user-turn fix, PRs #391–#402)
  apply: each model turn is a single grounded message carrying the running plan +
  the latest critique, not a fragile multi-message stack. Folds are built from
  the reducer's runtime state, the same way `useGovernanceChat` builds them at
  send time.

**Fork #0 (the load-bearing one, previously implicit): where does the session
run?** The governance chat is strictly stateless request/response — the client
holds all conversational state and the server's only persistence is the SQLite
quota store — while layers persist client-side in IndexedDB. Pure reuse
therefore buys exactly one architecture: a **client-driven loop** (browser
orchestrator → one `/api/llm/chat` POST per model turn → append to
`layers[].turns` → next turn), with real consequences: the session dies with
the tab, the growing running-plan round-trips on every turn, the client can
forge "model" turns, and every turn burns the per-user 10-requests/minute
limiter plus the anonymous daily chat quota. A **server-side loop** avoids
those but needs a brand-new session store, a turn-aware streaming protocol, and
a hand-back path to client IDB for persistence. This fork determines the
schema, persistence, resumption, and streaming design — everything below
depends on it (open question 0).

---

## Finalize → generate manifest

The payoff: **converged plan → the existing pipelines** — with the seam stated
precisely, because the two distillation targets enter **different** pipelines:

- **Structured branch (real, verified):** distill the session into a
  `StructuredConfig` and POST it to `/api/manifest/generate/spec` →
  `ExecuteStructuredConfigGenerationUseCase` — the same route the import flow's
  structured branch uses, selected client-side by the existing `detectInputMode`
  detection.
- **Prose branch (different pipeline):** a prose spec does _not_ enter that use
  case (its Stage 0 is a deterministic config parse). In the real import flow,
  description-mode runs `/api/manifest/generate/stage` →
  `ExecuteFullStagedGenerationUseCase`, and semi-structured text goes through
  `/spec/convert` (`ExecuteLooseSpecConversionUseCase`) first. So fork #4
  ("structured vs prose distillation") is bigger than it looks — the branches
  differ in pipeline, quality profile, and telemetry.
- **The tail is new scope.** The pasted-spec flow terminates by **creating a new
  project** on the accept screen. Phase-3 finalize runs inside an _existing_
  saved project and must instead update that project's `manifestYaml`, re-derive
  `formState` from the new manifest (the accept flow's
  `parseManifestToWizardData` is the precedent), and attach provenance — an
  **update-existing accept/review path that does not exist today**. "No new
  _generation_ path" holds; a new _acceptance_ path does not.
- **Manifest history is an explicit fork, not a promise.** "Re-generation
  produces a new Architecture layer" would contradict Phase 1's locked decision
  that `manifestYaml` stays the canonical artifact and no manifest-as-layer
  refactor happens. Either (a) keep `manifestYaml` canonical and store history
  as read-only snapshot layers (a new `kind: "architecture"` + a
  source-layer/round link field — i.e. a deliberate, scoped revisit of that
  decision), or (b) keep latest-only and drop the history claim (open
  question 6).

---

## Storage

Phase 3 **will need additive schema beyond Phase 1** — the earlier draft claimed
"no schema change", which its own content contradicted. Expected additions, all
additive and cheap because `normalizeLoadedProjects` spreads unknown keys
through:

- `layer.status` — the persisted lifecycle state (see the session model): a
  reloaded project must distinguish `converged` from died-mid-round from
  awaiting-human.
- `turn.role` — a machine-readable `proposer | critic | human | system` anchor
  alongside the display-only free-form `author`; the convergence signal
  ("critic emits no blocking issues") needs something sturdier than string
  matching on author names.
- Round metadata — per-turn round, or recorded at finalize time into the
  provenance edge ("manifest ⇐ session #N, converged round K"), which itself
  needs a home (the Phase-2 link field on `ProjectLayer`).

None of these are added in Phase 1 — they depend on fork #0 and the convergence
design. A live session is otherwise a `ProjectLayer` whose `turns` grow over
time; the reducer persists (debounced) through the same `updateLayer` mutation.
`kind` may extend (`"brainstorm"` for the session, a future `"decisions"` layer
for extracted contracts, possibly `"architecture"` per fork 6).

---

## Risks — the transcript's own lessons, applied

- **Don't hand-wave the state machine.** Design states/transitions/terminal
  conditions + the round cap explicitly first, as typed artifacts. This is the
  part that gets interrogated.
- **Cost model up front — and there is no metering to lean on yet.** Each round
  is N model calls; the round cap and convergence detection are the cost
  governor. Neither reused path meters usage today: the chat SSE protocol has no
  usage frames and the description use-case hardcodes `tokensUsed: 0`. Raw
  usage _is_ parsed at the non-streaming adapter boundary, so surfacing a
  per-session estimate is propagation/aggregation work plus a streaming usage
  frame (or a char-count heuristic) — plumbing to plan, not from-scratch, but
  "governed iteration reduces rounds" is only credible with a number.
- **Convergence is hard.** Two models can loop politely forever or collapse into
  agreement. Need a real terminal condition (critic emits "no blocking issues" +
  a bounded cap + a human override), not a vibe — and the critic's verdict must
  be structured. The chat path streams free text only; structured streaming
  (`streamStructuredRequest`) and the judge precedent
  (`ExecuteValidationReviewUseCase`, from the golden harness) live on the
  pipeline side.
- **Concurrent writers are a data-loss hazard, not a corner case.** Every
  `useSavedProjects` mutation rewrites the whole projects array from a
  per-instance snapshot into a single IDB key, with no cross-tab or
  cross-instance sync. A debounced per-turn `updateLayer` flush from a stale
  snapshot clobbers not just the session but _other projects'_ recent edits.
  **Phase-3 precondition:** fresh read-merge-write inside the adapter, a shared
  store, or per-project keys (a persistence-port API change worth anticipating).
- **Abandoned sessions.** Tab close mid-round (or mid-stream under debounce) is
  a normal event over a multi-minute session. Resumption/cleanup is
  undesignable without `layer.status` — this is why the Storage section exists.
- **Write amplification + context growth.** Whole-array persistence means each
  debounced flush rewrites every saved project as the transcript grows; and the
  grounding fold (running plan + critiques) grows every round, squeezing the
  context window and the per-turn latency. Both push toward per-project
  persistence and fold summarization/truncation at some round depth.
- **Free tier and rate limits shape the product.** On the chat path, an R-round
  session burns ~2R anonymous daily chat units (quota 100/day) and the
  10-requests/minute limiter paces _all_ users to ~5 rounds/minute; Finalize
  burns a generation unit (10/day anon). And if the orchestrator becomes a
  server-side route calling the use case directly, it _bypasses_ `/api/llm/chat`
  quota enforcement entirely unless it gets its own gate.
- **Quality caveats are the feature, not a bug.** LLM-generated planning can be
  confidently wrong; the human-author turn and the visible critic role _are_ the
  HITL guardrail — lean into it rather than hiding it.
- **Latency / dead air.** A multi-round session is slow. Stream turns as they land
  (existing SSE pattern) so the Plan view is never a frozen spinner.

---

## Open design questions (resolve before any Phase-3 build)

0. **Where does the session run** — client-driven loop over `/api/llm/chat`, or
   a server-side session orchestrator (new session store + turn-aware streaming
   - IDB hand-back)? Determines schema, persistence, resumption, streaming
     protocol, and quota enforcement. Decide first; everything below depends on it.
1. Distinct proposer/critic models vs. one model, two role prompts? (Either way
   needs a new two-model config surface — the precedent is the staged-pipeline
   provider selector, not the chat route.)
2. Convergence signal — critic self-declares "converged", or a separate judge
   (`ExecuteValidationReviewUseCase` precedent), or human-only? Requires
   `turn.role` + a structured verdict.
3. Round cap default + whether the human can raise it mid-session.
4. Does "Finalize" distill to a `StructuredConfig` (→ spec route) or a prose
   spec (→ a _different_ pipeline: staged route, or convert-then-spec) — and
   does the user review the distillation before generation?
5. Model/provider config surface — reuse the BYOK/`LLM_MODEL` settings, or a
   dedicated "planning models" setting? Widened by review: is the free tier
   eligible for sessions at all, what does one session cost in quota units, and
   does a server-side orchestrator need its own quota/limiter gate?
6. Manifest history — snapshot `kind: "architecture"` layers (a scoped revisit
   of Phase 1's manifest-as-layer deferral) vs. latest-only?

---

## Related

- [project-planning-layers](./project-planning-layers.md) — Phase 1/2 (the
  schema, the Plan phase, provenance) this builds on.
- [staged-generation-baseline-findings](./staged-generation-baseline-findings.md)
  and `packages/agentic-interaction/src/application/use-cases/staged-generation/`
  — the "Finalize → generate manifest" target
  (`ExecuteStructuredConfigGenerationUseCase`,
  `ExecuteFullStagedGenerationUseCase`, `ExecuteLooseSpecConversionUseCase`).
- Governance-chat arc — PRs #391–#402: the chat dispatch, model config,
  grounding-fold, and SSE-streaming patterns the orchestrator adapts (code:
  `apps/web/app/api/llm/chat/route.ts`,
  `apps/web/features/manifest-generation/useGovernanceChat.ts`).

---

## v1 build decisions (2026-07-21)

The open questions above were resolved for the v1 build
(`feat/planning-layers-phase-3`) as follows:

- **Q0 — client-driven loop.** The browser tab owns the proposer⇄critic loop
  over the existing `/api/llm/chat` route (`usePlanningSession`). No server
  session store, no new streaming protocol, quota enforced per turn by the
  chat route as-is. Accepted consequence: the loop dies with the tab — the
  layer's persisted `status` stays non-terminal and the Plan phase shows an
  interrupted-session banner (Resume / End) on the next mount.
- **Q1 — one model, two role prompts.** Both roles use the standard chat model
  (`NEXT_PUBLIC_LLM_MODEL` fallback `gpt-4o-mini`); the proposer/critic split
  is prompt-level (`fold.ts` preambles). No new model-config surface.
- **Q2 — critic self-declared verdict.** The critic must end with
  `VERDICT: CONVERGED` or `VERDICT: CONTINUE` (case-insensitive, parsed from
  the trailing lines — `verdict.ts`). Missing/malformed verdict = CONTINUE
  plus a console warning, never a stall. Backstops: the round cap and a human
  **Force converge** control.
- **Q3 — round cap fixed at 4.** `DEFAULT_MAX_ROUNDS = 4`, not user-editable in
  v1. Hitting the cap parks the session at `awaiting-human` (`cap-reached`);
  **Resume past the cap is an explicit human extension** and advances the
  round counter by one (reducer `RESUME` from `cap-reached`).
- **Q4 — finalize distills to editable spec text.** One chat call converts the
  converged proposal into `contexts:`-dialect YAML (the deterministic
  structured-config import path), shown in an editable review. Only an
  explicit **Confirm** seeds the import flow (`import_spec_content`) and
  navigates — a NEW project via the existing import pipeline; never
  auto-navigate.
- **Q5 — existing chat quota, disclosed.** No new quota surface. The seed form
  states "each round uses 2 AI chat requests"; finalize discloses its one
  extra call.
- **Q6 — latest-only manifests.** No snapshot `kind: "architecture"` layers;
  `manifestYaml` stays canonical.

Build-level decisions that fell out of the implementation:

- **Clobber-safe layer writes.** All layer mutations commit through a new
  `updateProjectRecord(id, updater)` read-merge-write on the persistence port
  (fresh read at write time, single-record update) — a mid-session wizard
  autosave can no longer clobber freshly appended turns. Model turns persist
  content + `role`/`round` + the status transition in ONE write
  (`appendLayerTurn(turn, patch)`).
- **Session provenance hand-off.** The finalize Confirm puts the distilled
  spec text in the import page's own `sessionStorage` key, but the session
  TRANSCRIPT rides in the pending-manifest store
  (`originSession`, untouched by `set()`), guarded at accept-save by an exact
  spec-text match — so the new project gets the full brainstorm layer
  (`status: "done"`, `link: produced-manifest`) and an abandoned finalize
  can't leak its session onto an unrelated import.
- **Interrupted-session recovery maps a persisted ACTIVE status to
  `awaiting-human` (paused)** with the interrupted status as `resumeStatus`:
  Resume re-runs the interrupted role (a duplicate proposal is recoverable; a
  skipped critic verdict is not).
