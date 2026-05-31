# ADR-0039: Template Interpolation Reserves Bare `{…}` and Passes `$`-Prefixed Expressions Through

**Date:** 2026-05-30
**Status:** Accepted
**Type:** Architecture

> **Amended 2026-05-30:** generalized from "GitHub Actions `${{…}}` only" to **all
> `$`-prefixed expressions** (`${{…}}` GitHub Actions _and_ `${…}` JS template
> literals / shell expansion). Only a **bare** `{var}` is a placeholder. See the
> "JS/shell `${…}`" subsection below.

## Context

Generator templates (`@hexagen/template-engine`) are scaffolded by running every
emitted file through `interpolate()` in `@hexagen/shared`. That function defines
the template "language":

- `{identifier}` → substituted with the matching answer value.
- `{{` → literal `{`, `}}` → literal `}` (escape sequences for emitting braces).

GitHub Actions workflow YAML is built almost entirely from `${{ … }}`
expressions (`${{ secrets.X }}`, `${{ github.sha }}`, `${{ runner.os }}`).
Because `${{ … }}` contains `{{` and `}}`, the escape rules collapsed every GHA
expression to single braces: `${{ secrets.GITHUB_TOKEN }}` was emitted as
`${ secrets.GITHUB_TOKEN }`, which GitHub does **not** evaluate.

This was not theoretical: the already-merged `docker` template's `docker-build.yml`
shipped broken `password: ${ secrets.GITHUB_TOKEN }`. The `ci-github-actions`
template (PR #130), which is mostly GHA expressions, made the conflict
unavoidable and forced a decision.

## Decision

**Only a _bare_ `{identifier}` is a placeholder. Anything `$`-prefixed is code
and passes through verbatim.** The token grammar, in precedence order, is:

1. `${{ … }}` — a GitHub Actions expression, passed through unchanged.
2. `{{` / `}}` — brace escape sequences.
3. `(?<!$){identifier}` — variable substitution, **only when not preceded by `$`**.

Implementation:
`/\$\{\{[\s\S]*?\}\}|\{\{|\}\}|(?<!\$)\{([A-Za-z_][A-Za-z0-9_.-]*)\}/`

- The leading `${{ … }}` alternative is matched first (non-greedy), so a GHA
  expression is consumed whole and its inner `{{`/`}}` never reach rules 2–3.
- The negative lookbehind `(?<!\$)` on the placeholder rule means a `${ … }`
  (JS template literal or shell expansion) is left untouched too.

The consequence for template authors: **workflow YAML, emitted TypeScript, and
shell scripts use `${{ … }}` / `${ … }` exactly as written** — no quadrupling
(`${{{{ … }}}}`), no string-concatenation workarounds (`"[" + x + "]"` instead
of a template literal), no per-file opt-out.

### JS/shell `${…}` (the amendment)

The original decision covered only `${{ … }}`. But the same brace-collision hit
ordinary `${ … }`: a JS template literal like `` `status ${res.status}` `` had
its `{res.status}` read as a placeholder, producing a spurious "unresolved
variable" warning on every literal — and, worse, a latent footgun: a
`${someAnswerId}` in emitted code would be **silently replaced** by an answer
value, corrupting the output. (This is why the `observability` template used
string concatenation instead of template literals.)

The lookbehind closes both: `${id}` is never a placeholder, so JS/shell
expressions emit verbatim, the warning channel is trustworthy (a remaining
"unresolved variable" now means a genuine dead `{placeholder}`), and the footgun
is gone. Verified: no template contained a `${answerId}` relying on the old
behaviour, so emitted output is unchanged.

## Rejected Alternatives

- **Escape inside each template (`${{{{ … }}}}`).** Round-trips correctly but
  makes every workflow source unreadable, is highly error-prone across many
  expressions, and leaves the `docker` bug unfixed. Rejected: pushes an engine
  defect onto every future template author.
- **Change the brace-escape sequences** (e.g. to `\{` / `\}`). Lower-collision,
  but a breaking change to the template language affecting all existing
  templates for a problem localized to GHA syntax. Rejected as
  disproportionate.
- **Skip interpolation for `.github/workflows/**`.** A path-based carve-out is
hidden, surprising, and still mangles GHA expressions used elsewhere (e.g.
`instrumentation`/deploy scripts). Rejected.

## Consequences

- The `docker` template now emits valid `${{ … }}`; a regression in
  `docker-emit-shape.test.ts` asserts `${{ secrets.GITHUB_TOKEN }}` survives and
  that nothing collapses to single-brace `${ … }`.
- `ci-github-actions` and any future CI/CD template author GHA YAML directly.
- Two downstream template-authoring patterns are _consequences of the existing
  emitter_, not separate decisions, and are documented here rather than in their
  own ADRs:
  - **Per-target gated files.** The emitter maps `output.path` → `files/<path>`
    (source path _is_ destination path), so one destination cannot have
    answer-dependent content. A `select` like `deploy_target` is therefore
    expressed as distinct gated output files (one per option), only the chosen
    one emitting — not a single `deploy.yml` rewritten per answer.
  - **In-file-effect answers.** Answers that would change _structure within_ a
    file (drop a step, reshape `on:`) cannot be honored by value-only
    interpolation. They are recorded in a config-summary comment with TODO
    guidance, matching the `docker` template's "one file + comments for
    alternatives" convention.

## Known Debt

- **`}}` inside a GHA expression body is mishandled.** The non-greedy match ends
  at the first `}}`, so an expression embedding a literal `}}` — e.g.
  `${{ fromJSON('{"a":{}}') }}` — terminates early. Standard expressions
  (`secrets.*`, `vars.*`, `env.*`, `github.*`, `steps.*`) never contain `}}`, so
  this is accepted for now. Revisit if a template needs inline-JSON GHA
  expressions.
- A malformed/unclosed `${{` (no matching `}}`) falls through to the escape
  rules and is mangled. Treated as author error.
