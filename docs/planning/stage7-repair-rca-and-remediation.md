# Stage-6 validation & Stage-7 repair — RCA and remediation

**Status:** Issues A & B shipped (#344). RCA-4 (Stage-7 rebuild crashed on the model's output shape, swallowed) remediated in **#346** (merged + deployed). A 2nd prod run confirmed RCA-1 & RCA-4 fixed but revealed **semantic ineffectiveness** (the model drops the edits when re-emitting the whole manifest) — cured by **follow-up C** (structured-edit contract, branch `feat/stage7-structured-edits`); see §8-9.
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

**Follow-up (RCA-4).** After A & B shipped and deployed, a _second_ prod run surfaced a distinct failure: Stage 7 **always** discarding on error because the deterministic rebuild **crashed** on the model's output shape (typed-object ports) and the crash was **swallowed** by a bare `catch {}`. RCA-1/2/3 above are the gate _rejecting_ a repair; RCA-4 is the rebuild _crashing_ before the gate can judge. See **RCA-4** (§3) and the as-built remediation (**§8**).

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

### RCA-4 — Stage-7 rebuild crashes on the model's output shape, swallowed (surfaced post-#344 deploy)

After Issues A & B shipped (#344) and deployed, a _second_ prod run (3 Stage-6 errors) showed Stage 7 **always** falling back to _"Repair output was not a valid manifest"_ — the repair never applied when there was anything to fix.

**Root cause — a conflation of two responsibilities.** Stage 7 mixes _semantic repair_ (deciding what to fix — needs a model) with _structural reconstruction_ (producing a strictly-shaped artifact — needs deterministic code against a validated schema) by asking the model to re-emit the **whole** manifest. Told to fix port **types** (R03/R10), gpt-4o emitted ports as typed objects (`{ name, type }`) instead of the manifest's **bare name strings**; the deterministic rebuild called `name.toLowerCase()` on each entry → **threw** → and a bare `catch {}` **discarded the reason**, so the failure was a black box in prod.

**Reproduced.** `parseStructuredConfig` is robust to prose / indentation / leaked entities (all parse), so the throw is in the **rebuild**, not the parse — and the swallowed error meant the exact failing step was unobservable. (A first instinct — "fragile YAML reproduction" — was disproved by a throwaway probe before any fix.) RCA-1/2/3 are the gate _rejecting_ a repair; RCA-4 is the rebuild _crashing_ before the gate can judge.

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
- **context-name SET preserved unless the baseline had an R01 finding** _(added round-2, qodo re-raise)_ — the domain floor catches a swap that _loses_ domain, but a swap that fabricates an equal-count replacement context would still slip past count + no-shrink. R01 (banned name) is the only rule whose fix renames a context, so when the baseline carries no R01 the gate requires the sorted, normalized context-name set to be **identical**; an R01 baseline opts into the rename. (Carve-out, not lineage: an R01 baseline still admits a balanced swap of an _unrelated_ context — acceptably rare for a non-adversarial reviewer; full 1:1 lineage is the escalation if a regression surfaces.)

**Anchor the floor to the real original, not a reconstruction.** The `before` counts in the gate are `countManifestEntities(assembledManifest)` — the **actual original Stage-6 manifest** (7 / 65 / 57), the artifact the user would otherwise keep — never a re-derived baseline. This prevents comparing against a floor that a lossy round-trip could itself have lowered. Likewise `errorsBefore` is the **original** Stage-6 report (R17-filtered), not a reconstructed one.

**Accept criterion (revised):** apply the repair iff `errorsAfter < errorsBefore` (R16/R17-excluded) **AND** `contextCount === before` **AND** `portCount ≥ before` **AND** `adapterCount ≥ before` **AND** `domainMemberCount ≥ before` **AND** (`allowContextRename` _or_ the context-name sets are equal) — the last two added in the #344 round-2 review, all against the original Stage-6 manifest. Any failure mode keeps the original (unchanged fail-safe). This already neutralizes "gaming-by-padding": filler ports raise `portCount` but do not lower `errorsAfter`, so the `errorsAfter < errorsBefore` clause rejects them.

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
- **Risk:** the gate softening (B3) trades absolute count-preservation for "no net deletion + no context drift + no domain-member loss" (the domain floor added in the #344 round-2 review). Lower than it reads — gaming-by-padding is already caught by the accept criterion (a filler port raises `portCount` but doesn't lower `errorsAfter`, so `errorsAfter < errorsBefore` fails); a same-error-count restructuring is rejected by the strict `errorsAfter < errorsBefore` clause; an _error-reducing_ swap that drops a context's domain is rejected by the domain-member floor; and an error-reducing swap with **no** R01 baseline is rejected by the context-name-set check. The one genuinely residual case is now an error-reducing, all-counts-preserved swap of an _unrelated_ context that rides along **while** an R01 rename is also warranted — acceptably rare for a non-adversarial reviewer; the full 1:1 rename-lineage gate is the escalation if a regression surfaces.
- **Risk:** R16/R17 exclusion means a repair won't be _credited_ for fixing description/aggregate quality, and those findings won't re-surface post-repair. Acceptable — a manifest-level repair can't address them anyway; the rich-port alternative (§4) is the escalation path.
- **Rollback:** independent of activation; `STAGE6_REVIEWER_API_KEY` unset still disables Stage 7 entirely (see [[stage6_verify_repair]] in memory).

---

## 7. Decision log

- **2026-06-15** — `Fix R18 matcher` + `Invest: make repair work for AI-port specs` (user, AskUserQuestion). Issue A shipped same day; Issue B per §4 (gate softening flagged for confirmation).
- **2026-06-15 (review pass)** — incorporated review feedback: **B1a** field-synthesis answer (name-level repair, deterministic type inference, naming-convention prompt — no metadata synthesis required, so the manifest-feed path stands); **B2** "by construction" justification + uniform-artifact nuance; **B3** floor anchored to the original Stage-6 manifest; alternative decoupled from the normalizer rewire; the AI-port orchestrator test elevated to the acceptance gate (write first). Rich-port remains the escalation for metadata-level (R16/R17) repair only.
- **2026-06-15 (follow-up, RCA-4)** — post-#344-deploy prod run showed Stage-7 always discarding on error. Chose **option B** (tolerant rebuild + observability + prompt realignment) over option A (instrument-only) and option C (structured-edit redesign, deferred) via AskUserQuestion. Shipped in PR #346 (§8); two review rounds folded in (qodo prompt-contradiction, CodeRabbit non-array slots).

---

## 8. Applied remediation — PR #346 (as built)

Remediation for **RCA-4**, on branch `fix/stage7-repair-robustness` (off main), three commits. Four pillars: **(a)** stop swallowing the error; **(b)** make ingestion tolerant of the model's common deviations; **(c)** report — never silently drop — what it can't ingest; **(d)** align the prompt so the drift stops at the source.

### Commit progression

| Commit     | Driver                             | Why separate                                                                                                      |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `0e188d92` | RCA-4 (option B)                   | Core: observability + entry-level tolerance + discard reporting + prompt realignment.                             |
| `4bbe9611` | qodo "prompt contradicts manifest" | The `<configuration>` user-prompt tag (kept to avoid test churn) contradicted the manifest-framed system prompt.  |
| `21d4cd72` | CodeRabbit "guard non-array slots" | Entry-level tolerance didn't cover the container shape; a scalar/object **slot** still threw before coercion ran. |

The scope grew across review rounds **legitimately, not by creep**: each round caught a distinct layer of the same shape-tolerance problem (entry → container) or a coherence gap (system vs user prompt) the original commit left.

### `execute-structured-config-generation.use-case.ts` (orchestrator — locus of the bug)

- **`summarizeError(e)`** _(pillar a)_ — first line of an error, truncated. Turns the discarded exception into a readable reason; the bare `catch {}` was itself the worst defect — a 100%-failing path with zero diagnostics.
- **`coercePortName(entry)`** _(pillar b)_ — salvages a name from a string OR a `{ name, … }` object; `null` for un-nameable. The direct fix for the reproduced crash; the port's type is still inferred from the coerced name.
- **`toEntryArray(value)`** _(pillar b, commit 3 — the easily-missed second layer)_ — normalizes a list **slot**: array → as-is; non-empty scalar → one-element list; else `[]`. Entry-level coercion is necessary **but not sufficient**: a scalar (`out: FooPort`) or object-shaped container blows up at the **iteration site** (`.map` / `for…of`) _before_ `coercePortName` ever runs. Salvaging a scalar (vs a blunt `Array.isArray ? : []`) avoids silently dropping a single-item port.
- **`collectMalformedManifestEntries(manifest)`** _(pillar c, exported)_ — reports entries/slots it can't salvage, so a silently-dropped port the model tried to add is **visible** (a passing-but-incomplete repair is harder to notice than a failure). Its slot guard also stops `for…of` throwing on an object slot — and it runs first in revalidation, so without the guard it would crash before the builders.
- **`buildPreDefinedPortMap` / `buildPreDefinedAdapterBindings`** _(pillar b)_ — route every entry through `toEntryArray → coercePortName → filter`. This is the reconstruction path; tolerance here is what lets a _fixable_ repair apply instead of being discarded. `buildPreDefinedPortMap` exported for unit testing.
- **Repair block** _(pillars a, c)_ — the single swallowing `try/catch` split into parse-phase and rebuild-phase handling, each surfacing `summarizeError` + a 200-char snippet of the raw output. `revalidateRepairedManifest` now returns `discarded`; the block logs the discard count **before** the gate, and the success line became repair **coverage**: _"Repaired X of N findings — Z remain (W discarded)."_

### `execute-manifest-repair.use-case.ts` (Stage-7 streaming wrapper)

- Doc comment + `execute(rawConfig)` → `execute(manifestYaml)` + telemetry `summary` ("Repaired configuration emitted" → "manifest") + streamed "Rewriting configuration…" → "manifest". The value **is** the manifest now (post-#344 B1); honestly-named variables/labels prevent the exact config-vs-manifest confusion that caused the bug.

### `generate-manifest.prompt.ts` (prompt contract — pillar d)

- **`STAGE7_REPAIR_SYSTEM_PROMPT`** realigned to manifest repair: a MANIFEST SHAPE section (`layers.*`), a bare-name-strings mandate, an explicit "DO NOT add `type:` / DO NOT turn a name into a map" rule with the bad pattern, and a one-shot before/after example (R03 adds `InvoiceRepositoryPort` as a bare list item). Without this the tolerant rebuild merely **absorbs** drift that would keep recurring; the example is the strongest lever against typed-object output.
- **`compileStage7Prompt`** _(commit 2, qodo)_ — `<configuration>` → `<manifest>` delimiters; closing line → "Emit the corrected manifest YAML … bare name strings"; param `rawConfig` → `manifestYaml`. The system and user prompts had been contradicting each other.
- A stale comment asserting _"we repair the configuration, **not** the assembled manifest"_ — the inverse of the current design — corrected with the #344 rationale.

### Tests

- **NEW `stage7-rebuild-robustness.test.ts`** — `coercePortName` (string / object / un-nameable); `buildPreDefinedPortMap` (typed-object coerced — _the regression_; un-nameable dropped; scalar slot salvaged; object slot → no ports, no throw); `collectMalformedManifestEntries` (salvageable not reported; un-nameable reported; object slot reported with **no `for…of` throw**; scalar not reported).
- **`generate-manifest.prompt.test.ts`** — injection-escape test retargeted to `<manifest>`.
- **`execute-structured-config-airport-repair.test.ts`** — the mock reviewer's extraction regex retargeted to `<manifest>`. **Load-bearing in a non-obvious way:** the mock extracts the fed manifest from the delimiter, so a missed rename would feed Stage 7 an **empty string** and the test would pass **vacuously** (the gate rejects an empty manifest — "correct" behavior for the wrong reason). _Checklist item for any future prompt-delimiter rename: confirm the extracting mock and the prompt move together, and that the test still exercises a non-empty path._

Suite **684/684**, typecheck + lint clean.

### Status & honest caveat

PR #346 **merged + deployed**; gated by `STAGE6_REVIEWER_API_KEY` (unset ⇒ byte-identical, off). That remediation was **tolerance + observability**: the swallowed error meant the _exact_ prod cause couldn't be confirmed (typed-object ports a strong, reproduced hypothesis, not a proof). The deploy was the confirmation — a re-run of the same spec resolved it into one of:

1. _"Repaired X of N findings"_ with **zero discards** → fixed cleanly. ✓
2. The parse/rebuild error + output snippet → a **residual cause**, no longer hidden — chase it.
3. _"Repaired …"_ with a **non-zero discard count** → gate passed but the manifest is quietly **incomplete**.
4. **What actually happened (2nd prod run):** the crash _and_ the R18 false positives were **both gone** (3 real findings, no R18; clean rebuild, zero discards) — **RCA-1 and RCA-4 confirmed fixed in prod**. But the repair _ran cleanly and changed nothing_: gpt-4o faithfully reproduced the ~2k-token manifest and **dropped the 3 small additive edits**, so the gate kept the original (_"3 of 3 remain"_). A NEW outcome — **semantic ineffectiveness**, not a structural crash — and the decisive trigger for follow-up C.

---

## 9. Follow-up C — structured-edit contract (as built)

Branch `feat/stage7-structured-edits`. The conflation RCA-4 named — _semantic repair_ (a model job) vs _structural reconstruction_ (deterministic code) — is dissolved by shrinking the model's job from "re-emit the whole manifest" to "emit a few typed edits", applied deterministically.

**The contract.** The reviewer emits ONLY a small JSON op-list, e.g.:

```json
[
  {
    "op": "add-out-port",
    "context": "identity-access",
    "name": "UserRepositoryPort"
  },
  {
    "op": "add-adapter",
    "context": "identity-access",
    "name": "RegisterUserAdapter"
  }
]
```

Five ops cover every rule a manifest-level repair can act on: `add-out-port` / `add-in-port` (R03/R10), `add-adapter` (R05), `rename-port` (R18), `rename-context` (R01).

**Why it removes the failure class (not just softens it):**

- The model never reproduces the 2k-token artifact, so it can't "drop" edits amid faithful reproduction (outcome 4) and can't mis-shape a slot/entry — the PR #346 tolerance work (`coercePortName` / `toEntryArray`) is no longer load-bearing on this path.
- The op set is **add/rename only** — it _cannot_ delete a context or shrink ports, so the "drop a context to shed R01" gaming vector is impossible **by construction**; the gate's shrink checks become pure defense-in-depth.
- Ops apply to a **deep copy** of the original (the fail-safe is never mutated); re-validation + the integrity gate are unchanged downstream.

**Files:**

- NEW `domain/manifest/apply-repair-ops.ts` — `RepairOp` union, `parseRepairOps` (tolerates a prose/fence wrapper around the array; reports unrecognised ops), `applyManifestOps` (applies on a clone; reports skips: unknown context, duplicate add, missing rename target). Pure, unit-tested.
- `generate-manifest.prompt.ts` — `STAGE7_REPAIR_OPS_SYSTEM_PROMPT` + `compileStage7OpsPrompt`; the whole-manifest `STAGE7_REPAIR_SYSTEM_PROMPT` / `compileStage7Prompt` are **deleted**.
- `execute-manifest-repair.use-case.ts` — emits the op-list (smaller token ceiling; "Planning repair edits" telemetry).
- `execute-structured-config-generation.use-case.ts` — parse ops → `applyManifestOps` on the original → revalidate → gate. The no-reduction path now logs before/after port/adapter counts (the bundled outcome-4 observability) plus applied/skipped/ignored op counts.

**Tests:** apply-engine units (each op, skip cases, clone-isolation), `parseRepairOps` (clean / prose / fenced / mixed-invalid), e2e repair rewritten to emit ops (rename clears R01 + domain survives; an applied edit that doesn't reduce findings is kept; an op for an unknown context is skipped). Suite 694/694, typecheck + lint clean.

**Honest caveat (still).** C removes the _structural_ failure mode. Whether gpt-4o emits the _right_ ops (semantic correctness) is the remaining variable — but the op-list is small enough to inspect, and the before/after + skip logging makes a wrong/no-op edit visible. The deploy re-test is, again, the confirmation.
