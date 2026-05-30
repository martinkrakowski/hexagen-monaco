# Git Conventions

## Branches

- `feat/<short-description>` — new functionality
- `fix/<short-description>` — bug fixes
- `chore/<short-description>` — tooling, deps, docs
- Never commit directly to the default branch; branch first.

## Commits

- **Conventional Commits:** `type(scope): summary` — e.g.
  `feat(auth): add magic-link login`.
- Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.
- Subject in the imperative ("add", not "added"); body explains *why*, not what.
- One logical change per commit. Do not bundle unrelated edits.

## Pull Requests

- Title = the commit summary; description covers what changed and why, plus how
  it was verified.
- Squash merge so the default branch keeps one commit per PR.
- CI (build, typecheck, lint, test) must be green before merge.

## Never

- `git commit --no-verify` (it skips the hooks that protect the branch).
- Force-push the default branch.
- Commit secrets, `.env` files, or generated artifacts that are gitignored.
- Amend or rebase commits that have already been pushed and reviewed by others.
