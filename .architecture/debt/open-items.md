# Open Architecture Debt Items

**Auto-read by:** hexagen agents before modifying `tools/arch-linter` or `packages/local-llm`

**Updated by:** committer when items are resolved or discovered

**Source of truth for items referenced by `TODO: ADR-XXXX` comments in source files**

---

## Human-Readable Remediation Plans

The rich, narrative version of architectural debt and remediation plans now lives in the documentation section:

- **Active & Recently Resolved:** [docs/remediation/debt-register.md](../../docs/remediation/debt-register.md)
- **Historical Archive:** [docs/remediation/resolved/](../../docs/remediation/resolved/)

---

## Current OPEN Items (Machine Index)

_(none)_

See the debt register in `docs/remediation/` for the full human context and any newly discovered items.

---

## Recently Resolved (Summary)

The following high-impact items were resolved during Arch-Linter v2 work (May 2026):

- DEBT-001: local-llm subpath normalization (`/shared` → `/client`)
- FEAT-001: subpath_conventions enforcement
- FEAT-002: `@hexagen-server-only` marker enforcement
- FEAT-003: Removal of dead `manifest-schema.ts`

Full details (origin, resolution steps, linked ADRs) are in the archive under `docs/remediation/resolved/2026-05-debt-archive.md`.

---

**Agents:** Continue to read this file for the fast index. For planning or review work, load the full documents under `docs/remediation/`.
