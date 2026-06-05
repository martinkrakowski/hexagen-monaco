# Template: `mcp-server-http` (author / agent guide)

> Not emitted. This documents how the template is built so a future agent can
> extend it without re-deriving the design. The user-facing install steps live
> in `manifest.json`'s `checklist`.

HTTP-transport + auth addon for [`mcp-server`](../mcp-server/README.md). Splitting
HTTP out of the base does two things: it keeps the auth/transport prompt noise
out of stdio installs, and it makes the network transport **always
authenticated** — the unsafe `auth=none` combination is structurally excluded
(no such option) rather than rejected at prompt time.

## Why this is a factory addon, not a `server.ts` rewrite

`docs/planning/generator-templates/18-mcp-server.md` (Template 2) predates the
base and describes re-emitting `server.ts` with an HTTP branch. **It is stale.**
The base shipped with the `registerTransport(factory)` seam its own Risk #4
asked for, so this addon uses the seam:

- **`server.ts` is untouched.** `startServer()` already dispatches on
  `MCP_TRANSPORT` via the transport-factory registry.
- **`transport/register-transports.ts` is re-emitted** with both `stdio` and
  `streamable-http` registrations — the seam's documented extension point. It is
  a 3-line declarative file, so the overwrite's blast radius is minimal; a
  user-edited copy is preserved as `.hexagen-update`.
- **The startup guard runs inside `createHttpTransport()`** (lazy), not in the
  composition root — so stdio deployments pay nothing and importing the module
  in a test never trips it.

## Auth wiring (the `{auth}` interpolation)

`auth` is a select (`bearer` | `oauth`, no `none`). Only the chosen
implementation is emitted (gated outputs), and `http.ts` imports it via the
reserved-var seam: the source line

```ts
import { authenticate } from "../auth/{auth}.js";
```

interpolates to `../auth/bearer.js` or `../auth/oauth.js`. This is
install-time-fixed by design: only the selected strategy ships, so the unused
one is never a bundle/attack surface. `MCP_AUTH_MODE` does not switch the auth
_implementation_ (that is fixed at install via the gated file) — but it IS read
at startup by `guard.ts` (unset/`none` over HTTP → refuse to start). Changing the
actual mechanism means re-installing; if a runtime switch is ever required,
promote to a runtime auth registry mirroring the transport seam (the gated-file
structure does not block that).

Both `bearer.ts` and `oauth.ts` export `authenticate(req): Promise<boolean>`.
`bearer` does a constant-time token compare against `MCP_BEARER_TOKEN`. `oauth`
is a **fail-closed scaffold**: it denies all requests until you wire JWKS
verification (the `jose` snippet is in the file). A scaffold that returned `true`
would be dangerously misleading, so the default is deny.

Each module also exports **`assertConfigured()`**, called once at startup from the
HTTP factory (`http.ts`), which throws if the chosen mode's secret
(`MCP_BEARER_TOKEN` / `MCP_OAUTH_ISSUER_URL`) is unset — turning a silent
deny-all into a loud startup error. (The manifest's `envVars` intentionally lists
only the always-required `MCP_TRANSPORT`/`MCP_HTTP_PORT`/`MCP_AUTH_MODE`; the
secrets are conditional on `auth`, so listing both would make
`validate-templates` flag the unused mode's secret. A schema for conditional env
vars would be the proper static fix — an engine follow-up, not this addon.)

## Deliberate deviations from the planning doc

- **`server.ts` is not re-emitted** (seam, above).
- **`MCP_ALLOWED_TOOLS` is documented but NOT enforced.** Tool-level
  allowlisting filters tool dispatch, which lives in the base tool registry and
  applies to every transport — it does not belong in a transport addon. The env
  var is reserved with a loud "not yet enforced" note; enforcing it is a base
  follow-up.

## Files

| Output                             | Notes                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport/http.ts`                | StreamableHTTP factory (`StreamableHTTPServerTransport`, dynamic import, stateless); guards, then authenticates each request before `handleRequest` |
| `transport/register-transports.ts` | **re-emit** — registers stdio + streamable-http                                                                                                     |
| `guard.ts`                         | `assertSafeTransport` — refuses streamable-http without an auth mode                                                                                |
| `auth/bearer.ts` / `auth/oauth.ts` | gated on `auth`; `http.ts` imports the chosen one via `{auth}`                                                                                      |
| `*.test.ts` (guard, bearer, oauth) | `node:test`; pattern-gated behind `--with-tests` (`99-gap-analysis.md`)                                                                             |
| `.env.mcp-http.example`            | `MCP_HTTP_PORT`/`MCP_AUTH_MODE` seeded from the answers                                                                                             |

## SDK

`@modelcontextprotocol/sdk` **v1** — `server/streamableHttp.js` →
`StreamableHTTPServerTransport` (verified against the installed `1.29.0`, not
external docs; the repo's own server is stdio-only so there was no in-repo
ground truth for the HTTP subpath). Dynamically imported per ADR-0010.

## Verify

```bash
# emit shape (this repo)
yarn --cwd packages/template-engine test
# runtime (a generated project, SDK installed)
MCP_TRANSPORT=streamable-http MCP_AUTH_MODE=bearer MCP_BEARER_TOKEN=dev npx tsx bin/cli.ts
```
