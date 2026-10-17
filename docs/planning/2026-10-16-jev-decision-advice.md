# Jev decision advice in HexaGen Monaco

_Date: 2026-10-16 · Status: revision 2.4, after the Grok and Fable reviews · Owner request: "Write up a plan to
implement Jev within hexagen-monaco." This builds on the fleet-v2 decision port (fleet-v2
`docs/planning/2026-10-16_decision-port.md`). Its live trial showed Jev is cheap and safe to call, but worth
using only where a scored judgement replaces a crude rule or an expensive call._

## What Jev is (verified 2026-10-16)

TypeSafe's Jev (`typesafe/jev-1.14` on OpenRouter, `POST /api/alpha/decisions`) answers small structured
questions about a `state` string it is given. It supports three question types:

- yes/no (`noul`), which returns a probability;
- choice, which returns a pick, a probability per option and a confidence;
- score, which returns a level, a probability per level and a confidence.

Measured: about 0.2 s and $0.00002–0.00003 per call. Probabilities come keyed by option id or level number,
and responses carry `type` and `legend` fields. Recorded fixtures pin the shape.

## Goal

Use Jev where HexaGen makes a small judgement with an expensive LLM call or a crude default. It is advice:
it may replace a like-for-like call only after it has matched that call in shadow mode, and only after it
has been measured in a durable store.

## Step Zero findings (revision 2)

- **The verdict "governance block" rule is dead.**
  - `ReconcileUseCase.generateVerdicts` writes only three reason templates, none of which contains a keyword
    (`packages/reconciliation-engine/src/application/use-cases/reconcile.use-case.ts:69-84`).
  - `compareVerdicts` only sorts the verdicts; acceptance comes from `verdict.accepted`.
  - So the former U-B is dropped. The keyword rule in `verdict-comparator.adapter.ts` is a deletion finding
    for a separate cleanup PR, not a Jev target.
- **NL command routing** (`nl-to-domain-command.adapter.ts`) has no live consumer. It is excluded and is
  also a deletion finding.

## Invariants

1. **Off by default.** Nothing calls Jev unless the dedicated `JEV_API_KEY` is set. This is the same pattern
   as `STAGE1_REFINER_API_KEY` (`apps/web/app/lib/wire.server.ts:436-462`, `createStage1RefinerConfig`).
   - The browser never calls Jev: `wire.client.ts` builds the staged use case without a classifier. The
     advice port is a constructor dependency that defaults to Null, so this stays true by construction.
   - `JevDecisionAdapter` is exported only from a server subpath (`@hexagen/agentic-interaction/server`),
     never from the `.` barrel that the client bundle imports.
   - The CLI (`@hexagen/sync`) does not depend on agentic-interaction.
   - The boundary is enforced, not just grepped: J1b adds the `"./server"` export, and the arch-linter's
     server-marker rule (`tools/arch-linter/src/server-marker-violation.ts`) fails any client import of it. A
     test also asserts that the `.` barrel's export list does not include `JevDecisionAdapter`.
2. **Shadow first.** Each use starts in shadow mode: today's result is the one the product uses, and Jev's
   answer is only recorded. A use leaves shadow mode only when its exit criterion is met and the owner
   flips that use's mode.
3. **Declared fields only; refuse, never redact.** Each use names the fields it sends.
   - Every field passes a secret-shape scan and byte caps: 8 KiB per field, 32 KiB in total, measured with
     `TextEncoder`.
   - A secret hit or a cap overflow refuses the call, and today's result stands.
4. **Fail to today.** All of these mean "no advice" and today's behaviour:
   - a timeout (3 s for the whole response, the body capped at 64 KiB, no redirects);
   - a non-2xx response, an unknown shape or a tie;
   - a confidence below the threshold, or a refused budget.
