# Architectural Governance Debt

**Status:** Living document  
**Machine index:** (no longer maintained in docs; agents should reference historical versions in git if needed)  
**Last reviewed:** 2026-05 (reorganization)

This is the primary human-readable register of **architectural governance and boundary enforcement debt**.

## Scope

This document tracks debt related to:
- Architectural boundaries and layer rules
- Subpath conventions (server vs client)
- Server-only code enforcement markers
- Manifest schema hygiene
- Linter configuration and enforcement

## Current OPEN Items

_(none)_

## Recently Resolved Work

See the [Resolved Archive](resolved/arch-linter-2026-05.md) for the major items resolved during the Arch-Linter v2 improvements (May 2026), including:

- DEBT-001: local-llm subpath normalization
- FEAT-001: subpath_conventions enforcement
- FEAT-002: @hexagen-server-only marker enforcement
- FEAT-003: Removal of dead manifest schema

## How to Add Items

Follow the same process as other planning documents: propose via ADR when significant, maintain rich entries here, and archive resolved items.
