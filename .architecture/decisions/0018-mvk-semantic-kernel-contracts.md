# ADR-0018: MVK Semantic Kernel Contracts
**Status:** Draft
**Date:** 2026-04-20
**Deciders:** Architecture team
**Supersedes:** None (extends ADR-0005 shared kernel framing)

## Context
- Why contracts-first architecture
- Why atomic design taxonomy was insufficient
- Why MVK is a compiled IR, not types or docs

## Decision
- Locked Q1–Q13 decisions enumerated
- Compilation pass atomicity
- Three-plane topology with convergence roadmap

## Rationale
- Controller hybrid (Q1)
- Three-layer firewall (Q2/Q5)
- Contracts-first (Q3)
- Feature folders (Q4)
- Path + manifest + versioning (Q6–Q12)

## Consequences
### Positive
- UI can't hold semantic state (firewall)
- Kernel sovereignty established
- Evolution path declared
### Negative
- Dual-truth period (manifest + MVK) until Phase 2–3
- Three-layer firewall adds tooling overhead
- Vertical-slice migration requires one-time feature folder reshuffle

## Co-Emitted Artifacts
- .architecture/mvk/drift-report-v1.md
- .architecture/mvk/spec-v1.md
- packages/core-domain/src/mvk/v1/index.ts

## Compilation Pass
- Pass ID: cp-2026-04-20-01
- Snapshot SHA: b061ccdb2c4b989a74fcd45130534e89c0926a04
---