5. **Recorded durably.** Two tables in the platform database, declared in **both dialects**, because ADR-0071
   keeps SQLite for dev and unit tests:
   - `CREATE TABLE IF NOT EXISTS` in `apps/web/lib/platform/platform-db.ts`;
   - `pg-migrations/0004_decision_receipts.sql`, registered in `pg-migrations/index.ts`;
   - the table count, `timestamptzColumns` (`created_at`) and `booleanColumns` (`reviewer`, `agreement`)
     updated in `__tests__/pg-schema.test.ts`.

   The columns are closed-set, numeric or identifiers only, following `repair_runs` (`platform-db.ts:369-392`)
   and the retention contract of `repair-telemetry-store.ts`.
   - `decision_calls` holds one row per HTTP call: `id` (primary key), `schema_version`, `created_at`,
     `use`, `model`, `request_id`, `generation_id`, `reviewer` (a boolean, see below), `cost_micro_usd`,
     `latency_ms` and `status` (`advised` or the `unknown` reason).
   - `decision_answers` holds one row per question in a call, with primary key `(call_id, question_index)`.
     Its columns are `mode` (`shadow | primary`), `jev_answer`, `jev_confidence` (a number), `today_answer`,
     `today_source` (`llm | heuristic | default`), `agreement` and `owner_review`.
   - Answers are a context type (U-A) or an option **index** (U-C), never text.
   - A batched U-A call therefore yields one answer row per flagged context, and each context is counted,
     scored and reviewed on its own.
   - Never stored: state text, context names, project text, the key, any user id.
   - A structured log line mirrors each call.

6. **Bounded spend.** Two caps; a call over either is not made:
   - `JEV_MAX_CALLS_PER_GENERATION` (default 20);
   - `JEV_DAILY_COST_CEILING_USD` (default 0.50), checked against the sum of `decision_calls.cost_micro_usd`
     with `created_at` since midnight UTC, so a redeploy does not reset it.
   - The web app is a single process (ADR-0064/0065). An in-process reservation serialised by one mutex adds
     the call's maximum cost before dispatch and settles it after, so concurrent requests cannot both pass
     the same check. A refused reservation means "no advice". If a second instance is ever added, the
     ceiling becomes best-effort, overshooting by at most one call per instance, and the runbook says so.

## Uses

### U-A. Context type for contexts the heuristic could not decide (agentic-interaction): first

**Today:** `ExecuteStructuredConfigGenerationUseCase` assigns each context a type by a heuristic.

- Only a context whose heuristic confidence is below 0.6 is flagged `needsTypeReview`. In practice that is
  the fall-through `core/0.4` case: no declared type and no keyword hit.
- Flagged contexts are sent one at a time to `ClassifyContextTypeUseCase`, an LLM call, inside the loop at
  `execute-structured-config-generation.use-case.ts:2144-2167`.
- If the LLM fails, the heuristic type is kept.
- The use case is live only through the spec route (`apps/web/app/api/manifest/generate/spec/route.ts:252`).

**Hook point:** that loop in `ExecuteStructuredConfigGenerationUseCase`, not inside
`ClassifyContextTypeUseCase`.

- One Jev request per generation batches every flagged context. Keys are `c0…cn`, with one `choice`
  question per context.
- The options are the five types (`core | supporting | generic | shared-kernel | driver`), each with its
  one-line definition from `classify-context-type.prompt.ts`.
- The batch is split if it would pass the 32 KiB cap.
- State: the project identifier (`config.project`, already passed to the classifier at
  `execute-structured-config-generation.use-case.ts:2158`), then for each context its name, responsibility,
  aggregate names and value-object names. `StructuredConfig` carries no project description, so none is
  sent.
- The Jev request runs **concurrently** with the LLM calls, so shadow mode costs max(LLM, Jev) in wall time,
  not their sum.

**Generation id and the reviewer's own generations:**

