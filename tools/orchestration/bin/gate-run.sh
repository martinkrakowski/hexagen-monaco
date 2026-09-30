#!/bin/sh
# The run loop behind `hexagen-orchestration-gate`. The bin reads the overlay,
# resolves the step list, and spawns this with that list in the environment; this
# is where the loop lives, because the loop's correctness is a shell property
# (traps, signals, an exit code propagated verbatim) and a Node process would
# have to re-derive all three rather than inherit them.
#
# Runs the steps in the foreground, one after another, and prints each step's
# real exit code, stopping at the first failure by name.
#
# There is NO default step list and no built-in locked names. Both come from the
# bin, which is the only thing that knows the project's own configuration:
#   HEXAGEN_GATE_STEPS   one `name<TAB>command` line per step, in order —
#                        INCLUDING the steps the bin has marked to skip
#   HEXAGEN_GATE_LOCKED  the locked step names, space-separated, with a leading
#                        and a trailing space
#   HEXAGEN_GATE_SKIP    one `name<TAB>reason` line per skipped step; unset or
#                        empty means nothing is skipped
# An unset or empty HEXAGEN_GATE_STEPS is a refusal (exit 2), never an empty
# green run: a gate that silently runs nothing must not report green.
#
# The lock covers only the steps the bin marked locked — the ones that must not
# run concurrently on one host. It is taken just before the first locked step
# and released right after the last one; everything before it runs WITHOUT it.
# While it is held, a background heartbeat loop keeps the lock's `beat` fresh,
# and ONE trap (the EXIT trap; INT and TERM only turn the signal into an exit
# that falls through to it) releases the lock AND kills that loop, on failure
# and on signal alike. A release that fails or is refused is reported loudly,
# and a gate whose lock could not be released does not report green.
#
# At every locked-step boundary the loop also verifies the lock is still its
# own: the heartbeat loop is running (its failure marker catches the zombie a
# kill -0 cannot) and the lock still names this gate — either failing fails
# the gate as "lock lost", so a holder whose lock was reclaimed stops its
# protected steps instead of running them beside whoever holds the name. The
# between-steps window is testable via HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP.
#
# A coverage threshold failure fails the gate even when the step's own tool
# exits 0: EVERY step's output is captured, replayed for the human, and scanned
# for `ERROR: Coverage`. The rule is deliberately NAME-AGNOSTIC — the scan
# applies to whatever the overlay lists, because a coverage report can be
# produced by any step that produces one, and a scan keyed on a step's name
# would pass the moment somebody renamed the step that reports it. No
# environment variable is set for it: the source set NODE_ENV on its one
# coverage step, which is that project's business, not this loop's.
#
# A skipped step is printed and counted as SKIPPED, never as a passed step.
#
# POSIX sh (not zsh): CI runners do not ship zsh. `sh -n` on this file is part
# of its tests.
set -u

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
LOCK_SCRIPT="$HERE/gate-lock"
TAB=$(printf '\t')

# The lock's busy contract: gate-lock exits 75 when the holder is alive and
# fresh, and this script propagates that rather than burying it.
BUSY=75

# The locked names, exactly as the bin computed them. A leading and a trailing
# space are part of the contract: the match below is a plain substring test, and
# it is a WHOLE-NAME match only because a name holds no whitespace, so a name
# that does can never be locked.
HEXAGEN_GATE_LOCKED="${HEXAGEN_GATE_LOCKED:- }"
is_locked_step() {
  case "$1" in
    ''|*[[:space:]]*) return 1 ;;
  esac
  case "$HEXAGEN_GATE_LOCKED" in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
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
      printf '%s\n' "usage: hexagen-orchestration-gate [--lane <id>]" >&2
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

HB_SECONDS="${HEXAGEN_GATE_HEARTBEAT_SECONDS:-60}"
case "$HB_SECONDS" in
  ''|*[!0-9]*)
    printf '%s\n' "gate: HEXAGEN_GATE_HEARTBEAT_SECONDS must be a number of seconds: $HB_SECONDS" >&2
    exit 2
    ;;
esac

STEPS="${HEXAGEN_GATE_STEPS:-}"
SKIP="${HEXAGEN_GATE_SKIP:-}"
if [ -z "$STEPS" ]; then
  printf '%s\n' "gate: refusing to run — HEXAGEN_GATE_STEPS is unset or empty, so there is no step list to run; the gate never supplies one of its own" >&2
  exit 2
fi

# The reason HEXAGEN_GATE_SKIP records for a name, or nothing. A skipped step is
# still in HEXAGEN_GATE_STEPS: the tally counts every step the bin resolved, and
# a step that vanished from the list would silently shrink the denominator.
skip_reason() {
  while IFS="$TAB" read -r skip_name skip_why; do
    [ -n "$skip_name" ] || continue
    if [ "$skip_name" = "$1" ]; then
      printf '%s' "$skip_why"
      return 0
    fi
  done <<EOF
$SKIP
EOF
  return 1
}

is_skipped() {
  skip_reason "$1" >/dev/null 2>&1
}

