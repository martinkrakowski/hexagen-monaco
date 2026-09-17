# Kickoff prompt — the findings store

Paste the block below into a fresh Claude Code session **whose working directory is
`~/Projects/hexagen-monaco`**. Everything above the line is for you, not for the agent.

**Before you paste it:**

1. **`.claude/` is gitignored here** (`.gitignore:85`), so the skill will **not** exist in a git
   worktree branched from `main` — and this orchestration works by giving each lane its own
   worktree. Choose one before you start:
   - **un-ignore `.claude/skills/`** and commit it (a one-line `.gitignore` change — but
     `.gitignore` is a protected file, so it needs `yarn sync --force-root`); or
   - keep it ignored and have the orchestrator **copy the skill into each worktree** after
     creating it. Simpler, leaves no trace in the repo, and the orchestrator reads the skill from
     the main checkout anyway — only lane agents that need it must have it copied.

   `scripts/wave-event.sh` and `scripts/merge-prs.sh` are **untracked but not ignored**; commit
   them so worktrees and CI can see them.

2. `git log -1` — note the SHA; the plan is verified against `c1038b31`.
3. Decide the §8 gap 1 question (where a wave record lives) — the agent will ask if you do not.

---

```
You are the ORCHESTRATOR for the findings store.

Plan: docs/planning/findings-store.md. Read it first, in full — it is 253 lines and it is the
contract. Then read .claude/skills/orchestrate-wave/SKILL.md, which is the operating procedure,
and its references/cast.md, which holds the seats, the spending rules and the traps that have each
already cost a cycle. Where the skill and the plan differ, the skill wins on process and the plan
wins on what gets built.

Wave 1 is lanes G1 and G2 — read §3 for their scope and §4 for their definition of done. Do not
start G3 or later without a fresh go-ahead.

This repository is not the one the orchestration was written for. The differences are in the plan
at §1 F5 and F6, and they matter on the first command you run:

  - The gate is `yarn build && yarn typecheck && yarn lint && yarn test`. Nothing else.
  - `yarn lint` already runs `lint:arch`. Do not run it separately and do not report it separately.
  - There is NO coverage gate. `test:cov` does not exist here. Never assert a coverage percentage.
  - `yarn sync` RUNS THE GENERATOR. It is not a check. There is no `sync:check`.
  - AGENTS.md lists files you may never edit: generator.config.yaml, any dist/, any *.tsbuildinfo,
    src/**/*.d.ts, yarn.lock, turbo.json, .gitignore. Changing one needs the owner's confirmation
    and `yarn sync --force-root`.

Before you dispatch anything:

  1. Verify main is green with the gate above, in a worktree, and that the tree is clean.
  2. Re-probe every seat named in cast.md — ids rotate and the quotas are shared with another
     project. Report what resolves and what does not before spending a lane on a dead seat.
  3. Red-team each lane brief against BOTH the code and the plan's own tables. Every path, symbol
     and line number a brief cites must exist. Check the brief's instructions against each other:
     a required field plus a fence around the files that construct it is impossible, and that exact
     contradiction cost a round on the project this orchestration came from.
  4. Confirm the lane boundaries and the cast with me, and wait for a go-ahead.

Three things in the plan are load-bearing and easy to get wrong:

  - G1 is first because nothing else works without it. A generated project does not record which
    add-on templates it has; until it does, a finding cannot be attributed to a project.
  - F-D1's layout is chosen so the existing verbatim template copy does the distribution work.
    If a lane finds itself editing packages/sync/tsup.config.ts, the layout is wrong — stop and
    report rather than making the build fit the plan.
  - F-D0 splits findings by subject. Template findings ship; component findings do not. The
    arch-linter lives in tools/, not packages/ — the plan says so, and it was wrong once already.

Report after each stage: what ran, what came back, what you decided, what is next. Lane status is
derived from command output, never asserted from an agent's report. At the end, one table:
PR | branch | URL | gate | fixed | refuted.

Two open questions you must put to me before the first merge, not after:

  - This repository has no .agents/session-log.md, so a wave record has nowhere to go. Ask me
    whether to create one or to record waves in docs/planning/.
  - .claude/ is gitignored (.gitignore:85), so a lane worktree will not contain the skill or its
    scripts. Tell me which resolution you are using — copying the skill into each worktree, or
    un-ignoring it — before you create the first worktree, not after a lane fails to find it.

Start by reading the plan and the skill, then report the seat probe and your proposed wave 1
lane boundaries. Dispatch nothing until I say go.
```
