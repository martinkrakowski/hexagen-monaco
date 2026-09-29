# Kickoff prompt — remaining work after the findings-store arc

**Date:** 2026-09-29
**Verified against:** `main` at `24841c49` (green), one open PR: #678
**Supersedes:** nothing. Companion to the three implementation plans in this directory.

Paste the block below the horizontal rule into a fresh session whose working directory is
`~/Projects/hexagen-monaco`. Everything above the line is for the owner, not the agent.

**Before you paste it:**

1. **`git log -1`** — the block states `24841c49`. If `main` has moved, the agent is told to
   re-derive, but say so anyway: this repository has sat idle for a week at a time twice in this
   arc, and both gaps produced a surprise (a date-dependent test that reddened `main` on day 31,
   and a scratchpad cleaned before a wave record was written).
2. **Your own checkout** is on `docs/gates-for-generated-projects` with uncommitted work. The
   block tells the agent never to touch it. Confirm that is still where you want to be.
3. **Two decisions are still yours** and the block asks rather than guesses: what replaces
   campaign-foundry as G5's proof surface, and whether the findings store grows a third subject
   kind for generator-internal defects. Nothing dispatches on either until you answer.
4. `.claude/` is gitignored, so the skill will not exist in a lane worktree. The block carries
   the owner's resolution (copy it in), but if that changes, change it there.

---

