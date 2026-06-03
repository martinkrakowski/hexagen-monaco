# HexaGen Monaco Documentation

> **Purpose:** Human-readable architectural planning, decision history, and remediation tracking for the HexaGen Monaco project.

This `docs/` folder is the home for **narrative, planning, and remediation** content. It is intentionally separate from the machine-enforced architecture contracts.

## Quick Navigation

| Section                                                 | What You'll Find                                    | Related Machine Source                                  |
| ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| [Decisions](index.md)                                   | Human-friendly index into the ADRs                  | [.architecture/decisions/](../.architecture/decisions/) |
| [Architecture](planning/three-plane-system-overview.md) | Human-oriented three-plane system overview          | [.architecture/README.md](../.architecture/README.md)   |
| [Planning](planning/)                                   | Per-feature plans, incl. generator add-on templates | [.architecture/](../.architecture/) (contracts)         |

## Core Principle

- **`.architecture/`** = Single source of truth for executable architecture (manifest.yaml, context definitions, invariants, ADRs as primary records, generator state). Tools (sync, arch-linter) consume it.
- **`docs/`** = Narrative synthesis, long-form planning artifacts, and actionable remediation plans for humans (architects, contributors, reviewers).

Cross-references between the two are explicit and maintained.

## Contributing to These Docs

When updating planning or remediation documents:

1. Keep the canonical technical detail in the source files under `.architecture/` where appropriate.
2. Update the synthesized views here for readability and discoverability.
3. Major decisions still require an ADR in `.architecture/decisions/`.

---

_This documentation structure was introduced during the `organize-docs-folder` effort to give architectural planning and remediation first-class, scannable homes._
