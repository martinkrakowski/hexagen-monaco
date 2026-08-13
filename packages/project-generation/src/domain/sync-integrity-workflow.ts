/**
 * The architectural-integrity CI workflow auto-injected into generated
 * projects. It runs `yarn sync:check` (the `hexagen sync --check` script every
 * generated project ships) so a project's hexagonal structure stays enforced in
 * CI — the same guarantee this repo gives itself via `.github/workflows/
 * sync-integrity.yml`.
 *
 * History: this was a `WorkflowGenerator` adapter + a `workflow-template.yml`
 * asset until the `f34a8880` ports refactor silently dropped its call site,
 * orphaning the whole chain. Re-wired here as a compiled-in constant — the old
 * asset was never copied into `dist`, so even when wired it resolved to a
 * missing file. A `const` ships with the build, no copy step.
 *
 * Yarn-4 correctness (the old asset got this wrong and a review flagged it):
 *   - Corepack is enabled and the pinned `yarn@4` prepared BEFORE setup-node,
 *     because setup-node's yarn cache probe runs the runner's global Yarn
 *     (Classic 1.x) and errors on a `packageManager`-pinned yarn@4 project;
 *   - setup-node carries NO `cache: "yarn"` AND sets
 *     `package-manager-cache: false` — on setup-node@v5 omitting the cache
 *     input is not enough, the auto-probe still runs (F21);
 *   - install is `yarn install --immutable` (Yarn Berry), not the old
 *     `--frozen-lockfile` (Yarn Classic).
 * Mirrors the live `ci-github-actions` `ci.yml` template, which documents the
 * same hazard.
 */
export const SYNC_INTEGRITY_WORKFLOW_PATH =
  ".github/workflows/sync-integrity.yml";

export const SYNC_INTEGRITY_WORKFLOW = `name: "Architectural Integrity"

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  sync-check:
    name: "Verify Hexagonal Structure"
    runs-on: ubuntu-latest
    steps:
      - name: "Checkout"
        uses: actions/checkout@v5
        with:
          fetch-depth: 0 # the sync engine inspects git history

      # Corepack MUST run before setup-node: setup-node's yarn cache probe runs
      # the runner's global Yarn (Classic) and errors on a packageManager-pinned
      # yarn@4 project. Enabling Corepack first makes \`yarn\` resolve to the
      # pinned shim. (Same reason there is no \`cache: "yarn"\` on setup-node.)
      - name: "Enable Corepack"
        run: corepack enable

      - name: "Prepare package manager"
        run: corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate

      - name: "Setup Node.js"
        uses: actions/setup-node@v5
        with:
          node-version: "22"
          # setup-node@v5 auto-probes the package-manager cache even without
          # \`cache: "yarn"\` — disable it explicitly (F21); the probe runs the
          # global Yarn Classic and fails on a packageManager-pinned project.
          package-manager-cache: false

      - name: "Install Dependencies"
        run: yarn install --immutable

      - name: "Verify Architectural Integrity"
        run: yarn sync:check
`;

/**
 * Auto-inject the workflow only for yarn-based projects. The workflow is
 * yarn-specific (`yarn install --immutable`, `yarn sync:check`), and generated
 * projects default to `yarn@4.12.0`. A `pnpm`/`bun` `packageManager` opts out
 * (no workflow beats a broken one); an absent/blank value is the yarn default.
 */
export function shouldInjectSyncIntegrityWorkflow(
  packageManager?: string,
): boolean {
  const pm = packageManager?.trim();
  if (!pm) return true; // default packageManager is yarn@4
  return /^yarn(@|$)/.test(pm);
}
