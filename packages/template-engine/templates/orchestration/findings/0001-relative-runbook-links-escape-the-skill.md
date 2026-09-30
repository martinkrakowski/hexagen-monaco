---
id: 0001
subject: orchestration
subjectKind: template
subjectVersion: "1.0.0"
fixedIn: "1.0.0"
class: host-assumption
severity: high
surface: docs
status: fixed
---

## What happens

The skill this template emits points at two runbooks by relative path, climbing out of the skill
directory to reach them: `docs/workflows/delegated-implementation-pipeline.md` for the stage detail
and prompt templates A-D, and `docs/workflows/orchestrator-kickoff-prompt.md` for the kickoff. A
relative path that escapes the emitting directory only resolves when the skill is read from the one
repository that happens to carry both files at those relative depths.

Everywhere else the link is dead. The file lands at `.agents/skills/orchestrate-wave/`, three
directories deep under the project root, so the upward climb the link performs points outside the project
entirely, and the anchor fragment that named a specific heading has nothing to resolve against. A
skill whose runbook reference is dead is a skill whose stage detail is missing, and the failure is
silent: the link renders as ordinary text and the reader never learns a runbook was supposed to be
there.

The same fragility has a second cost. The prose named the runbooks by path and by document title,
and the skill ordered "Template A" and "Template C" by name without saying where they live, so
there was no single place a re-sync would edit.

## Minimal repro

Install `orchestration` into a project that has no `docs/workflows/delegated-implementation-pipeline.md`.
Read the emitted SKILL.md at its stage-detail paragraph: the runbook it points at does not exist in
the project, and neither does the heading the anchor fragment names.

## Fix

Ship the runbooks the skill actually needs, inside the skill, and point at them relatively from
where the skill lands. The four prompt templates this skill orders by name (A, B, C, D) ship as
`references/briefs.md`, a sibling reference file like `references/rationale.md`, and the skill names
that path. The remaining runbook prose stays optional and project-owned: the contract says to read
it where the project ships it, which is true of no path in particular.

The residual assumption is stated rather than relied on: the reference is a sibling of the skill,
not an upward climb, so it resolves identically whether the skill is read from
`.agents/skills/orchestrate-wave/` or from a copy the project keeps elsewhere.
