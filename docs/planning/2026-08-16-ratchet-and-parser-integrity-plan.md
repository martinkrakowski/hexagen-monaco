# Ratchet & Parser Integrity — Plan (RI-1 / RI-2)

**Date:** 2026-08-16 · **Status:** Proposed. RI-1 buildable now (its blocker cleared);
RI-2 needs **D-R1**.
**Origin:** surfaced while building item 2.3's ratchet leg (PR #465) and item 3.4 (PR #466).
Neither was created by that work; both were exposed by it.

> **Status note — 2026-08-16 (committed with PR #468).** Both origin PRs have since merged:
> **#465** (`b3f79dd6`, ratchet leg in CI — this made Phase 2 green) and **#466**
> (`03b1369f`, ts-morph aligned to `^27`). RI-1's stated dependency is therefore satisfied and
> it is buildable today. No RI item has been built. The analysis and recommendations below
> stand as written; only status has moved. One material refinement to RI-2's cost is recorded
> in its own section.

Locators are durable (file + symbol), not line numbers, per planning house style.

---

## Why these two are one plan

Both are **a check that reports more confidence than it has earned**, and both fail _quietly_
in the direction of false assurance:

- **RI-1** — the arch-lint ratchet prints `Architecture is compliant` and exits 0 while its
  accepted-debt list is growing or rotting.
- **RI-2** — the refactoring impact analyser prints a complete, confident impact report over
  source files it could not parse.

That is the same defect class this repo has now hit **six** times (`sync --dry-run` as an
architecture gate; an arch-linter bin never resolvable in CI; a linter reporting compliant when
its own config failed to parse; `validate-ui-boundary.sh` printing PASSED on a renamed key; a
boundary check blind to alias imports; an error-level eslint rule that has never seen an `@/`
import). The unifying acceptance criterion is the same one FU-1/2/3 uses: **a check's scope and
confidence must be visible in its output**, not discoverable only by reading its source.

---

## RI-1 — the arch-lint ratchet is review-enforced, not machine-enforced

Item 2.2 (#459) seeded `.architecture/arch-lint-baseline.json` with 34 accepted violations.
Item 2.3's third leg (#465, **merged** `b3f79dd6`) wires it into CI. The ratchet correctly
fails on a **new** violation. It does not constrain the baseline itself.

**Verified in the source, not inferred:**

| Behaviour                                                  | Where                                | Result                           |
| ---------------------------------------------------------- | ------------------------------------ | -------------------------------- |
| New violation                                              | `partitionAgainstBaseline` → `fresh` | fails, exit 1 ✅                 |
| Baselined violation                                        | → `baselined`                        | suppressed, exit 0 ✅ (intended) |
| **Stale entry** (baselined violation no longer reproduces) | → `stale`                            | **warning only, exit 0**         |
| **Baseline grows** (a PR adds entries)                     | —                                    | **no check exists anywhere**     |

`tools/arch-linter/src/ratchet-baseline.ts` documents the stale case as "warned about" — this
is ADR-0054 §1 as designed, not a bug in the implementation. The gap is that **nothing converts
the design intent ("shrink, never grow") into a machine check.**

**Why it matters more than it looks.** The 34 entries include 11 `zod`-in-domain findings whose
disposition is an open decision. A ratchet nobody can grow is a debt ceiling; a ratchet anybody
can grow is a debt _laundry_ — the cheapest way to make a new violation pass is to append a
line, and today that PR goes green. The stale case is milder but has the same shape: an entry
that no longer reproduces is a standing amnesty for a violation that could silently return.

**This is not urgent-broken.** The gate is real and catches new violations today. RI-1 closes
the loop so the ratchet's central property is enforced rather than trusted.

### Items

| #          | Item                                                                                                                                           | Gate      | Size |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| **RI-1.1** | CI step: fail if `arch-lint-baseline.json` has **more** entries than at the merge base                                                         | none      | S    |
| **RI-1.2** | Make stale entries fail rather than warn, behind an opt-out flag                                                                               | **D-R1a** | S    |
| **RI-1.3** | Emit the baseline count as a visible line in every run (`34 suppressed / 0 stale`) so drift is legible in the job log without reading the file | none      | XS   |

**RI-1.1 build notes.** The check needs the base ref, so it belongs in the workflow (which has
`actions/checkout`) rather than in the CLI (which has no git). Compare entry **counts and keys**
against `git show <base>:.architecture/arch-lint-baseline.json`, so a PR that swaps one entry
for another is caught, not just net growth. Handle the baseline not existing on the base ref
(a first-introduction PR) as a pass, and say so in the message. Deliberate growth must remain
_possible_ — with an explicit label or an override token in the PR — or the check will be
disabled the first time it is inconvenient, which is worse than not having it.

**RI-1.2 is gated because it is a policy change, not a fix.** Making stale entries fatal is
correct in principle — it forces burn-down — but it turns "someone fixed a violation and
didn't un-pin it" from a warning into a red build on an unrelated PR. That is exactly the
dynamic that gets ratchets switched off. See **D-R1a**.

---

## RI-2 — refactoring impact analysis silently trusts unparseable input

`packages/sync/src/application/use-cases/refactoring-impact.use-case.ts` builds a ts-morph
`Project`, adds source files recursively (`addSourceFilesRecursively`), and walks the AST to
produce `ImpactAnalysisResult`. **It never consults diagnostics** — `grep -c "Diagnostic"` over
that file returns **0**.

A file the compiler cannot parse contributes an empty or truncated AST. The analyser reports
`filesToModify`, `crossPackageDeps` and `estimatedChanges` computed over that hole and returns
a result indistinguishable from a clean run.

**This is a published-surface concern.** `@hexagen-monaco/sync` is the engine behind
`hexagen arch refactor`, which is pointed at _arbitrary consumer workspaces_ — code this repo
has never seen and cannot vet. Item 3.4 (#466) demonstrated the concrete mechanism: under the
old bundled compiler, an `import defer` statement made the **entire `ImportDeclaration` vanish
from the AST** while the run stayed silent. #466 fixes the version; it does not fix the class.
A consumer on syntax newer than the bundled compiler reproduces it immediately.

### The cost is lower than first reported

The earlier hand-off said fixing this "changes `ImpactAnalysisResult`'s shape". Measured:
`ImpactAnalysisResult` (`packages/sync/src/domain/services/impact-analysis.types.ts`) **already
carries `warnings: string[]`**, and the use case already populates it via `generateWarnings`.
So a minimal, non-breaking fix exists — surface unparseable files through the existing channel.
A stronger fix (a typed `unparseableFiles` field, or refusing to emit a report at all) does
change the shape, and has **8 consumer files** in `packages/sync` (`refactoring-engine.ts`,
`impact-analyzer.ts`, `refactor-shared.ts`, four `refactoring-patterns/*`, plus the use case).
_(Re-measured 2026-08-16: still 8. `refactoring/index.ts` also names the type but only
re-exports it.)_

> **Refinement — 2026-08-16, from item 5.7 / PR #470 (open at time of writing).** That PR puts
> ts-morph behind a DTO port (`SymbolReferenceIndexPort` / `SymbolReferenceDto`), so the
> application layer no longer holds live `SourceFile` nodes. It does **not** change RI-2's
> behaviour — `grep -c "Diagnostic"` on the use case still returns 0, so the gap below is
> exactly as described. What changes is the **cost**: because the DTO is a per-file record
> rather than a bare path→reason pair, RI-2.1 becomes purely additive across three known
> places — an optional `diagnostics` field on `SymbolReferenceDto`, populated by the adapter
> (which holds the `Project` and can call `getSyntacticDiagnostics`), consumed by
> `generateWarnings`. Before #470 the same fix required the application layer to reach into a
> `SourceFile`. **Net: RI-2.1 gets easier, not harder.** Sequence RI-2.1 after #470 lands, and
> size it against #470's tree rather than this document's original estimate. The size column
> in the items table below is not yet re-scored.

### Decision gate D-R1 — warn, or refuse?

- **(a) Warn (minimal).** Collect syntactic diagnostics, push one warning per unparseable file
  into the existing `warnings` array. No shape change, no consumer churn, ships in the next
  release. **But** a warning in a string array is easy to ignore, and the caller still gets a
  confident-looking report.
- **(b) Refuse (strict).** If any file in scope fails to parse, do not emit an impact report —
  return a typed failure. Correct for a tool whose entire output is a claim about code it
  read. Changes the result contract and all 8 consumers; a published breaking change.
- **(c) Both, staged.** Ship (a) now as a non-breaking safety net; do (b) at the next major.

**Recommendation: (c).** The analyser's output is advice a human acts on, and today it gives
no signal at all — (a) removes the silence immediately at near-zero risk. But "I analysed code
I could not read" should ultimately be a refusal, not a footnote, and that belongs with a
deliberate major-version change rather than smuggled into a patch.

### Items

| #          | Item                                                                                                                | Gate               | Size                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------- |
| **RI-2.1** | Collect `getPreEmitDiagnostics` (or syntactic-only) and surface unparseable files via the existing `warnings` array | none               | S                         |
| **RI-2.2** | Regression test: a file with syntax the bundled compiler rejects produces a warning naming that file                | after RI-2.1       | S                         |
| **RI-2.3** | Typed failure mode — refuse to emit a report when any in-scope file is unparseable                                  | **D-R1** = (b)/(c) | M — 8 consumers, breaking |

**Scope the diagnostics deliberately.** `getPreEmitDiagnostics` includes _semantic_ errors, and
a consumer workspace with unresolved types would then warn on nearly every file — noise that
trains people to ignore the channel. **Syntactic diagnostics only** is the correct filter: they
mean "I could not read this", which is the actual claim being made. State the choice in code.

---

## Verification (both)

- **Failing-first, then adversarial.** RED before GREEN, then a separate pass asking _"can this
  be fooled?"_ Eight guards in this repo over the last three days shipped with holes their own
  RED→GREEN tests did not catch; that discipline answers "does it detect the bug I am fixing",
  never "can it be trivially bypassed".
- **RI-1.1 must be proven on a real PR**, not locally: a branch that appends a baseline entry
  must redden CI. A workflow-only check that has never run against a base ref is exactly the
  shape of the AUD-010 bug.
- **RI-2.2 must not pass against a stub.** Assert on the _named file_ appearing in `warnings`,
  and pair it with a control asserting a clean file produces no warning — otherwise a
  hard-coded warning satisfies the test.
- Mutation-restore by **inverse edit**, never `git checkout`; verify byte-identical after.
- **Known pre-existing, not to be absorbed:** `apps/web/app/lib/fetch-json.test.ts` fails 12
  tests on Node ≥24 (#435 hazard); `packages/sync` `typecheck:test` has a documented ports-drift
  baseline.

## Risks

- **RI-1.2 is the one that could backfire.** A stale-entry failure lands on whoever happens to
  fix a violation without un-pinning — an unrelated PR going red is how ratchets get disabled.
  Ship RI-1.3's visible counts first and see whether warnings alone drive burn-down.
- **RI-2.1 on a noisy consumer workspace.** If syntactic diagnostics turn out to be common in
  the wild (rather than rare), the warning channel floods. Sample real generated projects before
  assuming the signal is quiet.
- **RI-2.3 is a published breaking change** — `@hexagen-monaco/sync` is release-gated, so it
  ships only with an authorised release and needs a release note.
- Neither item touches `.architecture/manifest.yaml` or any `context.yaml`.

## Sequencing

```text
RI-1.3  (visible counts)      ─┐  independent, do first — cheapest, informs RI-1.2
RI-1.1  (growth check)        ─┘
RI-2.1 → RI-2.2               ─── independent of RI-1 entirely
RI-1.2  (⇐ D-R1a)             ─── after RI-1.3 has produced evidence
RI-2.3  (⇐ D-R1, release-gated)
```

RI-1 and RI-2 touch disjoint trees (`tools/arch-linter` + workflow vs `packages/sync`) and can
run in parallel.

## Relationship to other work

**Neither gates the architecture-remediation arc.** RI-1 depended on PR #465 being merged (it
wires the ratchet into CI) — **that landed** (`b3f79dd6`), so RI-1 is unblocked. RI-2 is
adjacent to but independent of PR #466 (**merged**, `03b1369f`), which fixes the ts-morph
version that _exposed_ the parser gap without addressing it. RI-2 now also has a sequencing
relationship with item 5.7 / PR #470 — see the refinement note in RI-2.

Open decisions that interact: the **`zod`-in-domain** disposition determines whether 11 of the
34 baseline entries burn down or become permanent, which is the main thing RI-1.1 would be
protecting.
