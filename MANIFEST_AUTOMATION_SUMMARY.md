# Manifest Automation: Quick Reference

## Current State

- **Manifest Authoring**: 100% manual
- **Generator Direction**: Manifest → Code (one-way)
- **Code Discovery**: None (no AST introspection)
- **Ownership Registry**: Manual (aspirational auto-update missing)

## What Works Now

| Item                                       | Auto-Generated?      | Who Updates It        |
| ------------------------------------------ | -------------------- | --------------------- |
| `manifest.yaml`                            | ❌ No                | Developers/Architects |
| `package.json` (per package)               | ✅ Yes (`yarn sync`) | SyncEngine            |
| `tsconfig.json` (per package)              | ✅ Yes (`yarn sync`) | SyncEngine            |
| Barrel files (`index.ts`)                  | ✅ Yes (`yarn sync`) | SyncEngine            |
| `generator.config.yaml` ownership-registry | ❌ No                | Manual edit           |

## Quick Win: Auto-Sync Ownership Registry

**Problem**: Developers must manually update both:

1. `manifest.yaml` (add new port)
2. `generator.config.yaml` (add port ownership entry)

**Solution**: Create `generators/ownership-registry.ts` that:

- Walks manifest for all declared ports
- Cross-references with `generator.config.yaml`
- Auto-adds/flags discrepancies
- Runs during `yarn sync`

**Effort**: ~2-3 hours
**Impact**: Eliminates most common manual sync pain point

## Medium Effort: Structure Validation Report

**Problem**: No way to detect manifest ↔ code divergence early

**Solution**: Create `generators/structure-report.ts` that:

- For each bounded context, scan `packages/{name}/src/`
- Compare against manifest declaration
- Report missing/extra files
- Output JSON/YAML summary

**Effort**: ~3-4 hours
**Impact**: Early detection of architecture drift

## Higher Effort: AST-Based Port Discovery

**Problem**: If developer adds new port without updating manifest, system doesn't catch it

**Solution**: Use `ts-morph` to:

- Parse all port definitions
- Extract interface names
- Validate against manifest
- Generate discrepancy report

**Effort**: ~8-10 hours
**Impact**: Bidirectional manifest ↔ code validation

## Architecture Philosophy

Per ADR-0014:

> "Project generation creates a structural skeleton only."

The manifest is intentionally the architectural CONTRACT FIRST. Code generation comes as a separate lifecycle event. This is by design:

- Ensures architectural intent is explicit
- Avoids auto-generating code that might not match user intent
- Keeps bootstrap phase fast and responsive

**Therefore**: Recommend staying with "manifest-first" philosophy, but add tooling to detect divergence.

## Key Files for Reference

| File                                  | Lines | Purpose                         |
| ------------------------------------- | ----- | ------------------------------- |
| `.architecture/manifest.yaml`         | 807   | Architecture contract (manual)  |
| `.architecture/generator.config.yaml` | 136   | Invariants + ownership registry |
| `packages/sync/src/sync-engine.ts`    | 403   | Main generator orchestrator     |
| `packages/sync/src/types/manifest.ts` | 314   | Manifest type definitions       |
| `AGENTS.md`                           | 365   | Agent interaction patterns      |

## Files Without Implementation

These are mentioned in docs but not yet implemented:

- `generators/ownership-registry.ts` — Auto-sync registry
- `generators/structure-report.ts` — Divergence detection
- `generators/port-discovery.ts` — AST-based validation
- `mvk/drift-report-v1.md` — Drift detection output
