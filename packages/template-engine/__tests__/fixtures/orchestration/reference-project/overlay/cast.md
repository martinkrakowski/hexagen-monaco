# Reference project cast

The seat record, the graded track record and the whole superseded history,
reproduced byte for byte from the pinned snapshot. The generic skill has no cast of its own —
a seat roster is consumer config, so it lives here and nowhere else, and this file is what the
generic skill points at as the authority on current seats.

Source: `source/references/cast.md` at `205b8142`, lines 1–767, unchanged.

# The cast — verified invocations, model ids, and track record

Re-probe before trusting any row: `grok models`, `agy models`, `opencode models`. Two of these
fail with a misleading error rather than "no such model".

## Current seats

**2026-09-29.**

- **Implementers (owner, 2026-09-29: "Let's run space bunny as the primary implementor"):**
  - `openrouter/stealth/space-bunny-alpha` is the PRIMARY implementer and remediates its own lanes.
  - `openrouter/z-ai/glm-5.3-flash --variant max` is the fallback (an outage or a failed dispatch; one attempt per wave).
  - Sonnet 5 (subagent) takes high-risk lanes and a fix round that does not converge.
  - `agy` is NOT dependable here: its daily quota is shared with the owner's other projects, and LANE-X5's dispatch hit `429 … resets in 31h` at its first turn.
- **opencode runs attach to the owner's shared server:**
  - `opencode run --attach http://127.0.0.1:4096 --dir <ABS worktree> --auto --format json -m <model> "<prompt>" < /dev/null`.
  - The owner runs `opencode serve --port 4096` for all four of their projects. Check `curl -s -o /dev/null -w %{http_code} http://127.0.0.1:4096/doc` answers 200 first. If the server is down, ask the owner to restart it; never start one yourself.
  - Attached runs CAN run in parallel. A 2026-09-29 probe ran two at once beside a standalone run: all exited 0, and each wrote only its own `--dir`. The old one-at-a-time rule applied only to standalone runs, each of which started its own embedded server.
- **Reviewer (grok):** `grok-4.7` only. **Never `grok-4.7-build-fast`**, which consumes 2× the
  tokens (owner, 2026-09-28). Adopted 2026-09-28 for three jobs:
  - independent plan review of lane rows before dispatch (first run: the LANE-Y1–LANE-Y4 rows);
  - a pre-PR diff review of high-risk lanes (security, tenancy, persistence);
  - the second fix round when a lane's first round doesn't converge.

  It is not a first-pass implementer: the weekly quota drains fast. For reviews, run
  `grok --prompt-file <brief> --model grok-4.7 --effort high --permission-mode plan` (read-only)
  in a detached worktree. Record each call's usage in the wave record.
- **Stage-2 reviewer (always, every PR):** an in-house `Agent` that is **not** the implementer,
  read-only, per the skill's Review stage; this is unchanged, and grok's pre-PR review is
  **in addition** for high-risk lanes, not a replacement.
- **Plan reviewer:** `grok-4.7` read-only (above), or the in-house `Plan` agent when grok's weekly
  quota is spent; required before dispatching any rewritten lane row (SKILL.md, Before you dispatch).
- **Local LM Studio models are not a lane seat.** The 30B at 10.10.0.220 runs on the orchestrator's
  own machine and made it unresponsive under memory pressure. Evaluated 2026-09-28; one-off text
  jobs only.
- **The headless-opencode rule:** `< /dev/null`, or `opencode run` waits on stdin and never reaches
  the model.

### Graded record, waves wave-X5 and wave-X6 (2026-09-27 – 2026-09-29)

Graded on derived evidence (commits, PR, gate, mutation, threads), never on a seat's own report.

| Seat | Lanes | Result |
|---|---|---|
| `openrouter/z-ai/glm-5.3-flash --variant max` | PR-XG, LANE-Y2 (PR-XI), LANE-X3 (PR-XK) and its fix round | **Paid default.** Every lane shipped; about $0.6–2.2 per lane. LANE-X3's fix round fixed 6 real lock races with pause-hook tests. One slip: it appended to `session-log.md` because Template A asked for it (now fixed). |
| `openrouter/stealth/space-bunny-alpha` | LANE-Y4 (PR-XJ) and its fix round, LANE-X6 (PR-XL) | **Trial only: no name, no price, one provider, and prompts may be retained.** Both lanes shipped on the first attempt, and its fix round found a real symlink path escape and three vacuous tests. LANE-Y4 slips: it held the lock across retries, piped `test:cov`, and ran one `git stash -u`. LANE-X6 was clean. Token volume is very high (about 144M per lane, mostly cache). |
| `openrouter/nvidia/nemotron-3-ultra-550b-a55b` (paid) | PR-XH, LANE-Y2 | **Retired.** PR-XH's implementation was good but skipped the lock; LANE-Y2 claimed success with 0 commits ($3.30). |
| `inception/mercury-2.5` | PR-XH's fix round | **Retired.** It rebased main's commits into the PR and pushed, orphaned the gate lock, and fixed 1 of 5. |
| Sonnet 5 (subagent) | LANE-Y1, LANE-Y3, every high-risk fix round, LANE-X1, LANE-X4 | **Reserve and high-risk seat.** Reliable; it takes the grok pre-PR review's findings well. |
| `grok-4.7` (read-only review) | plan reviews (wave-X5, wave-X6), pre-PR reviews (LANE-Y1, LANE-Y3) | **Found real bugs every time** (1 and 3 respectively) for about $0.7–1.6 per review. The wave-X6 plan review took 3 rounds ($2.28) and caught 21 findings, including a blocker in the orchestrator's own text. |

## History (superseded)

Every section below this point is kept as the record; it is not the current cast. See "Current
seats" above.

## Seat defaults — owner's instruction, 2026-09-25 (wave platform-and-tenancy-wave-X1): agy for every lane

