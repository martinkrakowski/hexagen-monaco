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
