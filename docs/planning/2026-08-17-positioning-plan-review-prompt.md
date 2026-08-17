# Review Prompt — Conformance Positioning Plan & Runbook

**Purpose:** hand this prompt, verbatim, to a fresh agent session (no prior context from the
session that authored the documents) to independently review the 2026-08-17 positioning arc.

---

## Prompt

You are an independent reviewer with an adversarial mandate. A strategy arc for this
repository (Hexagen-Monaco) was produced in a single session by one author-agent: a
positioning plan, a validation/adversarial review of that plan, and a development runbook.
Your job is to find where the _author_ is wrong — including where its "verification" is
wrong — not to summarize or polish. A review that merely agrees is a failed review. You
succeed by producing refutations, downgrades, or material findings the author missed.

### Inputs

Read in this order:

1. `docs/planning/2026-08-17-conformance-positioning-plan.md` — the original strategy draft.
2. `docs/planning/2026-08-17-positioning-plan-validation-and-adversarial-review.md` — the
   author's own verification and adversarial findings (A1–A7, D-1–D-4).
3. `docs/planning/2026-08-17-fde-gtm-development-runbook.md` — the execution plan derived
   from 1 and 2.

The repository itself is your ground truth. **Never accept a file/line citation in these
documents at face value — open the file.** The author's review corrected the plan's stale
claims; assume the author's review contains stale or wrong claims of its own.

### Part 1 — Re-verify the load-bearing factual claims (highest priority)

For each claim below, independently check the tree and issue a verdict:
**CONFIRMED / WEAKENED (true but overstated or missing caveats) / REFUTED**, with file:line
evidence you gathered yourself.

1. **License blocker (finding A1).** Read `LICENSE` and `README.md` yourself. Does the
   license actually prohibit the plan's "OSS CLI free forever" wedge? Is the open-core
   split (D-1 Option A) legally coherent given existing published npm packages
   (`@hexagen-monaco/sync`, `@hexagen-monaco/arch-linter` — check what license those
   artifacts were published under in `package.json` / `publish.yml`)? If the published
   packages already carry a permissive license field, A1 may be wrong in an important way.
2. **"The conformance engine already exists and is published."** Confirm
   `tools/arch-linter` capabilities against its actual rule sources and tests. Is the
   ratchet (`ratchet-baseline.ts`) genuinely equivalent to the plan's "baseline ratchet"
   feature (per-PR new-violation gating), or only a repo-wide count?
3. **Layout coupling (finding A3).** Verify that `hexagen-lint` cannot produce a useful
   report on a non-Hexagen-shaped repo. Attempt the strongest counter-case: how far does
   the existing root/manifest discovery + `linter-config.yaml` actually get you without
   the proposed `layout.yaml`? Is the claimed Phase-0 unlock (~1–1.5 weeks) credible given
   how deeply `layer-classifier.ts` assumptions propagate?
4. **"Manifest inference does not exist at all."** Search for any inference-adjacent
   capability the author missed (import-graph analysis, brownfield, reverse-engineering,
   anything in `packages/mcp-server` tools or the TUI).
5. **The quota defect.** Confirm the six cited routes call `enforceDailyQuota`
   unconditionally and that `enforce-quota.ts` states the signed-in exemption contract.
   Confirm the spec→convert double-charge. Then check whether there is a _deliberate_
   reason (commit messages, ADRs, `planned_subscription_gate`-related docs) that
   unconditional metering was chosen — a documented decision would downgrade this from
   "defect" to "known tradeoff," and the runbook's Phase 0.4 fix could be actively wrong.
6. **Auth/persistence characterization.** Confirm: NextAuth gates the cited routes; no DB
   adapter/accounts/middleware; `/api/projects/[projectId]` returns 501; saved-project
   schema is v4 with migrations. Check whether the runbook's revised estimates (accounts
   ~1 wk, server persistence 2–3 wks) survive contact with the actual code volume involved.
7. **Staleness claims.** The review asserts the "ships dark / NOT yet routed" comment at
   `execute-full-staged-generation.use-case.ts:20` is stale and the full staged pipeline is
   live. Verify against the live route wiring, not the comment.

### Part 2 — Attack the strategy and the runbook

- **False dichotomies:** D-1 presents open-core vs. fully-proprietary. Are there viable
  options it excludes (BSL/fair-source with a change date, free-for-small-teams grants,
  proprietary-but-free binary distribution)? Same scrutiny for D-3 and D-4.
- **Competitive blind spot:** the documents mention dependency-cruiser and eslint boundary
  plugins only. Assess the actual field — Nx module boundaries, Sherlock/ts-arch/ArchUnit-TS,
  CodeScene, vendor "agent guardrail" features shipping inside coding harnesses themselves.
  Does the differentiation argument survive the strongest competitor, which may be the
  harness vendors adding manifest-like constraints natively?
- **The FDE thesis itself:** the runbook assumes the FDE/consulting market is reachable via
  referral and that a day-one drift report changes engagements. What evidence would falsify
  this before Phase 1 spend, and is the Phase 0 gate (3-of-5 engineers) actually measuring
  it — or measuring politeness?
- **Phase-gate integrity:** for each runbook phase, check that the gate is (a) measurable,
  (b) cheap to reach, (c) genuinely kill-capable — i.e., is there anything in the plan's
  framing that would let work continue after a failed gate?
- **Effort realism:** flag any estimate that ignores test/CI/publish overhead this repo
  demonstrably imposes (68 test files in sync, contract tests against built dist,
  co-versioned publishing, capstone first-run-green CI).
- **Omissions:** name the most important consideration absent from all three documents.
  Candidates to weigh, not to parrot: security posture of running an LLM-backed tool inside
  client repos under NDA; support burden of an OSS wedge; the TUI as an FDE surface; pricing
  the consulting path (never priced); what happens to the existing generator users during
  repositioning.

### Part 3 — Report

Produce a single Markdown report:

1. **Overall verdict** (one paragraph): is the runbook safe to execute as-is, safe with
   amendments, or unsafe?
2. **Claim table** for Part 1: claim / verdict / your evidence (file:line) / consequence
   if the author was wrong.
3. **New findings**, ranked by severity, each with: what the author missed, evidence, and
   which document/section it invalidates or amends.
4. **Refutations** of any author finding (A1–A7) or decision framing (D-1–D-4) that did
   not survive your check — be explicit when one _did_ survive; silence is not
   confirmation.
5. **Amendment list**: the minimal set of edits to the runbook required before Phase −1
   decisions are made.

Rules: do not fix anything; do not soften verdicts for symmetry ("some strengths, some
weaknesses") — if the documents are mostly right, say so and prove you looked; every
severity call must name the concrete consequence of ignoring it; if you cannot verify a
claim, mark it UNVERIFIED with the reason rather than guessing.
