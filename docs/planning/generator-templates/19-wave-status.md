# Template: Wave Status

**Branch:** `feature/generator-template-wave-status`
**Status:** Proposed. Not implemented — this document is the plan.
**Origin:** Built first as a one-off in `campaign-foundry`
(`docs/planning/2026-09-07_wave-status-server.md`, D102–D107). This document generalises it.

---

## Purpose

A read-only local status server for **delegated multi-agent pipelines**: projects where an
orchestrator cuts a git worktree per lane, dispatches an agent CLI into each, and then reviews,
remediates and merges the resulting PRs. It answers, at a glance, the question those pipelines make
surprisingly expensive: **what is every lane actually doing right now?**

### The problem it exists for

In the originating project, a lane's log sat at **0 bytes for 43 minutes**. Deciding whether it was
alive or dead took four commands — size, mtime, `EXIT` marker, and finally `pgrep` for the worktree
path — because a lane working silently and a lane that died at startup look identical from the
filesystem. The dispatcher's own comment records the mirror-image trap: a lane that dies immediately
writes its `EXIT` marker _instantly_, so a marker-only wait returns at once and reads as success.

Both directions of that ambiguity collapse to one fact nothing surfaces: **is the process alive?**

### The finding that shapes the design

Almost nothing worth watching is derivable from the filesystem.

- **Free:** log size, mtime, `EXIT` marker, process liveness, PR number and check conclusions, gate
  exit codes, coverage lines.
- **Not free:** which stage a lane is in, findings fixed versus refuted, mutation results,
  refutation reasons. **These exist only as orchestrator prose in a chat transcript.**

So the template's spine is **emit, don't infer**: the orchestrator appends one JSON line per stage
transition, and the server merges that with derived facts. Inferring stage from log prose would be a
parser guessing at English — the class of thing that produces a confident wrong answer.

**Where reported and derived facts disagree, the page shows both.** A lane reporting `settled` with
no PR is the single most valuable thing such a pipeline can tell you; in the originating project that
contradiction caught a false success report twice in one session.

---

## Why this is a template rather than a copy-paste

Nothing in it is domain-specific. It needs only: a worktree-per-lane convention, a log file per lane,
a forge CLI, and an orchestrator willing to emit events. Every generated project that installs a
delegated-pipeline workflow wants the same window, and each one otherwise rebuilds it — or, more
likely, does without and keeps paying the four-commands-to-answer-one-question tax.

---

## Install-Time Questions

| ID                | Prompt                                           | Type        | Options                    | Default            |
| ----------------- | ------------------------------------------------ | ----------- | -------------------------- | ------------------ |
| `port`            | Port for the status server?                      | text        | —                          | `4317`             |
| `forbidden_ports` | Ports it must refuse to bind (comma-separated)?  | text        | —                          | `3000,3001`        |
| `log_root`        | Where lane logs are written?                     | text        | —                          | `/tmp`             |
| `forge`           | Pull-request host?                               | select      | `github`, `gitlab`, `none` | `github`           |
| `emitter`         | Emit helper to generate?                         | multiselect | `shell`, `typescript`      | `shell,typescript` |
| `agents_md`       | Add a Wave Observability section to `AGENTS.md`? | boolean     | —                          | `true`             |

`forbidden_ports` is a question rather than a constant because the refusal is the point: the
originating project's operator ran a dev server and an API on 3000/3001, and a house rule saying
"never touch them" had been in `AGENTS.md` all along while the ports still needed guarding. **A rule
the machine enforces beats a rule the document states.**

`forge: none` emits the server without PR columns — useful for pipelines that do not open PRs at all.

---

## Outputs

| Path                                    | Gated on                 | What                                                                    |
| --------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| `tools/wave-status/lib/events.ts`       | always                   | JSONL reader; tolerates a truncated final line                          |
| `tools/wave-status/lib/derive.ts`       | always                   | log bytes/mtime/`EXIT`, liveness, gate exit, coverage                   |
| `tools/wave-status/lib/merge.ts`        | always                   | one `WaveStatus`; **flags disagreement, never resolves it**             |
| `tools/wave-status/lib/forge.ts`        | `forge != none`          | PR number, branch, check conclusions                                    |
| `tools/wave-status/server.ts`           | always                   | `node:http`; `/api/status`, `/api/stream` (SSE), `/api/log/:wave/:lane` |
| `tools/wave-status/public/index.html`   | always                   | one table, no framework, no build step                                  |
| `tools/wave-status/bin.ts`              | always                   | entry point                                                             |
| `tools/wave-status/lib/emit.ts`         | `emitter` ⊇ `typescript` | `waveEvent()`                                                           |
| `scripts/wave-event.sh`                 | `emitter` ⊇ `shell`      | append from shell steps                                                 |
| `tools/wave-status/__tests__/*.test.ts` | always                   | the pure core, at the project's coverage bar                            |
| `AGENTS.md` § Wave Observability        | `agents_md`              | **append only**                                                         |

