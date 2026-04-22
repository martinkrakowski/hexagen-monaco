# Manifest Automation Investigation — Complete Documentation

## Overview

This investigation explores how to make `.architecture/manifest.yaml` fully auto-generated in HexaGen Monaco. The documentation includes:

1. **MANIFEST_AUTOMATION_SUMMARY.md** — Quick reference (2 min read)
2. **MANIFEST_AUTOMATION_ARCHITECTURE.md** — Visual diagrams and phased roadmap (5 min read)
3. **MANIFEST_AUTOMATION_REPORT.md** — Comprehensive analysis (15 min read)

---

## Quick Answers

### Q: Is the manifest auto-generated today?

**A:** No. The manifest is 100% manually authored. However, code is auto-generated FROM the manifest.

### Q: What's the biggest manual pain point?

**A:** When adding a new port, developers must manually update TWO files:

- `manifest.yaml` (add port to context)
- `generator.config.yaml` (add port to ownership-registry)

### Q: How can we fix it?

**A:** Create `generators/ownership-registry.ts` to auto-sync the registry (2-3 hours, high impact).

### Q: Should we make it fully auto-generated?

**A:** No — the manifest-first philosophy (per ADR-0014) is intentional. It keeps architectural intent explicit. Instead, add tooling to detect divergence and validate consistency.

---

## Document Guide

### For Quick Overview

→ Read: **MANIFEST_AUTOMATION_SUMMARY.md**

- What works now vs. what doesn't
- Quick wins and effort estimates
- Key files and philosophy

### For Architecture & Implementation

→ Read: **MANIFEST_AUTOMATION_ARCHITECTURE.md**

- Current system flow (one-way: manifest → code)
- Phase 1-3 proposed improvements
- Visual diagrams
- Implementation priority matrix

### For Deep Dive Analysis

→ Read: **MANIFEST_AUTOMATION_REPORT.md**

- Complete manifest structure
- Generator and SyncEngine capabilities
- Manual vs. auto-generated breakdown
- Gaps and limitations
- Detailed recommendations per tier

---

## Key Findings Summary

| Finding                             | Impact        | Recommendation                        |
| ----------------------------------- | ------------- | ------------------------------------- |
| **Ownership registry is manual**    | High friction | Auto-sync in Phase 1 (2-3h)           |
| **No code discovery**               | Medium risk   | Add validation in Phase 2 (3-4h)      |
| **Manifest stays manually curated** | By design     | Keep this — it ensures intent clarity |
| **Bootstrap sequence incomplete**   | Low impact    | Document unimplemented steps          |
| **No drift detection**              | Medium risk   | Add structure-report generator        |

---

## Recommended Roadmap

### Phase 1 (Immediate): Auto-Sync Ownership Registry

- **Problem**: Manual registry updates required for each port
- **Solution**: `generators/ownership-registry.ts` walks manifest, auto-populates registry
- **Effort**: 2-3 hours
- **Impact**: Eliminates most common manual sync pain point
- **Risk**: Low (manifest walking, no AST parsing)

### Phase 2 (Short-term): Structure Validation Report

- **Problem**: No early detection of manifest ↔ code divergence
- **Solution**: `generators/structure-report.ts` scans packages, compares to manifest
- **Effort**: 3-4 hours (cumulative: 5-7 hours)
- **Impact**: Drift detection before linting
- **Risk**: Low (read-only directory scanning)

### Phase 3 (Medium-term): AST-Based Port Discovery

- **Problem**: Code-to-manifest validation missing
- **Solution**: Use ts-morph to parse port definitions, validate against manifest
- **Effort**: 8-10 hours (cumulative: 13-17 hours)
- **Impact**: Bidirectional validation
- **Risk**: Medium (AST parsing complexity)

### Phase 4 (Long-term): Full Bidirectional Sync

- **Problem**: Limited to one-way manifest → code
- **Solution**: Implement two-phase validation (manifest→code, code→manifest)
- **Effort**: Design + Phase 3 implementation
- **Impact**: Complete automation with divergence detection
- **Risk**: High (architectural implications)