```
You are the ORCHESTRATOR for hexagen-monaco. Working directory: ~/Projects/hexagen-monaco.

Note before you start: `.claude/` is **gitignored**, so the first two files below exist in the
main checkout and in **no git worktree**. If you cannot find them, you are in a worktree — read
them from `~/Projects/hexagen-monaco` and copy the skill directory into each lane worktree you
create. Do not conclude they are missing.

Read first, in full: `.claude/skills/orchestrate-wave/SKILL.md` (operating contract),
its `references/cast.md` (seats, spending rules, traps — the roster was updated 2026-09-17),
`.agents/ORCHESTRATOR.md` (decomposition, the mandatory Work Plan Table, the Step 5 Quality
Gate), and `docs/workflows/delegated-implementation-pipeline.md` (Templates A–D).

Where the two specs overlap: ORCHESTRATOR.md decides WHAT the lanes are; orchestrate-wave
decides HOW a lane becomes a merged PR. One conflict is known and unresolved: ORCHESTRATOR.md
reserves `git commit` to Primary, the skill has lanes commit. Lanes commit — it keeps
authorship honest in `git log`. Write that down if it bites.

## State of main

`main` is at `24841c49`, green. One open PR: **#678** (the owner's — four planning documents).
Reviewed already; see below. Verify all of this yourself before acting — it was last checked
2026-09-29 and this repo has sat idle for a week at a time twice.

**The findings store is built and merged**: G1 config contract (#670), G2 schema/parser/
validator (#671), G3 seed (#674), G4 query API (#677). `template-engine` is 61 test files /
592 tests. Projects are attributable, findings are schema-validated and structurally incapable
of carrying client content, three real findings are seeded, the layout is proven to ship in the
tarball with no build change, and the read path exists.

**Plans live at** `docs/planning/findings-store.md` and
`docs/planning/implementation/2026-09-17-*.md` (three implementation plans + one supersede
notice). The implementation plans are in ORCHESTRATOR.md shape — Work Plan Tables with
PARALLEL/SEQUENTIAL/GATE tags, the Global Governance block, Step 5 as definition of done.

## Decisions already made — do not re-litigate

- **Applications are NOT lint units.** Claim withdrawn, not deferred. The generator does not
  emit `apps/*`; the arch-linter reads only `manifest.bounded_contexts`. Both formerly-blocked
  gates lanes retarget to **generated packages**. Recorded in
  `findings/0001-layer-rules-skip-apps.md` (now `wontfix`) and the gates implementation plan §5.
- **Coverage reaches a generated tree only via core-owned root Vitest config.** An add-on
  cannot patch `package.json` or a per-package config. Denominator = generated package src;
  applications excluded. An add-on may add a reporter or CI step, never the threshold.
- **The coverage floor is 80, and stays OFF until that root config exists.** A schema number
  with no runner is not a gate.
- **G2 is a module inside `template-engine`, not a package.** A new workspace needs a
  `yarn.lock` entry and every CI job installs `--immutable`.

## Remaining work

**Ready to dispatch now:**

1. **`pr-agent-review-replication`** — R1→R2→R3, per
   `docs/planning/implementation/2026-09-17-pr-agent-review-replication-impl.md`. Its factual
   claims about this repo all verified. Two amendments already in the plan: R4/R5 must override
   the shared `[ignore]` regex (`.pr_agent.toml:242` keeps only `apps/web` + three contract
   files, and the toml is read from the DEFAULT BRANCH), and R1's DoD must be re-anchored to a
   failure class this repo has recorded rather than campaign-foundry's.
2. **`19-wave-status`** (template series #19) — independent of everything else. Two amendments:
   the AGENTS.md "append" has no engine support (collision → `.hexagen-update` sidecar), and
   there is no coverage bar to run tests at.

**Blocked, each on one thing:**

3. **G5 `hexagen findings`** — its §4 DoD says "run inside campaign-foundry", unverifiable from
   this repo. Needs the F5 treatment. **The amendment needs an owner decision: what replaces
   campaign-foundry as the proof surface?** A generated capstone fixture is the obvious
   candidate and weakens the claim from "works downstream" to "works in a project we generated
   for the test". Ask; do not pick.
4. **Gates G2 (coverage)** — blocked until core emits the root Vitest config (decision above).
5. **Gates G4 (`pr-reviewers` add-on)** — GATE-blocked behind replication R1–R3. Shipping
   today's reviewer config downstream propagates the defect that plan exists to fix.
6. **G6 / G7** — the plan itself says re-plan once G5 has been used. Do not dispatch against
   the current text.

**Owed on #678 (the owner's PR):**

7. **Stamp `pr-agent-super-bot.md` superseded.** Both plan reviewers rated it a blocker: the bot
   it proposes shipped, then every specific was deliberately reversed with the reason recorded
   inline (rolling-tag pin, `hy3`→`mercury-2`, a fallback model absent from OpenRouter, a 64000
   cap that pruned #598, inverted auto_review/auto_improve, and PR-only concurrency that
   cancelled reviews on #594/#595/#609). It carries no Date/Status line and contradicts its
   sibling document committed in the same commit. Exact header is in the review comment on #678.

**New follow-up, larger than it looks:**

8. **123 of 292 add-on template files fail `prettier --check`** — 35 of 44 families, 0 parse
   errors, genuine line-width violations. They are `.prettierignore`d here so nothing is red,
   but a generated project installing one of those families inherits files its own `yarn format`
   rewrites immediately. G3 (#684) correctly refused to fix 123 files under a formatter-config
   brief and narrowed its DoD to core-generator output. **The gate G3 installed is therefore
   honest only about the core scaffold.** This wants its own plan.

**Smaller, carried:**

9. `TemplateConfigStorePort.loadState` → required. Needs a lane owning
   `__tests__/application/validate-templates-ports.test.ts`.
10. `tools/wave-status/` unported, so `wave-event.sh`'s "byte-identical to `emit.ts`" claim is
    untestable here (§8 gap 2).
11. `trend()` in `apps/web/lib/platform/run-history-store.ts` reads the clock internally, so its
    boundary cases are untestable. It cost a red `main` for eight days. An injected clock fixes
    it; that is a design change, not a hotfix.
12. **The findings store has no home for a generator-internal defect.** F-D0 scopes a subject to
    a template or a component; `apps/web` and `packages/sync/src/generators` are neither. Two
    real defects this arc had nowhere to go. Either that is intended and the store is narrower
    than its name, or it wants a third subject kind. **Owner decision.**

## The gate — this is not optional and it has caught two lanes

    yarn build && yarn typecheck && yarn lint && yarn test
    yarn workspace <the package you touched> typecheck:test

`typecheck` excludes `__tests__` by design, so nothing else type-checks a test file. CI's
"Verify TypeCheck (test sources)" (`sync-integrity.yml:95`) catches what it misses. **It caught
G2 after it passed the stated gate, and caught G4 one step before the orchestrator packaged a
lane's work with a `TS2322` in it.** There is no coverage gate (`test:cov` does not exist).
`yarn lint` already chains `lint:arch`. `yarn sync` RUNS THE GENERATOR — it is not a check.
Never edit: `generator.config.yaml`, any `dist/`, any `*.tsbuildinfo`, `src/**/*.d.ts`,
`yarn.lock`, `turbo.json`, `.gitignore`, `packages/sync/tsup.config.ts`.

**Put the no-new-dependency rule in the Global Governance block.** It has been hit three times —
it is why G2 became a module, why G4's brief forbade it, and G3 walked into it anyway and
reddened CI. A rule that must be remembered per lane is not a rule.

## Traps that each cost a cycle in this arc

- **A claim that something does not exist must be tested against the tool that would create it**,
  not only against the filesystem. F-D7 claimed no project records its templates; it already did,
  in a dotfile the original `find` pattern could not match.
- **A guard's coverage claim is unverifiable by inspection.** Three times a guard read as covering
  a surface while covering one hardcoded file — the F-D3 isolation suite passed with every
  finding deleted, the "layout ships free" test passed before anything was seeded, and the
  component-finding check validated exactly one filename. Each was found only by breaking the
  thing the test claims to protect. **Mutate every guard you inherit.**
- **A repo's own docs, ADRs and audit notes are claims with a date, not evidence.** Two reviewers
  independently argued a change was safe by citing AUD-020, which was the problem statement for
  the CI step it seemed to argue against. Verify against the workflow file.
- **Derive lane status, in both directions.** `EXIT 0` with no PR has happened three ways: a
  `nohup … & disown` torn down when the tool call returned; a host OOM kill after committing but
  before pushing; and a malformed tool call mid-mutation. A 0-byte log with **no child process**
  is a launch failure; a 0-byte log with a **live child** is a model thinking. And a lane that
  looks dead may have finished — one had five commits on a clean tree.
- **Gather every review source BEFORE writing one fix brief.** Building a round from the model
  reviewer alone, without pulling Qodo and CodeRabbit, cost an extra round at ~251k billed
  tokens. Rule 1 means *every* verified finding, not the ones you happened to read.
- **Not every red is yours.** A date-dependent test armed itself on day 31 and reddened `main`
  with no code change; a timing test lost a race under full-monorepo load and passed 44/44 in
  isolation. Reproduce on `origin/main` before blaming the branch.
- **Close a wave's record when its lanes settle, not when its PRs merge.** Wave 3's raw logs
  lived in a `/private/tmp` scratchpad that was cleaned before the record was written, so its
  cost is permanently partial.

## Seats (cast.md, owner's roster 2026-09-17 — re-probe before the first dispatch)

| Seat | How |
|---|---|
| implementer 1 | **Sonnet**, in-process: `Agent(subagent_type:"general-purpose", model:"sonnet", prompt:<brief>)` |
| implementer 2 | `agy --print "$(cat BRIEF.md)" --dangerously-skip-permissions --effort high --model gemini-3.8-flash-high --print-timeout 90m` |
| implementer 3 | `grok --prompt-file BRIEF.md --always-approve --effort high --output-format plain` |
| PR reviewer A | **Fable**, in-process: `Agent(model:"fable", …)` — no `--disallowedTools` on this path, so **the brief is the control**; fence it to a throwaway worktree |
| PR reviewer B | `agy --print "$(cat REVIEW.md)" --dangerously-skip-permissions --effort high --model gemini-3.1-pro-high` |
| remediator | the lane's own implementer, narrow brief, medium effort |
| orchestrator / sweep / merge | you, never delegated |

**Probe the model, never the prefix** — `opencode/claude-fable-5-1` answered *Insufficient
balance* while `opencode/big-pickle` answered fine on the same prefix. When opencode is used at
all, prefer `openrouter/` prefixes (owner's instruction).

**Two reviewers, not one.** On this arc the F-D4 path-prefix hole, the unvalidated `fixedIn`,
and G3's disjoint DoD test were each found independently by more than one reviewer, and Qodo
found the named instance of a defect Fable had found only in aggregate. Neither alone was
conclusive. Keep them on different families, and count threads-raised vs verified-real per bot
in every wave record — a reviewer under ~20% over two waves gets turned off, not tuned.

## Before you dispatch

1. Verify `main` is green with the gate above, in a worktree, and that the tree is clean.
2. **`.claude/` is gitignored**, so a lane worktree will not contain the skill or
   `dispatch-lane.sh`. Copy the skill into each worktree (owner's resolution).
3. **The owner's own checkout is on `docs/gates-for-generated-projects` with uncommitted work.**
   Never check out, stash, or clean it. Do all work in scratch worktrees.
4. Re-probe every seat. Report what resolves and what does not before spending a lane.
5. Red-team each brief against BOTH the code and the plan's own tables. Every path, symbol and
   line number must exist. Four plan defects in this arc were found this way before a lane paid
   for one — and the fourth was the orchestrator's own amendment.
6. Emit a Work Plan Table per ORCHESTRATOR.md Step 3 before instantiating any sub-agent.
7. Confirm lane boundaries and the cast with the owner, and wait for a go-ahead.

Start by reading the plans and the skill, then report the seat probe, the derived state of main,
and your proposed wave. Dispatch nothing until the owner says go.
```
