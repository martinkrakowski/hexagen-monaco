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
  - Fully aligned: 0
  - Partially aligned: 0
  - Requires adaptation: 0
  - Critical blockers: 0
- Critical blockers: None
- Adapter layer recommendations: None

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

## NodeKind Drift Audit
| Source Location | Implicit Node-like Types | Classification | Resolution |
|-----------------|--------------------------|----------------|------------|
| None found | N/A | N/A | No implicit node-like types found in surveyed locations |

## EdgeKind Drift Audit
| Source Location | Implicit Edge-like Types | Classification | Resolution |
|-----------------|--------------------------|----------------|------------|
| None found | N/A | N/A | No implicit edge-like types found in surveyed locations |

## DomainCommand Drift Audit
| Source Location | Implicit Command-like Types | Classification | Resolution |
|-----------------|-----------------------------|----------------|------------|
| None found | N/A | N/A | No implicit command-like types found in surveyed locations |

## RRP / REM Drift Audit
| Source Location | Implicit RRP/REM-like Types | Classification | Resolution |
|-----------------|-----------------------------|----------------|------------|
| None found | N/A | N/A | No implicit RRP/REM-like types found in surveyed locations |

## NodeVisualSpec Drift Audit
| Source Location | Implicit Visual Spec-like Types | Classification | Resolution |
|-----------------|---------------------------------|----------------|------------|
| None found | N/A | N/A | No implicit visual spec-like types found in surveyed locations |

## IntentLineage Drift Audit
| Source Location | Implicit Lineage-like Types | Classification | Resolution |
|-----------------|-----------------------------|----------------|------------|
| None found | N/A | N/A | No implicit lineage-like types found in surveyed locations |

## Critical Blockers (severity: critical)
No critical blockers found.

## Recommended Adapter Boundaries
No adapter boundaries recommended at this time.

## Appendix: Raw extraction data
No raw extraction data available as no implicit types were found.