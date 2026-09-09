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

The arch-linter's layer rules evaluate a context's declared files by matching
paths under `packages/*/src`. A context that declares files under `apps/` — a
Next.js adapter, a wizard component — gets no layer evaluation at all: the
glob matches nothing, so whatever the manifest claims about those files
(ownership, ports, adapters) is backed by nothing the linter actually runs.

## Minimal repro

An `.architecture/contexts/**/context.yaml` declares a layer entry whose
symbol lives in `apps/*/src`. Introduce an import from that symbol that
violates the context's layer rules: the arch-linter reports nothing, because
its layer rules never opened the file.

## Fix

Extend the layer rules' file matching to `apps/*/src` alongside
`packages/*/src`, and add a guard test with a violating import from an
`apps/`-side symbol so this coverage hole cannot reopen silently.
