---
id: 0001
subject: ci-github-actions
subjectKind: template
subjectVersion: "1.0.0"
fixedIn: null
class: host-assumption
severity: high
surface: ci
status: open
---

## What happens

The CI workflow this template emits runs the project's test suite on a stock
GitHub Actions runner. The runner image ships `bash` and `sh` but no `zsh`.
A test suite that spawns `zsh` — shell-integration fixtures, scripts run
through the author's interactive shell, `zsh -c` steps — passes on a macOS
developer machine and fails in CI with an ENOENT from the spawn. The template
gave no warning that the environment it provisions lacks the shell the project
may assume.

## Minimal repro

Any test that executes the host shell, e.g. `zsh -c "echo ok"`, in a suite run
by the emitted workflow on a stock `ubuntu-latest` runner: green on macOS,
red in CI.

## Fix

Keep the emitted workflow POSIX-neutral and record the assumption: run steps
must not name `zsh`, and the checklist gains a line telling the author that
stock runners ship no zsh — a test that needs one owns a skip guard
(`skipIf(!hasZsh)`) rather than a CI workaround.
