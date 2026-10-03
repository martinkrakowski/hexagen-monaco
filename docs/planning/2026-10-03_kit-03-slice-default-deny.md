# Kit plan 3: slice-scoped rules, default deny

**Date:** 2026-10-03
**Status:** plan, partly shipped. Checked against `origin/main` at `951acf1d`.
**Kernel object written:** Manifest side of the contract (`.hexagen/contract.json`). Reads Grant and the slice.
**Type of output:** command spec and acceptance tests.

## 1. Goal

Inside a slice, anything not allowed is denied, for writes and for imports, from one declared file. The FDE should not have to list every forbidden edge to get a closed slice.

## 2. What is on main (verified)

Writes are already default deny:

- `hexagen grant check` in a client repo denies a path outside the slice or inside its excludes even when the grant allows it, and denies every write when `.hexagen/slice.json` is absent (`packages/sync/README.md` "`hexagen grant show` and `hexagen grant check`").
- `hexagen_propose_patch` checks that both the grant and the slice allow every path a diff touches (`packages/mcp-server/src/application/use-cases/propose-patch-tool.use-case.ts`).

Imports are default allow, with two opt-ins to deny:

- `allow-only` rule kind: an edge from the rule's `from` prefix to anywhere that is not its `to` prefix or its own `from` prefix fails. Default deny per prefix, but written by hand (`packages/shared/src/types/brownfield/contract-eval.ts`).
- `hexagen slice check --closed` fails any edge crossing the slice boundary, all or nothing, with no way to name an accepted crossing (`packages/sync/src/commands/slice/index.ts`, lines 140 to 217).
- Unresolved imports in the slice always fail (`unresolved-import` built-in rule).

My earlier claim that this is "missing" was too strong: the write side is done and the import side has the primitives but not a one-step closed slice.

## 3. The gap

There are two gates for one idea. `slice check --closed` is blunt and `contract check` is explicit. A closed slice with a short list of accepted crossings has no single home, so an FDE either lists every forbidden edge by hand or accepts all crossings.

## 4. Proposed command spec

```
hexagen contract propose --closed
hexagen contract add-rule --kind closed --except <prefix>... [--severity error|warn]
```

1. `propose --closed` prints a candidate `closed` rule that excepts every prefix the observed edges currently leave the slice toward. It writes nothing. The human removes the excepts they do not accept.
2. A `closed` rule, once added, fails any edge whose `from` is in the slice and whose `to` is neither in the slice nor under an `--except` prefix. Excludes still win.
3. `contract check` evaluates it like any other rule, so `--baseline` and `expires` work on it with no new code path. This is the single gate.
4. `slice check --closed` stays as it is. It becomes documented as the drift view; the gate is `contract check`.

Decision for the owner: a new rule kind versus a documented recipe (`allow-only` with `from` set to each slice entry). The recipe needs no schema change but needs one rule per `paths` entry and is easy to get wrong. The plan assumes the new kind, because it makes the closed slice a first-class, single, visible thing in the file the client keeps.

## 5. Scope

In: the `closed` rule kind in `contract.schema` (`docs/kernel/contract.schema.json`) and `contract-eval.ts`, `propose --closed`, `add-rule --kind closed`, README text.
Out: changing write-side enforcement, UI, per-symbol rules, auto-excepting crossings.

## 6. Acceptance tests

1. A slice with a `closed` rule and no excepts fails on any outward edge.
2. An `--except` prefix lets edges to it pass and still fails others.
3. An edge into an excluded path fails even under an except that covers it.
4. A baselined violation of the `closed` rule passes until its `expires` day ends.
5. `propose --closed` writes nothing and lists the observed crossing targets.
6. Edges not collected (`edgesComplete` false) cannot be clean, same as today.
7. An unresolved import still fails regardless of excepts.
8. A root-package target (`.`) is never inside an except prefix, matching the existing `allow-only` behaviour.

## 7. Risks

- Excepts are an allowlist the FDE writes, so a loose `--except src/` empties the rule. `contract show` should flag any except that covers the whole repo.
- A package-root target spelled with or without a trailing slash must be judged under both spellings, as `targetInSlice` already does. Reuse it; do not reimplement.

## 8. Liveness proof (Step Zero)

The PR body shows `contract check` failing on a fixture with a `closed` rule and an outward edge, and a green run once the edge is excepted.

## 9. Order

Independent of plans 1 and 2. Do after plan 2 if both touch `contract-eval.ts`, to avoid conflicts.
