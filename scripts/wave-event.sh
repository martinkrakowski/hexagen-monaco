#!/bin/sh
# Append one wave-status event to <logdir>/events.jsonl (plan D103, §2.1).
#
#   wave-event.sh <logdir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']
#
# Output is byte-identical to formatEvent in tools/wave-status/lib/emit.ts for
# the same input, so the two writers cannot drift apart. Two consequences for
# callers, both checked before any write: --detail must be a compact JSON object
# (no spaces), and <wave>/<lane> must match ^[A-Za-z0-9_-]+$.
#
# POSIX sh (not zsh): GitHub Linux runners do not ship zsh. Validate first,
# append last: an unknown stage or event, a non-token wave/lane, or a --detail
# that is not a JSON object exits 2 with the reason on stderr and nothing is
# written — a rejected event must never reach the log, not even as garbage a
# reader would have to reject later.
set -u

[ $# -ge 5 ] || {
  printf '%s\n' "usage: $0 <logdir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']" >&2
  exit 2
}
LOGDIR="$1"; WAVE="$2"; LANE="$3"; STAGE="$4"; EVENT="$5"; shift 5

stages="dispatch implement gate review remediate sweep merge record"
kinds="started settled failed"

stage_ok=0
for s in dispatch implement gate review remediate sweep merge record; do
  if [ "$s" = "$STAGE" ]; then
    stage_ok=1
    break
  fi
done
[ "$stage_ok" -eq 1 ] || {
  printf '%s\n' "unknown stage: $STAGE — stage is one of: $stages; event is one of: $kinds" >&2
  exit 2
}

event_ok=0
for k in started settled failed; do
  if [ "$k" = "$EVENT" ]; then
    event_ok=1
    break
  fi
done
[ "$event_ok" -eq 1 ] || {
  printf '%s\n' "unknown event: $EVENT — stage is one of: $stages; event is one of: $kinds" >&2
  exit 2
}

pr="" round="" detail=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr)
      [ $# -ge 2 ] || { printf '%s\n' "missing value for $1" >&2; exit 2; }
      pr="$2"
      shift 2
      ;;
    --round)
      [ $# -ge 2 ] || { printf '%s\n' "missing value for $1" >&2; exit 2; }
      round="$2"
      shift 2
      ;;
    --detail)
      [ $# -ge 2 ] || { printf '%s\n' "missing value for $1" >&2; exit 2; }
      detail="$2"
      shift 2
      ;;
    *)
      printf '%s\n' "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [ -n "$pr" ]; then
  case "$pr" in
    *[!0-9]*)
      printf '%s\n' "--pr must be a number: $pr" >&2
      exit 2
      ;;
  esac
fi
if [ -n "$round" ]; then
  case "$round" in
    *[!0-9]*)
      printf '%s\n' "--round must be a number: $round" >&2
      exit 2
      ;;
  esac
fi

token_re='^[A-Za-z0-9_-]+$'
case "$WAVE" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' "invalid wave: $WAVE — must match $token_re" >&2
    exit 2
    ;;
esac
case "$LANE" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' "invalid lane: $LANE — must match $token_re" >&2
    exit 2
    ;;
esac
if [ -n "$detail" ]; then
  if ! python3 -c 'import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if isinstance(d, dict) else 1)' "$detail" 2>/dev/null; then
    printf '%s\n' "--detail must be a JSON object: $detail" >&2
    exit 2
  fi
fi

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
line="{\"ts\":\"$ts\",\"wave\":\"$WAVE\",\"lane\":\"$LANE\",\"stage\":\"$STAGE\",\"event\":\"$EVENT\""
[ -z "$pr" ] || line="${line},\"pr\":$pr"
[ -z "$round" ] || line="${line},\"round\":$round"
[ -z "$detail" ] || line="${line},\"detail\":$detail"
line="${line}}"

mkdir -p "$LOGDIR"
printf '%s\n' "$line" >> "$LOGDIR/events.jsonl"
