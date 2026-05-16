# ADR-0010: Increase DESCRIPTION_MAX_LENGTH from 2000 to 50000

## Status

Proposed

## Context

The `DESCRIPTION_MAX_LENGTH` value object in `@hexagen/core` was increased from 2000 to 50000 characters to support longer project descriptions in the AI generation pipeline. This change was made without documentation, and impacts LLM token costs and prompt sizes.

## Decision

Increase the maximum allowed project description length to 50000 characters to:

1. Support detailed project specifications for structured config imports
2. Allow richer context for AI manifest generation
3. Align with increased LLM context windows (GPT-4o: 128k tokens, Claude 3.5 Sonnet: 200k tokens)

## Consequences

- **Positive**: Enables more detailed project descriptions for better AI generation results
- **Negative**: Increased token costs for AI generation calls (each 50000 char description ≈ 12.5k tokens)
- **Mitigation**: Client-side char counter now shows 50000 limit; prompt engineering will truncate descriptions to 10k tokens max for LLM calls

## Compliance

- Updated `project-description.ts` value object to use 50000 limit
- Client-side `DescriptionInput` component updated to reflect new limit
- No changes to existing AI generation pipelines (they already handle long inputs via truncation)
