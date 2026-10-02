# @hexagen/tui

Ink terminal control plane for HexaGen.

## Architecture view (default)

```sh
yarn workspace @hexagen/tui dev
```

Navigation tree, rule engine and violation inspector, backed by the local MCP
server (`packages/mcp-server/dist/cli.js`). Keys: `j/k` move, `Tab` switch pane,
`r` request an agent remediation, `u` refresh, `q` quit.

## Brownfield view (`--brownfield`)

```sh
yarn workspace @hexagen/tui dev --brownfield [--workspace-root <dir>]
```

A read-only projection of a client repo's `.hexagen/` directory. `--workspace-root`
defaults to the current directory. It works from any checkout: it never starts
or needs the MCP server.

Three panes:

- **Slice**: `paths`, `excludes`, the commit, and whether `observed.json` exists
  and its edge list is complete (`edgesComplete`).
- **Grant**: the files in `.hexagen/grants/*.json`; pick one with `j/k`. The
  detail is the output of `hexagen grant show <file>` (the `hexagen` CLI must be
  on `PATH`), including the signature status and the key's path and fingerprint.
  Signature verification lives in `@hexagen/sync`, so the view shells out rather
  than duplicate it.
- **Trace tail**: the last 20 lines of `.hexagen/evidence/trace.jsonl` with seq,
  time, tool, halt reason (or `grant_missing`) and a `DENIAL` marker.

A missing or invalid file shows a message in its pane; it never stops the view.

Read-only by construction: this mode has no `r` action, never starts a
proposal, opens no write handles and uses no network. Keys: `Tab` switch pane,
`j/k` pick a grant, `u` reload, `q` quit.
