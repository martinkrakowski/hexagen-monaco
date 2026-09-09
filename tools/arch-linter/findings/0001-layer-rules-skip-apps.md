---
id: 0001
subject: arch-linter
subjectKind: component
subjectVersion: "0.12.1"
fixedIn: null
class: coverage-gap
severity: medium
surface: lint
status: open
---

## What happens

The arch-linter resolves each context's root with `contextRootAbs`
(`tools/arch-linter/src/cli.ts:585`): it returns `layout.contexts[name].root`
when the layout maps the context, and otherwise falls back to
`packages/<module>`. This repo has no `.architecture/layout.yaml` at all, so
today every context falls back — and a context whose files live under `apps/`
(a Next.js adapter, a wizard component) resolves to a `packages/` path that
does not exist. The linter skips a module whose root does not exist, so those
contexts get no layer evaluation at all: whatever the manifest claims about
their files (ownership, ports, adapters) is backed by nothing the linter
actually runs.

## Minimal repro

An `.architecture/contexts/**/context.yaml` declares a layer entry whose
symbol lives in `apps/*/src`. Introduce an import from that symbol that
violates the context's layer rules: the arch-linter reports nothing, because
the context's root fell back to a nonexistent `packages/<module>` directory
and its layer rules never opened the file.

## Fix

Map every `apps/`-rooted context's real directory in
`.architecture/layout.yaml` (`contexts:` → `<name>: root: apps/<name>` — the
mapping `contextRootAbs` already honours), and add a guard test with a
violating import from an `apps/`-side symbol so this coverage hole cannot
reopen silently.
