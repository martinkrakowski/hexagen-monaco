# ADR-0011: Terminal UI Architecture

**Date:** 2026-04-07
**Status:** Accepted
**Type:** Architecture

## Context

We needed a terminal-based user interface that could:

- Display real-time architectural state (navigation tree, violations, rules)
- Connect to the MCP server for live data
- Support keyboard navigation and actions
- Enable the human-AI symbiosis loop (select violation → invoke AI → execute fix)

Key choices involved:

1. **Framework** — Ink (React for CLI) vs pure blessed/blessed-contrib
2. **State management** — Redux vs Zustand vs React Context
3. **Layout** — Single pane vs multi-pane vs split view
4. **Input handling** — Custom key handlers vs library abstraction
5. **Live updates** — Polling vs file watching vs event subscription

## Decision

**Use Ink + Zustand with a three-pane layout, keyboard-driven navigation, and fs.watch for live updates.**

### Key Implementation Decisions

1. **Ink framework** — Ink is React for CLI. It provides a component model, hooks (`useInput`, `useApp`), and familiar patterns. Chosen over blessed for better componentization and easier future extension.

2. **Zustand for state** — Zustand is lightweight, requires no boilerplate, and works well with React's render model. Chosen over Redux for simplicity and smaller bundle size.

3. **Three-pane layout** — Navigation tree (left), rule engine (top-right), violation inspector (bottom-right). This mirrors typical IDE panels and allows simultaneous viewing of structure + details.

4. **Keyboard navigation** — Custom `useInput` hooks handle `j/k` (up/down), `Tab` (cycle panes), `u` (refresh), `r` (AI refactor), `q` (quit). No mouse support needed.

5. **File watching for live updates** — Use `fs.watch` on `.architecture/manifest.yaml` with debouncing. Changes trigger full state refresh. Avoids polling.

6. **Service layer** — Separate services for MCP client, manifest loading, sync/linter, messaging, and action orchestration. UI components depend on services, not directly on MCP.

## Rationale

- **Component reuse** — Ink's React model allows future decomposition of panes into reusable components.
- **TypeScript support** — Both Ink and Zustand have excellent TypeScript definitions.
- **Keyboard-first** — Terminal users expect keyboard control; mouse in terminals is inconsistent.
- **Live architecture** — File watching + debounce provides near-realtime updates without polling overhead.
- **Separation** — Services are testable independently; UI is declarative.

## Risks

- **Ink compatibility** — Ink is relatively new; API surface may change.
- **ANSI rendering** — Terminal rendering varies across environments; some layouts may break on older terminals.
- **Key conflicts** — Custom key handling may conflict with terminal emulators' own shortcuts.
- **fs.watch reliability** — `fs.watch` behavior varies across OS (macOS uses FSEvents, Linux uses inotify).

## Consequences

### Positive

- Clean separation between UI and business logic
- Zustand store is easily inspectable and debuggable
- Keyboard navigation is fast and terminal-native
- Live updates work without user intervention
- MCP client is reusable (TUI and external agents use same code)

### Negative

- Ink adds React runtime overhead in CLI
- Three-pane layout requires careful terminal size detection
- No mouse support limits usability on some terminals

## Implementation Notes

### Package Structure

```
apps/tui/
├── src/
│   ├── index.tsx              # Main Ink app + keybindings
│   ├── state/
│   │   └── use-tui-store.ts   # Zustand store
│   └── services/
│       ├── mcp-client.service.ts      # stdio MCP client
│       ├── manifest-service.ts        # Load nav tree
│       ├── sync-service.ts           # Load linter report
│       ├── messaging-service.ts      # File watching
│       └── action.service.ts          # AI refactor flow
```

### Keyboard Bindings

| Key       | Action                                |
| --------- | ------------------------------------- |
| `j` / `k` | Navigate up/down in current pane      |
| `Tab`     | Cycle focus between panes             |
| `u`       | Refresh all data (re-fetch resources) |
| `r`       | Invoke AI on selected violation       |
| `q`       | Quit TUI                              |

### Service Responsibilities

- **MCPClientService** — Wraps `@modelcontextprotocol/sdk` client, connects over stdio
- **ManifestService** — Parses manifest, builds navigation tree structure
- **SyncService** — Calls linter, returns violation list
- **MessagingService** — Watches manifest.yaml, debounces changes, notifies store
- **ActionService** — Takes violation → builds LLM prompt → calls MCP tool → refreshes

### Live Update Flow

1. `messaging-service.ts` watches `.architecture/manifest.yaml`
2. On change, debounce 300ms, then emit "refresh" event
3. TUI store listens, triggers `loadAllData()`
4. `loadAllData()` calls MCP resources and updates Zustand state
5. UI re-renders with fresh data

## References

- Ink docs: https://github.com/vadimdemedes/ink
- Zustand docs: https://github.com/pmndrs/zustand
- `packages/mcp-server/` — MCP server this TUI connects to
- `apps/tui/src/index.tsx` — Main TUI implementation
- `apps/tui/src/services/action.service.ts` — AI refactor orchestration
