# Stage-7 deterministic repair gate

**Status:** IMPLEMENTED 2026-06-18 · commit `8d74e2c1` · branch `feat/stage7-deterministic-repair-gate` · **Owner:** Martin
**Driver:** the nemotron-3-ultra Stage-6 pilot surfaced that the Stage-7 repair
gate re-validates with the LLM, so the reviewer's non-determinism rejects valid
repairs and doubles the latency. See `[[nemotron-stage-eval]]`,
`[[stage6-async-review-and-context-name-fix]]`, and the existing
`stage7-repair-rca-and-remediation.md`.

---

## Context — the prod run that exposed it (2026-06-18, post-PR-#350)

The context-name fix landed: **R03 on `identity-access` is gone** ✅ (was on
every prior run). Remaining findings were credible (R04 missing adapter, R08
workspace). But the Stage-7 line was nonsense:

```
Stage 7 · 1 edit applied but findings unchanged (11 of 2 remain) — keeping the
original. before 58p/57a, after 58p/58a
```

Decoded against the code (`execute-structured-config-generation.use-case.ts:1978`
= `(${errorsAfter} of ${errorsBefore} remain)`): **errorsBefore = 2, errorsAfter
= 11.** Sequence:

1. Stage 6 (nemotron) found **2** errors, incl. R04 (`InAppNotifierPort` has no
   adapter).
2. Stage 7 (gpt-4o) correctly emitted `add-adapter` → applied (57a → 58a). A
   legitimate fix.
3. The gate re-validates by **re-running Stage 6 on nemotron**
   (`:2116 this.stage6.execute`) → it returned **11** errors.
4. `evaluateRepairGate` (`:1271`): 11 ≥ 2 ⇒ not a strict reduction ⇒ repair
   **rejected**, original kept.

A correct +1-adapter repair cannot legitimately create 9 new errors, so the
2 → 11 swing is **nemotron non-determinism** on a near-identical input.

Two problems, one root cause:

- **The gate rejects good repairs.** It requires `errorsAfter < errorsBefore`
  where both counts come from a non-deterministic LLM, so noise alone fails the
  gate.
- **Hidden ~2× latency.** The re-validation is a _second_ full nemotron Stage-6
  call (`:2116`, invoked with no telemetry callbacks → invisible in the UI/logs).
  When Stage 7 engages, real cost ≈ review (~53s) + re-validation (~53s) ≈
  **~107s**, not the ~54s the labeled stages show.

---

## Root cause

`errorsAfter` is produced by re-running the **LLM** reviewer
(`revalidateRepairedManifest` → `this.stage6.execute`, `:1926`/`:2116`). But the
rules a Stage-7 op can fix are all **structural** (R01 banned-name, R03 repo
port, R04/R05 port-has-adapter, R10 publisher port, R18 leaky-name) — every one
is **deterministically computable from the manifest**. Using a slow,
non-deterministic LLM to score a question that's mechanically decidable is both
the noise source and the latency source.

---

## Fix — deterministic re-validation gate

Replace the gate's LLM re-validation with a **deterministic structural re-count**.
Keep nemotron for the user-facing _initial_ review; only the GATE's before/after
count becomes deterministic.

1. **Deterministic structural validator** over the rules repairs touch
   (`R02`–`R09` mechanical + `R12` adapter-name-uniqueness):
   - R02 `ctx.ports.in.length >= 1`; R03 `ctx.ports.out` has a `*RepositoryPort`;
     R04/R05 every out/in port is `implements`-ed by exactly one adapter; R06 no
     cross-context `implements`; R07 every `depends_on` names an existing context;
     R08 `workspace.name`/`description` non-empty; R09 shared-kernel has no ports.
   - **Reuse** `collectPortQualityIssues` (R16/R17/R18, already programmatic) and
     `isBannedContextName` (R01). **Audit** `validateManifest`
     (`in-memory-pipeline-ports.adapter.ts:165`) — reuse if it already does this,
     else build a focused `structuralManifestErrors(manifest): string[]`.
