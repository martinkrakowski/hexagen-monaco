#!/bin/sh
# Dispatch helper for orchestrators emitting wave-status events around direct dispatch.
#
# Usage:
#   wave-event.sh [<logdir>] <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']
#   wave-event.sh --logdir <dir> <wave> <lane> <stage> <event> [--pr N] [--round N] [--detail '<json>']
#
# Standalone dispatch examples (logdir defaults to the wave's directory under the
# config.yaml waveLogDir, or an existing /tmp/wave-<wave>):
#   wave-event.sh <wave> <lane> dispatch started
#   wave-event.sh <wave> <lane> implement settled --pr <PR_NUMBER>
#   wave-event.sh <wave> <lane> implement failed --detail '{"reason":"killed"}'
#
# This shim resolves nothing by path. The emitter is the package's own binary, so
# the script works from any directory, any worktree, and after any move — there is
# no directory count to keep correct.
exec hexagen-orchestration-wave-event "$@"
