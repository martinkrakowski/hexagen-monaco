---
mvk-compilation-pass: cp-2026-04-20-01
pass-snapshot-sha: b061ccdb2c4b989a74fcd45130534e89c0926a04
co-emitted-siblings:
  - .architecture/mvk/spec-v1.md
  - .architecture/decisions/0018-mvk-semantic-kernel-contracts.md
  - packages/core-domain/src/mvk/v1/index.ts
mvk-target-version: v1
rrp-target-version: v1
emission-phase: 1.0
---

# Drift Report v1

## Executive Summary

- Count by alignment classification:
  - Fully aligned: 11 (all surveyed packages contain no MVK-equivalent types)
  - Partially aligned: 0
  - Requires adaptation: 0
  - Critical blockers: 0
- Critical blockers: None
- Adapter layer recommendations: None — domain packages are stubs; no drift to resolve

## Survey Scope Manifest

The following 11 source locations were surveyed for implicit node-like types, edge kinds, domain commands, RRP/REM, NodeVisualSpec, and IntentLineage:

1. packages/architectural-enforcement/src/domain/rules/
2. packages/architectural-enforcement/src/application/use-cases/
3. packages/project-configuration/src/domain/
4. packages/project-generation/src/domain/
5. packages/code-generation/src/domain/
6. packages/local-llm/src/domain/
7. packages/agentic-interaction/src/domain/
8. packages/messaging/src/domain/
9. packages/persistence/src/domain/
10. packages/external-integration/src/domain/
11. packages/deployment/src/domain/

**Survey method:** `rg -l "NodeKind|EdgeKind|DomainCommand|RRP|REM|IntentLineage|NodeVisualSpec|GovernanceRule|TopologyRule|CardinalityRule"` across all 11 paths.

## NodeKind Drift Audit

| Source Location                                                 | Implicit Node-like Types             | Classification                                             | Resolution                        |
| --------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- | --------------------------------- |
| packages/project-generation/src/domain/model/file-tree-node/    | `FileTreeNode`, `FileSystemNodeType` | Not drift — file-system tree node, not semantic graph node | No action needed                  |
| packages/project-configuration/src/domain/model/file-tree-node/ | `FileTreeNode`, `FileSystemNodeType` | Not drift — file-system tree node, not semantic graph node | No action needed                  |
| All other 9 locations                                           | None found                           | N/A                                                        | No implicit node-like types found |

**Evidence:** `FileTreeNode` represents directory/file hierarchy for project generation, not a semantic domain node in the MVK sense. These types belong to a different bounded context.

## EdgeKind Drift Audit

| Source Location  | Implicit Edge-like Types | Classification | Resolution                                              |
| ---------------- | ------------------------ | -------------- | ------------------------------------------------------- |
| All 11 locations | None found               | N/A            | No implicit edge-like types found in surveyed locations |

**Evidence:** Zero matches for `EdgeKind`, `edge.*type`, or relationship types across all surveyed paths.

## DomainCommand Drift Audit

| Source Location  | Implicit Command-like Types | Classification | Resolution                                                 |
| ---------------- | --------------------------- | -------------- | ---------------------------------------------------------- |
| All 11 locations | None found                  | N/A            | No implicit command-like types found in surveyed locations |

**Evidence:** Zero matches for `DomainCommand`, `interface.*Command`, or `type.*Command` across all surveyed paths.

## RRP / REM Drift Audit

| Source Location  | Implicit RRP/REM-like Types | Classification | Resolution                                                 |
| ---------------- | --------------------------- | -------------- | ---------------------------------------------------------- |
| All 11 locations | None found                  | N/A            | No implicit RRP/REM-like types found in surveyed locations |

**Evidence:** Zero matches for `ResolvedRuleProgram`, `RuleExecutionManifest`, or compilation result types.

## NodeVisualSpec Drift Audit

| Source Location  | Implicit Visual Spec-like Types | Classification | Resolution                                                     |
| ---------------- | ------------------------------- | -------------- | -------------------------------------------------------------- |
| All 11 locations | None found                      | N/A            | No implicit visual spec-like types found in surveyed locations |

**Evidence:** Zero matches for `NodeVisualSpec`, `VisualSpec`, or projection types.

## IntentLineage Drift Audit

| Source Location  | Implicit Lineage-like Types | Classification | Resolution                                                 |
| ---------------- | --------------------------- | -------------- | ---------------------------------------------------------- |
| All 11 locations | None found                  | N/A            | No implicit lineage-like types found in surveyed locations |

**Evidence:** Zero matches for `IntentLineage`, `IntentId`, or causal tracking types.

## Critical Blockers (severity: critical)

No critical blockers found.

## Recommended Adapter Boundaries

No adapter boundaries recommended at this time. Domain packages are stubs with minimal domain logic. As the system grows, re-run this drift survey at each major phase boundary.

## Appendix: Raw extraction data

**Commands executed:**

```bash
rg -l "NodeKind|EdgeKind|DomainCommand|RRP|REM|IntentLineage|NodeVisualSpec" packages/{architectural-enforcement,project-configuration,project-generation,code-generation,local-llm,agentic-interaction,messaging,persistence,external-integration,deployment}/src/ --type ts
```

**Results:** No matches in 10 of 11 locations. Two false-positive matches for `FileTreeNode` in project-configuration and project-generation (not MVK drift).

---

## Resolved Drift — Compilation Pass cp-2026-04-22-01

**Date:** 2026-04-22
**Trigger:** CV-7 (spec↔TS drift within MVK compilation pass)
**Decision:** D2 — Remove `lineageId` + `timestamp` from `DomainCommand`; keep them on `IntentLineage`

### Issue

`spec-v1.md` lines 166–215 specify `DomainCommand` variants with only `type` and `payload`:

```
type DomainCommand =
  | { type: "CreateNode"; payload: { kind, attributes } }
  | { type: "UpdateNode"; payload: { nodeId, attributes } }
  | ...
```

The TypeScript implementation added a `BaseDomainCommand` interface with `lineageId: Identifier` and `timestamp: number`, inherited by every variant. These fields are **not in the spec** and duplicate the provenance tracking already provided by `IntentLineage` (spec lines 333–365).

Per ADR 0018 Q10/Q11 and the MVK authority model (spec line 37–40: "MVK Spec = Canonical"), the TypeScript must align to the spec, not vice versa.

### Fix Applied

- Removed `BaseDomainCommand` interface
- Removed `lineageId` and `timestamp` from all 7 command interfaces + `BatchCommand`
- Updated compilation pass ID to `cp-2026-04-22-01`
- No consumer code required updating — `lineageId`/`timestamp` were never read outside the type definition

### Verification

- `yarn build && yarn typecheck` — green
- `domain-command.ts` and `spec-v1.md §DomainCommand` are now shape-equivalent
- `IntentLineage` remains the sole provenance carrier for command chain-of-custody