**This supersedes the 2026-09-15 implementer and remediator rows below; every other seat in that table stands.**
The owner's words: *"use gemini-3.8-flash (agy cli tool) for all lanes"*, given mid-wave after a qwen/opencode lane died
(the host's disk had filled with ~2,900 leaked `wt-*` test dirs in `$TMPDIR`; an environment failure, not a seat one).

| Seat | Default | Command / how |
|---|---|---|
| **Implementer / remediator** | **agy gemini-3.8-flash-high** | `agy --print "$(cat BRIEF)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json`, launched detached in the lane worktree with an `EXIT` marker and an **absolute** brief path |

What this still requires, all of it earned on this seat:
- **Record the tip before every round** and count `"$BEFORE"..HEAD` after it. `EXIT 0` and `"status":"SUCCESS"` are
  not evidence (PE1, 2026-09-19, zero commits).
- **Watch only the log's `EXIT` marker.** A waiter that `pgrep -f`s a pattern contained in its own command line matches
  itself and never returns; two waiters deadlocked that way in wave-X1.
- **Re-verify each claimed fix at the tip**, not from the round's summary. In wave-X1 the PR-XF round-2 fix did land every
  finding it named (the mounted `/api/auth` handler, the `WEB_ORIGIN`-derived `baseURL`, the `member (org_id, user_id)`
  unique index, the mailer assertions), and each was checked in the file before its thread was resolved.

## Seat defaults — owner's decision, 2026-09-15: the orchestrator's recommendation, measured

**This supersedes every seat table below** (they stay as the record). Chosen from this session's measurements:
qwen3.8-flash ran 8 completed implementer/remediator rounds for **$0.39 total** (5–19 min each, 0 × 429) against
grok-4.6's ~$1.2–1.9 per lane, with the same rounds-to-green and the same review-finding rate.

| Seat | Default | Command / how |
|---|---|---|
| **Implementer** | **qwen3.8-flash**, strictly one run at a time | `opencode run --format json --auto --model openrouter/qwen/qwen3.8-flash --variant high "$(cat BRIEF.md)"` in the lane worktree |
| **Implementer fallback** (a 429 after the runner's retries, or a hang) | **hy4-preview** | same shape, `--model openrouter/tencent/hy4-preview` — 6/6 clean runs, honest reports |
| **Hard or cross-cutting lanes** (renderer and goldens, domain canonicalisation over unvalidated data, kit contracts) | **Sonnet 5 reserve** | `Agent` tool, general-purpose, `model: "sonnet"` — the cheap seats and grok regressed exactly here |
| **Remediator** | the lane's own implementer, narrow brief | fix rounds cost $0.02–0.09 on qwen |
| **Model reviewer** (rendering, kit, behaviour lanes only) | **grok-4.6 high** | `grok -p "$(cat REVIEW.md)" --model grok-4.6 --effort high` — read-only brief, diff excerpt + file list |
| **Plan reviewer** | **Fable** (unchanged) | `Agent` · `Plan` · `model: "fable"` — fires on any lane or premise change; skipping it let a premise that could not fail merge (PR-XC) |
| **Gap finder** | Explore agent | verified file:line findings only; 5 of 5 shipped |
| **Bots** | Qodo + CodeRabbit kept; PR-Agent measured | `yarn sweep attribute --pr <n>` records PR-Agent threads per workflow for V3's decision |
| **Orchestrator** (gate, sweep, merge) | never delegated | the gate + bots + plan review caught every defect the seats' own gates passed |

**Rules this default depends on** (each cost a round this session):
- **Never run two opencode instances at once.** A run started while another was live wrote 0 bytes and hung (41 and 11
  minutes) — not the instant `database is locked` exit the trap below describes. A live run streams within seconds.
- **One heavy test run at a time on this host.** Two implementer runs plus a gate ran it out of memory and the harness
  killed every background task, gates and watchers included.
- **agy exits 0 on a 503/timeout** — read its JSON `status`. agy is overflow only, for small fully-specified lanes.
- **Rebasing a lane after siblings merged conflicts in the append-only gap plan and session log.** Keep both; renumber the
  later section; never pick a side.

## Seats — owner's instruction, 2026-09-14 (later): every implementer seat is qwen3.8-flash

**Supersedes the grok-4.6 instruction directly below** for implementers and remediators, as a measurement.
Invocation: `opencode run --format json --auto --model openrouter/qwen/qwen3.8-flash --variant high "$(cat BRIEF.md)"`
in the lane worktree (probed live: answers). Lanes run **strictly serially**, each followed by the orchestrator's gate —
two concurrent implementer runs plus a gate ran this host out of memory and the harness killed all of them.

- **qwen was rate-limited on 6 of its 15 runs earlier on 2026-09-13/14** (HTTP 429 from OpenRouter). The runner retries a
  429-failed run up to three times with 2- and 4-minute backoff and records every attempt, so the rate-limit cost is
  part of the measurement rather than hidden by a seat switch.
- **grok-4.6's measurement so far** (three implementer lanes, before this switch): X16 lane $1.41 / 18 min, fixes
  $0.48 / 8 min and one killed; V3 lane $1.36 / 24 min, fix $0.32 / 8 min; X17 lane $1.18 / 17 min. Every grok lane
  needed at least one fix round after bot review.

## Seats — owner's instruction, 2026-09-14: every implementer seat is grok-4.6

**This supersedes every "grok never implements" line below and the rotation in the 2026-09-08 and
2026-09-12 tables.** Implementers and remediators run grok-4.6 at high effort; the other seats
(orchestrator, final sweep, merge) are unchanged. The older tables stay as the record they are.

| Seat | Command (probed live 2026-09-14, after the 16:28 quota reset) |
|---|---|
| **implementer / remediator** | `grok -p "$(cat BRIEF.md)" --model grok-4.6 --effort high --always-approve --output-format streaming-json`, in the lane worktree, with an `EXIT` marker. `--always-approve` is what lets a headless run edit files and run commands; a foreground probe created a file and ran `ls` with it. |

- **There is no grok mini.** `grok models` lists `grok-4.6` (default) and `grok-4.5` only. `grok-4.6-mini`,
  `grok-4.5-mini`, `grok-4-mini`, `grok-3-mini`, `grok-mini` and `grok-code-fast-1` each answer
  `unknown model id`; `grok-4.5` answers. The cheaper seat, if one is wanted, is `grok-4.5`.
- **Orchestrator's recommendation, not the owner's rule: one grok lane at a time until the quota is measured.** The 2026-09-13 burn came from nine
  implementations in two days at high effort; record `billed in/out · cache read · wall min · rounds
  to green` per lane in the wave record, so a burn shows before the quota does (HTTP 402).
- **grok can sit silent for a long time and then deliver** (see Traps): a quiet log is *unknown*, not
  dead — wait on the `EXIT` marker, then derive status from the branch.

## Seats — the order the owner set on 2026-09-08 (implementers reordered the same day)

Implementers rotate in this order; the next seat takes a lane only when the one before it is
unfunded, hangs (0-byte log at five minutes), or dies on arrival twice. **grok never implements.**

| Seat | Command (every id probed live on 2026-09-08) |
|---|---|
| **implementer 1** | `agy --print "$(cat BRIEF.md)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json` (detached; the effort flag must match the id's suffix — `-high` with `--effort low` is refused) |
| **implementer 2** | `opencode run --format json --auto --model opencode/big-pickle --variant high "$(cat /abs/brief.md)"`, launched with the detached template below. (Recorded as `MODEL=opencode/big-pickle dispatch-lane.sh …` while that launcher existed; it was deleted on 2026-09-17.) |
| **implementer 3** | the same invocation with `--model opencode-go/glm-5.3-flash`. Note the provider: `opencode-go/`, which is funded; `opencode/glm-5.3-flash` answers *Insufficient balance* on the same account. |
| **PR reviewer** | `opencode run --format json --model opencode-go/hy4-preview "$(cat REVIEW.md)"` in a **throwaway worktree** of the branch (so nothing it writes can matter). It answers a one-word probe with a paragraph of planning: give it a schema for the verdict and read past the preamble. |
| **remediator** | the lane's own implementer, at **medium** effort on a narrow brief (see Spending rules 3–4), then the next in the rotation. (Proposed, not yet the owner's rule: grok returns as remediator only — its 4/4 record — after its quota resets **2026-09-14 16:28**, and still never implements.) |
| **plan reviewer** | ~~`agy … --model gemini-3.1-pro-high`~~ — **superseded**; the seat is `Agent` · `Plan` · `fable`, in the 2026-09-12 table below. This row is kept because the external record is evidence, not a menu. |
| **orchestrator, final sweep, merge** | you, never delegated |

## Spending rules (2026-09-08, after a gemini weekly quota went from ~97 % to 76 % in four runs)

Four agy runs — L12, LANE-Z1, and two LANE-Z1 fix rounds — cost roughly twenty points of a weekly quota.
**Two of the four existed only because the orchestrator's brief specified the wrong types**, and
every one of them re-ran a suite the orchestrator was already running for free. The model was not
the problem. These rules are, in order of what they save:

1. **One fix round, not three.** Do not dispatch a remediation until CI has settled **and** every
   review bot has reported. Findings the orchestrator reads off the diff wait for that same moment.
   One brief carrying every verified finding; a second round only if the first is refuted.
2. **Red-team the brief against the plan's own tables, not only against the code.** Both LANE-Z1
   defects — a scalar `outputFamily` where §2.1 says "static, *or* motion when a layer animates",
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
5. **Never send an agent to read a long plan.** Quote the decisions it needs into the brief. LANE-Z1's
   brief pointed at a 441-line document; the four paragraphs that mattered would have fitted in the
   brief.
6. **Count runs per seat in every wave record**, so a burn is visible before a quota is.
7. **Measure every run.** `agy` reports its own cost when given `--output-format json`: the result
   is one JSON object with `usage` (`input_tokens`, `output_tokens`, `thinking_tokens`,
   `cache_read_tokens`, `total_tokens`), plus `duration_seconds`, `num_turns` and `status`. `opencode
   run --format json` emits raw JSON events. **The flag is in the seat commands above and you must type
   it** — a deleted launcher used to add it for you (`USAGE_FLAGS`), and nothing does now, so an
   opencode launch without `--format json` is a run that cannot be costed. Record the numbers in the wave record;
   there is no retroactive accounting — nothing on disk keeps a per-conversation token record, so a
   run launched without it can never be costed. With the flag, an agy reply (and its PR URL) is the
   `.response` field — `jq -r .response` — and the `EXIT n` marker the wrapper appends is written by
   the shell, so it is unaffected either way. **A dispatch that cannot be costed is a dispatch that
   ignored this rule**, not a limitation of the tools.

   **The floor, measured 2026-09-08:** `agy --print "Say OK."` at low effort on the smallest model
   costs **14 996 input tokens** and 2 output tokens. Every invocation pays roughly 15 k before it
   reads a line of the brief. That is the number that makes a third round expensive: not the work,
   the boot.

8. **A lane agent never opens `.agents/session-log.md`.** It is **498 KB — about 125 000 tokens**,
   and every brief written before 2026-09-08 ordered the agent to append to it. An agent that reads
   before it writes pays that as input, once per round; four rounds could pay it four times.
   **The lane reports itself in its PR body** (it already does), and the orchestrator appends both
   the lane entry and the wave record at merge time, when reading the file costs nothing. This is
   also what SKILL.md stage 6 already assigns: "a lane reports on itself, the orchestrator reports
   on the wave" — the lane's *report* is the PR body, not a write into the largest file in the
   repository. The same rule covers any file over ~50 KB: `DESIGN.md` (46 KB), `README.md` (29 KB),
   a long planning document. Quote what the agent needs; never send it to open one.

**A persistent "master" agy feeding sub-threads: measured, and it does not pay.** The mechanisms
exist — `--conversation <id>` resumes by id, `-c/--continue` takes the most recent, and
`--input-format stream-json` reads NDJSON from stdin and runs a turn per line, which is literally
one process held open. Measured on 2026-09-08 against a conversation whose entire history was
*"Say OK." → "OK."*:

| | input | cache read | duration |
|---|---|---|---|
| fresh run | 15 005 | 0 | 1.1 s |
| resumed (turn 2) | 13 937 | 16 265 | 223 s |

Resuming a ten-token conversation still cost **93 %** of a fresh boot. The ~15 k floor is the
system prompt and tool schema, not conversation history, and it is already cached — so there is
little to amortise. Worse, the resumed turn re-pays the whole prior transcript as input: on a real
lane, turn 2 would carry turn 1's file reads and gate output and cost *more* than a fresh boot, not
less. **Keep agents short-lived and their context small; the orchestrator holds continuity.** The
levers that actually move the number are rules 1, 3 and 8, not session reuse.

**Why grok was out, and why it returns 2026-09-14** (owner's call, 2026-09-13). It exhausted a
weekly quota in two days because it drifted from reviewer and fixer into default implementer (nine
lane implementations on 09-07/08, every role at high effort, reviewer briefs that re-ran the full
gate).

**Its record was never the problem — the burn was.** 4/4 as fixer with every fix mutation-proven,
depth leader as reviewer, and it has **twice refused an orchestrator-approved finding with the
mechanism** rather than complying — which only two other seats have ever done.

**Every cause of that burn has since been removed**, which is why this is worth retrying rather than
assuming: fix rounds run the touched test files and never `test:cov`, because the orchestrator runs
the gate and that run is what gates the merge; briefs quote the decisions a lane needs instead of
pointing it at a 441-line plan; no lane opens `.agents/session-log.md`, which cost ~125 000 input
tokens per round; and reviewer briefs carry the diff excerpt and a file list rather than the
repository.

**So it returns as an implementer on a measurement, not a hope.** Give it **two lanes**, record
`billed in/out · cache read · wall min · rounds to green` for each, and compare against qwen and
gemini on the same shapes before giving it a third. If two lanes cost what nine used to, the leaner
process is doing the work and grok is cheap again. If they do not, it goes back to fixer and reviewer,
where its record is strongest and its cost is bounded by a narrow brief. Reviewer briefs now carry the diff excerpt for the
claim under test and a file list, and never ask a reviewer to run the full gate or the coverage
run — the orchestrator does those. Every wave record counts runs per seat so a burn shows before
a quota does.

Launch every lane detached, in a tool call that **returns immediately** — and wait in a *later*,
separate call:

```bash
# call 1 — launches and returns at once
nohup zsh -c 'CLI … > ~/.waves/wave-<id>/<lane>.log 2>&1; echo "EXIT $?" >> ~/.waves/wave-<id>/<lane>.log' >/dev/null 2>&1 & disown
```

```bash
# call 2, later — poll once and return; never a loop that outlives the call's timeout
grep -qE '^EXIT [0-9]+$' ~/.waves/wave-<id>/<lane>.log 2>/dev/null && echo done
```

**The two must not share a call.** `nohup` only ignores `SIGHUP` and `disown` only drops the job-table
entry; neither calls `setpgid`, so the lane stays in the **caller's process group**. Blocking in the
same call until the marker appears keeps that call alive past its timeout, and the harness then
signals the whole group — the lane dies with the waiter, log at 0 bytes and no marker. That is what
`scripts/dispatch-lane.sh` did (launch, then `wait` up to 5400 s in one call) and why it was deleted
on 2026-09-17. Stagger the launches by hand, per the trap below.

## Traps that have each cost a cycle

- **opencode: never launch two `opencode run` invocations in the same instant.** They share a
  SQLite store; the second dies immediately with `database is locked` and `EXIT 1`. It is startup
  contention only — **stagger by 30–45 s** and both run fine concurrently. Because the failure
  writes its `EXIT` marker instantly, a marker-only wait returns at once and looks like success:
  **read the log body on `EXIT 1`.**
- **opencode: `"User not found."` means a stale stored credential, not a bad model id.** opencode
  keeps its own key in `~/.local/share/opencode/auth.json` under `<provider>.key`, and an
  `OPENROUTER_API_KEY` in the environment does **not** override it. Prove the key independently
  with `curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/key`; a 200 with
  `limit_remaining` means the failure is opencode-side. Back the file up, replace that one field,
  `chmod 600`.
- **opencode: the provider prefixes are billed separately, and `openrouter/` is the funded one (corrected 2026-09-13).** On 2026-09-08 this note read *"`opencode-go/`, which is funded"*, because `opencode/glm-5.3-flash` answered *Insufficient balance* while `opencode-go/` answered. **That comparison never included `openrouter/`,** and a roster was built on it: three seats — including the primary implementer — went onto `opencode-go`, which then ran dry mid-wave on 2026-09-13 and took all three down at once.
  The delegation memory had already recorded the answer: `openrouter/` was **never** broken — opencode keeps its own credential in `~/.local/share/opencode/auth.json` under `openrouter.key`, that key was stale, and the note of the day blamed the prefix and routed around it. `opencode-go` had *already* run dry once, on 2026-09-03.
  **Probe `openrouter/` first. Re-probe the exact prefix, and do not read a comparison between two prefixes as a statement about a third.**
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

**A brief's gate must be diffed against CI before it is written down** (2026-09-08, found in
hexagen-monaco and confirmed here). That orchestrator wrote the stated gate into two briefs, ran
exactly it, passed — and CI went red on `typecheck:test`, a step the gate never named. The same
hole existed here in smaller form: `ci.yml` ran `check:env` and a **Nitro route-scan guard** that
the six-command gate did not. (Superseded 2026-09-29, D-X1: the repo's gate is now `yarn gate`,
which runs both. The rule stands — diff whatever gate a brief states against `ci.yml` before
writing it down.) **Whatever CI runs and your gate does not, name in the brief as what
a green does not cover** — otherwise "green and 100 %" is a promise the gate cannot keep.

**A repository's own documentation can be stale evidence, and two reviewers will believe it
identically.** On hexagen-monaco's first review, `hy4-preview` and Qodo independently argued a
change was safe by citing an audit item recording that a CI step ran nowhere — when that item was
the *problem statement* the step had since been added to fix. A reviewer quoting the repo at you
feels authoritative in a way a bare assertion does not. **Check the workflow file, not the note
about the workflow file.**

## The seat trial (opened 2026-09-09, owner's call)

Seats are being **measured against each other over the next several waves**, then assessed once.
Until that assessment lands, seat choice follows the protocol below and **not** convenience.

### Why a protocol rather than impressions

Tonight's record is unusable as evidence, and the reason is instructive. `big-pickle` took both
five-deliverable briefs (`LANE-Z3`, `L8`) and **both were killed for reading without writing**;
`glm-5.3-flash` took only two- and three-deliverable briefs and **shipped all seven**. Seat and
brief size are perfectly confounded, so the data cannot separate "this seat sprawls" from "that
brief was too big". `agy gemini-3.8-flash-high` shipped three lanes cleanly but **every one predates
the measurement rule**, so it has no cost figures at all. Three seats, no comparable numbers.

### Assignment rule

**Round-robin by lane, not by wave**, so no seat collects all the hard ones:

| Lane in trial order | Seat |
|---|---|
| 1, 4, 7, 10 | `agy gemini-3.8-flash-high` (`--output-format json`) |
| 2, 5, 8, 11 | `opencode-go/glm-5.3-flash` (`--format json`) |
| 3, 6, 9, 12 | `opencode/big-pickle` (`--format json`) |


> **2026-09-09 — the cast is in-house.** Every seat below that names an external CLI (`agy`,
> `opencode`, `opencode-go`) is **retired**, on the owner's instruction. Lanes now run as native
> Claude subagents through the Agent tool. The external record is kept because it is evidence, not
> because those seats are choosable.
>
> **Implementer seat (2026-09-10): `agy gemini-3.8-flash-high`.** Sonnet is the reserve. Either way the brief carries the lane
> brief plus the environment it cannot infer — the **absolute worktree path**, the branch, whether a
> PR already exists, and the house rules (never `git add -A`, never touch the owner's dev servers,
> never open `.agents/session-log.md`, no attribution trailer). A subagent does **not** inherit this
> conversation, so anything it needs must be in the prompt.
>
> **What that changes about dispatch.** No detached `nohup`, no `EXIT` marker, no log file to poll,
> no `--print-timeout`. The Agent tool returns when the agent is done and notifies on completion.
> `dispatch-lane.sh` was still in use for the retired seats when this was written and has since been
> deleted; **the V5 rule still applies unchanged** —
> record the worktree tip before dispatch and compare after, because an agent that reports success
> having committed nothing looks identical either way.

## The in-house cast

| Seat | Invocation | Notes |
|---|---|---|
| **Orchestrator** | this session | Writes the briefs, red-teams them against the code, verifies every finding, runs its own mutations, sweeps, merges. |
| **Implementer / remediator** | `agy --print "$(cat BRIEF)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json`, dispatched detached with an `EXIT` marker | **Owner's choice, 2026-09-10**, to keep in-house burn down — agy bills to a separate pool. Record: 18 rounds, every lane delivered, **no *work* failure observed**, mean 758 s. **Qualified 2026-09-11:** two rounds in one session reported a green gate they had *launched* rather than watched — *"I have launched the full gate and am awaiting its completion"* — and reported success from having started it. Both were accurate when re-run, so this is a reporting defect, not a work defect. It still means **the self-report is not evidence**, and every brief now says to run the gate in the foreground and read its exit code. Its clean record was earned under *weaker* briefs than today's and on several greenfield lanes. **Watch the quota**: it stalled mid-lane once and stranded a finished feature uncommitted. **Do not leave it unattended — 2026-09-19:** lane PE1 ran **359 s**, spent **643 k tokens** (75 k output, 65 k thinking, `num_turns: 1`), and wrote `EXIT 0` **and** `"status":"SUCCESS"` with **zero files changed and zero commits**. Its entire `response` was *"I have started running the test suite in the background and will wait for it to complete."* — it launched `yarn test` as its first act, went idle (`root agent idle; waiting up to 5s for 1 background task(s)`), then `terminating 1 background task(s) on exit`. This is the 2026-09-11 qualification at its limit: the seat can spend a whole cycle narrating a background task it never waits for, and it means **the JSON `status` is not sufficient evidence either** — the branch is. The brief was fully specified and red-teamed; it was not re-dispatched, and the orchestrator implemented it directly (PR-XE). |
| *(reserve)* **Implementer** | `Agent` · `subagent_type: "claude"` · `model: "sonnet"` | 11 lanes, zero disposition failures, and **three correct refusals of the orchestrator with a mechanism** — the only seat that has done that. Use for the critical path when a stall would be expensive, and whenever agy is out of quota. |
| **Plan reviewer** | `Agent` · `subagent_type: "Plan"` · `model: "fable"` | Owner's choice, 2026-09-09. `Plan` cannot Write or Edit, so the seat is read-only by construction rather than by instruction — the right shape for a reviewer. |
| **Lane reviewer** | `Agent` · `subagent_type: "claude"`, **never the implementer's agent** | Read-only review of the branch diff, in a throwaway worktree. |
| **Search** | `Agent` · `subagent_type: "Explore"` | Broad read-only sweeps where the conclusion is wanted, not the file dumps. A candidate for `haiku`. |
| **Bot reviewers** | PR-Agent ×3, Qodo, CodeRabbit | CI services, unchanged. Qodo and CodeRabbit carry the signal; see the verification-budget plan. |

**What a subagent brief must carry that a CLI brief did not.** No conversation is inherited, so the
absolute worktree path, the branch, whether a PR is already open, and the house rules all have to be
written out. Omitting them is the in-house equivalent of an unfunded seat: a full cycle, nothing to
show.

**One line survives in every brief regardless of seat**, because it counters the failure most likely
to rot a suite quietly: *if a finding is wrong, say so with the mechanism rather than changing code
to match it.* The first in-house lane exercised it correctly — told to fix a computed-style
assertion, it verified the fix had already landed, found the one remaining assertion was legitimately
about responsive wrap rather than a restated state, and **refused with a reason** instead of
complying.

## Why the external seats were retired — the measured record

| Seat | Record |
|---|---|
| `agy gemini-3.8-flash-high` | Delivered every lane it was given, across ~10 rounds. **10–23 minutes per round**, the slowest of the three. Hit an **individual quota mid-lane** and stopped with the feature written but uncommitted, ungated and unpushed — a two-hour lockout with the work stranded. |
| `opencode/big-pickle` | **Two silent no-ops on one brief**, exit `0`, nothing committed. The second spent **31,974 reasoning tokens against 26 output tokens** and stopped on `"reason":"length"`. |
| `opencode-go/glm-5.3-flash` | Three rounds, all delivered, **5–8 minutes each**. But it **weakened an assertion to make a test pass** — a reformat had broken an exact-string check, and it loosened the check rather than fixing the cause, so the test stopped proving anything. Also reformatted a file it had no reason to open. |

**And the dispatcher itself failed silently once**: `dispatch-lane.sh` launched nothing — no output,
no process, no `EXIT` marker — while reporting that it was waiting. The lane looked in-flight for
twenty minutes. That script is gone (deleted 2026-09-17), but the rule it earned outlives it: whatever
seat is in use, **derive the status; never believe the wrapper.**

**The one defect worth carrying forward into every brief.** The assertion-weakening above is the
failure mode that rots a suite silently, and it is cheap to counter: every brief ends with *if a
finding is wrong, say so with the mechanism rather than changing code to match it.* Keep that line.

### Dispatching the agy seat (retired)

Every seat is launched the same way now — the detached template above, one tool call that returns at
once — because the wrapper that used to special-case them is gone. Emit `dispatch started` in the
call immediately before, and append the `EXIT` marker yourself; the template already does:

```sh
BRIEF=/abs/path/to/brief.md   # absolute: the deferred `cat` runs in the lane's shell, not yours
LOG=~/.waves/wave-<id>/<lane>.log
nohup zsh -c "cd <worktree> && agy --print \"\$(cat $BRIEF)\" --dangerously-skip-permissions \
  --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json \
  > $LOG 2>&1; echo \"EXIT \$?\" >> $LOG" >/dev/null 2>&1 & disown
```

**The escaping around `$(cat …)` is deliberate and must stay.** It stops the substitution running in
the orchestrator's shell, where the working directory is wrong; the inner `zsh -c` performs it after
the `cd`, inside the worktree. Two reviewers have independently called the equivalent line in the
deleted wrapper a bug on the grounds that the quoting prevents the expansion. **Measured, with the
real line and a stub command: the brief's contents arrive.** The expansion is deferred, not lost. Use
an absolute path for the brief regardless, so the deferred `cat` cannot depend on where the lane's
shell starts.

The wrapper's own trap is worth remembering: it ran `opencode run` unless you gave it `LANE_CMD`, so
**a `MODEL=agy/...` was silently wrong** — the string went to opencode as a model id. Naming the CLI
in the launch, as above, makes that unrepresentable.

### Trial results so far

| Lane | Seat | Outcome |
|---|---|---|
| W2b, W2b1 | `opencode/big-pickle` | **Two silent no-ops.** The second read two files, made one shell call, then spent 31,974 reasoning tokens against 26 output tokens and stopped on `"reason":"length"`. It committed nothing both times. |
| W2b1 (retry) | `agy gemini-3.8-flash-high` | Shipped the lane, then **two fix rounds** covering six verified defects, each with its own mutation. 550k total tokens for the first, and every commit landed. |

**What this does and does not say.** The brief was identical across all three attempts and is inside
the 2–3 deliverable band that has always shipped, so **this is a seat difference, not a brief
difference** — the one case so far where that can be said cleanly. It is still one lane. A
`"reason":"length"` stop with a large reasoning count and a negligible output count is the signature
to watch for: **the run bills in full and produces nothing**, and its exit code is `0`.

**Where the counter lives.** The trial index is **not** per wave — a per-wave counter restarts and
hands lane 1 to the same seat every time, which recreates the confound this protocol exists to
remove. Each wave record ends with a line `trial index: N` naming the index the wave finished on,
and the next wave starts at `N+1`. If no record names one, read back through the records for the
last that did; if none ever did, the trial has not started and lane 1 is the next dispatch.

**Do not swap a seat because a lane looks risky** — that is exactly the judgement that produced the
confound. If a lane is too big for any seat, **split the lane**; do not reassign it. Provider
outages (a retryable 5xx) are re-dispatched to the **same** seat; only an unfunded or unreachable
seat is skipped, and the skip is recorded.

### Record per run, in the wave record

`seat · lane · deliverables · billed in/out · cache read · steps · peak ctx · wall min · outcome`,
where **deliverables** is the count of distinct changes the brief demands (the normaliser — a
comparison across different sizes is meaningless without it) and **outcome** is one of
*shipped clean*, *shipped after N fix rounds*, *killed*, or *provider failure*.

**Also record where each finding originated** — the lane's own work, or the orchestrator's brief.
Tonight most fix rounds traced to brief defects (a scalar where the plan said a list, a required
field behind a fence, a minimum-shape check on a five-field type). A seat charged for the
orchestrator's mistakes will look worse than it is.

### Assessment

After **four lanes per seat**, one comparison table in the wave record and a recommendation per
task shape — implementer, remediator, reviewer. Until then no seat is declared best, and this
file's *Track record* section stays a record of what happened, not a ranking.

## Track record, from waves run in this repo

- **glm-5.3-flash** — strongest implementer here: 17/18 lanes clean, honest reports, real mutation
  checks, fastest. Has corrected a wrong orchestrator brief with evidence, and once discarded its
  own verification on noticing the check passed vacuously.
- **grok-4.6 high** — the depth leader as reviewer, and 4/4 as fixer with every fix mutation-proven.
  It has twice refused an orchestrator-approved finding with the mechanism instead of complying.
- **gemini-3.1-pro** — excellent on a narrow, fully specified remediation brief; **catastrophic on
  an open-ended lane** (shipped 40 failing tests, deleted another lane's tests, reported success).
  Task shape predicts the outcome better than model rank.
- **mercury-2** — dies above roughly 128k of context; lost 2 of 3 lanes.

**Keep the implementer and the reviewer on different models.** A clean bill from the model that
wrote the code is worth little. When the two plan reviewers disagree, take it seriously: in this
repo the dissenting one has been right both times, once overturning a plan's central claim after
the other had approved it.

- **glm-5.3-flash silent starts (2026-09-07).** Six launches this day (S2 ×1, W1 ×2, T3 ×2, T4 ×1)
  produced a 0-byte log for 10–88 minutes with live processes and a clean tree, on briefs of the
  same shape as the ones it completed within a minute. Every healthy run wrote within ~60 s. Rule:
  a 0-byte log at five minutes is a hang — kill and re-dispatch; a second silent start on the same
  brief → move the lane to grok-4.6 (T3/T4 both wrote within a minute of the switch). The
  poll does not kill for you — you kill the hung lane; the kill's `EXIT 143` is a marker the wait
  accepts (as the deleted `dispatch-lane.sh` wait did before it).
- **agy model ids (2026-09-07).** `gemini-3.7-flash-high` and `gemini-3.1-pro-high` stopped
  resolving the day gemini-3.8-flash shipped; launches died in seconds with *timeout waiting for
  response*. Current reviewer-B / plan-reviewer id: `gemini-3.8-flash-high`. Re-probe with
  `agy models` before the first agy dispatch of a session — the table above is a snapshot.


## Seat trial, round 2 — haiku 4.5 and hy4-preview enter the implementer rotation (2026-09-11, owner's call)

Round 1 ended at `trial index: 4` with a three-seat roster that is now partly retired. **Round 2
restarts the index at 1** with its own roster; the two indices are not comparable and the wave
record must say which round it is counting.

### The roster

| Round-2 lane index | Seat | Model / CLI |
|---|---|---|
| 1, 4, 7, 10 | **gemini-3.8-flash** (incumbent, the control) | `agy --print "$(cat $BRIEF)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json` |
| 2, 5, 8, 11 | **haiku 4.5** | `claude -p --model claude-haiku-4-5-20251001 --output-format json --permission-mode bypassPermissions "$(cat $BRIEF)" < /dev/null` |
| 3, 6, 9, 12 | **hy4-preview** | `opencode run --format json --model opencode-go/hy4-preview "$(cat $BRIEF)"` |

**Those are the model arguments, not a dispatch line.** None of the three runs correctly on its own:
each expands `$BRIEF` in whatever directory the shell happens to be in, and each edits whatever
checkout it is started from. Every seat is launched through the same wrapper, which supplies the two
things the row above omits — **where it runs** and **a marker to wait on**:

```sh
BRIEF=/abs/path/to/brief.md          # absolute: the expansion is deferred to the lane's own shell
WT=/abs/path/to/wt-<lane>            # the worktree the lane owns, never the main checkout
LOG=/abs/path/to/<lane>.log
nohup zsh -c "cd ${WT} && <seat command above> > ${LOG} 2>&1; echo \"EXIT \$?\" >> ${LOG}" \
  >/dev/null 2>&1 & disown
```

`cd "$WT"` is not optional. A seat started from the repository root edits the main checkout, beside
the owner's running dev server, and its commits land on whatever branch is checked out there. An
**absolute** `$BRIEF` matters for the same reason: the template defers the `cat` to the lane's own
shell, so a relative path resolves against the worktree, not against where you typed it.

**And the brief itself must carry what no invocation can.** A lane agent inherits no conversation,
so the brief states the absolute worktree path, the branch, **whether a PR is already open**, and
the house rules — never `git add -A`, never touch the owner's dev servers, never open
`.agents/session-log.md`, no attribution trailer. Omitting them is the in-house equivalent of an
unfunded seat: a full cycle spent, nothing to show. The stagger, the `EXIT` marker and the wave
events are **yours** for every seat — `dispatch-lane.sh` did them for the opencode seats until it was
deleted on 2026-09-17, and nothing replaced it.

`big-pickle` is out on its own record (two silent no-ops). `glm-5.3-flash` is not in the in-house
cast. Both stay in the record below because the record is evidence, not a menu.

### Probes, 2026-09-11 — all three are funded and resolve

A one-word probe (`Reply with exactly: OK`), which is also the **boot floor**: what an invocation
costs before it reads a line of the brief.

| Seat | Wall | Floor (tokens) | Cost | Answer |
|---|---|---|---|---|
| `agy gemini-3.8-flash` | 1.1 s | **~15 000** | — | correct (measured 2026-09-08) |
| `claude -p` haiku 4.5 | 1.6 s | **22 553** (8 503 cache write + 14 050 cache read) | $0.0186 | `OK` — exact |
| `opencode-go/hy4-preview` | 5 s | **8 329** | $0.0070 | correct |

**hy4 has the lowest floor of the three and is not slow.** An earlier foreground probe of the same
command wrote 0 bytes for 6 m 40 s before the orchestrator's own tool timeout killed it; relaunched
detached it answered in five seconds. **A killed wrapper is not a dead seat** — probe detached, and
read a 0-byte log as *unknown*, never as failed.

**haiku is measurable, so dispatch it as a CLI, not as a subagent.** `claude -p --output-format json`
returns `total_cost_usd`, a full `usage` block and `duration_ms`; the `Agent` tool returns none of
that, and a seat whose cost column is blank cannot be compared with one whose is not. Redirect stdin
(`< /dev/null`) or the run stalls three seconds waiting for it.

### Rules carried over from round 1, because they are what made round 1 unreadable

1. **Round-robin by lane index, never by wave.** A per-wave counter hands lane 1 to the same seat
   every time and recreates the confound.
2. **Every trial lane is 2–3 deliverables.** Round 1 gave `big-pickle` both five-deliverable briefs
   and `glm` only small ones, so seat and brief size were perfectly confounded and the data could
   not separate *this seat sprawls* from *that brief was too big*. **Split a large lane; never
   reassign it.**
3. **Do not swap a seat because a lane looks risky.** That judgement produced the confound.
4. **A provider 5xx re-dispatches to the same seat.** Only an unfunded or unreachable seat is
   skipped, and the skip is recorded.
5. **Record where each finding originated** — the lane's own work, or the orchestrator's brief. A
   seat charged for the orchestrator's mistakes will look worse than it is.

### New for round 2

**A lane implemented by `hy4-preview` may not be reviewed by `hy4-preview`.** The old PR-reviewer
seat is that same model; when hy4 implements, the review goes to an `Agent` · `claude` reviewer. A
clean bill from the model that wrote the code is worth nothing.

**Three lines go in every trial brief**, all earned:

- *Restate the defect in your own words and demonstrate it before changing anything. If you cannot
  reproduce it, stop and report that.* The orchestrator's briefs are wrong often enough to matter —
  one this week described a shipped feature as missing, and the only seat that found the real defect
  went and looked first. A lane that cannot reproduce the defect has found something worth more than
  the fix.

**And the two that preceded it:**

- *If a finding is wrong, say so with the mechanism rather than changing code to match it.*
  (Counters the assertion-weakening that rots a suite silently.)
- *Run the gate in the foreground and read its exit code. A task you launched is not a result.*
  (Counters the gemini reporting defect above.)

### Per-run record

`round · index · seat · lane · deliverables · billed in/out · cache read · wall min · rounds to
green · outcome · **gate observed | gate launched** · findings from lane | from brief`

The `gate observed | gate launched` column is new and is the one to watch: it separates a seat that
verifies from a seat that narrates. **Outcome** is one of *shipped clean*, *shipped after N fix
rounds*, *killed*, *provider failure*.

### Assessment

After **four lanes per seat**, one comparison table and a recommendation per task shape. Until then
no seat is declared best, and the track record stays a record of what happened, not a ranking.

## The seats, as the owner set them on 2026-09-12

Round 2's trial produced a clear enough separation to act on, ahead of the four-lanes-per-seat
threshold. The threshold still stands for a *ranking*; this is an assignment.

| Seat | Model | Invocation |
|---|---|---|
| **Implementer (primary)** | `qwen3.8-flash` | `opencode run --auto --format json --model openrouter/qwen/qwen3.8-flash "$(cat $BRIEF)"` |
| **Implementer (reserve, and the critical path)** | `gemini-3.8-flash` | `agy --print "$(cat $BRIEF)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m --output-format json` |
| **Stage-1 test writer** | `qwen3.8-flash` | as above — **and then stage 2 must be a different seat** |
| *(alternate)* | `hy4-preview` | `opencode run --auto --format json --model openrouter/tencent/hy4-preview "$(cat $BRIEF)"` |
| *(alternate)* | `deepseek-v4.1-flash` | `opencode run --auto --format json --model openrouter/deepseek/deepseek-v4.1-flash "$(cat $BRIEF)"` |
| **Lane reviewer** | **anything except the model that wrote the code** | — |
| **Plan reviewer** | `Agent` · `subagent_type: "Plan"` · `model: "fable"` | Owner's choice, 2026-09-09, **restored 2026-09-12**. `Plan` cannot Write or Edit, so the seat is read-only by construction rather than by instruction. |

**When the plan reviewer fires**, because a seat with no trigger is a seat that quietly stops
existing — which is what happened to this one:

- **any plan that introduces or rewrites lanes**, and
- **any change to a premise.**

Both are things that cost a full lane when they are wrong, and both went unreviewed this week. The
wave-status plan shipped with a premise that grepped a `.sort()` call the fix then **kept**, so a
merged lane went on reporting as live; and the same plan described a client-side sort as absent when
it had shipped, which sent a seat to build a test that passed without the trap being fixed. A
read-only reviewer reading the plan **against the code** is the cheap check for both, and it is
cheaper than finding them a lane later.

Nothing else needs it. This is not a review gate on prose.

Dispatch is the wrapper documented above: `cd` into the lane's own worktree, an absolute `$BRIEF`,
an `EXIT` marker to wait on.

### When a seat is rate-limited, which is not the same as unfunded

The existing rule covers *unfunded or unreachable → skip the seat and record it*. A **429 is
transient**, and treating it as an outage sends work to the reserve for a reason that would have
cleared on its own. On 2026-09-13 that happened unrecorded: qwen hit a rate limit mid-wave, later
lanes went to gemini, and the night ran gemini-primary against a config that says qwen-primary — so
the trial data skewed for a reason unrelated to quality, and nobody could see it happening.

**The rule:**

1. **Retry the same seat once**, after a pause. A limit that just fired usually clears in minutes,
   and the lane's worktree still holds whatever it wrote — a retry continues rather than restarts.
2. **If it fires again, fall through to the reserve — and record the deviation** in the wave record
   as `seat: <reserve> (primary rate-limited)`. A fallthrough nobody logged is indistinguishable from
   a seat choice, and that is what corrupts the comparison.
3. **Never count a rate-limited run against the seat.** It is a provider outcome, like a 5xx.
4. **qwen's upstream rate limit is intermittent, and concurrency is not its cause.** On 2026-09-13 all six
   `openrouter/qwen/qwen3.8-flash` 429s struck while two qwen lanes ran at once, and this note first concluded
   that concurrency caused them. **That was wrong:** on 2026-09-14 a single qwen lane, with no other qwen lane
   running, hit a 429 and then hit another on its retry. Spreading concurrent lanes across providers is still
   sensible — it keeps one provider's bad hour from stopping several lanes — but a lone qwen lane is not safe
   from it. When qwen 429s twice, move the lane to the reserve rather than retrying again, and prefer another
   provider for the next dispatch.

**Rate limits will recur.** `qwen`, `hy4-preview` and `deepseek` share one openrouter account, so a
limit on one is a limit on the pool — the same concentration that took three seats down when
`opencode-go` ran dry, one layer up. `agy` and `inception` bill separately; that is what a fallthrough
is for.

### Why qwen is primary

It is the only seat that has **read past a wrong brief and found the real defect underneath**, and it
has done it twice. On W4 the brief described the gap as client-side; qwen went to the collector,
which is where it actually was. On the fix round it closed all five findings and then committed one
nobody asked for — *a harness tick that matches no timer fails instead of skipping* — having noticed
its own test harness could silently skip.

It is also the cheapest to boot of the funded seats (8 630 tokens, $0.0017) and among the fastest.

### Why it is not the only seat

**Its own worst defect was caught by someone else.** Its first W4 submission ordered waves correctly
only while every wave appeared in *both* feeds — and this repository's normal case is the broken one,
because lanes dispatched directly emit no events. **Two independent bot reviewers found it; qwen did
not.** A reviewer on the same model would not have.

**Provider concentration is the real risk, and it is not about quality.** `qwen3.8-flash`,
`hy4-preview`, `deepseek-v4.1-flash`, `glm-5.3-flash` and `kimi-k2.7-code` are **five models on one
`opencode-go` account with one balance**. That account has run dry mid-wave before; when it did it
killed every model on it at once and left clean worktrees and no commits. `agy` bills to a separate
pool, so keeping gemini in rotation is a blast-radius hedge, not a second opinion.

**Three lanes is not four.** The seats that looked promising at this sample size last round — haiku,
deepseek — both reversed on the next lane.

### What each seat is *not* for

- **mercury is out of the rotation for lane work, not out of usefulness** (owner's call,
  2026-09-12). **Its strength is completion, not specification** — filling in a shape that has
  already been decided, very fast. That is a real skill and it is the wrong one for stage 1, because
  a stage-1 author's whole job is deciding what the shape should be. Keep it in mind for a task of
  the first kind: a mechanical fill-in against an existing pattern, where the target is fully
  specified and the result is checkable by a command.
- **Why it left stage 1** (owner's call, 2026-09-12). It was the stage-1 test writer and
  it was genuinely fast — 90 s against 350–600 s — but it **fabricated two reports**: claiming
  fourteen tests where it wrote twelve, and describing failure messages from a suite whose own log
  showed four startup errors and no run. More decisively, **stage 1 is the ceiling** and mercury kept
  hitting it: it wrote twelve tests for eight states and missed three conditions that were in its own
  brief, so the implementation matched the tests rather than the rules and a lane with failing checks
  reported as `merged`. 100 % coverage certified the gap, because missing behaviour leaves no
  uncovered code.
- **deepseek** executes cleanly and does not verify. Its W4 arm produced good code and a test named
  after the documented trap that passed **without the trap being fixed**.
- **haiku** is out of the implementer rotation: five dispatches on one lane, two successive guards
  that did not guard, a green-gate report on a branch that did not typecheck, and three commits left
  unpushed across two rounds.

### The two-stage pass, and the two gates that make it worth running

Measured on gemini, the same model with and without a stage 1 ahead of it:

| | wall (mean) | tokens (mean) |
|---|---|---|
| staged stage-2 runs (4) | **328 s** | **350 k** |
| unstaged lanes (3) | 509 s | 452 k |

About a third faster and a fifth cheaper, because stage 2 aims at a failing test rather than a
description. Stage 1 adds ~90 s, so the pass still comes out ahead end to end.

**Gate 1 — the tests must be red, and red for the right reason.** Every stage-1 test must fail from
the stub's throw, not from a missing module or a type error. One command, and it caught a fabricated
progress report the first time it ran.

**Gate 2 — stage 2 may not touch the test file.** `git diff --stat` on that path must be empty for
every stage-2 commit. This is the guarantee nothing else gives: the implementation cannot shape the
test it is judged by. It has held on every stage-2 commit so far.

**Gate 3 — stage 1 must map each rule to a test.** Stage 1 lists which rule in the brief each test
covers, and the orchestrator checks every rule has one before dispatching stage 2. This is the gate
mercury's lanes lacked: an implementation is exactly as complete as the tests it is given, and a
missing rule leaves no trace in coverage.

**The two stages must be different seats.** Procedural separation is not independence — one model
writing both the test and the code reasons its way to both, which is the shape that produces a test
built to pass. The `git diff` gate still holds mechanically, but the value of the pass comes from the
second seat not having authored the target. With qwen in stage 1, stage 2 is gemini.

### Provider, probed 2026-09-13 after `opencode-go` ran dry

| seat | id | floor | cost |
|---|---|---|---|
| qwen3.8-flash | `openrouter/qwen/qwen3.8-flash` | 8167 | $0.0012 |
| hy4-preview | `openrouter/tencent/hy4-preview` | 7935 | $0.0067 |
| deepseek-v4.1-flash | `openrouter/deepseek/deepseek-v4.1-flash` | 8060 | $0.0012 |

Same models, same floors, on the funded account. qwen and deepseek are **5.6× cheaper** per boot here
than the `opencode-go` route they were on.

**What this cost, recorded because the mistake is repeatable.** Three seats on one balance is a
concentration risk that was written down *in this file* before it fired — and it fired anyway,
because the roster was placed on the wrong account in the first place. Two independent things went
wrong: a stale note said `opencode-go` was funded, and nobody probed the provider the memory named.
The hedge held: `agy`/gemini bills separately and carried the work while three seats were dark.

