# Mercury-2 Prod Flip Runbook

**Status:** Active runbook. Every mutating command below is gated on explicit
operator sign-off — nothing here is run autonomously.
**Date:** 2026-06-10
**Parent:** [mercury-2-swap-investigation.md](./mercury-2-swap-investigation.md)
(evidence + decisions). Prereq PRs: #293–#300 (provider/cascade arc), #301
(WEB_LLM_API_KEY decoupling + chain log + refine-outcome notes), and this
runbook's deploy.yml plumbing PR.

The flip makes Inception **mercury-2 the sole provider of the
staged-generation fallback chain** by unsetting `LLM_API_KEY`, with the
stage-1 draft→refine cascade active (mercury draft → gpt-4o refine via
OpenRouter), while the direct-LLM web features (chat server-key path,
governance suggestions) keep working through `WEB_LLM_API_KEY`.

## The lever

Same plumbing as the [canary runbook](./staged-generation-canary-runbook.md):
GitHub Actions secret/variable → deploy.yml heredoc → `/opt/hexagen-monaco/.env`
→ compose `env_file` → `process.env`. The deploy **regenerates `.env` from
scratch every run** (line-count guard), and `env_file` is read at
container-creation time, so every env change needs a deploy
(`gh workflow run deploy.yml --ref main`) to take effect. Key/knob inventory:
[deploy/.env.example](../../deploy/.env.example).

One build-time wrinkle the canary doesn't have: `NEXT_PUBLIC_LLM_AVAILABLE` is
baked into the client bundle at image build from
`WEB_LLM_API_KEY != '' || LLM_API_KEY != ''`. A deploy with both unset ships a
client with all LLM UI disabled regardless of runtime env — this is why
`WEB_LLM_API_KEY` must exist **before** `LLM_API_KEY` is removed.

## Target state

