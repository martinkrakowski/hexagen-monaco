#!/usr/bin/env bash
#
# Decision F48: the parallel CI legs run on the committed tree. That is only
# valid if the hardened sync changes no source. This runs after
# `sync --force --allow-dirty` and fails when `git status --porcelain` is not
# empty, naming the files. NOT covered, because git status does not show them:
# - gitignored files: build outputs, SYNC-MIGRATION-REPORT.md, and anything
#   matching the repository's ignore rules for packages/*/src/**/*.js and
#   *.d.ts. No generator writes such a file today; build outputs rest on the
#   build being deterministic;
# - a change to an ignored file that already exists;
# - an empty directory the sync creates or removes (git tracks no directories).

set -euo pipefail

status="$(git status --porcelain)"

if [ -z "$status" ]; then
  echo "sync changed no tracked or untracked file"
  exit 0
fi

echo '::error::The hardened sync rewrote the committed tree. Run "yarn sync:force" locally and commit the result (or fix the generator/template that disagrees).'
echo "$status"
git diff --stat
exit 1