# Validate and count before running: a gate that silently runs nothing must
# not report green, and a malformed step line must refuse before step one.
# `last_locked` is the index of the last locked step that actually RUNS — a
# skipped one never takes the lock, so it must not hold it open either.
total=0
last_locked=0
while IFS="$TAB" read -r name cmd; do
  [ -n "$name" ] || continue
  if [ -z "$cmd" ]; then
    printf '%s\n' "gate: step '$name' has no command — steps are name<TAB>command lines" >&2
    exit 2
  fi
  total=$((total + 1))
  if is_locked_step "$name" && ! is_skipped "$name"; then
    last_locked=$total
  fi
done <<EOF
$STEPS
EOF
if [ "$total" -eq 0 ]; then
  printf '%s\n' "gate: refusing to run — HEXAGEN_GATE_STEPS held no name<TAB>command line, so there is nothing to run" >&2
  exit 2
fi

LOCK_HELD=0
HEARTBEAT_PID=""
HB_FAILED="${TMPDIR:-/tmp}/hexagen-gate.hbfailed.$$"
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
    # failed (or was refused — see gate-lock) must be reported, never
    # announced as released.
    if HEXAGEN_GATE_CALLER_PID=$$ /bin/sh "$LOCK_SCRIPT" release "$LANE"; then
      printf '%s\n' "gate: lock released, heartbeat stopped"
    else
      release_failed=1
      printf '%s\n' "gate: FAILED to release the lock — it may still be held at ${TMPDIR:-/tmp}/hexagen-gate.lock" >&2
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
      if HEXAGEN_GATE_CALLER_PID=$$ /bin/sh "$LOCK_SCRIPT" heartbeat >/dev/null 2>&1; then
        continue
      fi
      printf '%s\n' "lost" > "$HB_FAILED" 2>/dev/null
      exit 1
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
  HEXAGEN_GATE_CALLER_PID=$$ /bin/sh "$LOCK_SCRIPT" verify "$LANE" >/dev/null 2>&1
}

# Run one step with its output captured, replayed for the human, and scanned for
# `ERROR: Coverage` — see the header. The scan applies to EVERY step, so the
# message below names whichever step produced the report rather than a step
# called anything in particular. The command's own exit code is returned; the
# scan is recorded separately in `cov_failed`.
run_step() {
  COVLOG=$(mktemp "${TMPDIR:-/tmp}/hexagen-gate.covlog.XXXXXX")
  eval "$1" > "$COVLOG" 2>&1
  code=$?
  cat "$COVLOG"
  if grep -q "ERROR: Coverage" "$COVLOG"; then
    cov_failed=1
  fi
  rm -f "$COVLOG"
  COVLOG=""
  return "$code"
}

step_no=0
skipped=0
while IFS="$TAB" read -r name cmd; do
  [ -n "$name" ] || continue
  step_no=$((step_no + 1))
  # A skip is decided by the bin, from the overlay, and is printed here: a step
  # that did not run must never read as a step that passed.
  if reason=$(skip_reason "$name"); then
    skipped=$((skipped + 1))
    printf 'SKIPPED %s (%s)\n' "$name" "$reason"
    continue
  fi
  printf '==> [%s/%s] %s\n' "$step_no" "$total" "$name"
  if is_locked_step "$name" && [ "$LOCK_HELD" -eq 0 ]; then
    # The caller's pid travels in HEXAGEN_GATE_CALLER_PID: the lock must outlive
    # this acquire call, so it names this shell, not the gate-lock child.
    HEXAGEN_GATE_CALLER_PID=$$ /bin/sh "$LOCK_SCRIPT" acquire "$LANE"
    acq=$?
    if [ "$acq" -ne 0 ]; then
      printf '%s\n' "gate: could not acquire the gate lock (exit $acq) — 75 means busy: sleep and retry" >&2
      exit "$acq"
    fi
    LOCK_HELD=1
    start_heartbeat
  fi
  if [ "$LOCK_HELD" -eq 1 ]; then
    # Test hook (HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP): between locked steps, for
    # the test that removes or replaces the lock in exactly that window.
    if [ -n "${HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP:-}" ]; then
      touch "$HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP" 2>/dev/null
      while [ -f "$HEXAGEN_GATE_TEST_PAUSE_BEFORE_STEP" ]; do sleep 1; done
    fi
    if ! check_lock_intact; then
      printf '%s\n' "gate: FAILED — lock lost before step '$name' (the heartbeat died or the lock no longer names this gate)" >&2
      exit 1
    fi
  fi
  cov_failed=0
  run_step "$cmd"
  code=$?
  printf '<== %s: exit %s\n' "$name" "$code"
  if [ "$cov_failed" -eq 1 ]; then
    printf '%s\n' "gate: FAILED at step '$name' — a coverage threshold failure was reported (the command exited $code)" >&2
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

passed=$((total - skipped))
if [ "$skipped" -eq 0 ]; then
  printf '%s\n' "gate: $passed/$total steps passed"
else
  printf '%s\n' "gate: $passed/$total steps passed, $skipped skipped"
fi
exit 0
