# campaign-foundry house rules

Every rule the scrub removed from `generic/SKILL.md` because it named campaign-foundry and
nothing else, kept here **verbatim**. The generic skill keeps each rule in a form that reads
against `config.yaml`; the paragraph below is the original wording, and it is the wording
campaign-foundry's own sessions were given.

Nothing here is a new rule and nothing has been edited. Each block is the source's own text,
reproduced byte for byte from the pinned snapshot, with the line range it came from named
beside it. The coverage check in `scripts/orchestration/skill-coverage.mjs` is what proves it:
every paragraph and every heading in the snapshot has to appear, whole, in this overlay or in
the generic skill, and no source unit may be allowlisted away.

The same paragraphs, and campaign-foundry's rationale incidents, are the round-trip input OW8
seeds an installed tree with.

## The runbook and the cast

From `source/SKILL.md` lines 20–23 — the runbook's own document paths.

The full runbook is `docs/workflows/delegated-implementation-pipeline.md` (stage detail, prompt
templates A–D, invariants, failure playbook) and `docs/workflows/orchestrator-kickoff-prompt.md`.
**Read the plan and both documents before acting.** This file is the operating contract and wins
where they differ; it deliberately does not copy them, so they cannot drift apart.

From `source/SKILL.md` lines 25–25 — the cast link as the source states it.

- The cast, and each seat's track record: [references/cast.md](references/cast.md)

From `source/SKILL.md` lines 27–30 — cast authority, and the launcher that no longer exists.

