# Architecture (Human View)

This section contains synthesized, human-readable explanations of the HexaGen Monaco architecture.

It is **not** the source of truth for enforcement or code generation. The authoritative contracts live in the sibling directory:

→ [.architecture/](../.architecture/README.md)

## What Lives Here

- [Three-Plane System Overview](three-plane-system-overview.md) — The three-plane topology, major bounded contexts, and guiding principles.

See the top-level [Decisions](../decisions/) section for the ADR index and key decisions synthesis.

## Relationship to the Contracts

| Human Document              | Canonical Source                          | Update Rule |
|-----------------------------|-------------------------------------------|-------------|
| Three-Plane System Overview | manifest.yaml + MVK spec + key ADRs       | Synthesize; do not contradict |
| Any future diagrams         | Individual ADRs or context yamls          | Link + short summary |

## When to Update These Files

- After a significant cluster of ADRs land.
- When onboarding new architects or senior contributors.
- When the high-level mental model shifts (rare — requires ADR).

For the raw, enforceable definitions and the full history of decisions, always go to `.architecture/`.