2. **Gate computation:** compute `errorsBefore` deterministically on the baseline
   assembled manifest and `errorsAfter` on the repaired one, then keep the
   existing pure `evaluateRepairGate` (`:1271`, strict reduction + no
   count/contextName drift). No `this.stage6.execute` second call.
3. **Behavioral wins:**
   - **Deterministic** — identical input ⇒ identical count; no 2 → 11 swings.
   - **No hidden latency** — the ~53s re-validation pass is gone; Stage 7 stays
     ~1s.
   - **Filters false-positive-driven repairs for free.** If nemotron's R04 was a
     false positive (the port already had an adapter), the deterministic
     `errorsBefore` won't include it, so a redundant `add-adapter` won't reduce
     the count ⇒ correctly rejected. The gate now only accepts repairs that
     _deterministically improve structure_.

### Implementation seams

- `execute-structured-config-generation.use-case.ts`: `:1926`
  `revalidateRepairedManifest` and `:2116` `this.stage6.execute` (the call to
  replace); `:1939` `errorsAfter`; `:1951` `errorsBefore` (also compute
  deterministically for apples-to-apples); `evaluateRepairGate` `:1271`
  unchanged.
- New `structuralManifestErrors` (domain) + tests; or extend `validateManifest`.

### Alternative (lighter first slice)

**Op-targeted post-check:** instead of a full structural re-count, verify each
_applied_ op resolved its own target (R03 add-out-port ⇒ ctx now has a
`*RepositoryPort`; R04/R05 add-adapter ⇒ the named port now has an adapter; R18
rename ⇒ leaky token gone) using `applyManifestOps`'s known `applied` list, plus
the existing drift check. Simpler, fully deterministic, but narrower than a
structural re-count. Could ship first, generalize later.

---

## Secondary fixes

- **Message wording** (`:1978`): "findings _unchanged_ (11 of 2 remain)" is
  self-contradictory (11 ≠ 2). Change to "findings not reduced (11 after vs 2
  before)". Trivial; fold in.
- **Hidden re-validation latency** is auto-resolved by removing the second LLM
  call (no separate work).

## Scope / risks / non-goals

- The deterministic `errorsBefore` may differ from nemotron's user-facing count
  (e.g. 2). That's fine — the user-facing findings are still nemotron's; only the
  internal **gate** switches to deterministic. Document this so the "2 errors
  shown" vs "gate saw N" distinction is clear.
- Semantic rules (R11 event-pairing, R15 intent reflection) are **not**
  gate-relevant — no Stage-7 op targets them — so leaving them LLM-only is
  correct.
- Keep the deterministic checks **faithful to the prompt's rule semantics**
  (R02–R09 text) so the gate and the reviewer don't disagree on what "structural"
  means; cover with tests.
- **Not in scope:** the async Part B UX, the `STAGE6_VALIDATOR_REASONING`
  reasoning-cap, the R08 assembler gap (tracked elsewhere). This is purely the
  repair gate.

## Relationship to the other nemotron-pilot work

All three are facets of "nemotron is accurate but slow and non-deterministic":

- **This (gate):** removes non-determinism + hidden latency from the repair path.
- **Part B (async):** hides the user-facing review latency.
- **Reasoning-cap:** reduces the per-pass review latency.
  Independent; ship in any order. This one is self-contained (backend only, no
  frontend).

## Sequencing

1. Audit `validateManifest`; build/confirm `structuralManifestErrors` + tests.
2. Swap the gate's re-validation to deterministic; keep `evaluateRepairGate`.
3. Fix the `:1978` message.
4. Prod re-test: a real R04 repair should now be **accepted** (count drops
   deterministically), Stage 7 stays ~1s, no 2→11 swings.

## Open decisions for Martin

- **Full structural re-count vs op-targeted post-check** (default: structural —
  more general, modest extra effort).
- Whether to keep an LLM re-validation as an _optional_ extra signal (default:
  no — it's the problem).
