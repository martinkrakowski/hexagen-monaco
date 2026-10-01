# @hexagen-monaco/sync

> The Hexagen-Monaco sync engine — a CLI that generates and maintains modular, Hexagonal-architecture monorepos from a single `manifest.yaml`.

---

## Installation

```bash
npm install @hexagen-monaco/sync
# or
yarn add @hexagen-monaco/sync
# or
pnpm add @hexagen-monaco/sync
```

`@hexagen-monaco/sync` ships as a self-contained ESM package with only two runtime
dependencies (`commander`, `js-yaml`). All internal Hexagen-Monaco packages
(`@hexagen/governance`, `@hexagen/project-configuration`,
`@hexagen/shared`, `@hexagen/visualization`) are bundled into the published
artifact — consumers never see them in their `node_modules`.

---

## CLI Usage

The package installs a single binary, `hexagen`:

```bash
# Show top-level help
npx hexagen --help

# Run the sync engine against your manifest
npx hexagen sync

# Manage the architecture manifest
npx hexagen arch --help
```

### Typical Workflow

```bash
# 1. Add a bounded context to your manifest
npx hexagen arch context add billing --type=core

# 2. Declare a port on that context
npx hexagen arch port add --context=billing --name=InvoiceRepository --direction=out

# 3. Run sync to regenerate the monorepo artifacts
npx hexagen sync
```

Consult `npx hexagen arch --help` for the full list of manifest operations.

### `hexagen grant issue`

Mints a signed Grant — the file `hexagen_accept_transaction` trusts as its
`grant` argument (see `docs/kernel/GRANT.md`). Local, no server:

```bash
npx hexagen grant issue \
  --principal martin \
  --agent lane-ow3b \
  --paths .architecture/,packages/billing/ \
  --tools hexagen_accept_transaction,hexagen_create_port \
  --mode write \
  --expires-in 4h \
  --out .hexagen/grants/<id>.json
```

Signs with the HMAC-SHA256 key at `.hexagen/grant-signing.key` (created on
first use if missing, with a `.gitignore` entry added for it — never commit
it; the key must be a full 32-byte hex value, so a hand-edited or truncated
key file is rejected rather than silently used). `--contexts
<name[,name...]>` is a monaco-only convenience: it looks each name up in
`manifest.yaml` and expands it to `packages/<name>/`, appended to `--paths`.

