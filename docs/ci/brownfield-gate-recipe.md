# The brownfield CI gate: a recipe, and the key story

**Lane 5A of [kit plan 5](../planning/2026-10-03_kit-05-evidence-pack-and-ci-leave-behind.md).**
The example workflow is [`brownfield-gate.yml`](./brownfield-gate.yml). It is an
**example**: it is not wired into this repository's CI and must not be, because a
client repo holds only `.hexagen/` and no `.architecture/manifest.yaml`.

What this buys: when the FDE leaves, the client has a CI job that runs the kit's
own checks over the files it committed, in order, with exit codes a human can
read, and an HMAC'd evidence bundle that refuses a tampered blob. It runs with
the workbench deleted: the published CLI is the only dependency, and nothing
here reads a manifest or a web app.

## What a green run says, and what it does not

A green run says: **the checks this recipe names passed, on the edges
`hexagen observe` could see, at this commit.** That is the whole claim.

It does not say the agent was well behaved. It does not say the trace is true,
only that its chain and its cited grants hold. It does not say a write happened
— until `hexagen evidence verify` lands (kit plan 1, lane 1A, step 4b below), no
step here asks whether every changed file has a line covering it. Say this to a
client in those words.

Nor can the CLI re-open a saved bundle yet: the bundle index's HMAC verifier
exists as a library function, called by `hexagen workbook export` and its tests,
and no command takes a zip and checks it. What the client can do today is re-run
`hexagen evidence pack` against the committed trace with the engagement key,
which is the same judgement the CI step makes.

## Step 0: the `.hexagen/` inputs must be committed

Every writer of `.hexagen/` adds it to `.git/info/exclude` — `slice init`,
`contract add-rule`, `contract check --baseline`, `observe`, `grant issue` — so a
CI checkout has **none** of it until the client stages it. `git show` cannot tell
"never staged" from "the commit that adds it", so a missing sidecar file looks
exactly like a first commit. Step 0 exists to end that ambiguity, and it is the
only step that can name a missing path.

Run this once on the engagement machine, from the repo root, and commit what it
stages:

```bash
hexagen workbook export --stage \
  .hexagen/slice.json \
  .hexagen/contract.json \
  .hexagen/evidence/trace.jsonl \
  .hexagen/evidence/tip.json \
  .hexagen/grants/<every grant the trace cites>.json \
  --yes
```

Why each one:

| Path                     | Needed by                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.hexagen/slice.json`    | steps 2 and 3 load it; step 4 takes the engagement id from it when `--engagement` is absent                                           |
| `.hexagen/contract.json` | step 3                                                                                                                                |
| `evidence/trace.jsonl`   | step 4 takes the trace as an argument but accepts only that exact path, because the tip anchors one file                              |
| `evidence/tip.json`      | the anchor. Without it a truncated tail passes; with it, a removed line or a restart from genesis fails                               |
| `grants/*.json`          | `--grant` is required, and a line whose `grant_id` matches no supplied grant is invalid. Every grant the trace cites must be supplied |

`.hexagen/observed.json` is **not** on the list: step 1 rewrites it. Stage it
anyway if the client wants a run that starts at step 2 to agree with a fresh
clone — a missing one is exit 2 either way.

Step 0 exits **2**, names the first path that is not tracked, says it was never
staged, and prints the command above. It never treats a missing file as a first
commit, and it never skips.

## The steps

| #   | Command                                                                      | In the fail-fast chain | Exit 1 means                                                     | Exit 2 means                   |
| --- | ---------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- | ------------------------------ |
| 0   | `git ls-files --error-unmatch <each staged path>`                            | yes                    | —                                                                | a path was never staged        |
| 1   | `hexagen observe --out .hexagen/observed.json --yes`                         | yes                    | —                                                                | bad input, or a refused write  |
| 2   | `hexagen slice check --strict`                                               | **no** (exit 2 only)   | drift — logged, not gated                                        | bad input or stale state       |
| 3   | `hexagen contract check --base <pinned PR base SHA>`                         | yes                    | a rule crossed that is not in the baseline, or the gate weakened | bad input at the base          |
| 4   | `hexagen evidence pack <trace> --grant <each staged grant> --out <temp>.zip` | yes                    | the evidence is invalid; no bundle written                       | usage or a failed precondition |

Every step prints its own `step <n> exit <code>` line, so a reader of the log can
tell a **violation** (1) from **bad input or stale state** (2) without reading
the command's prose. The job stops at the first non-zero step except step 2.

### Why `slice check` is not in the fail-fast chain

It is run as a **non-blocking drift report**: its exit code is printed, exit 1 is
logged as a notice, and only exit 2 fails the job.

The reason is that `slice check` exits 1 on any in-slice file changed since
`slice.repo.commit`, and `slice init` writes that commit **once** and refuses to
overwrite an existing slice. After the first in-slice commit, every PR exits 1
here — forever. That is a property of the engagement, not of the PR, and it
carries no per-PR signal. A gate that is red on every run stops being read as a
gate; worse, it teaches the reader to ignore it. Step 2's exit 2 is a different
animal (a missing sidecar file, or `--strict` with a report read at another
commit) and stays fatal, because "the gate could not tell" must never look like
"the gate passed".

`hexagen slice check --since <base>` — which would judge only this PR's changes
and put step 2 back in the chain — does not exist yet. The only flags are
`--strict`, `--closed` and `--root`. When it lands, delete the `case` statement,
make step 2 fail-fast, and say in the log that drift is gated again.

### Why step 3 pins its own base

`--base` decides what counts as **growth**: a rule dropped or downgraded
`error` → `warn`, a `knownViolations` entry added, an `expires` pushed later or
dropped, a slice exclude added. Each of those is a way to make the gate pass
without changing any code. So the base cannot be a workflow input and cannot come
from the PR. The example takes it from
`${{ github.event.pull_request.base.sha }}` and checks the commit is in the
checkout before using it, the same pin `.github/workflows/sync-integrity.yml`
derives. `fetch-depth: 0` is not optional: step 3 reads the sidecar files **at**
that commit with `git show`, and an unresolvable ref is exit 2, never a pass.

Growth the FDE meant to accept is a review decision, not a workflow flag:
re-run locally with `--allow-growth --reason "<why>"` and commit the reason. The
reason is printed into the CI log, so the record of the acceptance lives with the
commit.

### Step 4 writes a bundle and throws it away

`evidence pack`'s contract is that it either writes a bundle that passed or writes
nothing at all, so a CI step that only wants a yes/no has to write somewhere
disposable. The example writes `.hexagen/ci-evidence-bundle.zip` in the CI
workspace and lets the runner delete it. A pass also advances
`.hexagen/evidence/tip.json` in that workspace; nothing is pushed, so the
repository's tip is untouched.

This is also the argument for `hexagen evidence verify` as the CI step: it reads,
judges a range, and writes nothing at all. **Step 4b in the example is that step,
written out and linted but disabled.** It turns on by flipping one value —
`USE_EVIDENCE_VERIFY: "true"` — which swaps step 4 out for step 4b. Do it when
`hexagen evidence verify` is merged (kit plan 1, lane 1A), and expect its first
run to be new: nothing has executed it yet.

## The workflow

Copy this into the client repo's `.github/workflows/`. It is byte-for-byte
[`brownfield-gate.yml`](./brownfield-gate.yml); keep the two identical, and edit
only the two `EDIT SPOT` values.

```yaml
# EXAMPLE — copy this into the CLIENT repo's .github/workflows/ and edit the two
# spots marked EDIT SPOT below.
#
# It is not wired into this repository's CI and must not be: a client repo holds
# only `.hexagen/` and no `.architecture/manifest.yaml`, so the generated
# conformance gate (which runs `hexagen-lint --ratchet` and `hexagen sync
# --check`) has nothing to run there. This repository's own gate is
# `.github/workflows/sync-integrity.yml`.
#
# Every step below prints `step <n> exit <code>`, and the job stops at the first
# non-zero one except step 2, which is a drift report. The recipe that explains
# each step, what 1 and 2 mean, and the key story is
# docs/ci/brownfield-gate-recipe.md — keep the two in step with each other.
name: "Brownfield gate"

on:
  pull_request:
  # No `paths:` filter on purpose. A filter that skips this job emits no check at
  # all on a non-matching PR, which blocks the merge rather than passing it — and
  # a skipped gate would also be indistinguishable from a passing one. Step 0
  # tells "nothing to gate" apart from "clean" by name and exit code.

# Reads the checkout and publishes nothing: contents: read and nothing more. No
# pull-requests: read, because no step calls the API — the base SHA comes from
# the event payload.
permissions:
  contents: read

concurrency:
  group: brownfield-gate-${{ github.event.pull_request.number }}
  cancel-in-progress: true

env:
  # EDIT SPOT 1 — the CLI pin. Pin it to the version the FDE ran locally, and
  # bump it deliberately: `hexagen --help` is the check that the pin exists.
  HEXAGEN_VERSION: "0.13.0"
  # EDIT SPOT 2 — flip to "true" when `hexagen evidence verify` ships (kit plan 1,
  # lane 1A), then commit. It swaps step 4 for step 4b: the pack step stops
  # running and the read-only verify step takes its place. Both are written out
  # here so both are linted today; the disabled one has never been executed by
  # this job, so treat its first run as new.
  USE_EVIDENCE_VERIFY: "false"

jobs:
  brownfield-gate:
    name: "Brownfield gate"
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Every `hexagen` step below runs from the checkout root, which is the repo
    # root on a GitHub runner. The commands default `--root` to the cwd and never
    # search upward, so a client whose repo root is not the checkout root passes
    # `--root` explicitly rather than relying on the default.
    steps:
      - name: "Checkout the repository"
        uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
        with:
          # Full history, not depth 1: step 3 reads `.hexagen/contract.json` and
          # `.hexagen/slice.json` AT the base commit with `git show`, and step 2
          # diffs from the slice's commit. A shallow clone resolves neither, and
          # both fail with exit 2 rather than passing.
          fetch-depth: 0
          persist-credentials: false

      - name: "Setup Node.js"
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: "22.12.0"
          package-manager-cache: false

      - name: "Install the hexagen CLI"
        run: |
          # From npm at the pinned version, into RUNNER_TEMP: not the workspace
          # (which is the tree the PR controls) and not a global npm prefix (which
          # wants sudo on a runner). The bin lands in <prefix>/node_modules/.bin,
          # which the next step puts on PATH.
          prefix="${RUNNER_TEMP}/hexagen-cli"
          npm install --prefix "${prefix}" "@hexagen-monaco/sync@${HEXAGEN_VERSION}"
          echo "${prefix}/node_modules/.bin" >> "${GITHUB_PATH}"
          hexagen --help

      - name: "Resolve the base commit"
        id: base
        run: |
          # From the event payload, never from a workflow input or a PR-supplied
          # value. The base decides what counts as growth in step 3, so a PR that
          # could choose it could choose a commit where the contract is already
          # weakened — the same pin sync-integrity.yml derives. This check is not
          # belt-and-braces: `contract check --base` with an unresolvable ref is
          # exit 2, but failing here names the cause instead of the symptom.
          base="${{ github.event.pull_request.base.sha }}"
          if [ -z "${base}" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
            echo "::error::base commit '${base}' is not in this checkout; a pull_request run needs fetch-depth: 0. Refusing to gate against an unknown base."
            exit 2
          fi
          echo "base=${base}" >> "${GITHUB_OUTPUT}"
          echo "gating against base ${base}"

      - name: "step 0: the .hexagen/ inputs must be tracked"
        run: |
          # Every writer of `.hexagen/` adds it to `.git/info/exclude`
          # (`slice init`, `contract add-rule`, `contract check --baseline`,
          # `observe`, `grant issue`), so a fresh clone has none of it and the
          # first commit that adds a file is indistinguishable from a file that
          # was never staged. Step 0 exists to tell those apart: an un-staged
          # repo must not look like a first commit. Not a kit command — it is the
          # only step that can name a missing path.
          set -uo pipefail
          required=(
            .hexagen/slice.json
            .hexagen/contract.json
            .hexagen/evidence/trace.jsonl
            .hexagen/evidence/tip.json
          )
          grants=()
          while IFS= read -r grant; do
            [ -n "${grant}" ] || continue
            grants+=("${grant}")
          done < <(git ls-files -- ".hexagen/grants/*.json")
          missing=""
          for path in "${required[@]}"; do
            if ! git ls-files --error-unmatch "${path}" >/dev/null 2>&1; then
              missing="${path}"
              break
            fi
          done
          if [ -z "${missing}" ] && [ "${#grants[@]}" -eq 0 ]; then
            missing=".hexagen/grants/<at least one grant the trace cites>.json"
          fi
          if [ -n "${missing}" ]; then
            echo "::error::${missing} is not tracked. It was never staged — this is not a first commit. Stage it from the engagement machine, then commit it on the branch:"
            echo "hexagen workbook export --stage ${required[*]} ${grants[*]:-<every grant the trace cites>.json} --yes"
            echo "step 0 exit 2"
            exit 2
          fi
          echo "tracked: ${required[*]} and ${#grants[@]} grant(s)"
          echo "step 0 exit 0"

      - name: "step 1: observe"
        run: |
          # Rescans the checkout and rewrites `.hexagen/observed.json` in the CI
          # workspace only — nothing is committed back. This is what makes steps 2
          # and 3 judge the PR's own tree rather than the tree the committed
          # report described, and it is why `--strict` passes on the next step.
          #
          # The caps are honest limits, not skips: over `--max-import-files`
          # (20 000 JS/TS files) or `--max-import-ms` the import pass reports
          # `collected: false`, observe still exits 0, and steps 2 and 3 then say
          # the edges are incomplete — which is never clean. Raise the caps for a
          # large repo; do not let a green observe hide an unread tree.
          set +e
          hexagen observe --out .hexagen/observed.json --yes
          code=$?
          set -e
          echo "step 1 exit ${code}"
          if [ "${code}" -ne 0 ]; then
            echo "::error::observe exit ${code}: 2 = bad input or a refused write (the --out path must resolve under <root>/.hexagen/). Nothing else in this gate can run without a fresh report."
          fi
          exit "${code}"

      - name: "step 2: slice check (drift report, not a gate)"
        run: |
          # NOT in the fail-fast chain, on purpose. `slice check` fails (exit 1)
          # on any in-slice file changed since `slice.repo.commit`, and
          # `slice init` writes that commit once and refuses to overwrite it — so
          # after the first in-slice commit every PR exits 1 here, forever. That
          # is a property of the engagement, not of the PR, and it carries no
          # per-PR signal: a gate that is always red is not a gate.
          #
          # Exit 2 is different: that is bad input or stale state, and it stays
          # fatal. `hexagen slice check --since <base>` — the fix that puts this
          # step back in the chain — does not exist yet.
          set +e
          hexagen slice check --strict
          code=$?
          set -e
          echo "step 2 exit ${code}"
          case "${code}" in
            0)
              echo "::notice::slice check: no drift"
              ;;
            1)
              echo "::notice::slice check reported drift (exit 1): an in-slice file changed since slice.repo.commit, or the edge list is incomplete. Logged, not gated — see docs/ci/brownfield-gate-recipe.md."
              ;;
            *)
              echo "::error::slice check exit ${code}: 2 = bad input or stale state (a missing or invalid sidecar file, or --strict with observed.json read at another commit). Failing."
              ;;
          esac
          if [ "${code}" -eq 2 ]; then
            exit 2
          fi
          exit 0

      - name: "step 3: contract check --base <pinned base>"
        run: |
          # stale observed.json is not on this list: step 1 rewrote it at HEAD, and this
          # step does not pass --strict, so it could only warn.
          set +e
          hexagen contract check --base "${{ steps.base.outputs.base }}"
          code=$?
          set -e
          echo "step 3 exit ${code}"
          if [ "${code}" -eq 1 ]; then
            echo "::error::contract check exit 1: a rule was crossed that is not in the baseline, or the gate was weakened against the base (a rule dropped or downgraded, a suppression added or extended, a slice exclude added). Both are refusals, not warnings."
          elif [ "${code}" -eq 2 ]; then
            echo "::error::contract check exit 2: bad input — an unresolvable base, a sidecar file never staged at the base, or a slice/contract file that does not parse."
          fi
          exit "${code}"

      - name: "Inject the engagement key"
        env:
          HEXAGEN_GRANT_KEY: ${{ secrets.HEXAGEN_GRANT_KEY }}
        run: |
          # The key comes from a secret and only from a secret. It is written to
          # RUNNER_TEMP, outside the checkout, so nothing in the tree can read it
          # and `git add -f` cannot reach it; `--key-file`/`HEXAGEN_GRANT_KEY_FILE`
          # is the second step of key resolution, after `--key-file`. Never commit
          # a key and never let the job fall back to a key file in the checkout.
          #
          # A `pull_request` run from a fork gets no secrets, so this step exits 2
          # there. That is deliberate: without the key the evidence step cannot
          # verify anything, and a gate that skips what it cannot do is not a
          # gate. Run this job on branches in the repository, not on forks.
          key_file="${RUNNER_TEMP}/engagement.key"
          install -m 600 /dev/null "${key_file}"
          printf '%s' "${HEXAGEN_GRANT_KEY:-}" >"${key_file}"
          if [ ! -s "${key_file}" ]; then
            echo "::error::the HEXAGEN_GRANT_KEY secret is empty. A missing or weak key is a denial, not a skip: set the repository secret, or stop using the evidence step."
            exit 2
          fi
          echo "HEXAGEN_GRANT_KEY_FILE=${key_file}" >> "${GITHUB_ENV}"
          echo "wrote the engagement key to ${key_file} (mode 600, outside the checkout)"

      - name: "step 4: evidence pack"
        if: env.USE_EVIDENCE_VERIFY != 'true'
        run: |
          # Reads the whole trace and writes a bundle the job throws away. That is
          # deliberate: `evidence pack`'s contract is that it either writes a
          # bundle that passed or writes nothing, so a CI step that only wants a
          # yes/no has to write somewhere disposable. A pass also advances
          # `.hexagen/evidence/tip.json` in this workspace; nothing is pushed, so
          # the repository's tip is untouched.
          set -uo pipefail
          grants=()
          while IFS= read -r grant; do
            [ -n "${grant}" ] || continue
            grants+=("${grant}")
          done < <(git ls-files -- ".hexagen/grants/*.json")
          if [ "${#grants[@]}" -eq 0 ]; then
            echo "::error::no tracked grant under .hexagen/grants/; --grant is required, and every grant the trace cites must be supplied or Rule 3 fails the line that cites it."
            echo "step 4 exit 2"
            exit 2
          fi
          set +e
          hexagen evidence pack .hexagen/evidence/trace.jsonl \
            --grant "${grants[@]}" \
            --out .hexagen/ci-evidence-bundle.zip
          code=$?
          set -e
          echo "step 4 exit ${code}"
          if [ "${code}" -eq 1 ]; then
            echo "::error::evidence pack exit 1: the evidence is invalid — a broken hash chain, a torn last line, a line citing a grant that was not supplied or does not verify, a tool or time outside the grant's window, or a tip that does not match. No bundle was written and the tip is unchanged."
          elif [ "${code}" -eq 2 ]; then
            echo "::error::evidence pack exit 2: bad input or a failed precondition — no engagement key, an --out path outside .hexagen/ or one that already exists, a trace the tip does not anchor, an unreadable grant file, or the same grant id passed twice."
          fi
          exit "${code}"

      - name: "step 4b: evidence verify --since <base>"
        if: env.USE_EVIDENCE_VERIFY == 'true'
        run: |
          # The read-only replacement for step 4, once `hexagen evidence verify`
          # ships (kit plan 1, lane 1A). It never writes: no bundle, no tip. It
          # also narrows to what the PR changed — a file inside the slice or
          # inside a supplied grant with no trace line covering it is unaccounted
          # and exits 1, which is a per-PR signal the whole-trace pack cannot
          # give. Exit 1 = an unaccounted change; 2 = bad input or stale state
          # (an unresolvable --since, a missing trace, an empty diff).
          set -uo pipefail
          grants=()
          while IFS= read -r grant; do
            [ -n "${grant}" ] || continue
            grants+=("${grant}")
          done < <(git ls-files -- ".hexagen/grants/*.json")
          if [ "${#grants[@]}" -eq 0 ]; then
            echo "::error::no tracked grant under .hexagen/grants/; --grant is required, and every grant the trace cites must be supplied."
            echo "step 4b exit 2"
            exit 2
          fi
          set +e
          hexagen evidence verify --since "${{ steps.base.outputs.base }}" \
            --grant "${grants[@]}"
          code=$?
          set -e
          echo "step 4b exit ${code}"
          if [ "${code}" -eq 1 ]; then
            echo "::error::evidence verify exit 1: a changed file inside the slice or a grant has no covering trace line."
          elif [ "${code}" -eq 2 ]; then
            echo "::error::evidence verify exit 2: bad input or stale state — an unresolvable --since, a missing trace, or an empty diff."
          fi
          exit "${code}"

      - name: "Key fingerprint (report only)"
        if: always()
        run: |
          # Diagnostic, never a gate: names the key the job resolved, by path and
          # fingerprint, so a mismatch is visible in the log. The key itself is
          # never printed. `hexagen grant check <grant> --tool <tool> --path
          # <path>` is the enforcing form and needs a tool and a path.
          set +e
          first="$(git ls-files -- ".hexagen/grants/*.json" | head -n 1)"
          if [ -n "${first}" ]; then
            hexagen grant show "${first}" || echo "::notice::grant show exit $? — the fingerprint above, if any, is what the job resolved"
          fi
          exit 0
```

## The engagement key in CI

In a client repo the key lives **outside** the tree, at
`~/.hexagen/keys/<engagement>.key`, created only by
`hexagen grant key init --engagement <id>`. A CI runner has no home directory
copy of it, so it must be injected:

1. store the key as a repository secret (`HEXAGEN_GRANT_KEY` in the example);
2. write it to a file under `$RUNNER_TEMP` at mode 0600 — **outside** the
   checkout, so nothing in the tree can read it and `git add -f` cannot reach it;
3. point `HEXAGEN_GRANT_KEY_FILE` at that file. It is the second step of key
   resolution, after `--key-file`, and it is the same resolver the FDE's machine
   and the MCP server use.

**Never** put a key in the checkout, and never let a step fall back to one. A
key in `.hexagen/` is a key in the PR, and the PR is public the moment the
repository is.

To see which key the job resolved, read the **fingerprint** in the log: `hexagen
grant show <grant>` prints the key path and the first 16 hex characters of the
SHA-256 of the key bytes, never the key. `hexagen grant check <grant> --tool
<tool> --path <path>` is the enforcing form and needs a tool and a path. If the
fingerprint in CI differs from the FDE's, every grant signature fails and step 4
exits 1 — which is the correct answer, not a bug to work around.

**A missing or weak key is a denial, not a skip.** With no key at all, `evidence
pack` exits 2 with `cannot locate the engagement key`. The example's key step
checks the secret before the evidence step and exits 2 with the same meaning, so
the job never reports green over evidence it could not check. That is also why the
example's gate is for branches in the repository: a `pull_request` run from a fork
receives no secrets.

## The key story, told honestly

The bundle is an **HMAC'd bundle that refuses a tampered blob**. That is the
whole claim, and four things follow from it that a client should be told before
they sign anything:

- **The HMAC is symmetric, so the CI secret can also forge.** Anyone holding the
  engagement key can mint a tip, or a bundle index, that verifies. The check
  tells you the bytes were not altered by someone _without_ the key. It does not
  tell you who wrote them.
- **The FDE and CI hold the same key, so a bundle cannot attribute a line to
  either of them.** There is one key and two holders; the signature says
  "someholder".
- **Rotating or deleting the key makes every earlier bundle unverifiable.** The
  tip and the bundle index are HMACs keyed by it, so a rotated key cannot re-check
  anything already written. Deleting the key is the documented emergency stop —
  every grant in the engagement stops verifying, so every write is denied — and
  it is also total amnesia for the evidence already gathered.
- **Every grant the trace cites must be supplied.** A line whose `grant_id`
  matches no `--grant` file is invalid, and a grant whose signature does not
  verify is no known grant at all. The example derives the grant list from
  `git ls-files` so a grant cannot be quietly dropped from the check.

### Wording

Do not call this "verifiable governance", "tamper-proof", or something that
"enforces" a rule. It detects and it refuses; it does not prove intent, and it
does not know who held the key. The accepted phrasing is **an HMAC'd bundle that
refuses a tampered blob**.

## What this recipe does not do

- It does not gate on drift between commits, because `hexagen slice check --since
  <base>` does not exist yet.
- It does not ask whether every changed file has a trace line covering it. That
  is `hexagen evidence verify` (step 4b), pending lane 1A.
- It does not stop a write. It finds evidence that does not hold after the fact.
- It does not commit anything back, and it does not advance the repository's tip.
- It does not cover a change applied through `hexagen_accept_transaction`, which
  leaves no path list for a future `verify` to join.
- It does not re-open a saved bundle; no command takes a zip and checks its index
  HMAC yet.

Each of those is named in [kit plan 5](../planning/2026-10-03_kit-05-evidence-pack-and-ci-leave-behind.md)
§7 rather than papered over here, because the recipe is what a client reads when
the FDE is gone.

## Exit codes, per command

| Command           | 0                                   | 1                                                             | 2                                                                    |
| ----------------- | ----------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `slice check`     | no drift                            | drift (an in-slice file changed, or the edges are incomplete) | bad input, or `--strict` with a report read at another commit        |
| `contract check`  | clean                               | a violation not in the baseline, incomplete edges, or growth  | bad input, an unresolvable `--base`, a file never staged at the base |
| `evidence pack`   | packed                              | the evidence is invalid; nothing written                      | usage or a failed precondition                                       |
| `evidence verify` | every changed file is accounted for | a changed file has no covering line                           | bad input, a missing trace, an unresolvable `--since`, an empty diff |

## Where this came from

- [Plan 5 §4.0 and §4.1](../planning/2026-10-03_kit-05-evidence-pack-and-ci-leave-behind.md) —
  the staging precondition and the step order.
- [Plan 1 §5 and §11](../planning/2026-10-03_kit-01-unaccounted-mutation-check.md) —
  `evidence verify`, its exit codes, and the same precondition.
- [`docs/kernel/TRACE.md`](../kernel/TRACE.md) — what the pack checks, and what
  the tip anchors.
- [`docs/kernel/GRANT.md`](../kernel/GRANT.md) — key resolution, the fingerprint,
  and deleting the key as an emergency stop.
- [`packages/sync/README.md`](../../packages/sync/README.md) — the command
  surfaces and their exit codes.