---

## Files Analyzed

### Architecture & Configuration

- `.architecture/manifest.yaml` (807 lines)
- `.architecture/generator.config.yaml` (136 lines)
- `AGENTS.md` (365 lines)

### SyncEngine & Generators

- `packages/sync/src/sync-engine.ts` (403 lines) — Main orchestrator
- `packages/sync/src/types/manifest.ts` (314 lines) — Type definitions
- `packages/sync/src/generators/` (4 files) — Existing generators

### Project Generation

- `packages/project-generation/src/infrastructure/adapters/external-sync-engine.adapter.ts` (375 lines)
- `packages/sync/src/commands/arch/*/persistence.ts` — Manifest serialization

### Architectural Decisions

- ADR-0002 — SyncEngine Structural Fixes
- ADR-0014 — Code Generation as Post-Bootstrap (KEY)
- ADR-0003 — External Project Generation MVP
- ADR-0010 — MCP Server Architecture

---

## Implementation Checklist (Phase 1)

- [ ] Create `packages/sync/src/generators/ownership-registry.ts`
- [ ] Implement manifest port discovery function
- [ ] Implement registry sync logic
- [ ] Add error handling and logging
- [ ] Integrate into bootstrap sequence
- [ ] Write tests
- [ ] Update SyncEngine.run() to call new generator
- [ ] Test with real manifest
- [ ] Update `yarn sync` output to show registry syncs
- [ ] Document in `.architecture/README.md`

---

## Key References

### Core Architecture Patterns

- **Hexagonal Architecture**: All ports are contracts, adapters implement them
- **Manifest-First**: Architectural intent defined before code exists
- **Generator-Aware**: Code is auto-generated FROM manifest, not vice versa

### Invariants (from AGENTS.md Section 7)

1. composite-safety — Cross-package refs use dist/ only
2. barrel-ownership-boundary — Barrels can't re-export across packages
3. port-single-ownership — Each port belongs to exactly one context
4. dependency-consistency — Imports must be in package.json
5. self-import-prevention — No package imports itself by name
6. signature-synchronization — Port signatures match canonical definition
7. no-empty-stubs — No `export {};` in barrels
8. exports-field-mandatory — package.json must have exports map
9. test-double-parity — Test doubles implement port interfaces exactly

### Related CLI Commands

```bash
yarn sync              # Run SyncEngine with default settings
yarn sync --dry-run    # Preview changes
yarn sync --force      # Overwrite non-generated files
yarn sync --allow-dirty # Skip git clean check
yarn lint:arch         # Run architectural linter
```

---

## Questions for Follow-Up

1. **Should ownership registry auto-update every `yarn sync`, or only on demand?**
   → Recommend: Every sync (ensures consistency)

2. **If code diverges from manifest, should sync fail or just warn?**
   → Recommend: Warn + continue (manifest is source of truth, but don't block)

3. **Should structure report be JSON, YAML, or human-readable text?**
   → Recommend: All three (JSON for tooling, human for review)

4. **How to handle legacy projects without complete manifests?**
   → Recommend: Graceful degradation (skip validation, warn user)

5. **Should Phase 3 auto-generate missing manifest entries or just warn?**
   → Recommend: Warn only (keep manifest-first philosophy)

---

## Conclusion

The manifest is **intentionally manual** (per ADR-0014) to ensure architectural intent is explicit. Rather than auto-generate it, recommend adding tooling to:

1. **Eliminate sync pain** (Phase 1 registry auto-sync)
2. **Detect divergence** (Phase 2 structure validation)
3. **Validate bidirectionally** (Phase 3 AST-based discovery)
4. **Support full automation** (Phase 4 bidirectional sync)

This approach respects the existing architecture while reducing manual overhead.

---

## Document Versions

- **Version 1.0**: Initial investigation (2026-04-21)
- **Generated**: Comprehensive analysis of 30+ source files
- **Confidence Level**: High (code-backed analysis, cross-referenced with ADRs)

---

**Next Steps**: Review Phase 1 recommendations and confirm ownership registry auto-sync design before implementation.
