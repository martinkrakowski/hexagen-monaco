#!/bin/sh
# Dispatch helper for orchestrators emitting wave-status events around direct dispatch.
#
# Usage:
#   wave-event.sh [<logdir>] <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']
#   wave-event.sh --logdir <dir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']
#
# Standalone dispatch examples (logdir defaults to ~/.waves/wave-<wave>, or existing /tmp/wave-<wave>):
#   wave-event.sh <wave> <lane> dispatch started
#   wave-event.sh <wave> <lane> implement settled --pr <PR_NUMBER>
#   wave-event.sh <wave> <lane> implement failed --detail '{"reason":"killed"}'
exec "$(dirname "$0")/../../../../scripts/wave-event.sh" "$@"
