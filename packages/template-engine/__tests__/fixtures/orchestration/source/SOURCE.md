# Provenance of this snapshot

This directory is a pinned snapshot of the reference skill: the orchestration skill, its two
reference documents, its wave-event shim and its gate script, as they stood on 2026-09-29. Four
of the five files are byte-for-byte copies of the reference content. The fifth, `gate.sh`, is the
same script with its project-specific environment-variable prefix, lock-file prefix and package
scope replaced by neutral names (`GATE_`, `gate.`, `@example/`), so that it names no project; its
behaviour is unchanged. The reference project is read-only reference for this work (§12 A-10 of
`docs/planning/2026-09-29_orchestration-template.md`); nothing under it was created or deleted.

| | |
| --- | --- |
| **Snapshot taken** | 2026-09-29 |
| **Scrubbed** | 2026-10-01 (`gate.sh` only; the blob id below is the scrubbed file's) |

## The five files

| File | Blob | Destination here |
| --- | --- | --- |
| `skill` | `942001af64158379b5170edea9f1c643a85bcd53` | `SKILL.md` |
| `rationale` | `25f6fd0a7b3279c9441202ed680c32e92fd66217` | `references/rationale.md` |
| `cast` | `12687b070af78c91f42809a81eefab7b367cc9d7` | `references/cast.md` |
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
