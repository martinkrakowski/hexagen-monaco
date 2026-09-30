# The cast — verified invocations, model ids, and track record

Re-probe before trusting any row: `grok models`, `agy models`, `opencode models`. Two of these
fail with a misleading error rather than "no such model".

> **Provenance.** This file was ported from `campaign-foundry` on 2026-09-08. The seats, spending
> rules and traps are model facts and carry over unchanged. **The track record in the last section
> was earned on that repository**, whose gate enforces 100 % coverage on four counters; this
> repository has no root coverage gate, so a lane here is judged by `yarn build && yarn typecheck &&
yarn lint && yarn test` and by its mutations, nothing else. Re-probe every seat before the first
> dispatch — ids rotate, and quotas here are the same account.
>
> `dispatch-lane.sh` was the pre-template wrapper and no longer exists; its roles are now `laneHosts[].dispatch` and `hexagen-orchestration-wave-event`.

**Lane hosts.** Where an opencode lane runs, and how it is dispatched, is declared in
`.agents/orchestration/config.yaml` under `laneHosts`, not here. The two opencode seats,
`space-bunny` (primary) and `glm-flash` (the owner's fallback), are declared under `seats` there and are
referred to in this file by id only; their agent and model live in `config.yaml`, where doctor checks
them. Every non-opencode seat below stays as prose, since doctor cannot check it.

## Seats — the order the owner set on 2026-09-08 (implementers reordered the same day)

Implementers rotate in this order; the next seat takes a lane only when the one before it is
unfunded, hangs (0-byte log at five minutes), or dies on arrival twice. **grok never implements.**

| Seat                                 | Command (owner's roster, 2026-09-17; every id probed live that day)                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **implementer 1**                    | **Sonnet**, in-process: `Agent(subagent_type: "general-purpose", model: "sonnet", prompt: <the brief>)`. No CLI, no detachment, no `EXIT` marker — the harness tracks it and its report returns as a tool result rather than a JSON log to parse.                                        |
| **implementer 2**                    | **gemini-3.8-flash**: `agy --print "$(cat BRIEF.md)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m` (detached; **the effort flag must match the id's suffix** — `-high` with `--effort low` is refused).                                |
| **implementer 3**                    | **grok-4.6**: `grok --prompt-file BRIEF.md --always-approve --effort high --output-format plain`. Prefer `--prompt-file` over `-p "$(cat …)"` for a large brief — it keeps the brief off the command line entirely.                                                                      |
| **PR reviewer A**                    | **Fable**, in-process: `Agent(subagent_type: "general-purpose", model: "fable", prompt: <the review brief>)`. Fence it to a throwaway worktree in the prompt and forbid writes, builds and installs; there is no `--disallowedTools` flag on this path, so **the brief is the control**. |
| **PR reviewer B**                    | **gemini-3.1-pro**: `agy --print "$(cat REVIEW.md)" --dangerously-skip-permissions --effort high --model gemini-3.1-pro-high`.                                                                                                                                                           |
| **remediator**                       | the lane's own implementer, at **medium** effort on a narrow brief (see Spending rules 3–4), then the next in the rotation.                                                                                                                                                              |
| **orchestrator, final sweep, merge** | you, never delegated                                                                                                                                                                                                                                                                     |

> **Roster changed 2026-09-17 (owner's instruction).** Three things this reverses, recorded so
> they are not re-derived from the older text below:
>
> 1. **grok now implements.** The "Why grok is out" section further down was written when grok
>    _drifted_ into being the default implementer and burned a weekly quota in two days. That
>    rationale was about drift, not capability — its record as reviewer and fixer is 4/4 with every
>    fix mutation-proven. An explicit assignment is not drift. Rule 6 (count runs per seat in every
>    wave record) is what keeps it honest.
> 2. **Two PR reviewers, not one.** Convergence is the point: on the findings-store arc, the
>    F-D4 path-prefix hole and the unvalidated `fixedIn` were each found independently by more than
>    one reviewer, and two sources agreeing on a security control is worth more than either alone.
>    Keep them on different families.
> 3. **The opencode seats leave the implementer rotation.** Note what that costs, because the
>    number is measured rather than felt: the `glm-flash` seat carried G1, G3 and G4 in this
>    repository — clean lanes, honest reports, real mutation checks, and it twice corrected an
>    orchestrator brief with evidence. It remains funded and probed-live. If a lane needs a known
>    quantity rather than a new one, it is still there.
>
> **Probe-the-model, never the prefix.** On 2026-09-17 `opencode/claude-fable-5-1` answered
> _Insufficient balance_ while `opencode/big-pickle` answered fine **on the same prefix** — balance
> is gated per model, not per provider. The older text below reads as though `opencode/` were
> unfunded wholesale. It is not.
>
> **Fable routes that do NOT work** (probed 2026-09-17): `opencode/claude-fable-5-1` (insufficient
> balance), `anthropic/claude-fable-5-1` (credit balance too low), `opencode-go/claude-fable-5-1`
> (model not on that provider). `openrouter/anthropic/claude-fable-5.1` does answer via opencode,
> but the owner's route is the in-process `Agent` seat above.
>
> **When opencode is used at all, prefer `openrouter/` prefixes** (owner's instruction,
> 2026-09-17).

## Spending rules (2026-09-08, after a gemini weekly quota went from ~97 % to 76 % in four runs)

Four agy runs — L12, L1a, and two L1a fix rounds — cost roughly twenty points of a weekly quota.
**Two of the four existed only because the orchestrator's brief specified the wrong types**, and
every one of them re-ran a suite the orchestrator was already running for free. The model was not
the problem. These rules are, in order of what they save:

1. **One fix round, not three.** Do not dispatch a remediation until CI has settled **and** every
   review bot has reported. Findings the orchestrator reads off the diff wait for that same moment.
   One brief carrying every verified finding; a second round only if the first is refuted.
2. **Red-team the brief against the plan's own tables, not only against the code.** Both L1a
   defects — a scalar `outputFamily` where §2.1 says "static, _or_ motion when a layer animates",
   and a `string` template id where the same lane defines the union — were visible in the planning
   document the brief was written from. Every type a brief dictates must be checked against the
   decision it implements.
3. **Fix rounds run the touched test files, never `yarn test:cov`.** The orchestrator runs the full
   gate itself and that run is what gates the merge; the agent running it too is a duplicate paid
   for inside a metered context. Reserve the full gate in a brief for an opening lane, and even
   then ask for the coverage lines, not the whole log.
4. **Match effort to task shape.** `--effort high` is for an open lane. A narrow, fully specified
   remediation brief takes `gemini-3.8-flash-medium` (or `-low`) — this file's own track record
   says that shape is where gemini is strongest, and it is not a reasoning-heavy job. Remember the
   effort flag must match the id's suffix.
5. **Never send an agent to read a long plan.** Quote the decisions it needs into the brief. L1a's
   brief pointed at a 441-line document; the four paragraphs that mattered would have fitted in the
   brief.
6. **Count runs per seat in every wave record**, so a burn is visible before a quota is.
7. **Measure every run.** `agy` reports its own cost when given `--output-format json`: the result
   is one JSON object with `usage` (`input_tokens`, `output_tokens`, `thinking_tokens`,
   `cache_read_tokens`, `total_tokens`), plus `duration_seconds`, `num_turns` and `status`. `opencode
run --format json` emits raw JSON events. **The flag is in the seat commands above and `dispatch-lane.sh` passes `--format json` to opencode by default** (`USAGE_FLAGS`, opt out with `USAGE_FLAGS=""`). Record the numbers in the wave record;
   there is no retroactive accounting — nothing on disk keeps a per-conversation token record, so a
   run launched without it can never be costed. With the flag, an agy reply (and its PR URL) is the
   `.response` field — `jq -r .response` — and the `EXIT n` marker the wrapper appends is written by
   the shell, so it is unaffected either way. **A dispatch that cannot be costed is a dispatch that
   ignored this rule**, not a limitation of the tools.

   **The floor, measured 2026-09-08:** `agy --print "Say OK."` at low effort on the smallest model
   costs **14 996 input tokens** and 2 output tokens. Every invocation pays roughly 15 k before it
   reads a line of the brief. That is the number that makes a third round expensive: not the work,
   the boot.

8. **A lane agent never opens `.agents/session-log.md`.** In campaign-foundry it reached **498 KB — about 125 000 tokens**. **Here it is 2 KB today**, so the
   cost is not yet the point; the _seam_ is. Two lanes that both append share a file, which is
   exactly the 'shared files: none' claim a wave boundary rests on. An agent that reads
   before it writes pays that as input, once per round; four rounds could pay it four times.
   **The lane reports itself in its PR body** (it already does), and the orchestrator appends both
   the lane entry and the wave record at merge time, when reading the file costs nothing. This is
   also what SKILL.md stage 6 already assigns: "a lane reports on itself, the orchestrator reports
   on the wave" — the lane's _report_ is the PR body, not a write into the largest file in the
   repository. The same rule covers any file over ~50 KB: `DESIGN.md` (46 KB), `README.md` (29 KB),
   a long planning document. Quote what the agent needs; never send it to open one.

**A persistent "master" agy feeding sub-threads: measured, and it does not pay.** The mechanisms
exist — `--conversation <id>` resumes by id, `-c/--continue` takes the most recent, and
`--input-format stream-json` reads NDJSON from stdin and runs a turn per line, which is literally
one process held open. Measured on 2026-09-08 against a conversation whose entire history was
_"Say OK." → "OK."_:

|                  | input  | cache read | duration |
| ---------------- | ------ | ---------- | -------- |
| fresh run        | 15 005 | 0          | 1.1 s    |
| resumed (turn 2) | 13 937 | 16 265     | 223 s    |

Resuming a ten-token conversation still cost **93 %** of a fresh boot. The ~15 k floor is the
system prompt and tool schema, not conversation history, and it is already cached — so there is
little to amortise. Worse, the resumed turn re-pays the whole prior transcript as input: on a real
lane, turn 2 would carry turn 1's file reads and gate output and cost _more_ than a fresh boot, not
less. **Keep agents short-lived and their context small; the orchestrator holds continuity.** The
levers that actually move the number are rules 1, 3 and 8, not session reuse.

**Why grok is out.** It exhausted a weekly quota in two days because it drifted from reviewer and
fixer into default implementer (nine lane implementations on 09-07/08, every role at high effort,
reviewer briefs that re-ran the full gate). Reviewer briefs now carry the diff excerpt for the
claim under test and a file list, and never ask a reviewer to run the full gate or the coverage
run — the orchestrator does those. Every wave record counts runs per seat so a burn shows before
a quota does.

Launch every lane detached so a harness timeout cannot kill it, and wait on the marker:

```bash
nohup zsh -c 'CLI … > /tmp/<lane>.log 2>&1; echo "EXIT $?" >> /tmp/<lane>.log' >/dev/null 2>&1 & disown
while ! grep -qE '^EXIT [0-9]+$' /tmp/<lane>.log 2>/dev/null; do sleep 30; done
```

`scripts/dispatch-lane.sh` does both, with the stagger below.

## Traps that have each cost a cycle

- **opencode: never launch two `opencode run` invocations in the same instant.** They share a
  SQLite store; the second dies immediately with `database is locked` and `EXIT 1`. It is startup
  contention only — **stagger by 30–45 s** and both run fine concurrently. Because the failure
  writes its `EXIT` marker instantly, a marker-only wait returns at once and looks like success:
  **read the log body on `EXIT 1`.**
- **opencode: `"User not found."` means a stale stored credential, not a bad model id.** opencode uses its own stored provider key; an `OPENROUTER_API_KEY` in the environment does not override it. Verify the key against the provider's key endpoint before blaming the model id.
- **opencode: `opencode/` and `opencode-go/` are billed separately (2026-09-08).** `opencode/<model>` said _Insufficient balance_ for the model behind the `glm-flash` seat (then on the `opencode-go/` prefix) while `opencode-go/<model>` and `opencode/big-pickle` answered on the same account. Re-probe the exact provider prefix, not just the model.
- **opencode: an unfunded seat kills every model on that account** (`Insufficient balance`), the
  alternates included, and leaves nothing behind — clean worktrees, no commits. Probe before a wave.
- **grok can take 80+ minutes and look dead**: 0 bytes written, seconds of CPU, no error, then it
  delivers. Report a silent reviewer as **unknown**, never as failed, and keep the blocking wait
  armed.
- **grok invocation:** this file prescribes `grok -p "$(cat FILE.md)"`, which every run in the wave
  that produced this skill used successfully, with briefs of several thousand words.
  `docs/workflows/orchestrator-kickoff-prompt.md` prescribes `--prompt-file FILE.md` instead. Both
  work; `--prompt-file` keeps the brief off the command line entirely, so prefer it for a very large
  brief. **The two documents disagreeing is itself worth fixing** — noted rather than silently
  diverged from.
- **grok model id is `grok-4.6`**, not `grok-4.6-high`; effort is a separate flag. Quota exhausts
  with HTTP 402 and later resets.
- **agy needs `--dangerously-skip-permissions` when detached** — the denial is the permission
  prompt failing with no TTY, not the detachment.

## Track record, from waves run in this repo

- **glm-flash's model** — strongest implementer here: 17/18 lanes clean, honest reports, real mutation
  checks, fastest. Has corrected a wrong orchestrator brief with evidence, and once discarded its
  own verification on noticing the check passed vacuously.
- **grok-4.6 high** — the depth leader as reviewer, and 4/4 as fixer with every fix mutation-proven.
  It has twice refused an orchestrator-approved finding with the mechanism instead of complying.
- **gemini-3.1-pro** — excellent on a narrow, fully specified remediation brief; **catastrophic on
  an open-ended lane** (shipped 40 failing tests, deleted another lane's tests, reported success).
  Task shape predicts the outcome better than model rank.
- **mercury-2** — dies above roughly 128k of context; lost 2 of 3 lanes.

**Per-run boot floor — a probe number, and NOT what a lane costs (see the lane table below).** Every invocation pays a
system prompt and tool schema before it reads a line of the brief. That floor differs by CLI by
more than a factor of two, so on a narrow brief the floor _is_ most of the cost:

| CLI / seat                   | model                 | prompt      | input      | total                        | measured                    |
| ---------------------------- | --------------------- | ----------- | ---------- | ---------------------------- | --------------------------- |
| `agy --print` (low effort)   | smallest available    | `"Say OK."` | **14 996** | —                            | 2026-09-08 (hexagen-monaco) |
| `opencode run --format json` | `opencode/big-pickle` | `"Say OK."` | **6 765**  | **8 561** (cache read 1 792) | 2026-09-08 (hexagen-monaco) |

**Consequence:** a narrow remediation is more than twice as cheap on opencode as on agy. That
cuts against the instinct to hold gemini for remediation on cost grounds — hold it for _task
shape_ (rule 4: it is strongest on a narrow, fully specified brief) if at all, not because it is
cheap, because it is not. Re-measure rather than trusting this table: both numbers will drift
with the CLIs' system prompts and tool schemas, and neither is recorded anywhere on disk after
the run.

**What a real lane costs — measured on campaign-foundry's L2a compositor lane, 2026-09-08.**
The boot floor above is a probe artefact. A working lane is dominated by _context accumulation
across steps_, not by startup:

| Metric         | Value         |
| -------------- | ------------- |
| billed input   | 74 900        |
| billed output  | 55 858        |
| **cache read** | **3 997 888** |
| peak context   | 114 486       |
| steps          | 50            |

Roughly 131 k billed, and **4 M read from cache — about 30× the billed amount**. The mechanism:
the conversation grows to ~114 k, and each of 50 steps re-reads all of it. Three consequences,
each of which changes a decision:

1. **"An extra round is expensive because of the ~15 k boot" is wrong.** An extra round is
   expensive because it accumulates a _fresh transcript_. Rule 1 (one fix round, not three) is
   right for a bigger reason than the one it gives.
2. **Rule 8 is now quantitatively justified, not merely prudent.** Sending an agent to open a
   125 k-token file does not cost 125 k once — the file enters the context and is re-read at
   every subsequent step. At 50 steps that is a different order of magnitude. This is also why
   narrowing a brief's read list is worth more than it looks: 75 KB → 15 KB is not a 60 KB
   saving, it is 60 KB × the remaining step count.
3. **The held-open master session is now disproven at lane scale**, not merely at probe scale.
   The earlier probe result (resuming a ten-token conversation cost 93 % of a fresh boot) was
   suggestive; this shows the real mechanism — a long-lived session's cost is its accumulated
   transcript re-read per step, and that grows superlinearly with turns. Keep agents
   short-lived and their context small; the orchestrator holds continuity.

**Practical rules that follow.** Put the expensive, high-volume actions (the full gate, a long
log) as _late_ in a lane as possible, so their output is re-read by as few subsequent steps as
possible. Quote what an agent needs instead of pointing it at a file. Prefer one well-specified
brief over an exchange.

**Keep the implementer and the reviewer on different models.** A clean bill from the model that
wrote the code is worth little. When the two plan reviewers disagree, take it seriously: in this
repo the dissenting one has been right both times, once overturning a plan's central claim after
the other had approved it.

- **glm-flash's model, silent starts (2026-09-07).** Six launches this day (S2 ×1, W1 ×2, T3 ×2, T4 ×1)
  produced a 0-byte log for 10–88 minutes with live processes and a clean tree, on briefs of the
  same shape as the ones it completed within a minute. Every healthy run wrote within ~60 s. Rule:
  a 0-byte log at five minutes is a hang — kill and re-dispatch; a second silent start on the same
  brief → move the lane to grok-4.6 (T3/T4 both wrote within a minute of the switch). The
  `dispatch-lane.sh` wait does not kill; the kill's `EXIT 143` is a marker it accepts.
- **agy model ids (2026-09-07).** `gemini-3.7-flash-high` and `gemini-3.1-pro-high` stopped
  resolving the day gemini-3.8-flash shipped; launches died in seconds with _timeout waiting for
  response_. Current reviewer-B / plan-reviewer id: `gemini-3.8-flash-high`. Re-probe with
  `agy models` before the first agy dispatch of a session — the table above is a snapshot.
