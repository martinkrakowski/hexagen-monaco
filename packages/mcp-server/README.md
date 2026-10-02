# @hexagen/mcp-server

The Hexagen MCP server (`hexagen-mcp --workspace-root <repo>`). It exposes the
architecture tools and resources over MCP. Two of its tools are gated by a
signed Grant (`docs/kernel/GRANT.md`) and leave Trace evidence
(`docs/kernel/TRACE.md`).

## `hexagen_propose_patch` (client repos, propose-only)

Input: `patch` (a git-style unified diff), `grant` (the signed Grant) and an
optional `goal_id`.

The tool **proposes only**. It never applies the patch and never writes to the
working tree. An allowed patch is stored as `.hexagen/proposals/<id>.patch`
(with `<id>.json` beside it), and the FDE applies it:

```sh
git apply -p1 .hexagen/proposals/<id>.patch
```

Every touched path (both sides of a rename or copy) must be allowed by the
grant (its `tools` must name `hexagen_propose_patch`) and must lie inside
`.hexagen/slice.json`, checked again on the on-disk spelling of the path.
Symlink and submodule modes, binary patches and patches over 1 MiB are
refused. Every call, allowed or denied, appends a line to
`.hexagen/evidence/trace.jsonl`. The checks and their order are in
`docs/kernel/GRANT.md`.

## `hexagen_accept_transaction`

Applies a pending manifest mutation after the same signature and window
checks, plus the grant's mode, tool, context and path scope.
