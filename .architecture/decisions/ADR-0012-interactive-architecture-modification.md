# ADR-0012: Human-Guided Modification Loop

**Date:** 2026-04-07
**Status:** Accepted
**Type:** Architecture

## Context

The TUI enables humans to view architectural state, but we also wanted to enable automated assistance for fixing violations. The human-guided modification loop allows:

1. Human selects a violation in the TUI
2. Human triggers automated action (presses `r`)
3. The system receives context (violation details, architectural state)
4. The system suggests a fix via MCP tool call
5. The fix is executed through the MCP server
6. UI refreshes to show the result

Key design questions:

1. **How does the system know what to do?** — Prompt engineering with violation context
2. **How does the system execute fixes?** — MCP tools (add dependency, create port, scaffold)
3. **How do we ensure safety?** — Dry-run, confirmation, revert capability
4. **How do we integrate with LLM providers?** — Abstracted LLM port, not hardcoded provider

## Decision

**Implement a prompt-driven action service that sends violation context to an LLM, receives MCP tool suggestions, and executes them through the MCP server.**

### Key Implementation Decisions

1. **Violation-first context** — The prompt includes: violation message, rule ID, file/line, current manifest excerpt, available tools. This gives the LLM everything it needs.

2. **MCP tool as execution primitive** — The system doesn't write code directly. It suggests MCP tool calls (e.g., `hexagen_add_dependency`). The action service executes them.

3. **Dry-run safety by default** — Suggestions run with `dry_run: true` first. Human sees result, confirms, then runs with `dry_run: false`.

4. **LocalLLMProviderAdapter** — Since `@hexagen/agentic-interaction` doesn't export concrete classes, we implement a lightweight adapter that accepts any LLM-compatible API endpoint.

5. **Result feedback loop** — After execution, TUI refreshes data. Success/failure shown in UI. Human can undo or iterate.

## Rationale

- **Clear contract** — MCP tools have typed inputs/outputs. The system can only call what's exposed.
- **Audit trail** — MCP server logs tool calls. Human can trace what was done.
- **Fail-safe** — Dry-run prevents accidental writes. Human approval required for persistence.
- **Extensible** — New MCP tools automatically become available. No code changes needed in TUI.
- **Decoupled** — LLM provider is a port. Can swap OpenAI, Anthropic, local models without changing flow.

## Risks

- **LLM reliability** — LLMs can suggest wrong tools or parameters. Human must verify.
- **Prompt fragility** — Prompt engineering is trial-and-error. Changes to manifest schema may break prompts.
- **Tool coverage** — If a violation can't be fixed with existing tools, the system can't help. Need to expand tools.
- **Token limits** — Large architectural state in prompts may exceed context windows.

## Consequences

### Positive

- Human can get automated help without leaving terminal
- The system operates within architectural constraints (MCP tools)
- Dry-run ensures safety before changes
- System is explainable: each action maps to an MCP tool call
- New tools automatically available (no TUI code changes)

### Negative

- Requires running LLM endpoint (local or cloud)
- Latency: LLM reasoning + MCP execution + UI refresh takes seconds
- Prompt engineering is ongoing maintenance

## Implementation Notes

### Action Flow

```
1. Human selects violation in TUI (keyboard j/k)
2. Human presses 'r' to invoke automated action
3. ActionService.buildPrompt(violation) → full prompt string
4. ActionService.callLLM(prompt) → LLM response with tool suggestion
5. ActionService.parseToolSuggestion(response) → { tool: string, args: object }
6. ActionService.executeMCPTool({ tool, args: { ...args, dry_run: true } })
7. Display result in TUI (dry-run preview)
8. If human confirms → execute with dry_run: false
9. Trigger data refresh → UI updates
```

### Prompt Structure

```markdown
You are an architect assistant. Fix this violation:

Violation:

- Rule: {ruleId}
- Message: {message}
- File: {file}
- Line: {line}

Current architecture:
{manifest excerpt}

Available tools:

- hexagen_add_dependency: Add dependency between modules
- hexagen_create_port: Create port contract
- hexagen_create_adapter: Create adapter
- hexagen_scaffold_module: Create new module

Respond with a JSON object:
{ "tool": "tool-name", "args": { ... } }
```

### Tool Execution

```typescript
// In action.service.ts
const dryRunResult = await mcpClient.callTool({
  name: suggestion.tool,
  args: { ...suggestion.args, dry_run: true },
});

// Display to human
// If confirmed:
const finalResult = await mcpClient.callTool({
  name: suggestion.tool,
  args: { ...suggestion.args, dry_run: false },
});
```

### Port for LLM Integration

```typescript
// In @hexagen/agentic-interaction/src/domain/ports/llm-provider.port.ts
export interface LLMProviderPort {
  complete(prompt: string): Promise<LLMResponse>;
}

// Implemented by LocalLLMProviderAdapter (or OpenAIAdapter, etc.)
```

## References

- `apps/tui/src/services/action.service.ts` — Implementation of action flow
- `apps/tui/src/services/mcp-client.service.ts` — MCP client wrapper
- ADR-0010 — MCP Server Architecture (tools available for modifications)
- ADR-0011 — Terminal UI Architecture (how human interacts)
- `packages/mcp-server/src/infrastructure/adapters/sync-engine.adapter.ts` — What tools actually do
