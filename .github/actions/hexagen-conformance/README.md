# Hexagen Conformance action

In-repo composite action for `hexagen-lint --ratchet` + `hexagen sync --check`.

## Version pin (0.10.0 unpublished)

This action implements the **0.10.0 unpublished** contract:

- per-PR baseline diff (only this PR's new violations)
- rename-aware identity remapping (`rule|file|specifier`)
- machine-enforced baseline growth
- suppression `reason` / `expires`

The published **0.9.0** tarball of `@hexagen-monaco/sync` / `@hexagen-monaco/arch-linter` does **not** include `adopt`, `report`, or per-PR diffing. Do not point a 0.9.0 consumer at this action and expect those flags to exist.

Until 0.10.0 is published, pin by **commit SHA**, not a `vX.Y.Z` tag:

```yaml
- uses: martinkrakowski/hexagen-monaco/.github/actions/hexagen-conformance@<commit-sha>
```

In this repository and in generated projects that vendor the action, use the relative path:

```yaml
- uses: ./.github/actions/hexagen-conformance
```

Do not push a `vX.Y.Z` tag to publish this action.

## Behaviour

| Event          | Lint                                     | Sync check             | PR comment                                      |
| -------------- | ---------------------------------------- | ---------------------- | ----------------------------------------------- |
| `pull_request` | `--ratchet --pr-diff` vs `origin/<base>` | `hexagen sync --check` | Only this PR's new findings. Silent when clean. |
| `push`         | `--ratchet`                              | `hexagen sync --check` | None                                            |

Clean PRs leave no comment (a previous comment from this action is deleted).
