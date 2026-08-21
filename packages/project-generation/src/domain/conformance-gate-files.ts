/**
 * The conformance gate files — the single source of truth for the
 * architectural-integrity CI gate, shared by **greenfield** (auto-injected
 * into a generated project by `GenerateProjectUseCase`) and **brownfield**
 * (downloaded as a leave-behind bundle by the install-gate route).
 *
 * The surface is the in-repo `hexagen-conformance` composite action
 * (hexagen-lint --ratchet + sync --check, per-PR baseline diff, silent when
 * clean) plus the workflow that calls it.
 *
 * History: this was a `WorkflowGenerator` adapter + a `workflow-template.yml`
 * asset until the `f34a8880` ports refactor silently dropped its call site,
 * orphaning the whole chain. Re-wired as compiled-in constants — the old
 * asset was never copied into `dist`, so even when wired it resolved to a
 * missing file. A `const` ships with the build, no copy step.
 *
 * Lifted out of `sync-integrity-workflow.ts` (which now re-exports every name
 * below verbatim) so the brownfield bundle can reuse the exact bytes the
 * greenfield generator emits, rather than growing a second copy that drifts.
 * The re-export is deliberate: three in-repo call sites — including a deep
 * relative import from `scripts/capstone/generate-fixture.ts`, which lives
 * outside this package — still import from the old path, and a broken import
 * there would fail at runtime rather than at compile time.
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
 * Version pin: this workflow is the 0.11.0 contract. The published 0.9.0
 * tarball does not include --pr-diff / report / adopt.
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

      # 0.11.0 contract: hexagen-lint --ratchet + yarn sync:check with per-PR
      # baseline diff. The published 0.9.0 tarball does not have --pr-diff /
      # report / adopt — this workflow is emitted by the 0.11.0 tree.
      - name: "Hexagen Conformance"
        uses: ./.github/actions/hexagen-conformance
        with:
          lint-command: yarn hexagen-lint --ratchet
          check-command: yarn sync:check
`;

export const HEXAGEN_CONFORMANCE_ACTION_YML = `# Hexagen conformance composite action.
#
# Contract version: 0.11.0. The published 0.9.0 tarball does NOT include
# adopt, report, or per-PR baseline diffing.
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
        # Two-dot git diff base HEAD only needs both tips present, but a
        # depth-1 fetch of the base on a shallow HEAD still cannot resolve
        # objects when the runner checked out a single commit. Unshallow when
        # needed so --pr-diff rename detection can run (fail-closed otherwise).
        if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
          git fetch --unshallow --no-tags --prune origin "\${{ github.base_ref }}"
        else
          git fetch --no-tags --prune origin "\${{ github.base_ref }}"
        fi

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

if (body.trim() && !body.includes(MARKER)) {
  body = \`\${MARKER}\\n\${body}\`;
}

const api = \`https://api.github.com/repos/\${repo}\`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: \`Bearer \${token}\`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "hexagen-conformance",
};

async function listComments() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(
      \`\${api}/issues/\${pr}/comments?per_page=100&page=\${page}\`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(\`list comments \${res.status}\`);
    }
    const batch = /** @type {Array<{ id: number; body?: string }>} */ (
      await res.json()
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
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

/**
 * Options for materializing the gate files.
 *
 * A single optional object rather than positional arguments, so every existing
 * zero-arg call site keeps compiling verbatim.
 */
export interface ConformanceGateFilesOptions {
  /**
   * Prefix applied to each returned `path`. Defaults to `""` — i.e. today's
   * repo-relative paths, unchanged. Pass e.g. `"my-project"` to nest the whole
   * gate under a directory inside a zip.
   */
  readonly pathPrefix?: string;
  /**
   * Append `.github/workflows/sync-integrity.yml` to the returned files.
   *
   * Defaults to **false**, which is the backward-compatibility lever:
   * `GenerateProjectUseCase` already writes `SYNC_INTEGRITY_WORKFLOW` into its
   * own injection map before calling this, so defaulting to `true` would
   * double-write it (and reorder the array the domain test pins).
   */
  readonly includeWorkflow?: boolean;
}

/** A gate file as the callers consume it: a repo-relative path and its bytes. */
export interface ConformanceGateFile {
  readonly path: string;
  readonly content: string;
}

/**
 * Join `pathPrefix` onto a repo-relative gate path. An absent/blank prefix
 * returns the path untouched (the default, and what the three existing call
 * sites depend on); trailing slashes are collapsed so `"out/"` and `"out"`
 * behave identically.
 */
/**
 * Thrown when `pathPrefix` could produce an archive entry outside the
 * extraction root.
 */
export class UnsafePathPrefixError extends Error {
  constructor(pathPrefix: string) {
    super(
      `Unsafe pathPrefix ${JSON.stringify(pathPrefix)}: must be a relative path of ` +
        `[A-Za-z0-9._-] segments, with no "..", no leading "/", and no backslashes.`,
    );
    this.name = "UnsafePathPrefixError";
  }
}

const SAFE_PREFIX_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Prefix an entry path, refusing anything that could escape on extraction.
 *
 * These strings become zip entry names, and `JsZipCreatorAdapter` writes them
 * verbatim — so an unchecked "../" or "/abs" prefix is a zip-slip primitive
 * handed to whoever unzips the bundle. No caller passes untrusted input today,
 * but this is exported API and the cost of being wrong later is borne by the
 * consumer's filesystem, not ours. Rejecting loudly beats silently emitting a
 * traversing entry.
 */
function withPathPrefix(filePath: string, pathPrefix?: string): string {
  const raw = pathPrefix?.trim() ?? "";
  const prefix = raw.replace(/\/+$/, "");
  if (prefix.length === 0) return filePath;

  if (
    prefix.includes("\\") ||
    prefix.includes("\0") ||
    prefix.startsWith("/") ||
    /^[A-Za-z]:/.test(prefix) ||
    // "." and ".." are made entirely of characters SAFE_PREFIX_SEGMENT allows,
    // so they must be rejected by name -- and ".." is the whole point.
    !prefix
      .split("/")
      .every(
        (segment) =>
          segment !== "." &&
          segment !== ".." &&
          SAFE_PREFIX_SEGMENT.test(segment),
      )
  ) {
    throw new UnsafePathPrefixError(raw);
  }
  return `${prefix}/${filePath}`;
}

/**
 * The vendored `hexagen-conformance` composite action files.
 *
 * ORDER IS PART OF THE CONTRACT: `action.yml` at index 0, `post-comment.mjs`
 * at index 1. New files are **appended**, never inserted — a reorder breaks the
 * order-sensitive `deepEqual` in `sync-integrity-workflow.test.ts` and, more
 * importantly, silently changes what a consumer's zip looks like between
 * releases.
 */
export function hexagenConformanceActionFiles(
  options?: ConformanceGateFilesOptions,
): ReadonlyArray<ConformanceGateFile> {
  const { pathPrefix, includeWorkflow = false } = options ?? {};

  const files: ConformanceGateFile[] = [
    {
      path: withPathPrefix(HEXAGEN_CONFORMANCE_ACTION_YML_PATH, pathPrefix),
      content: HEXAGEN_CONFORMANCE_ACTION_YML,
    },
    {
      path: withPathPrefix(HEXAGEN_CONFORMANCE_COMMENT_SCRIPT_PATH, pathPrefix),
      content: HEXAGEN_CONFORMANCE_COMMENT_SCRIPT,
    },
  ];

  if (includeWorkflow) {
    files.push({
      path: withPathPrefix(SYNC_INTEGRITY_WORKFLOW_PATH, pathPrefix),
      content: SYNC_INTEGRITY_WORKFLOW,
    });
  }

  return files;
}

/**
 * Where the install instructions land inside the brownfield bundle: the repo
 * root, so it is the first thing a consultant sees when they unzip.
 */
export const HEXAGEN_GATE_INSTALL_DOC_PATH = "HEXAGEN-GATE-INSTALL.md";

/**
 * npm dist-tag range for the toolchain the vendored action invokes. The action
 * and workflow are the 0.11.0 contract (`--pr-diff` / `report` / `adopt` do not
 * exist in the published 0.9.0 tarball), so the doc must not tell a consumer to
 * install anything older.
 */
export const HEXAGEN_TOOLCHAIN_RANGE = "^0.11.0";

/**
 * Decision **D-B4**: the bundle documents the `package.json` edits a consumer
 * must make — it never patches a foreign `package.json` itself.
 *
 * Rewriting someone else's manifest is the one irreversible thing this bundle
 * could do. We do not know their package manager, their script names, their
 * lockfile discipline, or whether `package.json` is generated. The gate is a
 * leave-behind that a consultant applies inside the client's own review
 * process, so the correct artifact is instructions plus a copy-pasteable diff,
 * not a mutation.
 */
export const HEXAGEN_GATE_INSTALL_DOC = `# Installing the Hexagen conformance gate

This bundle is a **leave-behind**. It adds an architectural-conformance gate to
your repository's CI. It changes no application code, and it deliberately does
not edit your \`package.json\` — see step 2.

## What is in this bundle

| Path | Purpose |
| --- | --- |
| \`.github/workflows/sync-integrity.yml\` | The workflow. Runs on push to \`main\` and on every pull request. |
| \`.github/actions/hexagen-conformance/action.yml\` | Vendored composite action: \`hexagen-lint --ratchet\` + \`hexagen sync --check\`, with a per-PR baseline diff. |
| \`.github/actions/hexagen-conformance/post-comment.mjs\` | Posts, updates, and deletes a single PR comment listing only *this* PR's new violations. Silent when the PR is clean. |
| \`HEXAGEN-GATE-INSTALL.md\` | This file. Delete it once you have applied the steps below. |

## Step 1 — unpack at the repository root

Unzip this bundle into the root of the repository you are installing the gate
into. Everything it writes lives under \`.github/\`, plus this file.

If you already have a \`.github/actions/hexagen-conformance/\` directory from an
earlier install, replace it wholesale rather than merging — the action and the
workflow are versioned together.

## Step 2 — patch \`package.json\` yourself

**This bundle does not rewrite your \`package.json\`.** That is the one
irreversible edit it could make to a repository it does not own, and we do not
know your script names, your package manager, or whether the file is generated.
Apply the following by hand.

### 2a. Pin the package manager

The workflow prepares the pinned package manager through Corepack, reading it
straight out of your \`package.json\`. Without this field the CI run fails at
the "Prepare package manager" step.

\`\`\`json
{
  "packageManager": "yarn@4.12.0"
}
\`\`\`

### 2b. Add the toolchain to \`devDependencies\`

\`\`\`json
{
  "devDependencies": {
    "@hexagen-monaco/sync": "${HEXAGEN_TOOLCHAIN_RANGE}",
    "@hexagen-monaco/arch-linter": "${HEXAGEN_TOOLCHAIN_RANGE}"
  }
}
\`\`\`

Both packages are published on npm. \`@hexagen-monaco/sync\` provides the
\`hexagen\` binary; \`@hexagen-monaco/arch-linter\` provides \`hexagen-lint\`.
Do not pin below \`0.11.0\`: the vendored action passes \`--pr-diff\`,
\`--base-ref\`, and \`--comment-file\`, which older tarballs do not accept.

### 2c. Add the two scripts the workflow calls

\`\`\`json
{
  "scripts": {
    "hexagen-lint": "hexagen-lint",
    "sync:check": "hexagen sync --check"
  }
}
\`\`\`

The workflow invokes \`yarn hexagen-lint --ratchet\` and \`yarn sync:check\`. If
your repository already uses those script names for something else, rename them
here **and** update the \`lint-command\` / \`check-command\` inputs in
\`.github/workflows/sync-integrity.yml\` to match — the action takes both as
inputs precisely so you do not have to bend your conventions.

## Step 3 — install and run it locally first

\`\`\`bash
corepack enable
yarn install
yarn hexagen-lint --ratchet
yarn sync:check
\`\`\`

Run this before you open the PR. A gate that first fails in CI is a gate the
team turns off.

## Step 4 — seed the baseline

On an existing codebase the linter will report violations on day one. That is
expected, and it is not what the gate is for: the gate stops *new* violations.
Seed a baseline so the first run is green, and let the ratchet shrink it:

\`\`\`bash
yarn hexagen-lint --update-baseline
\`\`\`

This writes \`.architecture/arch-lint-baseline.json\`. Commit it. From then on
\`--ratchet\` fails only on findings that are not in the baseline, and the
per-PR comment names only what that PR introduced.

Each baseline entry takes an optional \`expires\` date. An expired entry fails
the gate even when the underlying finding is gone — that is deliberate, it is
how a suppression stops being permanent.

The linter reads \`.architecture/manifest.yaml\`, \`.architecture/layout.yaml\`,
and \`.architecture/invariants/*\` for the rules it enforces. If your repository
has no \`.architecture/\` directory yet, run \`hexagen scan\` (or use the import
flow in the web app) to produce one before seeding the baseline.

## Step 5 — open the pull request

Open it as a normal PR inside your own review process. On that PR the workflow
runs against its own diff, so the first comment you see is exactly what a
contributor will see.

## Troubleshooting

**"This project is configured to use yarn" / Yarn Classic errors in CI.**
Corepack must be enabled *before* \`actions/setup-node\`, because setup-node's
package-manager cache probe runs the runner's global Yarn (Classic 1.x) and
errors on a \`packageManager\`-pinned yarn@4 project. The shipped workflow
already orders the steps this way and sets \`package-manager-cache: false\` —
on setup-node@v5, omitting \`cache:\` is not enough, the auto-probe still runs.
Do not "simplify" those two things away.

**The PR comment never appears.** The workflow needs
\`permissions: pull-requests: write\`, which it declares. Repository or
organisation settings can still downgrade the default \`GITHUB_TOKEN\` to
read-only; check Settings → Actions → Workflow permissions. The comment step
degrades quietly rather than failing the build, so a missing comment never
masks the lint result.

**Shallow-clone / merge-base failures.** The action unshallows the repository
before diffing against the base ref. Keep \`fetch-depth: 0\` on the checkout
step.

## Not using Yarn?

The workflow is Yarn-specific (\`yarn install --immutable\`, \`yarn sync:check\`).
For npm or pnpm, replace the install step and the two command inputs; the
composite action itself is package-manager agnostic — it just runs the commands
you give it.
`;

/**
 * The complete brownfield leave-behind bundle: the workflow, the vendored
 * composite action, and the D-B4 install instructions.
 *
 * Always includes the workflow — unlike the greenfield path, nothing else is
 * writing it here — so `includeWorkflow` is not honoured from `options`.
 */
export function hexagenGateBundleFiles(
  options?: Pick<ConformanceGateFilesOptions, "pathPrefix">,
): ReadonlyArray<ConformanceGateFile> {
  const pathPrefix = options?.pathPrefix;
  return [
    ...hexagenConformanceActionFiles({ pathPrefix, includeWorkflow: true }),
    {
      path: withPathPrefix(HEXAGEN_GATE_INSTALL_DOC_PATH, pathPrefix),
      content: HEXAGEN_GATE_INSTALL_DOC,
    },
  ];
}
