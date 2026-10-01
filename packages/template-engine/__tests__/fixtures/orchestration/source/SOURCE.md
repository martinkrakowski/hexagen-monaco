# Provenance of this snapshot

This directory is a pinned snapshot of the reference skill: the orchestration skill, its two
reference documents, its wave-event shim and its gate script, as they stood on 2026-09-29. Only
`scripts/wave-event.sh` is still a byte-for-byte copy of the reference content. The other four were
scrubbed on 2026-10-01 so that they name no project, and their blob ids below are the scrubbed
files' ids. The reference project is read-only reference for this work (§12 A-10 of
`docs/planning/2026-09-29_orchestration-template.md`); nothing under it was created or deleted.

What the scrub changed, and nothing else:

- `gate.sh`: the project-specific environment-variable prefix, lock-file prefix and package scope
  became `GATE_`, `gate.` and `@example/`, and the header comment's plan-decision and lane ids were
  replaced by neutral wording. Behaviour is unchanged for the script in isolation (the fixture is
  never executed); the extracted gate steps are identical.
- `SKILL.md`, `references/cast.md`, `references/rationale.md`: the reference project's PR numbers,
  lane ids, wave ids, decision id and branch names became neutral stand-ins (`PR-X…`, `LANE-X…`,
  `LANE-Y…`, `LANE-Z…`, `wave-X…`, `wave-Q…`, `D-X1`, `lane-Q1`, `wt-*`, `wt-<lane>`). The same mapping was applied to
  the overlay, so every snapshot unit still appears whole in the generic skill or the overlay.

| | |
| --- | --- |
| **Snapshot taken** | 2026-09-29 |
| **Scrubbed** | 2026-10-01 (four of the five files; the blob ids below are the scrubbed files' ids) |

## The five files

| File | Blob | Destination here |
| --- | --- | --- |
| `skill` | `d057583f3137a3df3285ec1ccaf5e9ef37e95e38` | `SKILL.md` |
| `rationale` | `5f83836ec6f7d3f0ce2b4de55cf350bbcf86f518` | `references/rationale.md` |
| `cast` | `8938fdaeb9a73f7818ff38707d8d5078ae4a01f3` | `references/cast.md` |
| `wave-event shim` | `6cd1f96986ed78d1394fb8aa1ed571e7aaabeb64` | `scripts/wave-event.sh` |
| `gate script` | `b8328a585f20060958232603617cdafbbd1e59fb` | `gate.sh` |

`scripts/wave-event.sh` keeps its executable bit; the other four are `100644`.

## Verifying this snapshot

The `git hash-object` of each file here equals the blob id recorded above, and
`scripts/orchestration/skill-coverage.mjs` recomputes the same ids and fails when any file
differs. From the repository root:

```sh
git hash-object packages/template-engine/__tests__/fixtures/orchestration/source/SKILL.md
```

Repeat for the other four with the paths in the table above.

## What was deliberately not read

The reference project's operator data (its briefs and input assets) was never opened. The contents
of those directories did not enter this fixture.
