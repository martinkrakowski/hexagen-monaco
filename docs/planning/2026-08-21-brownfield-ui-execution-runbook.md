# Brownfield UI — execution runbook

> Operational companion to `2026-08-20-brownfield-ui-feature-plan.md` and
> `2026-08-20-brownfield-ui-implementation-prompt.md`.
>
> The plan says _what_ to build and the prompt says _how to delegate_. This
> file records what actually went wrong across the first thirteen landings, so
> the next worker loses hours to none of it. Everything here was verified
> against the tree or reproduced — nothing is inferred.

## 1. The worktree contract

Worker worktrees have **no `node_modules`**. That is deliberate (they are cheap
and disposable), and it has one hard consequence:

> **A worker can author tests but cannot run them.** Every "tests pass" claim
> from a worker is _authored-but-unrun_ until the Primary re-runs it from a
> checkout that has dependencies.

This is not a formality. Of the six packets delegated in the second wave, the
Primary's own runs caught: a broken existing test (BF-0.1), a wrong assumption
about file existence (BF-0.1), and a stale-`dist` failure that looked like a
code fault but wasn't. None were visible to the workers.

### Collecting a worker's output

Workers **stage but never commit**, so their branch ref still points at `main`.

```bash
# WRONG — the branch has no commit, so this silently gives you main's copy
git checkout <worker-branch> -- path/to/file

# RIGHT — copy from the worktree's working directory
cp "$WORKTREE/path/to/file" path/to/file
```

Also: **never** pass several paths to one `git checkout <ref> -- a b c`. A
single bad pathspec aborts the whole command, and it is easy to not notice you
are still testing the old file. Split it, or use `cp`.

## 2. Gates the Primary must run, and the ones that bite

Run these from the **main checkout**, per packet:

```bash
bash scripts/validate-ui-boundary.sh
yarn --cwd apps/web typecheck
cd apps/web && npx eslint <touched dirs> --ext .ts,.tsx
cd apps/web && yarn vitest run <touched dirs>      # MUST be from the apps/web cwd
yarn workspace @hexagen/<pkg> test
yarn workspace @hexagen/<pkg> typecheck
yarn workspace @hexagen/<pkg> typecheck:test       # <-- separate turbo task
```

### `typecheck:test` is not `typecheck`

They are **different turbo tasks**. `typecheck` covers `src`, `typecheck:test`
covers `__tests__`. Running only the former passes locally and then fails in
CI. This happened on #577: `@types/node` types `process.exitCode`'s **getter**
as `string | number | null | undefined` but its **setter** as
`string | number | undefined`, so the obvious save/restore does not compile.

```ts
const original = process.exitCode ?? undefined; // the ?? is load-bearing
```

### Stale `dist` will lie to you twice

`apps/web` and `packages/sync` resolve workspace dependencies **through
`dist/`**, not source. Turbo will also replay a cached build from another
branch. Symptom: a test fails asserting behaviour whose source is plainly
correct in front of you.

```bash
# Confirm before debugging the code — compare source against built output
grep -n "<symbol>" packages/shared/src/...
grep -rn "<symbol>" packages/shared/dist/
yarn turbo build --filter=@hexagen/<pkg> --force
```

This cost time twice. Check it _first_ whenever a schema/contract assertion
fails inexplicably.

## 3. `apps/web` test conventions

- **jest-dom is a dependency but is NOT imported** by `apps/web/vitest.setup.ts`.
  `toBeInTheDocument` and `toHaveAttribute` are therefore **unregistered**. Use
  `toBeTruthy()`, `toBeNull()`, and `element.getAttribute(...)`.
- **Do not `import React`.** The Vitest config compiles JSX with the automatic
  runtime, so the import is an unused binding — which pre-commit ESLint treats
  as an **error**, not a warning.
- Run vitest **from the `apps/web` cwd**; the suite depends on that config.
- `NoSemanticState` is imported from bare **`@hexagen/ui`**. The `@hexagen/ui/types`
  subpath referenced in DESIGN.md §3.4 **does not exist** in `package.json`.

## 4. The information-state firewall, in practice

Three layers: L1 branded types, L2 `@hexagen/eslint-plugin-ui`, L3
`scripts/validate-ui-boundary.sh`.

**Eleven prop names are banned** in `components/primitives/`:

```
data, loading, error, result, isFetching, isPending,
isSuccess, isError, governance, llm, status
```

Two collide with almost every natural design. Substitutions that landed:

