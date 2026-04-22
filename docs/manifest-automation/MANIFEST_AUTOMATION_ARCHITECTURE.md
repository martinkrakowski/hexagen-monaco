# Manifest Automation: Current vs. Proposed Architecture

## Current System (One-Way: Manifest → Code)

```
┌─────────────────────────────────────────────────────────────┐
│  DEVELOPERS / ARCHITECTS                                    │
│  (Manual Actions)                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  manifest.yaml (Manual Edit) │◄─── Port name added
        │  - bounded_contexts          │◄─── Use case defined
        │  - ports, entities, adapters │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  generator.config.yaml       │◄─── Ownership registry
        │  (ALSO Manual Edit)          │     updated by hand
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  yarn sync                   │
        │  (SyncEngine runs)           │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┴──────────────────────────────────┐
        │                                                 │
        ▼                                                 ▼
┌────────────────────┐                         ┌─────────────────────┐
│ Auto-Generated:    │                         │ Hand-Written:       │
│ - layer folders    │                         │ - port interfaces   │
│ - package.json     │                         │ - implementations   │
│ - tsconfig.json    │                         │ - adapters          │
│ - barrel files     │                         │ - use cases         │
└────────────────────┘                         └─────────────────────┘

PROBLEM: Two manual edits required for each port (manifest + ownership-registry)
```

---

## Proposed System (Phase 1: Auto-Sync Ownership Registry)

```
┌─────────────────────────────────────────────────────────────┐
│  DEVELOPERS / ARCHITECTS                                    │
│  (Manual Actions)                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  manifest.yaml (Manual Edit) │◄─── Port name added
        │  - bounded_contexts          │◄─── Use case defined
        │  - ports, entities, adapters │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  yarn sync                   │
        │  (SyncEngine runs)           │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┴──────────────────────────────────┐
        │                                                 │
        ▼                                                 ▼
┌────────────────────────────────┐         ┌──────────────────────────┐
│ Auto-Generated:                │         │ AUTO-SYNC (new):         │
│ - layer folders                │         │ - ownership-registry.ts  │
│ - package.json                 │         │   walks manifest         │
│ - tsconfig.json                │         │   auto-updates .config.y │
│ - barrel files                 │         │   [PHASE 1]              │
└────────────────────────────────┘         └──────────────────────────┘
                │
                ▼
        ┌──────────────────────────────┐
        │  generator.config.yaml       │◄─── AUTO-POPULATED
        │  ownership-registry          │     (no manual edit needed)
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌────────────────────────────────┐
        │ Arch-linter runs               │
        │ Validates port-single-ownership│
        │ (all invariants pass)          │
        └────────────────────────────────┘

BENEFIT: Single manual edit per port (manifest only)
```

---

## Extended System (Phase 2: Structure Validation Report)

```
        ┌──────────────────────────────┐
        │  manifest.yaml               │
        │  (Manual Edit)               │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  yarn sync                   │
        │  (SyncEngine runs)           │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┴──────────────────────────────────────┐
        │                                                     │
        ▼                                                     ▼
┌────────────────────────────────┐     ┌──────────────────────────┐
│ Auto-Generated:                │     │ AUTO-VALIDATION (new):   │
│ - layer folders                │     │ - structure-report.ts    │
│ - package.json                 │     │   scans packages/{name}/ │
│ - tsconfig.json                │     │   checks manifest match  │
│ - barrel files                 │     │   [PHASE 2]              │
└────────────────────────────────┘     └──────────────────────────┘
                │                                  │
                ▼                                  ▼
        ┌─────────────────────────────┐  ┌─────────────────┐
        │ Arch-linter passes          │  │ Report generated│
        │ All invariants valid        │  │ JSON/YAML output│
        │                             │  │ Drift detected? │
        └─────────────────────────────┘  └─────────────────┘

BENEFIT: Early detection of manifest ↔ code divergence
```

---

## Full Bidirectional System (Phase 3: AST-Based Discovery)

```
Manifest                             Code
─────────────────────────────────────────────────────────────────

manifest.yaml ◄──────────────────► packages/{name}/src/
   │                                    │
   │ Declares:                          │ Contains:
   ├─ ports                             ├─ port interfaces
   ├─ entities                          ├─ entities/VOs
   ├─ use-cases                         ├─ use-case classes
   ├─ adapters                          ├─ adapters
   │                                    │
   ▼                                    ▼
[Phase 1 & 2 generators]      [Phase 3: Port Discovery]
- ownership-registry          - AST parsing (ts-morph)
- structure-report            - Extract interface names
                              - Validate against manifest
                              - Flag missing/extra

   │                                    │
   └────────────┬───────────────────────┘
                ▼
        ┌──────────────────────┐
        │ yarn sync --validate │
        │ Two-phase validation │
        ├──────────────────────┤
        │ Phase 1: manifest→code│
        │ (ensure scaffolds exist)
        │                      │
        │ Phase 2: code→manifest
        │ (warn on divergence)  │
        └──────────────────────┘

BENEFIT: True bidirectional sync with divergence detection
```

---

## Key Differences

| Aspect                   | Phase 0 (Current) | Phase 1 (Short-term) | Phase 2 (Medium) | Phase 3 (Long)   |
| ------------------------ | ----------------- | -------------------- | ---------------- | ---------------- |
| **Registry Sync**        | Manual            | ✅ Auto              | ✅ Auto          | ✅ Auto          |
| **Structure Validation** | None              | None                 | ✅ Report        | ✅ Report        |
| **Port Discovery**       | None              | None                 | None             | ✅ AST-based     |
| **Divergence Detection** | Manual            | Manual               | ✅ Early         | ✅ Bidirectional |
| **Manifest Authoring**   | Manual            | Manual               | Manual           | Manual           |
| **Code Generation**      | Manual            | Manual               | Manual           | Manual           |
| **Effort**               | -                 | 2-3h                 | +3-4h            | +8-10h           |

---

## Implementation Priority

```
IMMEDIATE (High ROI, Low Risk)
│
├─ Phase 1: Auto-sync ownership-registry
│  └─ Solves: Most common manual sync pain point
│  └─ Effort: 2-3 hours
│  └─ Risk: Low (just manifest walking)
│
├─ Phase 2: Structure validation report
│  └─ Solves: Drift detection
│  └─ Effort: 3-4 hours
│  └─ Risk: Low (read-only scanning)
│
FUTURE (Medium ROI, Medium Risk)
│
├─ Phase 3: AST-based port discovery
│  └─ Solves: Code-to-manifest validation
│  └─ Effort: 8-10 hours
│  └─ Risk: Medium (AST parsing complexity)
│
└─ Phase 4: Full bidirectional sync
   └─ Solves: Complete automation
   └─ Effort: Design + Phase 3
   └─ Risk: High (architectural changes)
```
