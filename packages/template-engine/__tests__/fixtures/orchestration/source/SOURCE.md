# Provenance of this snapshot

Every file in this directory is a byte-for-byte copy of committed content in the
campaign-foundry repository, read at one pinned commit. Nothing here was written,
edited or reformatted. The upstream repository is read-only reference for this work
(§12 A-10 of `docs/planning/2026-09-29_orchestration-template.md`); it was never
modified, and no file under it was created or deleted.

| | |
| --- | --- |
| **Repository** | campaign-foundry |
| **Local path (read-only)** | `/Users/martin/Projects/Client-work/ADOBE/campaign-foundry` |
| **Pinned commit** | `205b8142d311b05a1802287a35e9a1d38d185ea8` |
| **Pinned commit date** | 2026-09-29T17:03:37-04:00 |
| **Pinned commit subject** | `feat(campaigns): reserve every static /campaigns route segment as a campaign id (D181) (#632)` |
| **Snapshot taken** | 2026-09-29 |

## The five paths read at the pin

| Source path at the pin | Blob at the pin | Destination here |
| --- | --- | --- |
| `.claude/skills/orchestrate-wave/SKILL.md` | `942001af64158379b5170edea9f1c643a85bcd53` | `SKILL.md` |
| `.claude/skills/orchestrate-wave/references/rationale.md` | `25f6fd0a7b3279c9441202ed680c32e92fd66217` | `references/rationale.md` |
| `.claude/skills/orchestrate-wave/references/cast.md` | `12687b070af78c91f42809a81eefab7b367cc9d7` | `references/cast.md` |
| `.claude/skills/orchestrate-wave/scripts/wave-event.sh` | `6cd1f96986ed78d1394fb8aa1ed571e7aaabeb64` | `scripts/wave-event.sh` |
| `scripts/gate.sh` | `c3954e2282b9f4d5cb5c02cd48a36d2a34e17d82` | `gate.sh` |

`scripts/wave-event.sh` keeps its executable bit; the other four are `100644` upstream
and `100644` here.

## Verifying this snapshot

Each file is byte-identical to the pinned blob. From the repository root, with
`git show` reading the committed object and `cmp` comparing bytes:

```sh
git show HEAD:packages/template-engine/__tests__/fixtures/orchestration/source/SKILL.md \
  | cmp - <(git -C /Users/martin/Projects/Client-work/ADOBE/campaign-foundry show 205b8142:.claude/skills/orchestrate-wave/SKILL.md)
```

Repeat for the other four with the paths in the table above. The `git hash-object` of
each file here also equals the blob id recorded above.

## What was deliberately not read

`briefs/` and `assets/inputs/` in campaign-foundry are the owner's operator data and
were never opened. The contents of either directory did not enter this fixture.
