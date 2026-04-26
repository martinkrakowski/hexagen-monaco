# @hexagen/sync

> The HexaGen Monaco sync engine — a CLI that generates and maintains modular, Hexagonal-architecture monorepos from a single `manifest.yaml`.

---

## Installation

```bash
npm install @hexagen/sync
# or
yarn add @hexagen/sync
# or
pnpm add @hexagen/sync
```

`@hexagen/sync` ships as a self-contained ESM package with only two runtime
dependencies (`commander`, `js-yaml`). All internal HexaGen packages
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

---

## Programmatic Usage

The default export exposes the sync-engine surface used by the CLI. Types
ship alongside the bundle.

```ts
import { runSync } from "@hexagen/sync";

await runSync({ mode: "external", workspaceRoot: process.cwd() });
```

The package is ESM-only (`"type": "module"`). Consumers that still use
CommonJS must use dynamic `import()` or transpile via their bundler.

---

## Requirements

| Requirement | Version                              |
| ----------- | ------------------------------------ |
| Node.js     | ≥ 20                                 |
| Module kind | ESM (`"type": "module"` in consumer) |

---

## What's Bundled

When `@hexagen/sync` is published, the tarball contains the sync engine
plus four inlined workspace packages:

| Bundled package                  | Purpose                                    |
| -------------------------------- | ------------------------------------------ |
| `@hexagen/governance`            | Linter report schemas and invariant rules  |
| `@hexagen/project-configuration` | Manifest + project spec schemas            |
| `@hexagen/shared`                | Shared value objects, logger, result types |
| `@hexagen/visualization`         | Architecture graph schemas                 |

Bundling is handled at build time by [`tsup`](https://tsup.egoist.dev/) and
is codified in [`.architecture/decisions/ADR-0009-published-cli-bundling.md`](../../.architecture/decisions/ADR-0009-published-cli-bundling.md).

### Runtime Dependencies (not bundled)

| Package     | Version   | Why it stays external                  |
| ----------- | --------- | -------------------------------------- |
| `commander` | `^14.0.3` | Stable CLI arg parser; semver-stable   |
| `js-yaml`   | `^4.1.0`  | Manifest parsing; widely-consumed peer |

Both are pulled in transitively through standard `npm install` resolution
when `@hexagen/sync` is installed.

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
- **Architecture Decision Record:** [`ADR-0009`](../../.architecture/decisions/ADR-0009-published-cli-bundling.md) — CLI Bundling Strategy
- **Manifest schema:** `@hexagen/project-configuration`
- **Issue tracker:** https://github.com/martinkrakowski/hexagen-monaco/issues

---

## License

MIT