| natural  | used instead                                  | where             |
| -------- | --------------------------------------------- | ----------------- |
| `data`   | `rows`                                        | `EntityDataGrid`  |
| `status` | `rowVariant` (appearance intent, host-chosen) | `EntityDataGrid`  |
| `status` | `disabled` + `unavailableReason`              | `ChoiceCardGroup` |
| `status` | `tone`                                        | `CountPills`      |

The rule the substitutions follow: a primitive may express **appearance
intent** chosen by the host, never a **domain verdict** it computed.

### Check 3 has two predicates, and one used to false-positive

`validate-ui-boundary.sh` check 3 runs a declaration-anchored predicate **and**
a property-declaration predicate (`^\s*(readonly\s+)?token\??\s*:`) — the second
exists because the first is line-scoped and misses multi-line interfaces.

Before `wave-bf-2.0b`, the first predicate was unanchored
(`(interface|type).*\btoken\b`) and matched **any** line containing the word
`type` plus a banned word. Ordinary JSX failed CI:

```tsx
<input type="radio" data-testid="probe" />
// -> Found forbidden token 'data' in type/interface definition
```

If you see check 3 name a violation you cannot find, confirm you have that fix.

## 5. `.husky/pre-commit` is POSIX `sh`, not bash

husky's shim runs `sh -e "$s"` **regardless of any shebang**, and on Linux `sh`
is commonly dash. Dash has neither process substitution (`<(...)`) nor
`read -d`. Both were tried, both broke the hook outright — verified by running
it through `dash` directly.

There is a **docs-only fast path**: when every staged file ends in `.md`, the
hook skips `turbo lint`, `turbo typecheck` and the arch ratchet. Note it uses
`--no-renames` on purpose, so a `foo.ts` → `notes.md` rename cannot be
misclassified as docs-only.

## 6. PR hygiene

- The repo **rejects stacked PRs** on the same file; sequence those packets
  instead of parallelising them.
- The plan caps open `wave-*` PRs at **four**. That cap was deliberately
  exceeded during the parallel wave (eight open) because holding finished,
  verified work in disposable worktrees is the worse risk — but it is a
  conscious trade, not the default.
- **Sweep review comments more than once.** Late-landing bots are the norm, not
  the exception: pass 1 found 4 findings, pass 2 found 7 more, and pass 3 found
  2 on a PR that had zero in pass 2.
- **Verify every finding against the tree.** In the last sweep, 11 of 12 bot
  findings were real and 1 was wrong on the facts (`role="caption"` _is_ a valid
  WAI-ARIA 1.2 role) — and separately, one _correct_ finding shipped a
  **proposed fix that broke an existing test**. Confirming the diagnosis does
  not mean accepting the prescription.
- `jsx-a11y` is **not configured** in `apps/web`. Lint passing is not evidence
  about ARIA correctness; check the spec.

## 7. RED-check anything you claim is a fix

A test that passes both before and after proves nothing. Revert the fix, watch
the new test fail, restore it. Two examples where this paid:

- `colSpan={0}` — the test failed only against the unclamped version.
- The chunked-body DoS — against the unfixed route the regression test ran for
  **32 seconds** draining an endless producer before failing; with the fix, the
  whole file completes in 29ms. That contrast _is_ the evidence.

## 8. Known open items

- `useRovingTabIndex` in `@hexagen/ui/controllers` is **inert**: `totalItems` is
  a ref initialised to `0` and never assigned, so circular mode computes
  `x % 0` → `NaN` and linear mode clamps everything to `0`; `tabIndex` is
  hardcoded `0` and never `-1`, so it cannot express roving tabindex at all,
  and it focuses nothing. DESIGN.md §5.1 advertises it and §5.2 says to compose
  before writing — so a future packet **will** reach for it and get silent
  no-ops. Verified independently twice.
- `no-arbitrary-tailwind-values` is wired for `features/**` and
  `components/primitives/**` only, so `components/chat/ChatMessageList.tsx`'s
  two `max-w-[85%]` are out of scope — despite the BF-2.0 comment naming that
  exact file. Needs an `eslint.config.js` widening.
- The same rule does not inspect `TemplateElement`, so class names built in
  template literals are unenforced. Closing it would newly flag
  `ContextGovernanceChatDrawer.tsx` and break lint-green, so it needs its own
  packet.
- No test harness exists for shell scripts, so `validate-ui-boundary.sh` changes
  ship with hand-run cases recorded in the PR body.
