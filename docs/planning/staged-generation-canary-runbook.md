# Staged-Generation Canary Runbook (A3 §4)

**Status:** Active runbook.
**Date:** 2026-06-10
**Parent:** [normalizer-rewire-development-plan.md](./normalizer-rewire-development-plan.md) (A3). Flag semantics: `apps/web/app/api/manifest/generate/stage/pipeline-selection.ts`. Gates: `packages/agentic-interaction/scripts/golden-harness-lib.ts`.

Cuts cloud "Generate manifest" over from the 4-pass stub (`ExecuteStagedGenerationUseCase`) to the full 0→6 pipeline (`ExecuteFullStagedGenerationUseCase`) behind the #288 seam, gated on the #289 harness.

## The lever (how prod env actually changes)

The deploy workflow **regenerates `/opt/hexagen-monaco/.env` from scratch on every deploy** (heredoc + line-count guard) — hand-edits on the VPS do not survive the next deploy. The canary flags are therefore sourced from GitHub Actions **repository variables** (not secrets) and flow: repo variable → deploy.yml heredoc → `.env` → compose `env_file` → `process.env` read per request by the stage route.

```sh
# Set / change the canary percent (0–100; unset or "" = 0 = all-stub):
gh variable set STAGED_GENERATION_FULL_PERCENT --body "10"

# Apply it (env-only changes still need a deploy — .env is read at
# container-creation time and the workflow force-recreates):
gh workflow run deploy.yml --ref main
```

Fail-closed by construction: an unset variable becomes an empty string in `.env`, which `selectPipeline` treats as percent 0 / no pin → stub. A repo with no variables configured ships dark, exactly as today.

## Rollback (two speeds)

- **Durable (minutes — one deploy):**
  ```sh
  gh variable set STAGED_GENERATION_PIPELINE --body "stub"   # overrides the percent
  gh workflow run deploy.yml --ref main
  ```
- **Immediate (seconds — survives only until the next deploy):** on the VPS, edit `/opt/hexagen-monaco/.env`, set `STAGED_GENERATION_PIPELINE="stub"`, then `docker compose -f docker-compose.prod.yml up -d --force-recreate --wait`. **Always follow with the durable flip** or the next deploy silently re-opens the canary.

## Preconditions (before any nonzero percent)

1. This runbook's env plumbing is merged and has been deployed at least once (the heredoc guard expects 10 lines — an old workflow run with new variables, or vice versa, fails the deploy loudly, by design).
2. A green local baseline: `yarn workspace @hexagen/agentic-interaction golden-harness` exits 0 — all gates T1–T4 pass against a measured stub baseline (the harness fails closed if the baseline or judge verdicts are missing).
3. `STAGED_GENERATION_PIPELINE` is unset/empty (a leftover `stub` pin silently defeats the percent; a `full` pin skips the canary entirely).

## Canary schedule

| Step | Percent | Window                                                      | Advance when                                                                                                   |
| ---- | ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | 10      | ≥ 3 days or ≥ 50 full-pipeline requests, whichever is later | T1/T2/T4 clean in live signals; spot-check manifests                                                           |
| 2    | 50      | same                                                        | same, plus a fresh harness run still green                                                                     |
| 3    | 100     | one release                                                 | full is now the de-facto default; keep `STAGED_GENERATION_PIPELINE=stub` as the rollback lever for one release |
| 4    | —       | —                                                           | A4: delete the stub + the flag; the pipeline is unconditional                                                  |

Any gate trip at any step ⇒ rollback (above), investigate, fix, restart the window at the same percent.

## Live signals (what to watch, per gate)

Every request logs its assignment and tags its terminal event:

```sh
# On the VPS — pipeline assignment per request:
docker logs hexagen-web --since 24h 2>&1 | grep '\[staged-gen\] pipeline selected'
# Terminal events: success carries {"type":"done", ..., "pipeline":"full|stub"},
# failure carries {"type":"error"}.
```

- **T1 — error rate** (full success-rate ≥ stub − 10pp): ratio of `done` to selected, per pipeline, over the window.
- **T2 — latency** (full p95 ≤ 2× stub p95): request durations of successful (`done`) requests, per pipeline.
- **T3 — quality** (judge pass-rate not regressed AND zero banned context names): not measurable from logs — re-run the golden harness locally per window step. Banned-name spot-check: `done` payload context names against `isBannedContextName`.
- **T4 — empty output** (no zero-context success): any `done` event with `contextCount: 0` and `pipeline: "full"` is an immediate trip.

## Step 100 → "swap default" (plan A3 §4)

Percent 100 _is_ the swap — there is deliberately no code change: the unset-default stays `stub`-safe so a mis-deployed or variable-less environment ships dark, and the one-flip rollback lever stays live. The code default flips only in A4, when the stub is deleted and `selectPipeline` goes away with it.
