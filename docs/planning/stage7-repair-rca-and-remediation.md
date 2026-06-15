# Stage-6 validation & Stage-7 repair — RCA and remediation

**Status:** Issue A shipped (`296c6a85`, branch `fix/stage7-airport-revalidation`); Issue B designed, pending build.
**Date:** 2026-06-15
**Trigger:** First real prod test of Stage-7 verify-and-repair (shipped in #343, live 2026-06-15) against a 7-context structured spec (`Architectural project configuration.md`).

---

## 1. Executive summary

A real spec import produced **"26 errors found"**, then Stage-7 GPT-4o repair ran for **42.7s / ~6,000 tokens**, was **rejected by the integrity gate** ("Repair altered the manifest structure — keeping the original"), and the user was left with the **same 26 findings**. The new pipeline worked _mechanically_ (clean Stage 6→7 hand-off, explicit `[mercury-2]`/`[gpt-4o]` telemetry chips, the integrity gate firing) but the _outcome_ was useless and costly.

Investigation found **two independent defects** (one pre-existing, one introduced by #343) plus a **gate-design tension**:

| #         | Defect                                                                                                            | Origin                          | Effect                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **RCA-1** | R18 runtime-concern leak check matches on a single shared token                                                   | Pre-existing (Stage 6)          | 22 of 26 "errors" are false positives — domain ports flagged for sharing one noun with a multi-word infra concern                   |
| **RCA-2** | Stage-7 re-validation reconstructs ports via `buildPreDefinedPortMap`, which is empty for AI-generated-port specs | Introduced by #343              | Repair can **never apply** for specs whose ports the AI generated (the common case); always rejected, always wastes the gpt-4o call |
| **RCA-3** | The counts-_preservation_ integrity gate blocks legitimate _additive_ repairs                                     | Introduced by #343 review round | Even once RCA-2 is fixed, repairs that fix R03/R05 by **adding** ports/adapters are rejected                                        |

---

## 2. Observed behavior (telemetry)

Spec: 7 bounded contexts, 8 aggregates, 44 value objects, 34 use cases, 15 context mappings; **no pre-defined hexagonal ports** (the AI generates them).

```
Stage 3 · Port Mapping        — [mercury-2] · 8.2s   (7 contexts → 65 port definitions, LLM-derived)
Stage 4 · Adapter Assignment  — [mercury-2] · 2.5s   (57 adapters)
Stage 6 · Validation Review   — [mercury-2] · 2.1s   → 26 errors, 0 warnings
Stage 6 found 26 errors — handing off to the reviewer model for Stage 7 verify-and-repair
Stage 7 · Manifest Repair     — [gpt-4o]   · 42.7s  (~6000 tokens)
Stage 7 · Re-validating the repaired manifest…
Stage 7 · Repair altered the manifest structure (contexts/ports/adapters) — keeping the original
```

The 26 errors: 1× R03, 3× R05, **22× R18** ("Port name … leaks runtime concern …"), e.g.:

- `[R18] CreateInvoicePort … leaks runtime concern "overdue-invoice-detection"`
- `[R18] UserEventPublisher … leaks runtime concern "event-bus"`
- `[R18] EmailNotifierPort … leaks runtime concern "email-retry"`

The spec's runtime concerns (`apps[].responsibilities` + deployment platforms): `event-bus`, `stripe-integration`, `supabase-admin-client`, `overdue-invoice-detection`, `email-retry`, `vercel`, `fly.io`.

---

## 3. Root cause analysis

### RCA-1 — R18 over-matches on a single shared token (pre-existing, Stage 6)

**Mechanism.** `checkRuntimeConcernLeak` in `packages/agentic-interaction/src/domain/services/port-quality-validator.ts` tokenized each runtime concern and flagged a port if **any single ≥3-char concern token equalled any port token**:

```ts
const concernTokens = concern
  .toLowerCase()
  .split(/[-_\s.]+/)
  .filter(Boolean);
const match = concernTokens.some(
  (ct) => ct.length >= 3 && portTokens.some((pt) => pt === ct),
);
```

**Why it fires falsely.** Multi-word infra concerns contain **domain nouns**:

- `overdue-invoice-detection` → `[overdue, invoice, detection]`; **`invoice`** matches every invoice port (`CreateInvoicePort`, `InvoiceRepository`, `SendInvoicePort`, …).
- `event-bus` → `[event, bus]`; **`event`** matches every `*EventPublisher` (which _should_ contain "event" — they publish domain events).
- `email-retry` → `[email, retry]`; **`email`** matches `EmailNotifierPort`.

R18's stated intent (per its own prompt comment) was to catch ports **named after** a worker responsibility — `EmailRetryPort`, `OverdueInvoiceDetectionPort` — not ports that merely share one domain noun. The tokenizer conflated the two. Result: 22 false positives on this spec; the manifest was essentially fine.

### RCA-2 — Stage-7 re-validation can't reconstruct AI-generated ports (introduced by #343)

**Mechanism.** The Stage-7 design (#343) repairs the **raw config** and re-validates by reconstructing pipeline state deterministically:

```ts
// execute-structured-config-generation.use-case.ts — reconstructAndValidate(config)
const portMap = buildPreDefinedPortMap(config);              // ← reads ctx.layers.application.ports
const adapterBindings = buildPreDefinedAdapterBindings(config, portMap);
const manifest = this.stage5.execute({ …, stage3: portMap, stage4: adapterBindings });
const report  = await this.stage6.execute({ …, stage5: manifest });
```

`buildPreDefinedPortMap` only includes contexts that **pre-declare** `layers.application.ports` (`ctxHasPreDefinedPorts`).

**Why it's empty here.** This spec (and the common case) has **zero pre-defined ports** (`layers:` / `ports:` / `adapters:` = 0 occurrences) — Stage 3 **LLM-generated** all 65 ports. The repaired config is in the same shape (no `layers`), so:

- `buildPreDefinedPortMap(repairedConfig)` → **empty** → reconstructed manifest has **0 ports / 0 adapters**.
- `countManifestEntities`: original = 7 / 65 / 57; reconstructed = 7 / **0 / 0**.
- The integrity gate sees the port/adapter counts collapse → **"structure altered"** → rejects, **every time**, for any AI-generated-port spec.

Worse, the repair prompt hands gpt-4o a **port-less config** while all 26 findings are about ports it can't see — it never had a chance.

**The gate earned its keep here.** Without the counts gate, re-validation would have computed `errorsAfter` on the degenerate **0-port** manifest (0 ports ⇒ 0 R18 ⇒ fewer errors than 26 ⇒ "improvement"), **applied** it, and shipped the user an **empty manifest**. The review-round gate (#343) prevented that — but it also masks that the repair path is non-functional for this spec class.

### RCA-3 — counts-_preservation_ gate blocks additive repairs (introduced by #343 review)

The integrity gate **as first implemented in the #343 review round** required **counts preserved** — `contextCount === && portCount === && adapterCount ===` (verified at `159af7dd`), i.e. nothing added or removed — to stop a model gaming the error count by _deleting_ the offending element. (This is the gate RCA-3 analyses; **§4 B3 below relaxes it** — the current `evaluateRepairGate` is non-shrinking, not preservation.) But legitimate repairs for the residual findings are **additions**:

- **R03** ("context has no outbound repository port") → _add_ a repository port.
- **R05** ("inbound port lacks an adapter") → _add_ an adapter.

So even after RCA-2 is fixed, the **original** count-_preservation_ gate rejects every additive repair → repair still delivers nothing for this spec (whose only real findings, post-RCA-1, are R03/R05). B3 is therefore an **optimization** of the gate (admit growth, still block shrink), not a reversal of it.

---

## 4. Remediation

### Issue A — R18 matcher (SHIPPED, `296c6a85`)

A port "leaks" a runtime concern only when it is **named after** it: a contiguous, in-order run of at least `min(2, |concern|)` of the concern's tokens appears in the port-name tokens.

- `EmailRetryPort` (`[email, retry]` ⊇ `[email, retry]`) → flagged ✓
- `OverdueInvoiceDetectionPort` (contains `[overdue, invoice]`) → flagged ✓
- `CreateInvoicePort` (only `invoice`), `UserEventPublisher` (only `event`), `EmailNotifierPort` (only `email`) → **not** flagged ✓

Single-token concerns (e.g. `fly.io` → `[fly]`) keep matching on the single token; the deployment-platform regex backstop (`PLATFORM_TOKENS`) is unchanged. Existing positive tests (`EmailRetryPort`, `OverdueInvoiceDetectionPort`, `FlyIO`, `StripeReconciliation`) still pass; a false-positive guard test was added. Suite 651/651.

**Effect on the test spec:** 26 → ~4 findings (1× R03 + 3× R05). The advisory panel stops crying wolf.

### Issue B — make Stage-7 repair work for AI-generated-port specs (DESIGN)

**B1. Feed Stage 7 the assembled _manifest_, not the raw config.** The manifest carries `layers.application.ports.{in,out}` as **string-name arrays** (confirmed: `draft-to-manifest.transform.ts` → `transformPortNames` → `ports.map(p => p.name)`), exactly the shape `buildPreDefinedPortMap` consumes. So:

- gpt-4o repairs the manifest (renames leaking ports, adds a missing repository, etc.) — it can now _see_ the ports.
- `buildPreDefinedPortMap(parse(repairedManifest))` returns the real ports instead of empty.
- Re-validation reuses the orchestrator's **in-scope** Stage 0/1/2 (`normalizedPrompt` / `domainAnalysis` / `classification`) rather than rebuilding them from the manifest — faithful R01 and classification.

**B1a — what gpt-4o actually edits (the field-synthesis question).** Because the manifest is **name-only**, the repair is a **name-level** operation: gpt-4o _renames_ a leaking port, or _adds_ a port **name** — it does **not** synthesize port metadata, because none exists at this layer. The port **type** is then derived **deterministically** by `buildPreDefinedPortMap` from the name (`inferInboundPortType` / `inferOutboundPortType`), so an R03 fix is "add an out-port named `…Repository`" → inferred type `repository` → R03 satisfied; an R05 fix is "add an adapter named to match the port" → `inferAdapterImplements` binds it. The repair prompt must therefore encode the **naming conventions** that drive inference (`…Port` / `…Repository` / `…Publisher` / `…Adapter`), not ask for descriptions/types. Consequence: an added port is exactly as rich as every other port in the (name-only) manifest — **no asymmetry** between a synthesized port and the originals, so nothing is concealed relative to peers.

**B2. Treat R16/R17 as reconstruction artifacts (principled, not pragmatic).** R16 (description quality) and R17 (`forAggregate` validity) are computed from **Stage-3 state**, which the manifest YAML does not carry — so they are unresolvable by a manifest-level repair **by construction**. `buildPreDefinedPortMap` gives every reconstructed port a name-derived description (→ a _uniform_ R16 across all ports) and no `forAggregate` (→ R17 cannot fire). Both are therefore **excluded** from the gate's before/after error comparison and from the post-repair report, so the gate judges only the rules a manifest-level repair can actually move: **R18 / R03 / R05 / R01**. (`errorsBefore` is the original Stage-6 report with R17 filtered out for symmetry; `errorsAfter` naturally has none.) The exclusion **is** load-bearing — but it suppresses a _uniform_ artifact (every port, not just synthesized ones), so it conceals no asymmetric deficit, and the user-facing manifest is name-only with or without repair. Repairing R16/R17 themselves requires the rich-port path (§4 alternative).

**B3. Relax the integrity gate from "preserved" to "no shrink, no context drift" (the one real tradeoff).**

- **context count must be exact** — still cannot invent or delete a bounded context (the primary gaming vector — e.g. deleting a banned context to shed R01).
- **port/adapter counts may grow but not shrink** — admits legitimate additive fixes (R03/R05) while still blocking the "delete the offending port to shed its finding" game.
- **domain-member count must not shrink** _(added in the PR #344 round-2 review, commit `2d61782a`)_ — context count being exact still permits a count-preserving **swap** (delete context A, add context C) or a rename whose new context ships an empty `layers.domain`; both keep contexts/ports/adapters intact but lose domain members. Only a domain-member floor catches that silent loss.

**Anchor the floor to the real original, not a reconstruction.** The `before` counts in the gate are `countManifestEntities(assembledManifest)` — the **actual original Stage-6 manifest** (7 / 65 / 57), the artifact the user would otherwise keep — never a re-derived baseline. This prevents comparing against a floor that a lossy round-trip could itself have lowered. Likewise `errorsBefore` is the **original** Stage-6 report (R17-filtered), not a reconstructed one.

**Accept criterion (revised):** apply the repair iff `errorsAfter < errorsBefore` (R16/R17-excluded) **AND** `contextCount === before` **AND** `portCount ≥ before` **AND** `adapterCount ≥ before` **AND** `domainMemberCount ≥ before` (the last added in the #344 round-2 review), all against the original Stage-6 manifest. Any failure mode keeps the original (unchanged fail-safe). This already neutralizes "gaming-by-padding": filler ports raise `portCount` but do not lower `errorsAfter`, so the `errorsAfter < errorsBefore` clause rejects them.

**Alternative considered — repair the rich Stage-3/4 port map (not the manifest).** gpt-4o would emit a corrected `port_map` + `adapter_bindings` JSON (descriptions / types / `forAggregate` intact), re-validated by plugging straight into Stage 5/6. More faithful (R16/R17 survive, no name-inference, no exclusion) but a larger rewrite of the repair use case + prompt + a robust structured-output parser, and a reliability cost (re-emitting ~65 ports as JSON risks dropped/malformed entries — the count gate rejects those, so it fails safe but repairs less often). **Independent of the prompt-path normalizer rewire** ([[ai_manifest_staged_pipeline]]): the structured-config path already holds the rich Stage-3/4 state in scope, so this needs no Stage-0–2 LLM parity and the two land separately. **Deferred** unless metadata-level repair (R16/R17) becomes a requirement; B1–B3 deliver the high-value rename/add repairs at much lower risk and higher reliability.

**Touch points:**

- `execute-manifest-repair.use-case.ts` — input is the manifest; prompt/label say "manifest" (mechanics unchanged: escape + emit corrected YAML).
- `execute-structured-config-generation.use-case.ts` — feed `assembledManifest.yaml` to Stage 7; re-validate reusing in-scope Stage 0/1/2; the revised gate + R16/R17 exclusion.
- Telemetry/log lines unchanged (already explicit per Phase 3).

---

## 5. Verification plan

- **Unit (R18):** false-positive guard + retained positives — DONE (651/651).
- **Unit (Stage-7, AI-port spec) — write this FIRST; it is the acceptance gate for Issue B.** An orchestrator test where the spec has **no** pre-defined ports, the original manifest has N ports, and a mock reviewer renames a leaking port → re-validation finds fewer errors with counts preserved → **applied** (today impossible — it must fail before the fix and pass after). Plus: a reviewer that **drops** a context/port → rejected; one that **adds** a repository port (R03 fix) → applied (ports grew); one that **pads** with a filler port but doesn't reduce errors → rejected.
- **Suites:** full `@hexagen/agentic-interaction` + web (typecheck + tests) + lint.
- **Manual:** re-run the same spec import; expect ~4 findings pre-repair, a repair that actually reduces them, and no 0-port degenerate output.

---

## 6. Scope, risks, open decisions

- **Scope:** spec-import path only (consistent with Phase 1/2). Prompt-path parity still deferred.
- **Risk:** the gate softening (B3) trades absolute count-preservation for "no net deletion + no context drift + no domain-member loss" (the domain floor added in the #344 round-2 review). Lower than it reads — gaming-by-padding is already caught by the accept criterion (a filler port raises `portCount` but doesn't lower `errorsAfter`, so `errorsAfter < errorsBefore` fails); a same-error-count restructuring is rejected by the strict `errorsAfter < errorsBefore` clause; an _error-reducing_ swap that drops a context's domain is rejected by the domain-member floor. The one genuinely residual case is an error-reducing swap that **preserves** the domain-member count — acceptably rare for a non-adversarial reviewer; revisit only if a real regression surfaces.
- **Risk:** R16/R17 exclusion means a repair won't be _credited_ for fixing description/aggregate quality, and those findings won't re-surface post-repair. Acceptable — a manifest-level repair can't address them anyway; the rich-port alternative (§4) is the escalation path.
- **Rollback:** independent of activation; `STAGE6_REVIEWER_API_KEY` unset still disables Stage 7 entirely (see [[stage6_verify_repair]] in memory).

---

## 7. Decision log

- **2026-06-15** — `Fix R18 matcher` + `Invest: make repair work for AI-port specs` (user, AskUserQuestion). Issue A shipped same day; Issue B per §4 (gate softening flagged for confirmation).
- **2026-06-15 (review pass)** — incorporated review feedback: **B1a** field-synthesis answer (name-level repair, deterministic type inference, naming-convention prompt — no metadata synthesis required, so the manifest-feed path stands); **B2** "by construction" justification + uniform-artifact nuance; **B3** floor anchored to the original Stage-6 manifest; alternative decoupled from the normalizer rewire; the AI-port orchestrator test elevated to the acceptance gate (write first). Rich-port remains the escalation for metadata-level (R16/R17) repair only.
