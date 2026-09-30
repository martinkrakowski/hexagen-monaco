#!/bin/sh
# The in-repo gate (plan D183, lane HX3-gate-in-repo): `yarn gate [--lane <id>]`.
#
# Runs CI's gate steps in the foreground, one after another, and prints each
# step's real exit code, stopping at the first failure by name. The default
# step list mirrors .github/workflows/ci.yml:
#
#   check:env  build  typecheck  lint  format:check  lint:arch  sync:check
#   lint:bytes  plan:verify  arch:inventory  nitro-route-scan  test:cov
#   verify-manifests
#
# `yarn install --immutable` is the ONE CI step the gate does not run — the
# gate assumes dependencies are installed, and CI installs them immutably
# before anything else. `check:env` stays the conditional no-op CI has: with
# no check:env script in package.json it prints the skip line and passes.
#
# The lock covers ONLY `test:cov` and `verify-manifests` — the two steps that
# must not run concurrently on one host. It is taken just before the first
# locked step and released right after the last one; everything before —
# build, typecheck, lint, the arch checks — runs WITHOUT it. While it is
# held, a background heartbeat loop keeps the lock's `beat` fresh, and ONE
# trap (the EXIT trap; INT and TERM only turn the signal into an exit that
# falls through to it) releases the lock AND kills that loop, on failure and
# on signal alike. A release that fails or is refused is reported loudly, and
# a gate whose lock could not be released does not report green.
#
# At every locked-step boundary the gate also verifies the lock is still its
# own: the heartbeat loop is running (its failure marker catches the zombie a
# kill -0 cannot) and the lock still names this gate — either failing fails
# the gate as "lock lost", so a holder whose lock was reclaimed stops its
# protected steps instead of running them beside whoever holds the name. The
# between-steps window is testable via CF_GATE_TEST_PAUSE_BEFORE_STEP.
#
# A coverage threshold failure fails the gate even when vitest exits 0: the
# test:cov step's output is captured, replayed for the human, and scanned for
# `ERROR: Coverage` — a piped read (M3) reported exit 0 while coverage failed,
# and the scan is what stops the same failure arriving through a pipe.
#
# For tests the step list is injectable: CF_GATE_STEPS overrides it, one
# `name<TAB>command` line per step, run in the given order — so a test runs
# fake steps (`true`, `sh -c "exit 3"`, a step that prints `ERROR: Coverage`
# and exits 0) instead of the real suite. The locking rules above apply to
# injected lists unchanged: a step NAMED test:cov or verify-manifests is
# locked, whichever command it carries. The nitro guard's prepare command and
# manifest path are injectable the same way (CF_GATE_NITRO_PREPARE,
# CF_GATE_NITRO_MANIFEST) so a test can fail preparation without touching the
# workspace.
#
# POSIX sh (not zsh): GitHub Linux runners do not ship zsh. Like wave-event.sh
# and verify-manifests.sh, this file parses under the runners' /bin/sh —
# `sh -n` on it is part of its tests.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCK_SCRIPT="$HERE/gate-lock.sh"
TAB=$(printf '\t')

# The lock's busy contract: gate-lock.sh exits 75 when the holder is alive and
# fresh, and this script propagates that rather than burying it.
BUSY=75

