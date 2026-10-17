# Jev Decision-Advice Runbook

**Status:** Active runbook. Every mutating command below is gated on explicit
operator sign-off — nothing here is run autonomously.
**Date:** 2026-10-17
**Parent:** [2026-10-16-jev-decision-advice.md](./2026-10-16-jev-decision-advice.md)
(the plan: invariants, uses, lanes). Follows the structure of the
[mercury-2 prod-flip runbook](./mercury-2-prod-flip-runbook.md).

## What it is and what it never does

Jev (`typesafe/jev-1.14` via OpenRouter) answers small structured questions
about a state string. In HexaGen Monaco it is **advice only**:

- It never generates, never accepts or rejects a patch, and never becomes
  authority. A probability only ever annotates or substitutes a like-for-like
  judgement, and only after shadow review.
- It is **off by default**. Nothing calls Jev unless the dedicated
  `JEV_API_KEY` is set — the same gate as `STAGE1_REFINER_API_KEY`. With no
  key, `createJevDecisionAdvice()` returns null, no port is constructed, and
  today's behaviour is byte-for-byte unchanged.
- The browser never calls Jev: the adapter is exported only from the
  `@hexagen/agentic-interaction/server` subpath, and the arch-linter's
  server-marker rule fails any client import.
- Every failure is **fail to today**: a timeout, a bad response, a refused
  budget, a secret-shaped field — the product keeps today's result and Jev's
  answer (if any) is only recorded.
- Receipts never store project text, context names, state text, the key, or
  any user id — only `reviewer = (sub === JEV_REVIEWER_SUB)` as a boolean.

## Enabling

The key lives in the **vault** (`SecretVaultPort`), not in a committed file.
Everything else is a plain env variable on the usual plumbing: GitHub
Actions secret/variable → deploy.yml heredoc → `/opt/hexagen-monaco/.env` →
compose `env_file` → `process.env`. Every env change needs a deploy
(`gh workflow run deploy.yml --ref main`) to take effect. Inventory:
[deploy/.env.example](../../deploy/.env.example) (Jev block) and
[apps/web/.env.local.example](../../apps/web/.env.local.example).

| Env                               | Default | Allowed values / meaning                                                                                       |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `JEV_API_KEY`                     | unset   | Any value activates Jev; unset (or empty) means fully off. **Never logged, never committed.**                  |
| `JEV_CONTEXT_TYPE_MODE`           | `off`   | `off` \| `shadow` \| `primary` — U-A context-type advice mode; anything else stays `off`.                      |
| `JEV_CONTEXT_TYPE_MIN_CONFIDENCE` | `0.8`   | Number; negative is malformed (→ default), above 1 clamps to 1. The floor for `primary` to apply Jev's answer. |
| `JEV_MAX_CALLS_PER_GENERATION`    | `20`    | Positive number; per-generation call cap.                                                                      |
| `JEV_DAILY_COST_CEILING_USD`      | `0.50`  | Number in USD; checked against durable receipts since midnight UTC, so a redeploy does not reset it.           |
| `JEV_TEMPLATE_SUGGEST`            | `off`   | `on` \| `off` — U-C template-select suggestion; anything other than `on` is off.                               |
| `JEV_REVIEWER_SUB`                | empty   | The owner's JWT `sub`. Empty keeps `reviewer = false` everywhere and closes both reviewer routes.              |

**Budget mechanics (invariant 6):** a call over either cap is not made. The
web app is a single process (ADR-0064/0065), so an in-process reservation
serialised by one mutex adds each call's maximum cost (1000 µUSD — measured
calls cost $0.00002–0.00003) before dispatch and settles it after. If a
second instance is ever added, the ceiling becomes best-effort, overshooting
by at most one call per instance.

**Enabling steps:**

```sh
gh variable set JEV_CONTEXT_TYPE_MODE --body "shadow"
gh workflow run deploy.yml --ref main
```

The key itself is set where the secrets live (not committed). Enabling means
project identifiers, context definitions and template question prompts leave
the host for OpenRouter and TypeSafe — the same class of data the Stage 1
refiner and Stage 6 reviewer already send when their keys are set. This is
**hard to undo** in the data-flow sense; enabling is the owner's choice.

