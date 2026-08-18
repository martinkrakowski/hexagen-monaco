# Agent-constraint workflow

How to pin an agent (Claude Code or any MCP client) to one bounded context,
and how edits escalate when they cross a boundary.

This is the differentiator a dependency-cruiser config cannot follow: the
**manifest is the context**, and mutation of that manifest is a transaction
the human accepts.

## Manifest as context

Give the agent:

1. `.architecture/manifest.yaml` (or the split per-context files)
2. The one context it is allowed to touch (`bounded_contexts[].name`)
3. The MCP tools: `hexagen_audit_boundaries`, `hexagen_get_manifest`,
   `hexagen_diff_manifest`, and the transaction family
   (`hexagen_list_transactions`, `hexagen_get_transaction`,
   `hexagen_accept_transaction`, `hexagen_reject_transaction`)

Do **not** grant a blanket "edit any file" loop. The seven structural
mutations (`hexagen_create_context`, `hexagen_add_dependency`,
`hexagen_create_port`, `hexagen_create_adapter`, `hexagen_remove_port`,
`hexagen_remove_context`, `hexagen_scaffold_module`) **propose** a
transaction. They do not write the manifest. A human (or a tightly scoped
approver) runs `hexagen_accept_transaction` after reading the proposal.

## Pin the agent to one context

In the system / project prompt:

> You are working only in the `<context>` bounded context. Do not edit
> files outside `packages/<context>/`. Do not add `depends_on` edges to
> other contexts. If a change requires another context, stop and escalate.

Then run the linter on the staged set before the agent commits:

```bash
hexagen-lint --staged --ratchet
# or, via MCP
hexagen_audit_boundaries
```

A pre-commit hook in this repo invokes `hexagen-lint --staged` when the
linter is built.

## Escalation on cross-boundary edits

| Signal                                                                         | What to do                                                                                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hexagen-lint` reports `cross-package-import` on a file the agent just touched | Stop. The import is not on the context's `depends_on`. Either reject the change or open a transaction (`hexagen_add_dependency`) and wait for accept. |
| The agent wants to create/remove a context or port                             | It must call the matching MCP tool (which only proposes). A human accepts.                                                                            |
| The agent edits two contexts in one turn                                       | Treat as an escalation: split the work, or get an explicit go-ahead that names both contexts.                                                         |
| `hexagen report` shows fresh violations vs the baseline                        | The PR introduced debt. Do not grow the baseline to hide it.                                                                                          |

## Why accept is in the loop

Until Phase 1.4 the mutation tools wrote `manifest.yaml` directly while
`hexagen_accept_transaction` was a parallel family that never ran. That
bypass is closed: accept is the only path those seven tools have to the
write port.