# Steps that hold the lock — and nothing else.
LOCKED_STEPS=" test:cov verify-manifests "
is_locked_step() {
  case "$LOCKED_STEPS" in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# ci.yml runs `check:env` only if the script exists; the gate keeps exactly
# that conditional no-op. With no check:env script (today's package.json) this
# prints the skip line and passes; with one, it runs it.
gate_check_env() {
  if node -e "try { process.exit(require('./package.json').scripts?.['check:env'] ? 0 : 1) } catch { process.exit(1) }"; then
    yarn check:env
  else
    echo "no check:env script — skipping (env-setup not installed or package.json unreadable)"
  fi
}

# ci.yml's route-scan guard (its "Guard the API route scan against test files"
# step), verbatim: tests live in __tests__/ next to their modules, but Nitro
# scans apps/api/server/ recursively, and a *.test.ts landing there registers
# as a route and crashes `yarn dev` at boot — a runtime fault the build and
# coverage gate do not catch.
gate_nitro_guard() {
  MANIFEST="${CF_GATE_NITRO_MANIFEST:-apps/api/.nitro/types/nitro-routes.d.ts}"
  PREPARE="${CF_GATE_NITRO_PREPARE:-yarn workspace @campaignfoundry/api exec nitro prepare}"
  # A stale manifest must never be validated: remove it BEFORE preparing, so a
  # failed prepare cannot leave old routes behind for the scan to bless.
  rm -f "$MANIFEST"
  # Fail the step when preparation fails — CI's `bash -e` aborts the step on a
  # failed prepare; the gate (set -u, no -e) must check the status itself, and
  # it reports prepare's real status, not a generic 1.
  eval "$PREPARE"
  prepare_status=$?
  if [ "$prepare_status" -ne 0 ]; then
    echo "::error::nitro prepare failed (exit $prepare_status) — refusing to scan a route manifest that was not rebuilt"
    return "$prepare_status"
  fi
  # Fail closed: a missing manifest means the guard can't validate anything.
  if [ ! -f "$MANIFEST" ]; then
    echo "::error::Nitro route manifest not found at $MANIFEST"
    return 1
  fi
  # `\.test\b` is robust to Nitro's quoting/extension (matches .test', .test.ts, .test/, …).
  if grep -Eq '__tests__|\.test\b' "$MANIFEST"; then
    echo "::error::A test file was scanned as a Nitro route. Keep tests out of the server scan (see apps/api/nitro.config.ts \`ignore\`)."
    return 1
  fi
  echo "Nitro route manifest is free of test files."
}

LANE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lane)
      [ $# -ge 2 ] || { printf '%s\n' "gate: missing value for --lane" >&2; exit 2; }
      LANE="$2"
      shift 2
      ;;
    *)
      printf '%s\n' "usage: yarn gate [--lane <id>]" >&2
      exit 2
      ;;
  esac
done
[ -n "$LANE" ] || LANE="gate"
case "$LANE" in
  *[!A-Za-z0-9_-]*)
    printf '%s\n' "gate: invalid lane id: $LANE — must match ^[A-Za-z0-9_-]+\$" >&2
    exit 2
    ;;
esac

HB_SECONDS="${CF_GATE_HEARTBEAT_SECONDS:-60}"
case "$HB_SECONDS" in
  ''|*[!0-9]*)
    printf '%s\n' "gate: CF_GATE_HEARTBEAT_SECONDS must be a number of seconds: $HB_SECONDS" >&2
    exit 2
    ;;
esac

# The default list is the row's list in the row's order: the cheap local loop
# first, the arch checks in CI's relative order behind it, the guard, then the
# two locked steps last. `gate_check_env` and `gate_nitro_guard` are the
# functions above; every other cell is the yarn command CI runs for that step.
STEPS=""
add_step() {
  if [ -n "$STEPS" ]; then
    STEPS="$STEPS
"
  fi
  STEPS="${STEPS}${1}${TAB}${2}"
}
if [ "${CF_GATE_STEPS+set}" = "set" ]; then
  STEPS="$CF_GATE_STEPS"
else
  add_step "check:env" "gate_check_env"
  add_step "build" "yarn build"
  add_step "typecheck" "yarn typecheck"
  add_step "lint" "yarn lint"
  add_step "format:check" "yarn format:check"
  add_step "lint:arch" "yarn lint:arch"
  add_step "sync:check" "yarn sync:check"
  add_step "lint:bytes" "yarn lint:bytes"
  add_step "plan:verify" "yarn plan:verify"
  add_step "arch:inventory" "yarn arch:inventory"
  add_step "nitro-route-scan" "gate_nitro_guard"
  add_step "test:cov" "yarn test:cov"
  add_step "verify-manifests" "sh \"\$HERE/verify-manifests.sh\""
fi

# Validate and count before running: a gate that silently runs nothing must
# not report green, and a malformed step line must refuse before step one.
total=0
last_locked=0
while IFS="$TAB" read -r name cmd; do
  [ -n "$name" ] || continue
  if [ -z "$cmd" ]; then
    printf '%s\n' "gate: step '$name' has no command — steps are name<TAB>command lines" >&2
    exit 2
  fi
  total=$((total + 1))
  if is_locked_step "$name"; then
    last_locked=$total
  fi
