/**
 * The architectural-integrity CI workflow auto-injected into generated
 * projects. Greenfield and brownfield share one surface: the in-repo
 * `hexagen-conformance` composite action (hexagen-lint --ratchet +
 * sync --check, per-PR baseline diff, silent when clean).
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
 *
 * Version pin: this workflow is the 0.10.0 unpublished contract. The published
 * 0.9.0 tarball does not include --pr-diff / report / adopt. Do not tag a
 * vX.Y.Z release from this change.
 */
export const SYNC_INTEGRITY_WORKFLOW_PATH =
  ".github/workflows/sync-integrity.yml";

export const HEXAGEN_CONFORMANCE_ACTION_YML_PATH =
  ".github/actions/hexagen-conformance/action.yml";

export const HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH =
  ".github/actions/hexagen-conformance/post-comment.mjs";

/**
 * `${{ }}` is GitHub Actions interpolation — escaped so this file stays a
 * JS template literal.
 */
export const SYNC_INTEGRITY_WORKFLOW = `name: "Architectural Integrity"

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

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

      # 0.10.0 unpublished contract: hexagen-lint --ratchet + yarn sync:check
      # with per-PR baseline diff. The published 0.9.0 tarball does not have
      # --pr-diff / report / adopt — this workflow is emitted by the 0.10.0 tree.
      - name: "Hexagen Conformance"
        uses: ./.github/actions/hexagen-conformance
        with:
          lint-command: yarn hexagen-lint --ratchet
          check-command: yarn sync:check
`;

export const HEXAGEN_CONFORMANCE_ACTION_YML = `# Hexagen conformance composite action.
#
# Contract version: 0.10.0 (unpublished). Pin by commit SHA until 0.10.0 is
# published. The published 0.9.0 tarball does NOT include adopt, report, or
# per-PR baseline diffing.
name: "Hexagen Conformance"
description: >
  Run hexagen-lint --ratchet (per-PR baseline diff + machine-enforced
  baseline growth) and hexagen sync --check. Comments only THIS PR's new
  violations; silent when clean.

inputs:
  lint-command:
    description: Shell command that runs the linter.
    required: false
    default: "hexagen-lint --ratchet"
  check-command:
    description: Shell command for the sync drift gate.
    required: false
    default: "hexagen sync --check"
  skip-sync-check:
    description: Set "true" to run only the linter.
    required: false
    default: "false"
  github-token:
    description: Token used to post or update the PR comment.
    required: false
    default: \${{ github.token }}
  working-directory:
    description: Working directory for the lint and check commands.
    required: false
    default: "."

runs:
  using: composite
  steps:
    - name: Fetch PR base ref
      if: github.event_name == 'pull_request'
      shell: bash
      run: |
        set -euo pipefail
        git fetch --no-tags --prune --depth=1 origin "\${{ github.base_ref }}"

    - name: Run hexagen-lint --ratchet
      id: lint
      shell: bash
      working-directory: \${{ inputs.working-directory }}
      run: |
        set -euo pipefail
        COMMENT_FILE="\${RUNNER_TEMP:-/tmp}/hexagen-conformance-comment.md"
        echo "comment_file=$COMMENT_FILE" >> "$GITHUB_OUTPUT"
        : > "$COMMENT_FILE"
        extra=()
        if [ "\${{ github.event_name }}" = "pull_request" ]; then
          extra+=(--pr-diff --base-ref "origin/\${{ github.base_ref }}" --comment-file "$COMMENT_FILE")
        fi
        # shellcheck disable=SC2086
        \${{ inputs.lint-command }} "\${extra[@]}"

    - name: Run hexagen sync --check
      if: inputs.skip-sync-check != 'true'
      shell: bash
      working-directory: \${{ inputs.working-directory }}
      run: |
        set -euo pipefail
        # shellcheck disable=SC2086
        \${{ inputs.check-command }}

    - name: Comment only this PR's violations
      if: always() && github.event_name == 'pull_request'
      shell: bash
      env:
        GITHUB_TOKEN: \${{ inputs.github-token }}
        COMMENT_FILE: \${{ steps.lint.outputs.comment_file }}
        GH_REPO: \${{ github.repository }}
        PR_NUMBER: \${{ github.event.pull_request.number }}
      run: |
        set -euo pipefail
        node "\${{ github.action_path }}/post-comment.mjs"
`;

export const HEXAGEN_CONFORMANCE_COMMENT_SCRIPT = `#!/usr/bin/env node
import { readFileSync } from "node:fs";

const MARKER = "<!-- hexagen-conformance -->";

const token = process.env.GITHUB_TOKEN ?? "";
const repo = process.env.GH_REPO ?? "";
const pr = process.env.PR_NUMBER ?? "";
const file = process.env.COMMENT_FILE ?? "";

if (!token || !repo || !pr) {
  process.stderr.write(
    "hexagen-conformance: missing GITHUB_TOKEN / GH_REPO / PR_NUMBER — skipping comment\\n",
  );
  process.exit(0);
}

let body = "";
try {
  body = readFileSync(file, "utf8");
} catch {
  body = "";
}

const api = \`https://api.github.com/repos/\${repo}\`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: \`Bearer \${token}\`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hexagen-conformance",
};

async function listComments() {
  const res = await fetch(\`\${api}/issues/\${pr}/comments?per_page=100\`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(\`list comments \${res.status}\`);
  }
  return /** @type {Array<{ id: number; body?: string }>} */ (await res.json());
}

const comments = await listComments();
const existing = comments.find((c) => (c.body ?? "").includes(MARKER));

if (!body.trim()) {
  if (existing) {
    const del = await fetch(\`\${api}/issues/comments/\${existing.id}\`, {
      method: "DELETE",
      headers,
    });
    if (!del.ok && del.status !== 404) {
      process.stderr.write(
        \`hexagen-conformance: could not delete stale comment (\${del.status})\\n\`,
      );
    }
  }
  process.exit(0);
}

if (existing) {
  const res = await fetch(\`\${api}/issues/comments/\${existing.id}\`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    process.stderr.write(
      \`hexagen-conformance: could not update comment (\${res.status})\\n\`,
    );
  }
} else {
  const res = await fetch(\`\${api}/issues/\${pr}/comments\`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    process.stderr.write(
      \`hexagen-conformance: could not post comment (\${res.status})\\n\`,
    );
  }
}
`;

export function hexagenConformanceActionFiles(): ReadonlyArray<{
  path: string;
  content: string;
}> {
  return [
    {
      path: HEXAGEN_CONFORMANCE_ACTION_YML_PATH,
      content: HEXAGEN_CONFORMANCE_ACTION_YML,
    },
    {
      path: HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH,
      content: HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
    },
  ];
}

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
