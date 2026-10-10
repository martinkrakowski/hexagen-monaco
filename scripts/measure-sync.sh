#!/usr/bin/env bash
# Measurement only, no gating: fleet plan 2026-10-10 "CI under five minutes", step 0.
# Prints what the hardened sync changes (source diff, gitignored files, dist checksums,
# turbo dry-run cache status) so decision F48 (parallel checks on the committed tree)
# or F56 (checks must keep waiting for the sync) can be made on evidence.
# Always exits 0 — this script can never fail the job that calls it.
# Runs in three stages: after-build, after-sync, after-forced-build.
# Remove this script together with the "Measure:" workflow steps when
# decision F48 or F56 is recorded.
set +e
stage="${1:-}"
m="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sync-measure"
mkdir -p "$m"

# checksums of gitignored files outside node_modules, dist, .next and .turbo
hash_ignored() { git ls-files -o -i --exclude-standard -z | grep -zvE '(^|/)(node_modules|dist|\.next|\.turbo)/' | sort -z | xargs -0 -r sha256sum; }
# checksums of turbo's own log folders
hash_turbo() { git ls-files -o -i --exclude-standard -z | grep -zE '(^|/)\.turbo/' | grep -zvE '(^|/)node_modules/' | sort -z | xargs -0 -r sha256sum; }
# checksums of every built file
hash_dist() { git ls-files -o -i --exclude-standard -z | grep -zE '(^|/)dist/' | grep -zvE '(^|/)(node_modules|\.next)/' | sort -z | xargs -0 -r sha256sum; }

case "$stage" in
after-build)
  date -u +"measure-start %Y-%m-%dT%H:%M:%SZ"
  # (b) gitignored files outside node_modules, dist, .next and turbo's folders
  hash_ignored > "$m/ignored-before.txt"
  # turbo's own log folders, listed apart so they do not hide anything else
  hash_turbo > "$m/turbo-before.txt"
  # (c) every built file
  hash_dist > "$m/dist-after-first-build.txt"
  echo "ignored files (b) before the sync: $(wc -l < "$m/ignored-before.txt")"
  echo "dist files (c) after the first build: $(wc -l < "$m/dist-after-first-build.txt")"
  # (d) Would the sync's inner `npx turbo run build` (preflight.ts) be
  # served from turbo's cache right now? A dry run executes nothing and
  # reports each task's cache status. It runs the way the sync runs it:
  # through `yarn workspace @hexagen/sync`, from the repository root.
  echo "===== (d) turbo dry run before the sync: cache status of the inner build's tasks ====="
  yarn workspace @hexagen/sync exec sh -c 'cd "$PROJECT_CWD" && npx turbo run build --dry=json' > "$m/dry-before.json" 2> "$m/dry-before.err"
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const d = JSON.parse(raw.slice(raw.indexOf("{")));
    const tasks = d.tasks || [];
    const miss = tasks.filter((t) => !t.cache || t.cache.status !== "HIT");
    console.log("tasks: " + tasks.length + ", cache HIT: " + (tasks.length - miss.length) + ", MISS: " + miss.length);
    for (const t of miss) console.log("MISS " + t.taskId);
  ' "$m/dry-before.json" || { echo "(d) dry run could not be read"; head -c 2000 "$m/dry-before.json"; head -c 2000 "$m/dry-before.err"; }
  date -u +"measure-end %Y-%m-%dT%H:%M:%SZ"
  ;;
after-sync)
  date -u +"measure-start %Y-%m-%dT%H:%M:%SZ"
  echo "===== (a) git status --porcelain after the sync (empty means no source changed) ====="
  git status --porcelain
  echo "===== (a) lines: $(git status --porcelain | wc -l) ====="
  echo "===== (a) git diff --stat ====="
  git diff --stat
  # The content, not only the stat: the workflow uploads this folder as an
  # artifact so a person can read what the sync rewrote before deciding F48.
  mkdir -p "$m/publish"
  git status --porcelain > "$m/publish/status.txt"
  git diff --binary > "$m/publish/tracked.patch"
  git ls-files -o --exclude-standard > "$m/publish/untracked-files.txt"
  git ls-files -o --exclude-standard -z | tar --null -czf "$m/publish/untracked.tar.gz" -T -
  echo "===== (a) published for upload: $(wc -l < "$m/publish/tracked.patch") patch lines, $(wc -l < "$m/publish/untracked-files.txt") untracked files ====="
  echo "===== (b) gitignored files changed, added or removed by the sync ====="
  hash_ignored > "$m/ignored-after.txt"
  diff "$m/ignored-before.txt" "$m/ignored-after.txt" > "$m/ignored.diff"
  cat "$m/ignored.diff" | head -200
  echo "===== (b) differing lines: $(grep -cE '^[<>]' "$m/ignored.diff") ====="
  hash_turbo > "$m/turbo-after.txt"
  echo "===== (b) turbo log files differing: $(diff "$m/turbo-before.txt" "$m/turbo-after.txt" | grep -cE '^[<>]') ====="
  echo "===== (c) dist after the first build against dist after the sync's inner build ====="
  hash_dist > "$m/dist-after-sync.txt"
  diff "$m/dist-after-first-build.txt" "$m/dist-after-sync.txt" > "$m/dist-sync.diff"
  cat "$m/dist-sync.diff" | head -100
  echo "===== (c) dist differing lines after the sync: $(grep -cE '^[<>]' "$m/dist-sync.diff") of $(wc -l < "$m/dist-after-sync.txt") files ====="
  # (d) Would the sync's inner `npx turbo run build` (preflight.ts) be
  # served from turbo's cache right now? A dry run executes nothing and
  # reports each task's cache status. It runs the way the sync runs it:
  # through `yarn workspace @hexagen/sync`, from the repository root.
  echo "===== (d) turbo dry run after the sync: cache status of the inner build's tasks ====="
  yarn workspace @hexagen/sync exec sh -c 'cd "$PROJECT_CWD" && npx turbo run build --dry=json' > "$m/dry-after.json" 2> "$m/dry-after.err"
  node -e '
    const fs = require("fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const d = JSON.parse(raw.slice(raw.indexOf("{")));
    const tasks = d.tasks || [];
    const miss = tasks.filter((t) => !t.cache || t.cache.status !== "HIT");
    console.log("tasks: " + tasks.length + ", cache HIT: " + (tasks.length - miss.length) + ", MISS: " + miss.length);
    for (const t of miss) console.log("MISS " + t.taskId);
  ' "$m/dry-after.json" || { echo "(d) dry run could not be read"; head -c 2000 "$m/dry-after.json"; head -c 2000 "$m/dry-after.err"; }
  date -u +"measure-end %Y-%m-%dT%H:%M:%SZ"
  ;;
after-forced-build)
  date -u +"measure-start %Y-%m-%dT%H:%M:%SZ"
  echo "===== (c) dist after the first build against dist after the FORCED rebuild ====="
  hash_dist > "$m/dist-after-forced-build.txt"
  diff "$m/dist-after-first-build.txt" "$m/dist-after-forced-build.txt" > "$m/dist-forced.diff"
  cat "$m/dist-forced.diff" | head -100
  echo "===== (c) dist differing lines after the forced rebuild: $(grep -cE '^[<>]' "$m/dist-forced.diff") of $(wc -l < "$m/dist-after-forced-build.txt") files ====="
  echo "===== (a) git status --porcelain after the forced rebuild, lines: $(git status --porcelain | wc -l) ====="
  date -u +"measure-end %Y-%m-%dT%H:%M:%SZ"
  ;;
*) echo "measure-sync: unknown stage '$stage'" ;;
esac

exit 0