done <<EOF
$STEPS
EOF
if [ "$total" -eq 0 ]; then
  printf '%s\n' "gate: no steps to run — CF_GATE_STEPS, when set, must hold at least one name<TAB>command line" >&2
  exit 2
fi

LOCK_HELD=0
HEARTBEAT_PID=""
HB_FAILED="${TMPDIR:-/tmp}/cf-gate.hbfailed.$$"
COVLOG=""
cov_failed=0
release_failed=0

release_lock() {
  if [ "$LOCK_HELD" -eq 1 ]; then
    if [ -n "$HEARTBEAT_PID" ]; then
      # Kill the heartbeat loop and reap it, so no heartbeat process survives
      # the gate by even a moment.
      kill "$HEARTBEAT_PID" 2>/dev/null
      wait "$HEARTBEAT_PID" 2>/dev/null
      HEARTBEAT_PID=""
    fi
    rm -f "$HB_FAILED"
    LOCK_HELD=0
    # The release's status and diagnostics are not discarded: a release that
    # failed (or was refused — see gate-lock.sh) must be reported, never
    # announced as released.
    if CF_GATE_CALLER_PID=$$ sh "$LOCK_SCRIPT" release "$LANE"; then
      printf '%s\n' "gate: lock released, heartbeat stopped"
    else
      release_failed=1
      printf '%s\n' "gate: FAILED to release the lock — it may still be held at ${TMPDIR:-/tmp}/cf-gate.lock" >&2
    fi
  fi
}