**`envVars`:** none. **`requires`:** none. **`conflicts`:** none.

---

## Design decisions carried over from the originating project

|          | Decision                                                                          | Why it generalises                                                                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D102** | Lives in `tools/`, outside the workspace globs, but **inside the test gate**      | Puts a dev tool outside the architectural layer rules (it is not domain/application/infrastructure) while refusing to let it rot untested. Accepted cost, stated in the generated README: **a broken dev tool will block a product PR.** Projects that find that intolerable should move it to a separate CI job, not exempt it. |
| **D103** | Emit, don't infer; append-only JSONL                                              | A crashed orchestrator loses nothing already written, and no parser ever guesses at prose.                                                                                                                                                                                                                                       |
| **D104** | **No new runtime dependency** — `node:http`, one hand-written page, no build step | A dev tool that must be built before it can tell you why your build failed is the wrong shape. SSE is a few lines of `node:http`.                                                                                                                                                                                                |
| **D105** | Bind loopback; **refuse the forbidden ports in code**                             | See the question table above.                                                                                                                                                                                                                                                                                                    |
| **D106** | **Read-only** — starts nothing, kills nothing, merges nothing                     | An observability tool that can act becomes a second control plane, and then "did the dashboard or the orchestrator do that?" has to be answerable. It does not.                                                                                                                                                                  |
| **D107** | The `AGENTS.md` section lands **in the same emission as the server**              | The contract is read by every agent on every task; telling them to run a path that does not exist yet is the precise failure lane briefs forbid.                                                                                                                                                                                 |

---

## The event shape

```jsonc
{
  "ts": "2026-09-07T16:55:43Z",
  "wave": "S",
  "lane": "s4",
  "stage": "remediate",
  "event": "settled",
  "pr": 218,
  "round": 1,
  "detail": { "fixed": 5, "refuted": 2, "mutations": 3, "mutationsBit": 3 },
}
```

`stage` ∈ `dispatch | implement | gate | review | remediate | sweep | merge | record`.
`event` ∈ `started | settled | failed`. Everything under `detail` is optional.

---

## Test coverage

`packages/template-engine/__tests__/templates/wave-status-emit-shape.test.ts`, following the
`bullmq` and `supabase` precedent, exercises two installs end-to-end against the real template
directory:

- **minimal** (`forge=none`, `emitter=shell`, `agents_md=false`) — asserts the core and server emit;
  asserts `lib/forge.ts`, `lib/emit.ts` and the `AGENTS.md` append are **absent**.
- **full** (`forge=github`, both emitters, `agents_md=true`) — asserts every output emits, and that
  the `AGENTS.md` section is appended rather than overwriting the file.

Plus, in the generated project's own suite: a truncated final event line must not blank the view; a
merge where reported and derived disagree must **flag**, not resolve; and the server must **refuse**
the forbidden ports — asserted, not documented.

---

## What this template does not pretend

Its value is bounded by the emitter. Without instrumentation it is a prettier `ls -l`, and the
temptation is to install it, enjoy the table, and never wire the emission points — which is exactly
how three waves' records went unwritten in the originating project until the operator noticed.

**The generated README says so in the first paragraph**, and the `AGENTS.md` section repeats
_emitting is part of the stage, not a courtesy_. A duty defined as a separate final step is the duty
that slides.

---

## Deferred

| What                                                      | Why                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pushing status to a surface reachable from another device | Needs a hosted target and a push; the loopback server cannot be reached from a phone. |
| Historical / cross-session telemetry                      | Event logs live under `log_root` and vanish. Persist **after** the format settles.    |
| Cost and token telemetry per lane                         | The agent CLIs do not report it in a form the pipeline captures.                      |
| Any control action from the page                          | **D106.**                                                                             |
