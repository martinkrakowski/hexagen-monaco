# Repository best practices — review reference for Qodo

Qodo Merge reads this file from the repository root and raises suggestions
labelled **Organization best practices** when a PR contradicts it.

It exists to correct conventions Qodo has previously flagged incorrectly here,
and to point it at the defect class this codebase cares most about. Each rule
names the decision that owns it rather than restating it — a restated rule
drifts, and this repo has already carried one invariant in three places and had
two of the three diverge before review ran.

> Not to be confused with `.agents/REVIEW.md`, which tells _our_ agents how to
> disposition review comments. This file tells the reviewer what is true here.

---

## Please do flag these

This monorepo is mid-way through an architecture-remediation arc whose thesis is
that **a check must not report more confidence than it has earned.** Findings in
that class are the most valuable ones available in this repo.

- A gate, guard, script or CI step that can **pass when it never ran** — a
  swallowed resolution error, a package filter that matches nothing and exits 0,
  a `continue-on-error` on a step described as a gate.
- A guard that asserts a population is _clean_ without first asserting the
  population is **non-empty**. Without that floor it goes green the moment its
  discovery pattern drifts. Measured twice here.
- A test that passes for a reason other than the one its name claims — most
  often because a mock replaced the very subject under test.
- An exit code that cannot distinguish _"ran and found problems"_ from _"could
  not run"_.
- A parser or matcher inside a **guard** that misses a legal syntax form. A
  blind spot in a verifier under-reports silently and is trusted while doing it,
  so it is worth more than the same bug in ordinary code.

When proposing a fix, say what it does to inputs the current code already
handles — particularly whether it turns a loud failure into a quiet one. Several
correct findings here have carried remedies worse than the defect they reported.

## Please do not flag these

### Assertion style is settled

`expect()` and `node:assert/strict` are **both permitted** (ADR-0044 §2), and
`assert.*` is **retained codebase-wide** (`AGENTS.md`). The rule in ADR-0044 §3
is **per file** — a single file should not mix the two, but the repo as a whole
legitimately uses both. Do not propose migrating `assert.*` to `expect()` and do
not treat `assert.*` as legacy.

### The manifest is a registry, not an inventory

`.architecture/**/context.yaml`'s `layers.*.ports` and `layers.*.adapters` are a
**curated ownership registry, not a file inventory** (ADR-0057). The filesystem
is the authoritative inventory.

- **Accuracy is the invariant** — a phantom or misattributed entry is a real
  defect worth raising.
- **Completeness is not** — a port file with no entry is expected. Do not ask
  for an entry because a file exists.

`.architecture/**` is human-authored. Do not propose edits to `manifest.yaml`,
any `context.yaml`, or `invariants/**`.

### Repeated ESLint entries across scoped blocks are deliberate

ESLint **flat config replaces rule options rather than merging them**, so a
narrowly-scoped `no-restricted-imports` block silently drops every entry the
broader block declared for the files it matches. Removing a "duplicate"
ADR-0021 `@hexagen/local-llm` ACL entry from a scoped block has already caused a
real regression on `main` here.

Note also that `no-restricted-imports` matches the **import string**, not the
resolved module — a pattern must cover the relative form, the `@/`-alias form,
and any barrel that re-exports the fenced module.

### Generated barrels

Some `index.ts` barrels carry an `@generated` marker and are emitted by
`@hexagen/sync`. Hand-edits are reverted by the next sync run. If an export
surface is wrong, fix the generator or the source module.

### Template payload is shipped code

`packages/template-engine/templates/**` is emitted into customer projects. It
sits outside this repo's tsconfig, so "outside the build" is not grounds for
treating a defect there as cosmetic — a layering or typing error in those files
is one this product exports to its users.

---

## Conventions worth knowing

- **Port direction** follows ADR-0048: a contract implemented by an
  infrastructure adapter, or injected into a use case as a dependency, is
  **outbound** (`ports/out`); a contract a use case itself implements is
  inbound.
- **Tests** run on Vitest (ADR-0044). `apps/web` tests must be run from the
  `apps/web` working directory.
- **Published surface**: the supported contract of `@hexagen-monaco/sync` is the
  `hexagen` **binary**; the root barrel is provisional under 0.x, and removals
  ride a minor, never a patch (ADR-0056).