# The ONE trap that releases the lock and kills the heartbeat loop — on a
# failing step, on a signal, on any exit. It preserves the exit status that
# was pending when it fired (an INT arrives as `exit 130` from the trap below,
# not as $? mid-command, which could be 0 on a Ctrl-C between steps).
cleanup() {
  status=$?
  trap - INT TERM EXIT
  release_lock
  if [ -n "$COVLOG" ]; then
    rm -f "$COVLOG"
  fi
  rm -f "$HB_FAILED"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start_heartbeat() {
  # The heartbeat is a background loop that refreshes the lock's beat; the
  # EXIT trap above kills it together with the lock it keeps fresh. Its own
  # traps are cleared inside: the loop must die quietly when killed, never
  # release the lock itself. Its stdio is detached from the caller's pipes —
  # killing the subshell orphans its in-flight `sleep`, which would otherwise
  # hold the caller's stdout open (a synchronously-run gate would hang on it
  # until the sleep expired); orphaned that way it holds nothing and expires
  # on its own within one interval, and the heartbeat pid itself — what the
  # tests check and what `wait` reaps — is the subshell's.
  (
    trap - INT TERM EXIT
    while :; do
      sleep "$HB_SECONDS"
      # The heartbeat is ownership-checked on the lock side too: it refreshes
      # only a lock that still names THIS gate's pid ($$ is this shell's even
      # inside the subshell), so after a reclaim the loop fails and dies
      # instead of refreshing whoever replaced us. Its failure is recorded in
      # a marker file the foreground gate checks at every locked-step boundary
      # — a dead loop is a zombie its parent's kill -0 cannot see.
      CF_GATE_CALLER_PID=$$ sh "$LOCK_SCRIPT" heartbeat >/dev/null 2>&1 || {
        printf '%s\n' "lost" > "$HB_FAILED" 2>/dev/null
        exit 1
      }
    done
  ) >/dev/null 2>&1 &
  HEARTBEAT_PID=$!
  printf '%s\n' "gate: heartbeat pid $HEARTBEAT_PID (every ${HB_SECONDS}s while the lock is held)"
}

# The foreground gate never waits on the heartbeat, so it would otherwise
# never learn that the loop died (a dead background child is a zombie its own
# parent's kill -0 reports as alive) or that the lock was reclaimed. At every
# locked-step boundary — before and after each locked step — it checks both:
# the loop is alive (and did not leave its failure marker), and the lock still
# names this gate. Either failure is "lock lost": the protected steps must not
# continue on a lock someone else holds or is about to.
check_lock_intact() {
  if [ -f "$HB_FAILED" ]; then
    return 1
  fi
  if [ -z "$HEARTBEAT_PID" ] || ! kill -0 "$HEARTBEAT_PID" 2>/dev/null; then
    return 1
  fi
  CF_GATE_CALLER_PID=$$ sh "$LOCK_SCRIPT" verify "$LANE" >/dev/null 2>&1
}

# The test:cov step runs with its output captured, replayed for the human, and
# scanned for `ERROR: Coverage`: a threshold failure must fail the gate even
# when vitest itself exits 0. CI sets NODE_ENV=test on its Test step; the gate
# mirrors it. The command returns vitest's real exit code; cov_failed records
# the scan.
run_test_cov() {
  COVLOG=$(mktemp "${TMPDIR:-/tmp}/cf-gate.covlog.XXXXXX")
  eval "NODE_ENV=test $1" > "$COVLOG" 2>&1
  code=$?
  cat "$COVLOG"
  if grep -q "ERROR: Coverage" "$COVLOG"; then
    cov_failed=1
  fi
  rm -f "$COVLOG"
  COVLOG=""
  return "$code"
}

printf '%s\n' "gate: lane $LANE, $total steps — 'yarn install --immutable' is the one CI step the gate does not run"
# CI's Test step sets TEST_DATABASE_URL (postgres service); the two
# real-Postgres concurrency suites skip themselves when it is absent, so a
# local gate — and a local test:cov — has not exercised them. Say so.
printf '%s\n' "gate: the two real-Postgres concurrency suites run only when TEST_DATABASE_URL is set — CI sets it; locally they skip themselves"

step_no=0
while IFS="$TAB" read -r name cmd; do
  [ -n "$name" ] || continue
  step_no=$((step_no + 1))
  printf '==> [%s/%s] %s\n' "$step_no" "$total" "$name"
  if is_locked_step "$name" && [ "$LOCK_HELD" -eq 0 ]; then
    # The caller's pid travels in CF_GATE_CALLER_PID: the lock must outlive
    # this acquire call, so it names this shell, not the gate-lock child.
    CF_GATE_CALLER_PID=$$ sh "$LOCK_SCRIPT" acquire "$LANE"
    acq=$?
    if [ "$acq" -ne 0 ]; then
      printf '%s\n' "gate: could not acquire the gate lock (exit $acq) — 75 means busy: sleep and retry" >&2
      exit "$acq"
    fi
    LOCK_HELD=1
    start_heartbeat
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then
    # Test hook (CF_GATE_TEST_PAUSE_BEFORE_STEP): between locked steps, for
    # the test that removes or replaces the lock in exactly that window.
    if [ -n "${CF_GATE_TEST_PAUSE_BEFORE_STEP:-}" ]; then
      touch "$CF_GATE_TEST_PAUSE_BEFORE_STEP" 2>/dev/null
      while [ -f "$CF_GATE_TEST_PAUSE_BEFORE_STEP" ]; do sleep 1; done
    fi
    if ! check_lock_intact; then
      printf '%s\n' "gate: FAILED — lock lost before step '$name' (the heartbeat died or the lock no longer names this gate)" >&2
      exit 1
    fi
  fi
  cov_failed=0
  case "$name" in
    test:cov)
      run_test_cov "$cmd"
      code=$?
      ;;
    *)
      eval "$cmd"
      code=$?
      ;;
  esac
  printf '<== %s: exit %s\n' "$name" "$code"
  if [ "$cov_failed" -eq 1 ]; then
    printf '%s\n' "gate: FAILED at step 'test:cov' — a coverage threshold failure was reported (vitest exited $code)" >&2
    exit 1
  fi
  if [ "$code" -ne 0 ]; then
    printf '%s\n' "gate: FAILED at step '$name' (exit $code)" >&2
    exit "$code"
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then
    if ! check_lock_intact; then
      printf '%s\n' "gate: FAILED — lock lost after step '$name' (the heartbeat died or the lock no longer names this gate)" >&2
      exit 1
    fi
  fi
  if [ "$LOCK_HELD" -eq 1 ] && [ "$step_no" -eq "$last_locked" ]; then
    release_lock
    if [ "$release_failed" -eq 1 ]; then
      printf '%s\n' "gate: FAILED — the lock could not be released; the gate cannot report green while it lingers" >&2
      exit 1
    fi
  fi
done <<EOF
$STEPS
EOF

printf '%s\n' "gate: $total/$total steps passed"
exit 0