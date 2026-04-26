# Frozen Package: @hexagen/code-generation

**Status:** Frozen as of April 25, 2026 (Phase 4 architectural remediation)

## Why This Package Was Frozen

- **Aspirational scaffold** — marked as "scaffold" status in manifest
- Zero runtime responsibility; not imported elsewhere
- Code generation tooling should live in `/tools/` or integrated into CLI, not as a standalone package
- Package philosophy: packages contain domain/application code, not build/generation tools

## What Was Preserved

- (Empty placeholder scaffold — no code implementation)

## Recommended Disposition

**Delete or keep as documentation artifact only.** Code generation infrastructure should live in:

- **Sync CLI:** `packages/sync/` (where code generation commands are orchestrated)
- **Prompt compiler:** `packages/prompt-compiler/` (where LLM prompts are compiled)
- **Project generation:** `packages/project-generation/` (where workspace generation lives)
- **Tooling:** `tools/code-generation/` (if separate generator infrastructure is needed)

## Future Path if Reactivation Needed

If dedicated code generation infrastructure is needed:

1. Determine if it fits in existing prompt-compiler or project-generation
2. Or create new dedicated tooling in `tools/code-generation-cli/`
3. Build against documented CompoundSchema and ProjectSpec types

## Frozen Date

2026-04-25 | Status: Awaiting architecture cleanup decision (low priority)
