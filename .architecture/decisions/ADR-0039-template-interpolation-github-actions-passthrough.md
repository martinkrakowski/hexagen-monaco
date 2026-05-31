# ADR-0039: Template Interpolation Reserves `{…}` and Passes GitHub Actions `${{…}}` Through

**Date:** 2026-05-30
**Status:** Accepted
**Type:** Architecture

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

**`interpolate()` treats a GitHub Actions `${{ … }}` expression as an atom and
emits it verbatim.** The token grammar, in precedence order, is:

1. `${{ … }}` — a GitHub Actions expression, passed through unchanged.
2. `{{` / `}}` — brace escape sequences.
3. `{identifier}` — variable substitution.

Implementation: the matcher tries the `${{ … }}` alternative first
(`/\$\{\{[\s\S]*?\}\}|\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_.-]*)\}/`), so the inner
braces of a GHA expression are consumed whole and never reach rules 2–3. The
body is non-greedy so adjacent expressions (`${{ a }}${{ b }}`) stay separate.

The consequence for template authors: **workflow files use GHA expressions
exactly as GitHub documents them** — no quadrupling (`${{{{ … }}}}`), no
per-file interpolation opt-out.

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