- `ExecuteStructuredConfigGenerationUseCase.execute()` mints a `generationId` per run and passes it to the
  receipt sink. The spec route emits it on the NDJSON stream, in a new Stage 2 telemetry emission (Stage 2 emits none today; `StageTelemetry` gains an optional
  `generationId?: string`, and the route's forwarder at `spec/route.ts:197-215` carries it unchanged), so the reviewer
  can match what he saw to the rows.
- Middleware already requires a session on the spec route (`middleware.ts:33-44, 150-153`; the comment at
  `require-owner.ts:40-41` is stale), so every request reaching it has a JWT `sub`. The receipt records only
  `reviewer = (sub === JEV_REVIEWER_SUB)`, a boolean; no user id is stored.
- With `JEV_REVIEWER_SUB` unset, `reviewer` is always false and the owner-review route is closed.

**Modes** (`JEV_CONTEXT_TYPE_MODE`):

- `off` is the default.
- `shadow`: the LLM result is used and Jev's answer is recorded.
- `primary`: the answer comes from the first of these that applies:
  1. Jev, when its confidence is at least `JEV_CONTEXT_TYPE_MIN_CONFIDENCE` (default 0.8);
  2. otherwise the LLM;
  3. otherwise today's heuristic type.

**Exit criterion for `primary`, with its rubric:**

- **Sample:** at least 50 flagged contexts recorded in shadow mode. Flagged contexts are a small fraction of
  each generation, so if 50 have not arrived within 30 days of enabling, the report states the count and the
  owner decides whether to continue or stop.
- **Agreement:** at least 90 % of those contexts, counted from `decision_answers` rows with `mode = shadow`
  and `today_source = llm`. Rows whose baseline is the heuristic are reported separately and do not count.
- **Disagreements:** the owner reviews every disagreement that comes from a `reviewer = true` generation, where the
  live NDJSON stream showed him the inputs and the `generationId`. For each one he records a closed-set `owner_review` on that context's answer row through the
  reviewer route (J5b). The values are `jev_better`, `llm_better`, `both_ok` and `both_wrong`.
- **Floors:** an empty or undersized cohort is "not passed", never zero failures. The rule needs at least
  50 rows with `today_source = llm` and at least 20 contexts from `reviewer = true` generations. Without
  them, U-A stays in shadow.
- **Rule:** `primary` is allowed when `llm_better` is at most 1 in 10 of the reviewed disagreements and no
  `llm_better` case had a Jev confidence at or above the threshold.

### U-C. Defaulted template select questions (template-engine): a suggestion only

**Today:** `DefaultingQuestionEngine` answers an unanswered `select` with its default, or with the first
option, and adds a warning. It runs only for questions that belong to templates pulled in by `requires`
and that the wizard did not answer. The select questions that can reach it:

- `env-setup.framework` and `env-setup.dotenv_tool`;
- `docker.node_version` and `docker.registry`;
- `adobe-firefly-core.*`;
- `error-handling.http_mapping`;
- `llm-adapter.primary_provider`.

**Jev question:** one `choice` over the question's options.

- State: the project name, the question prompt and the options. The materializer does not receive the
  project description (`in-memory-add-on-materializer.ts:31-36`), and threading it through project-generation
  is out of scope.

**Never applied:** the warning gains `suggested: <option> (<confidence>)` and the default still applies.

**Wiring:** `createInMemoryMaterializer({ suggest? })` takes an optional named callback and passes it to each
`DefaultingQuestionEngine` that `materialize()` constructs. With no callback, behaviour is byte-identical to
today.

### Excluded

- **Verdict blocks and NL routing:** dead paths (see Step Zero).
- **Generative stages:** Jev cannot generate.
- **The arch-linter, the layer classifier and sync's analysers:** they are deterministic and stay exact.
- **Accepting or rejecting patches and transactions:** a probability never becomes authority.

## Architecture

- **Port:** `DecisionAdvicePort` under `packages/agentic-interaction/src/application/ports/out/` (ADR-0048).
  - It is declared under `layers.application.ports.out` in the context's `context.yaml`.
  - Signature: `ask({ use, fields, questions }) → { status: 'advised', answers, receipt } | { status:
'unknown', reason, receipt? }`.
- **Pure domain code**, with no new npm imports (ADR-0054). It covers:
  - the question and answer value objects;
  - the validators: choice with a single argmax (a tie is unknown), and yes/no with confidence `max(p, 1−p)`;
  - the state builder;
  - the budget rule.
- **Adapters** (infrastructure):
  - `JevDecisionAdapter`: `fetch` with one deadline covering the request and the body read, a streamed
    64 KiB cap and `redirect: 'error'`. It reads the key through `SecretVaultPort` and never logs or returns
    it. It is exported from the server subpath only.
  - `NullDecisionAdapter`.
  - `PgDecisionReceiptStore` in apps/web.
- **template-engine** receives a narrow callback type named `SelectSuggestion`, never the port, which keeps
  its dependency on `shared` only. Following ADR-0047, no type outside agentic-interaction is named
  `DecisionAdvicePort`.
- **Manifest:** each declared symbol matches an exported symbol exactly (ADR-0057), and `yarn lint:arch`
  passes.

## Lanes (hexagen-monaco lanes run in its own container, `OCM_REMOTE_PORT=4126`, per the owner's rule of 2026-10-07)

Review markers: **F** is one Fable pre-merge pass; **O** is an Opus pass.

Each lane:

- runs `yarn build && yarn typecheck && yarn lint` before it starts;
- runs `yarn lint:arch` after any `.architecture/` edit;
- runs targeted tests before each commit;
- puts its Step Zero grep and the output in the PR body.

| #   | Lane                                                                                                                                                                                                                                                                                                                                                                                                          | Edits                              | Depends on  | Review |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------- | ------ |
| J0  | The orchestrator records one real `choice` response (five types, two contexts) and one real score response from the Mac. Committed under `packages/agentic-interaction/__tests__/use-cases/staged-generation/fixtures/jev/`                                                                                                                                                                                   | fixtures                           | none        | none   |
| J1a | Port, value objects, validators, state builder, budget rule, `NullDecisionAdapter`, manifest entries                                                                                                                                                                                                                                                                                                          | agentic-interaction, .architecture | J0          | F      |
| J1b | `JevDecisionAdapter` (deadline, cap, no redirects, key handling) tested against the fixtures with no network; server subpath export: `src/server.ts` headed `// @hexagen-server-only` plus a `"./server"` export in package.json (the `project-configuration` convention); a grep proof that the `.` barrel omits it                                                                                          | agentic-interaction                | J1a         | F      |
| J1c | `decision_calls` and `decision_answers` in both dialects (platform-db.ts, 0004 migration, pg-schema test), the receipt store for both backends via `platform-backends.ts`, the daily-ceiling query                                                                                                                                                                                                            | apps/web platform                  | J1a         | F      |
| J2  | U-A shadow in the staged loop: concurrent call, batching, `generationId` minted per run, `today_source`, `JEV_CONTEXT_TYPE_MODE`, receipts emitted through an injected sink                                                                                                                                                                                                                                   | agentic-interaction                | J1b         | F      |
| J4  | U-C: the `SelectSuggestion` callback, the materializer factory option, the warning text                                                                                                                                                                                                                                                                                                                       | template-engine                    | J1a         | O      |
| J5a | `createJevDecisionAdvice()` in `wire.server.ts` beside `createStage6ReviewerConfig`, called from `apps/web/app/api/manifest/generate/spec/route.ts` (which constructs the staged use case) and from the materializer's composition; `generationId` on the stream; env homes (`JEV_API_KEY`, the caps, the modes, `JEV_REVIEWER_SUB`) in `deploy/.env.example`, `deploy.yml` and `apps/web/.env.local.example` | apps/web, deploy                   | J1c, J2, J4 | F      |
| J5b | New routes `/api/jev/report` (agreement numbers) and `/api/jev/review` (writes `owner_review` for one answer row of a `reviewer = true` call). Middleware answers first (401 with no session, 403 for a cookie POST without the CSRF header, `middleware.ts:64-76, 134-153`); for a signed-in caller the handler answers 404 unless `JEV_REVIEWER_SUB` is set and equals `getToken().sub`                     | apps/web                           | J5a         | F      |
| J6  | Runbook following `mercury-2-prod-flip-runbook.md`: enabling, shadow review, flipping a mode, the kill switch                                                                                                                                                                                                                                                                                                 | docs                               | J5b         | O      |

Waves:

1. J0
2. J1a
3. J1b, J1c and J4 in parallel
4. J2
5. J5a
6. J5b
7. J6

## Hard to undo

- When the key is set, project identifiers, context definitions and template question prompts leave the host for OpenRouter and
  TypeSafe. The same class of data already leaves through the Stage 1 refiner and the Stage 6 reviewer when
  their keys are set (`wire.server.ts:432, 477, 537`). Enabling it is the owner's choice.
- The `decision_calls` and `decision_answers` tables are a schema migration. It is additive, and a later migration can drop it.
- Flipping U-A to `primary` changes generated manifests. The flip is the owner's, with the exit-criterion
  numbers recorded in the runbook.

## Assumptions

- `/api/alpha/decisions` keeps its shape. If it changes, calls show as `unknown/shape` and today's behaviour
  stands.
- Enough generations hit flagged contexts to reach 50 within 30 days. If they do not, the report says so
  and the owner decides.
- The owner generates projects himself often enough to review disagreements.

## Challenge this

Whether U-A is worth it at all.

- It covers only the contexts the heuristic could not decide, and the LLM call it would replace is small
  (256 tokens).
- The gain is fewer local-model failures and less latency on those contexts. The shadow data decides, and
  "stop after shadow" is a valid outcome.