## Shadow review (U-A context type)

The owner works through it as the reviewer, generating projects himself:

1. **Generate as the reviewer.** Run a spec generation from the UI while
   signed in as the account whose `sub` matches `JEV_REVIEWER_SUB`. Read the
   `generationId` from the NDJSON stream — Stage 2 now emits a telemetry
   event (`"type":"stage-telemetry","stage":2`) whose payload carries
   `generationId`; the same id is on every decision receipt the run records.
   Only contexts the heuristic could not decide (confidence < 0.6) are sent.
2. **Read the report.**

   ```sh
   # from a signed-in session as the reviewer:
   curl -s https://<host>/api/jev/report
   ```

   Both `/api/jev/report` and `/api/jev/review` answer **404 to anyone who is
   not the reviewer** (middleware owns 401 no-session and 403 cookie-POST
   without CSRF; the handler's reviewer guard answers 404 first). Field
   meanings:

   | Field                                          | Meaning                                                                                                                            |
   | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
   | `total`, `todaySource`, `agreed`, `disagreed`  | All shadow answer rows for `use = context-type`, split by the baseline that produced today's answer.                               |
   | `llmCohort`                                    | Rows with `today_source = llm` — the cohort the 90% rule counts. Heuristic-baseline rows are reported separately and do not count. |
   | `llmCohort.agreementRate`                      | Agreed ÷ total in the llm cohort.                                                                                                  |
   | `reviewerCohort`                               | Contexts from `reviewer = true` generations — the floor the owner-review rule counts.                                              |
   | `ownerReview`                                  | Counts of the closed-set verdicts (`jev_better`, `llm_better`, `both_ok`, `both_wrong`).                                           |
   | `floors`                                       | `llmRows` (required 50) and `reviewerContexts` (required 20); an empty or undersized cohort is "not passed", never zero failures.  |
   | `exitRule.threshold`                           | The configured confidence floor (default 0.8).                                                                                     |
   | `exitRule.llmBetter` / `reviewedDisagreements` | The at-most-1-in-10 rule: `llm_better * 10 ≤ reviewedDisagreements`.                                                               |
   | `exitRule.llmBetterAtOrAboveThreshold`         | Must be 0: no `llm_better` case may have had Jev confidence at or above the threshold.                                             |
   | `passed`                                       | The **full** exit rule: floors met ∧ agreement ≥ 90% ∧ llm_better ≤ 1 in 10 ∧ no llm_better at/above threshold.                    |

3. **Record owner reviews.** For every disagreement from a `reviewer = true`
   generation (the ones whose live NDJSON stream showed the inputs and the
   `generationId`), POST one verdict per answer row:

   ```sh
   curl -s -X POST https://<host>/api/jev/review \
     -H 'Content-Type: application/json' \
     -d '{"callId":"<call-id>","questionIndex":0,"review":"jev_better"}'
   ```

   The four values are `jev_better`, `llm_better`, `both_ok`, `both_wrong`
   (anything else is a 400). The store refuses — 404 — any row that was not
   `reviewer = true` or not `mode = shadow`, so a verdict can never land
   outside the cohort the exit criterion counts.

## Flipping a mode

Flip only what the report has earned, and record the exit-criterion numbers
here when you do (the plan's "Hard to undo": the flip is the owner's, with
the numbers recorded in the runbook).

**U-A shadow → primary** (only when `passed` is `true`):

```sh
gh variable set JEV_CONTEXT_TYPE_MODE --body "primary"
gh workflow run deploy.yml --ref main
```

In `primary`, the answer comes from the first of: Jev (confidence ≥
`JEV_CONTEXT_TYPE_MIN_CONFIDENCE`), otherwise the LLM, otherwise today's
heuristic type.

- **Rollback (one line):** `gh variable set JEV_CONTEXT_TYPE_MODE --body "shadow"` → deploy.
  Or, immediate until the next deploy: edit `/opt/hexagen-monaco/.env` and
  recreate the container — **always follow with the durable change**, the
  next deploy regenerates `.env` from the repo state.

**U-C template suggest on/off** (a suggestion only, never applied — the
default still answers, the warning gains `suggested: <option>
(<confidence>)`):

```sh
gh variable set JEV_TEMPLATE_SUGGEST --body "on"    # or "off" to stop
gh workflow run deploy.yml --ref main
```

- **Rollback (one line):** `gh variable set JEV_TEMPLATE_SUGGEST --body "off"` → deploy.

## Kill switch

```sh
# Full stop: remove the key from the vault (nothing Jev is constructed).
# Partial stop: both use switches off.
gh variable set JEV_CONTEXT_TYPE_MODE --body "off"
gh variable set JEV_TEMPLATE_SUGGEST --body "off"
gh workflow run deploy.yml --ref main
```

Unsetting `JEV_API_KEY` is the only single switch that stops everything: with
no key nothing is constructed, whatever the use variables say. The two use
switches are independent: `JEV_CONTEXT_TYPE_MODE=off` stops context-type
advice (U-A) only, and template suggestions (U-C) keep calling Jev until
`JEV_TEMPLATE_SUGGEST` is also `off`.

- **Stops at once:** all Jev HTTP calls (U-A advice and U-C suggestions —
  no key, no port); new receipt rows; spend against the ceiling.
- **Keeps working:** everything else — the LLM classification path, the
  heuristic defaults, template defaults, generation as a whole. Existing
  receipt rows stay in the database; the report route still answers the
  reviewer (it reads the store, not the key) so the cohort can still be
  assessed. The unrecorded-cost ledger entries of calls whose receipt write
  never landed are process state and clear on restart.

## Known limits

From the reviews — accepted, do not rediscover them in an incident:

- **A database outage that fails receipt writes leaves those costs counted
  in memory.** The unrecorded-cost ledger is deliberately conservative: an
  entry whose durable write never lands stays for the process's lifetime,
  so Jev may refuse (`unknown/budget`) until a restart clears it. The
  conservative direction is intentional; do not "fix" it by evicting.
- **The materializer's awaited receipt write can drop a suggestion under
  the 3 s deadline.** U-C's suggestion callback has a 3 s timeout
  (`suggestTimeoutMs`, default 3000); the awaited receipt write shares that
  budget, so a slow write can cost the suggestion. The default still
  applies — nothing is lost but the annotation.
- **There is no per-call structured log line yet.** The plan's invariant 5
  calls for one mirroring each call; today only the durable rows (and the
  stream telemetry) exist. Debugging a single call means querying
  `decision_calls` by `request_id`.
- **Receipts never store a user id, only the reviewer boolean.** Identity
  questions ("was this my generation?") are answerable only via
  `JEV_REVIEWER_SUB` equality at write time — do not look for a sub column.

## Checks after any change

Targeted tests (run before committing any Jev-touching change):

```sh
yarn vitest run packages/agentic-interaction/__tests__/decision-advice
yarn vitest run apps/web/lib/decision-advice/__tests__/budgeted-decision-advice.test.ts
yarn vitest run apps/web/lib/platform/__tests__/decision-receipts-store.test.ts
yarn vitest run apps/web/app/api/jev/report/__tests__/route.test.ts
yarn vitest run apps/web/app/api/jev/review/__tests__/route.test.ts
yarn vitest run apps/web/app/api/manifest/generate/spec/__tests__/route.jev.test.ts
yarn vitest run apps/web/app/lib/__tests__/jev-decision-advice-wire.test.ts
yarn vitest run apps/web/app/lib/__tests__/wire.server-jev-materializer.test.ts
yarn vitest run packages/template-engine/__tests__/infrastructure/defaulting-suggestion.test.ts
yarn vitest run apps/web/lib/platform/__tests__/pg-schema.test.ts   # after any schema edit
```

What to look at in the report after enabling or changing a mode:

- `floors.llmRows.actual` climbing toward 50 — shadow is collecting; if 50
  have not arrived within 30 days, the plan says the owner decides whether
  to continue or stop.
- `llmCohort.agreementRate` trend and `ownerReview` mix — a rising
  `llm_better` count pushes the flip further away, never closer.
- `status` distribution in `decision_calls` — a spike of `unknown/timeout`
  or `unknown/http` points at the Jev endpoint, `unknown/budget` at the
  caps (or the known receipt-write limit above), `unknown/refused` at the
  secret-shape scan doing its job.
