# Review guidance for Greptile

Structured, scoped rules live in `.greptile/config.json`; the referenced source
documents are listed in `.greptile/files.json`. This file holds the reasoning
behind them — the part that is hard to compress into a rule string.

Rules here cite the decision that owns them rather than restating it. A restated
rule drifts: this repo has already carried one invariant in three places and had
two of the three diverge before review ran.

> This is not `.agents/REVIEW.md`. That file tells _our_ agents how to
> disposition review comments. This one tells the reviewer what is true here.

## The defect class worth your attention

This monorepo is mid-way through an architecture-remediation arc whose thesis is
that **a check must not report more confidence than it has earned.** Roughly
twenty instances have been found by hand so far. A sample, so the shape is
concrete rather than abstract:

- A CI step invoked a package filter that matched nothing; `turbo run test --filter='@hexagen/typo...'`
  prints `0 successful, 0 total` and **exits 0**. The gate was green over nothing.
- A workspace's `typecheck` reported zero errors because its `tsconfig.json`
  included only `src/**` — its ten type-invalid test files were outside the
  domain it checked.
- A guard asserted `toCreativeServiceError(` appeared _somewhere_ in each
  adapter. That was true of all three offenders — in their `catch` block, while
  their pre-validation early returns leaked a vendor type straight through the
  port.
- A boundary rule wired at **error** level had never inspected an `@/` import,
  because it returned early on any non-relative specifier. Two hundred-odd alias
  imports were invisible to it.
- An arch-linter exit code of `1` meant both "ran and found violations" and
  "could not run at all".

If you find another, it is almost certainly worth more than a style comment.

## Judging a proposed fix

Please state what your suggested change does to inputs the current code already
handles, **especially whether it converts a loud failure into a quiet one.** A
valid finding can carry an invalid remedy, and three landed here this arc:

- Replacing an index-manifest check with `every()` would have returned hollow
  pointer stubs, silently green, where the current code throws.
- Routing a manifest guard through the production loader would have rewritten
  its question from _"does a real `context.yaml` provide this key?"_ into _"does
  the Zod schema allow it?"_ — reinstating the exact defect the guard exists to
  catch.
- A fallback for a missing type literal would have silently rewritten a valid
  `generic` bounded context to `supporting` before it reached the model.

Applying a bad fix to a real bug is worse than leaving the bug, because it looks
resolved.

## "No live case" is a weak defence for a verifier

When the code under review is itself a check, _"there is no case in this package
today"_ is much weaker than it is for production code. Production code with no
live case does nothing. A verifier with a blind spot **under-reports silently,
forever, and is trusted while doing it.**

`main` currently carries the same constructor-parameter regex in two sibling
guards with opposite dispositions — fixed in one package, left naive in the
other on exactly that reasoning. Prefer fixing the parser to proving the tree
happens to be clean today.

## Things that look wrong here and are not

Each of these has been raised by a review bot and was incorrect. Full statements
are in `config.json`; the short version:

- **Assertion style is settled** — `expect()` and `node:assert/strict` are both
  permitted, per file, and `assert.*` is retained deliberately (ADR-0044 §2/§3).
- **The manifest is a registry, not an inventory** — accuracy is the invariant,
  completeness is not (ADR-0057).
- **Repeated `no-restricted-imports` entries in scoped ESLint blocks are
  deliberate** — flat config replaces rule options rather than merging them, and
  deduplicating one caused a real regression on `main`.
- **`@generated` barrels** are emitted by sync; hand-edits are reverted.

## Repo mechanics worth knowing

- Yarn 4 with the `node-modules` linker, Turborepo, Vitest. `apps/web` tests run
  from the `apps/web` working directory.
- Every workspace is symlinked into the root `node_modules`, so **dropping a
  dependency from a `package.json` does not make its specifier unresolvable**. A
  guard that means to enforce a dropped dependency has to assert on the manifest,
  not on resolvability.
- `apps/web` resolves workspace packages through those symlinks, so a change to
  a package only reaches the app after a rebuild — relevant when judging whether
  a test actually exercises the code it names.