| Env                                    | Before flip                             | After flip                                             |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `LLM_API_KEY`                          | set (generic chain slot + web fallback) | **unset** (the flip itself)                            |
| `LLM_BASE_URL` / `LLM_MODEL`           | set                                     | **keep set** — see warning below                       |
| `WEB_LLM_API_KEY`                      | unset (falls back)                      | **set** — web chat/governance key                      |
| `INCEPTION_API_KEY`                    | set                                     | set (becomes the chain's only resolved provider)       |
| `INCEPTION_MODEL`                      | unset (default mercury-2)               | unset                                                  |
| `LLM_REASONING`                        | unset                                   | **`low`** (validated regime — see below)               |
| `STAGE1_REFINER_API_KEY`               | set                                     | set (cascade active, mode default `always`)            |
| `STAGE1_REFINER_BASE_URL/_MODEL/_MODE` | unset (defaults)                        | unset                                                  |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | not plumbed                             | not plumbed (chain slots can never resolve — see Pins) |
| `LLM_ESCALATION_MODEL`                 | not plumbed                             | not plumbed (see Pins)                                 |

> **Warning — `WEB_LLM_API_KEY` pairs with `LLM_BASE_URL`/`LLM_MODEL`:** the
> web routes construct `ServerLLMAdapter(resolveWebLlmApiKey(), LLM_BASE_URL,
LLM_MODEL)`. Unset only `LLM_API_KEY`; keep `LLM_BASE_URL`/`LLM_MODEL` set,
> and `WEB_LLM_API_KEY` must be a key **valid at that base URL**.

## Pins and accepted risks (decided, do not re-litigate)

1. **`LLM_REASONING=low` is the validated regime — never `disabled`.** All
   mercury-2 parity numbers in the sweep were measured @low. `disabled` maps
   to Inception's `"instant"` mode, which dropped to **62.5% success with
   NDJSON failures**. The stale in-code advice recommending `disabled` was
   corrected in this PR (`wire.server.ts`). Note: empty string in `.env` is
   treated as unset (provider default = `medium`, untested at scale) — set the
   variable explicitly.
2. **`LLM_ESCALATION_MODEL` is deliberately not plumbed into the deploy.** The
   stage-3 escalation `preferredCloudModel ?? provider.model` injection is
   provider-unscoped; a foreign model name in an Inception-only chain 404s
   every escalation retry. Its absence from the heredoc makes "unset in prod"
   structural. Do not add it without making the injection provider-scoped
   first. The same structural-absence applies to **`OPENAI_API_KEY` /
   `ANTHROPIC_API_KEY`**: the fallback chain's openai-primary and anthropic
   slots exist in code, but neither var is in the deploy heredoc (nor the
   compose/Dockerfile), so on this deploy path they can never resolve — the
   prod chain reduces to generic(`LLM_API_KEY`) + inception by construction,
   and after the flip to inception alone. Setting them as repo secrets does
   nothing unless someone also plumbs them; if that ever happens, they would
   resolve **ahead of** mercury and silently un-flip the chain — keep them
   out of the heredoc.
3. **Stage 6 is the only NDJSON stage without `response_format` (accepted).**
   The streaming path never attaches `ndjsonResponseFormatFor` (deferred in
   #295). The flip accepts mercury free-text NDJSON at stage 6 on the strength
   of the sweep/golden-harness results @low. Closing the gap is a PR-C
   hardening item; a stage-6 NDJSON failure spike post-flip points here first.
4. **The non-streaming cloud path has no 429 backoff (accepted).** In a
   single-provider chain there is no fallback to absorb throttling. Sweep
   traffic never tripped Inception rate limits; PR-C item. A post-flip failure
   burst with 429s in the logs points here.
5. **Cascade mode stays `always`** (the validated config — see the
   investigation doc §8 disposition update). `escalation` is the conservative
   fallback knob if refine cost ever becomes a complaint.

## Preconditions

1. PR #301 and this runbook's deploy-plumbing PR are merged, and **one deploy
   has run since** (the heredoc line-count guard means old-workflow + new-vars
   or vice versa fails loudly; the transition deploy below satisfies this).
2. Repo secrets in place: `INCEPTION_API_KEY`, `STAGE1_REFINER_API_KEY`
   (OpenRouter), and `WEB_LLM_API_KEY` (valid at `LLM_BASE_URL`).
3. Repo variable `LLM_REASONING` = `low`.
4. Canary state checked (`gh variable list`): the staged-generation pipeline
   flags are whatever the canary runbook currently prescribes — this flip
   changes the _provider_, not the pipeline selection.

## Flip steps (two deploys, verify between)

**Step 1 — transition deploy (both keys live):**

```sh
gh secret set WEB_LLM_API_KEY            # value: current LLM_API_KEY value, or a new key for LLM_BASE_URL
gh variable set LLM_REASONING --body "low"
gh workflow run deploy.yml --ref main
```

Verify (on the VPS): chain log shows mercury present _and_ the generic slot
still resolved — e.g. `["openai:<LLM_MODEL>", "inception:mercury-2"]`; chat +
governance still work. This proves the new plumbing end-to-end while rollback
is a no-op.

**Step 2 — the flip:**

```sh
gh secret delete LLM_API_KEY
gh workflow run deploy.yml --ref main
```

## Day-one verification

```sh
# Chain resolution — MUST read exactly ["inception:mercury-2"]:
docker logs hexagen-web --since 1h 2>&1 | grep '\[llm\] cloud fallback chain resolved'

# Cascade active per staged-gen request:
docker logs hexagen-web --since 1h 2>&1 | grep '\[staged-gen\] stage-1 refiner active'

# Refine outcomes (PR #301 telemetry notes) — look for the summary suffixes:
#   "(cascade refined N→M subdomains)" — accepted
#   "(cascade refine failed/discarded: …)" — kept the draft, with the reason
```

Manual smoke: one staged generation (any prompt) succeeds with ≥1 bounded
context; chat answers on the server-key path; governance suggestions return
non-empty for a manifest with obvious issues; LLM UI is visible in the client
(`NEXT_PUBLIC_LLM_AVAILABLE` collateral — if LLM UI vanished, the image was
built without either key).

Watch for ~a day: staged-gen success rate (canary runbook T1/T4 signals),
stage-6 NDJSON failures (pin 3), 429 bursts (pin 4).

## Rollback (two speeds)

- **Durable (one deploy):** `gh secret set LLM_API_KEY` (restore the old
  value) → `gh workflow run deploy.yml --ref main`. The generic provider
  re-enters the chain ahead of mercury; web routes keep using
  `WEB_LLM_API_KEY` (no need to undo it — the helper prefers it but both now
  work).
- **Immediate (until the next deploy):** on the VPS, edit
  `/opt/hexagen-monaco/.env`, restore `LLM_API_KEY="…"`, then
  `docker compose -f docker-compose.prod.yml up -d --force-recreate --wait`.
  **Always follow with the durable rollback** — the next deploy regenerates
  `.env` from the repo state.