`hexagen_accept_transaction`'s enforcement (`checkMutationAgainstGrant`)
requires `grant.contexts` to independently name every context a mutation
targets — a grant's `paths` alone never satisfies that check, and an empty
`contexts` denies everything. So the CLI also reverse-matches any
`packages/<name>/` prefix already present in `--paths` against the
manifest, folding matching names into `grant.contexts` automatically
(`--contexts` can usually be omitted when `--paths` already names the
context's package directory, as in the example above). Symmetrically,
`.architecture/` — the one path every manifest mutation actually writes
through — is always added to the grant's `paths` whenever it authorizes any
context, so `--contexts` alone is enough without repeating
`.architecture/` in `--paths`. This reconciliation only works where a
manifest exists: a grant that names no context at all (no manifest to
derive contexts from, and no `--contexts` given) is paths-only in the
literal sense, but since every manifest-mutation tool's enforcement
requires a context match, such a grant cannot authorize any of those seven
tools — it is scoped only for a future, generic Field Kit adapter that
doesn't check `contexts`, not for `hexagen_accept_transaction` as it exists
today. Prints the grant JSON to stdout, or to `--out <file>` if given.

---

## Programmatic Usage

> **The supported contract of this package is the `hexagen` binary.** The root
> barrel below is **provisional under 0.x** (ADR-0056): names may be withdrawn,
> and a withdrawal rides a **minor** — never a patch — and is listed by name in
> that release's `CHANGELOG.md` section. Programmatic use is permitted and
> unsupported. Prefer the CLI unless you are embedding the engine.
>
> _(Before 0.10.0 this section documented a `runSync` function. No such export
> has ever existed — the example was wrong for the life of the package.)_

The barrel exposes the engine the CLI drives. Types ship alongside the bundle.

```ts
import { SyncEngine, type LoggerPort } from "@hexagen-monaco/sync";

const logger: LoggerPort = {
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
  errorWithException: (err, message) => console.error(message, err),
};

const dryRun = false;

const engine = new SyncEngine(
  {
    mode: "external", // 'external' honours the workspace root you give it
    dryRun,
    force: false,
    forceRoot: false,
    allowDirty: false,
    strict: false,
    logger,
  },
  { targetRoot: process.cwd() },
);

const summary = await engine.run();

// `run()` RESOLVES when a generator fails soft — it does not throw. Check the
// count, or a partial tree reads as success.
if (summary.errors > 0) {
  throw new Error(`sync finished with ${summary.errors} generator failure(s)`);
}

// Only needed if you set `dryRun: true`. A missing
// `.architecture/manifest.yaml` REJECTS `run()` on a real run, but a dry run
// tolerates it by synthesizing an empty manifest — which plans ops against
// nothing and still resolves with `errors: 0`. That is the same fact the CLI
// gates `--check` on.
if (dryRun && summary.manifestMissing) {
  throw new Error("no .architecture/manifest.yaml in the target workspace");
}
```

The package is ESM-only (`"type": "module"`). Consumers that still use
CommonJS must use dynamic `import()` or transpile via their bundler.

### Workspace resolution modes

How the engine locates the workspace root depends on `mode`:

| Mode         | Root resolution                                                       | Used by                                          |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| `external`   | The explicit `workspaceRoot` you pass (typically `process.cwd()`).    | The published CLI run inside a consumer project. |
| `self-regen` | The workspace of the **package the engine lives in** — _not_ the cwd. | The hexagen monorepo regenerating itself.        |

> **Monorepo footgun (issue #179).** `self-regen` deliberately ignores the
> current directory and walks up from the engine's own location. This is
> correct for the published CLI (installed into your project's `node_modules`,
> it resolves _your_ project) and for the monorepo regenerating itself. But it
> means running the monorepo's **built `dist/cli.js` from an unrelated
> directory targets the monorepo, not that directory** — it will happily
> rewrite the monorepo's files. To operate on another project, always use
> `mode: "external"` with an explicit `workspaceRoot`, never the in-tree
> `dist` CLI. The capstone harness relies on this distinction and guards it.

---

## Requirements

| Requirement | Version                              |
| ----------- | ------------------------------------ |
| Node.js     | ≥ 20                                 |
| Module kind | ESM (`"type": "module"` in consumer) |

---

## What's Bundled

When `@hexagen-monaco/sync` is published, the tarball contains the sync engine
plus four inlined workspace packages:

| Bundled package                  | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `@hexagen/governance`            | Linter report schemas and invariant rules  |
| `@hexagen/project-configuration` | Manifest + project spec schemas            |
| `@hexagen/shared`                | Shared value objects, logger, result types |
| `@hexagen/visualization`         | Architecture graph schemas                 |

Bundling is handled at build time by [`tsup`](https://tsup.egoist.dev/) and
is codified in [`.architecture/decisions/ADR-0068-published-cli-bundling.md`](../../.architecture/decisions/ADR-0068-published-cli-bundling.md).

### Runtime Dependencies (not bundled)

| Package     | Version   | Why it stays external                  |
| ----------- | --------- | -------------------------------------- |
| `commander` | `^14.0.3` | Stable CLI arg parser; semver-stable   |
| `js-yaml`   | `^4.1.0`  | Manifest parsing; widely-consumed peer |

Both are pulled in transitively through standard `npm install` resolution
when `@hexagen-monaco/sync` is installed.

---

## For Maintainers — Publishing

`@hexagen/sync` uses a publish staging flow to avoid contaminating the
source manifest with publish-time mutations. The flow:

```bash
# 1. Build the package (tsup + tsc --emitDeclarationOnly + fix-esm-barrels)
yarn workspace @hexagen/sync build

# 2. Stage the publishable artifact into packages/sync/publish/
yarn workspace @hexagen/sync pack:prepare

# 3. Inspect the staged manifest before packing (optional but recommended)
cat packages/sync/publish/package.json

# 4. Create the tarball from the staging dir
cd packages/sync/publish
npm pack

# 5. (When ready) Publish
npm publish  # reads publish/package.json, not source
```

The staging script (`scripts/prepare-publish-package.js`) is shared and
parameterized — it works for any workspace package that adopts this
pattern.

### What the Staging Script Strips

From the published `package.json`, the script removes:

- `private` (prevents npm publish)
- `devDependencies` (never shipped to consumers)
- `scripts` (reference dev-only paths like `../../scripts`)
- `workspaces`, `packageManager`, `resolutions` (monorepo-only fields)
- Any `dependencies` using the `workspace:*` protocol (they're bundled
  into the output JS at build time)

The source `packages/sync/package.json` is never mutated by this process.

---

## Links

- **HexaGen Monaco repository:** https://github.com/martinkrakowski/hexagen-monaco
- **Architecture Decision Record:** [`ADR-0068`](../../.architecture/decisions/ADR-0068-published-cli-bundling.md) — CLI Bundling Strategy
- **Manifest schema:** `@hexagen/project-configuration`
- **Issue tracker:** https://github.com/martinkrakowski/hexagen-monaco/issues

---

## License

Licensed under the Source-Available Evaluation License. See [LICENSE](./LICENSE).

The Hexagen-Monaco name is a trademark of Krakowski Cloud Solutions, LLC.
