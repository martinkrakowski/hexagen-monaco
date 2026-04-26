# Frozen Package: @hexagen/architectural-enforcement

**Status:** Frozen as of April 25, 2026 (Phase 4 architectural remediation)

## Why This Package Was Frozen

- **Aspirational scaffold** — marked as "scaffold" status in manifest
- Zero runtime responsibility; not imported elsewhere
- Tooling should live in `/tools/` or within other packages, not in `/packages/`
- Package philosophy: packages contain domain/application code, not build tools

## What Was Preserved

- (Empty placeholder scaffold — no code implementation)

## Recommended Disposition

**Delete or keep as documentation artifact only.** Architectural enforcement tooling should live in:

- **ESLint plugins:** `packages/eslint-plugin-ui/` (where UI token compliance rules live)
- **Linter infrastructure:** `tools/arch-linter/` (where boundary checks and manifest validation live)
- **CI/CD:** Integrated into `yarn lint:arch` command via sync package

## Future Path if Reactivation Needed

If a new architectural tool is needed:

1. Decide whether it's UI enforcement (goes to `eslint-plugin-ui`)
2. Decide whether it's structural validation (goes to `tools/arch-linter`)
3. Or create new dedicated package if scope warrants it

## Frozen Date

2026-04-25 | Status: Awaiting architecture cleanup decision (low priority)
