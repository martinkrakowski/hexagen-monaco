# Orchestration (`orchestration`)

> Delegated wave orchestration: the `orchestrate-wave` skill and a `gate.yml` that runs the one
> gate your own config declares.

|               |                                            |
| ------------- | ------------------------------------------ |
| **ID**        | `orchestration`                            |
| **Category**  | Tooling                                    |
| **Provides**  | `platform.orchestration`                   |
| **Requires**  | —                                          |
| **Conflicts** | none                                       |
| **Branch**    | `feature/generator-template-orchestration` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects. It is the
template root, not `files/`, exactly like `ci-github-actions`'s: `README.md` and `findings/` are
documentation about the template, and an output is a file a consumer project receives.

## What it does

Installs the `orchestrate-wave` skill — the operating contract for running one wave of a plan
across per-lane worktrees — and a `gate.yml` whose single CI step is `hexagen-orchestration-gate`.

## What it scaffolds

| Output                                                    | What it is                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `.github/workflows/gate.yml`                              | one job, one step: the gate bin                               |
| `.agents/skills/orchestrate-wave/SKILL.md`                | the operating contract                                        |
| `.agents/skills/orchestrate-wave/references/rationale.md` | why each rule is what it is                                   |
| `.agents/skills/orchestrate-wave/references/briefs.md`    | prompt templates A–D (lane brief, reviewer, fix brief, sweep) |
| `.agents/skills/orchestrate-wave/scripts/wave-event.sh`   | appends one JSON event line per stage transition              |

## The overlay, and why it is not an output

`.agents/orchestration/` — `config.yaml`, `house-rules.md`, `cast.md`, `lessons.md`,
`rationale.local.md` — is **yours**. It is never declared in `outputs`, so `hexagen add` never
writes it, never hashes it, and never conflict-copies it, and no version bump can touch it.
`hexagen-orchestration-init` scaffolds it once and skips whatever already exists; run
`hexagen-orchestration-doctor` to check the config against the invariants the skill locks.

`config.yaml` is also the single source for the gate's step list. `gate.yml` names no steps of its
own, so CI and a human running `hexagen-orchestration-gate` consult the same file.

## Install

`hexagen add orchestration`. Questions:

| Question       | Options (default)                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `agents_md`    | `true` — whether `init` scaffolds the Wave Observability text for you to paste into `AGENTS.md`         |
| `node_version` | `auto` — taken from a recorded `ci-github-actions` answer when there is one, else `22`. Never prompted. |

## Checklist (post-install)

1. `yarn add -D @hexagen-monaco/orchestration`
2. Optionally add a `"gate": "hexagen-orchestration-gate"` script to `package.json` by hand, for
   local convenience. Templates cannot write `package.json`, and `gate.yml` does not need it — the
   workflow invokes the bin directly with `--no-install`.
3. `npx hexagen-orchestration-init`
4. If you answered yes to `agents_md`, paste the Wave Observability section from
   `.agents/orchestration/house-rules.md` into `AGENTS.md`. The section is not a template output:
   the engine has no append capability, and your `AGENTS.md` is never-edit.
5. `npx hexagen-orchestration-doctor`
6. `mutate` and `verify-manifests` run only when `.agents/orchestration/config.yaml` sets
   `mutate: true`.

## Notes for agents

- **`requires` is empty on purpose.** The engine treats `requires` as "apply this too if it is not
  recorded installed", so requiring `ci-github-actions` would silently auto-install it and write a
  first-ever `ci.yml` as a conflict copy against an existing one. If `ci-github-actions` is not
  installed, `doctor` says so; nothing installs it behind your back.
- **`--immutable` here, not in `ci.yml`.** `gate.yml` lands after `yarn add`, so the lockfile
  exists. `ci-github-actions`'s first run does not have one.
- **No Turbo cache step.** That belongs to `ci-github-actions`'s own workflow; `gate.yml` has no
  equivalent.
- **Upgrades.** `hexagen add --force orchestration` re-emits the five outputs above, per file,
  writing a `.hexagen-update.*` conflict copy where you have edited one. It does not touch
  `.agents/orchestration/**`.
- **The skill is one copy.** The template's `files/` tree is the canonical source. A
  byte-identical mirror at hexagen's own `.agents/skills/orchestrate-wave/`, and the guard test
  that holds it so, are OW6's deliverables; neither exists yet.

## Related

Pairs with [`ci-github-actions`](../ci-github-actions) (`ci.yml`), which `doctor` checks for, and
[`agents-md`](../agents-md) (`AGENTS.md`, which you paste into by hand).