- **`references/cast.md` is the authority on current seats; this file does not restate them.**
  Record the worktree tip first and watch the provider's quota. Reviewers stay in-house: a second
  `Agent` that is not the implementer. There is no lane launcher — launch every lane yourself and
  emit its event in the call immediately before. (why: [rationale](references/rationale.md#cast-authority-and-the-retired-launcher))

## Mutation

From `source/SKILL.md` lines 43–43 — the mutation command, as a yarn alias.

**Run mutations through `yarn mutate`, not by hand.** (why: [rationale](references/rationale.md#run-mutations-through-yarn-mutate-not-by-hand))

From `source/SKILL.md` lines 45–48 — the mutation command block, as a yarn alias.

```sh
yarn mutate --file <path> --before <before.txt> --after <after.txt> \
  --because "<the input whose behaviour this changes>" -- <test command…>
```

## Derived status and the gate

From `source/SKILL.md` lines 77–82 — the derived-status block, with the project's gate alias.

```bash
gh pr list --head "<branch>" --json number,url --jq '.[] | "#\(.number) \(.url)"'   # empty ⇒ stuck
git -C "<worktree>" rev-list --count origin/main..HEAD                             # 0 ⇒ it wrote nothing
(cd "<worktree>" && yarn gate)
git -C "<worktree>" status --porcelain=v1 -b && git -C "<worktree>" diff --stat origin/main...HEAD
```

From `source/SKILL.md` lines 86–90 — the named gate step list (D183) and its exclusions.

**The gate is a subset of CI, and the difference is named.** `yarn gate` (D183) runs CI's gate
steps in one command — `check:env` as the same conditional no-op, `build`, `typecheck`, `lint`,
`format:check`, `lint:arch`, `sync:check`, `lint:bytes`, `plan:verify`, `arch:inventory`, the
Nitro route-scan guard, `test:cov` and `verify-manifests` — and stops at the first failure by
name. `ci.yml` runs **one** step it does not:

From `source/SKILL.md` lines 92–93 — the immutable-install note, with the project's gate alias.

**`yarn install --immutable`** is not in `yarn gate`. Say in the brief whether a lane may add
a dependency, and if it may, that the regenerated `yarn.lock` travels with it. (why: [rationale](references/rationale.md#yarn-install---immutable))

From `source/SKILL.md` lines 95–95 — the byte-level scan step, by its project alias.

**`yarn lint:bytes`** is in the gate, deliberately — it is not inside `yarn typecheck`. (why: [rationale](references/rationale.md#yarn-lintbytes))

From `source/SKILL.md` lines 97–98 — the framework route-scan guard step.

**The Nitro route-scan guard is a `yarn gate` step** (`nitro-route-scan`), so a lane that adds or
moves a test file under `apps/api/server/` is covered by the gate itself. (why: [rationale](references/rationale.md#the-other-two-checkenv-and-the-nitro-route-scan-guard))

## Lane briefs

From `source/SKILL.md` lines 115–120 — the two brief lines carrying the relative pipeline-doc link.

- *Measure a file's coverage the way the gate does — a claim of per-file 100% without the JSON
  reporter's per-file listing is not evidence.* (Template A, [pipeline
  doc](../../../docs/workflows/delegated-implementation-pipeline.md#template-a--lane-brief-implementer))
- *A loaded host is a reason to show the isolated pass and let CI be the gate, never to raise a test
  timeout.* (Template A, [pipeline
  doc](../../../docs/workflows/delegated-implementation-pipeline.md#template-a--lane-brief-implementer))

From `source/SKILL.md` lines 122–124 — which gates are CI and which are the orchestrator's habit.

**Know which gates are enforced by CI and which are enforced by you.** `plan:verify`, a lane
retiring its own premise, and `mutate:verify` on a changed manifest are **CI**; a manifest existing
at all, and `handoff:check` on a two-stage lane, are **habits only you enforce**. (why: [rationale](references/rationale.md#which-gates-are-machinery-and-which-are-you))

From `source/SKILL.md` lines 171–178 — the worked type example, with the domain types named.

   - **If it names a type or a document surface, open that type and paste its fields in.** A brief
     covering `CopyTimeline` names five things, because `CopyBeat` is `{text, weight, background?}`
     and `CopyTimeline` is `{beats, transition, keyBeat}`.
   - **Write one test requirement per field**, so a missed field fails a test instead of shipping.
   - **If a value is parsed from a string, name the hazards**: leading zeros, values past
     `Number.MAX_SAFE_INTEGER`, delimiters that can appear in the data.
   - **If the lane compares or gates on state, list the inputs and their refresh cadence.** Two
     sides collected at different times need a carve-out, not a threshold.

From `source/SKILL.md` lines 184–186 — the premise check, as a yarn alias.

7. **Check the plan's premises first.** `yarn plan:verify` fails when a lane's stated gap has already
   been closed. Four lanes in one week were dispatched, or nearly dispatched, to re-implement shipped
   behaviour. A lane whose premise no longer holds is not a lane.

From `source/SKILL.md` lines 198–200 — the plan-reviewer seat, by model id.

9. **Send the plan to the plan reviewer** (`Agent` · `subagent_type: "Plan"` · `model: "fable"`)
   before dispatching any lane from it, whenever the plan introduces or rewrites lanes or changes a
   premise. Nothing else needs this seat. (why: [rationale](references/rationale.md#9-send-the-plan-to-the-plan-reviewer))

## The six stages

From `source/SKILL.md` lines 204–207 — the event-emission contract, with the project script path.

*Emitting is part of the stage, not a courtesy.* Every transition below appends one event via
`scripts/wave-event.sh <logdir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']`
— one JSON line in `<logdir>/events.jsonl` — and a stage with no event is, to the server, a stage
that did not happen.

From `source/SKILL.md` lines 250–264 — the dispatch templates: the external CLI roster, the brief path and the log-dir root.

   Emit as you go (`scripts/wave-event.sh`): `dispatch started` per lane just before its launch,
   carrying the seat that runs it in `--detail` — `--detail '{"seat":"<implementer model>"}'` — because
   the status page names the seat that ran each lane, and a lane whose record never names one reads
   **unknown**. The seat is a property of the lane, so later stages need not repeat it.
   **When the seat is an external CLI** (the `openrouter/` roster in `references/cast.md`), launch it
   directly from a tool call — `nohup zsh -c "cd <worktree> && <cli> … \"\$(cat <ABSOLUTE brief>)\" >
   <log> 2>&1; echo \"EXIT \$?\" >> <log>" < /dev/null > /dev/null 2>&1 & disown` — from a tool call
   that returns straight away, never from a wrapper that launches and then waits (see above). The
   brief path **must be absolute**: the command `cd`s into the worktree first and `briefs/` exists only
   in the main checkout. The template assumes paths without spaces or glob characters, true of this
   repo's worktrees; quote them for the inner shell if that ever changes. Liveness differs by CLI:
   `opencode run --format json` streams within seconds, so a log still at 0 bytes after ~30 s **with no
   `opencode run` process for that worktree** (`pgrep -f 'cd <worktree> && opencode'`) is a dead lane;
   `agy --print` writes nothing until it exits, so watch its process and the worktree's commits. Never
   call a lane dead from the log alone.

From `source/SKILL.md` lines 271–280 — Implement and Review stages, with the project script path.

   The per-lane `implement settled|failed` events **are** the completion record of a dispatch —
   `implement settled` when a lane's `EXIT` marker lands, `implement failed` on a non-zero
   marker or a lane killed without one; and `gate settled` with the gate exit and the four
   coverage numbers (statements, branches, functions, lines) in `--detail` once the gate has run.
2. **Review.** Two independent inputs per PR, both required: a read-only review from a model that
   is **not** the implementer, and the bot comments (`gh pr checks`, `gh api …/comments`). Verify
   every finding — yours and the bots' — against the branch diff before acting on it. Require the
   reviewer to remove any throwaway worktree it created, and check: two have been left behind.
   When the review of a PR is dispositioned, emit `review settled` (`scripts/wave-event.sh`)
   with the counts of BUG / SUGGESTION / NIT findings in `--detail`.

From `source/SKILL.md` lines 286–299 — Remediate, Sweep and Merge stages, with the project script path.

   Run the remediator in that worktree, then **verify it yourself**: full gate, re-read the
   diff. Never merge on a remediator's self-report.
   After each round you verify, emit `remediate settled` per round (`scripts/wave-event.sh`)
   with the fixed/refuted counts in `--detail`.
4. **Sweep** (you, no CLI). Per thread: verify → reply with the resolution and its commit, or the
   refutation and its mechanism → resolve. Then one disposition comment per PR. A refutation is a
   first-class outcome; a silently ignored comment is indistinguishable from an overlooked one.
   When a PR's threads are all dispositioned, emit `sweep settled` with the `fixed` / `refuted` /
   `deferred` counts in `--detail`.
5. **Merge** (you). Sequential, via `scripts/merge-prs.sh` — each merge invalidates the CI of
   everything behind it. If main goes red: stop, reproduce locally, ship a minimal hotfix, resume.
   **A green gate is not a merge condition on its own.** Merge only when, on the PR's *final* head:
   every check-run conclusion is success, skipped or neutral (read conclusions, not the rollup line —
   `neutral` is what informational checks report); the review bots have had time to post on that head;

From `source/SKILL.md` lines 301–304 — the merge gate, with the project script path and the settle-period flag.

   and **zero review threads are unresolved**. `scripts/merge-prs.sh` **enforces this
   mechanically** and re-reads the PR's head immediately before `gh pr merge`, refusing if it moved.
   **The settle period is a wait, not a proof the bots reviewed the final head** — confirm a bot
   actually posted on it yourself. (why: [rationale](references/rationale.md#scriptsmerge-prssh-enforces-this))

## House rules that name this project

From `source/SKILL.md` lines 343–347 — the manifest rule, with its yarn aliases and CI step name.

- **Touching a manifest arms it.** CI replays only the manifests a change *touches*, so editing
  one for an unrelated reason pulls it into the replay set. `yarn mutate:anchors` checks every
  anchor cheaply ahead of the replay, and also checks whether the `command`'s `-t` still selects a
  test — verify it with `yarn vitest list <file> -t '<pattern>'` before you record it. Re-anchor
  when the code moved; retire (`"retired": "<why>"`) only when it is gone. (why: [rationale](references/rationale.md#touching-a-manifest-arms-it))

From `source/SKILL.md` lines 353–359 — the operator-data paths, the live dev-server ports and the reviewer-facts file.

- **Never `git add -A`.** `briefs/` and `assets/inputs/*/` are the owner's operator data.
- **Never start a dev server or curl `localhost:3000` / `:3001`** — those are the owner's live
  servers; a request there overwrites their output and spends their GenAI credits.
- **Run full gates in a worktree**, never in the main checkout beside a running dev server: the
  build shares `.next/` and will disturb it.
- `best_practices.md` is the reviewer-facts file. Check it before endorsing a finding class it
  disproves, and extend it when a new premise-false class appears.
