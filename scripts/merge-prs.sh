#!/usr/bin/env zsh
#
# merge-prs.sh — sequentially refresh, verify and squash-merge a set of PRs.
#
# Usage:
#   scripts/merge-prs.sh "<pr>|<worktree-or-empty>|<branch>" ...
#
# Example:
#   scripts/merge-prs.sh "41|../cf-wt-seeded-random|feat/seeded-random" "42||fix/typo"
#
# For each PR, in order:
#   1. Refresh the branch from origin/<main>. Conflicts are auto-resolved ONLY for
#      ordinary text conflicts in append-only files (see APPEND_ONLY) by keeping both
#      sides; anything else — a different path, a modify/delete, a binary conflict, a
#      failed resolution — aborts the merge and exits non-zero.
#   2. Push the refreshed branch.
#   3. Wait for CI on the new head — poll until checks are REGISTERED, then watch
#      (`gh pr checks --watch --fail-fast`). A fixed sleep races the forge; see #206.
#   4. Squash-merge.
# Then remove the worktrees and delete the merged branches, and fast-forward main.
#
# When the worktree field is empty a temporary worktree is created for the refresh and
# removed afterwards, so EVERY pr is refreshed and re-verified — never merged stale.
#
# Why sequential: each merge changes main, so every later PR must be re-verified against
# it. Why not `gh pr merge --auto`: repos without auto-merge enabled reject it. Why no
# `--delete-branch` on merge: git refuses to delete a branch that a worktree holds, so
# branches are deleted after the worktrees are removed.
set -u -o pipefail

REPO=$(git rev-parse --show-toplevel) || exit 1
MAIN=${MAIN_BRANCH:-main}

# Files where two branches legitimately append and both sides must survive.
# Extend for your repo (a session log, a hand-maintained barrel, a changelog).
# Files that concurrent lanes routinely append to, where keeping BOTH sides of a
# conflict hunk is the correct resolution. The web barrel and the message catalogue
# earned their place the hard way: every wave with two parallel lanes touches them,
# and without them the second merge of each wave aborts. Only ever add a file whose
# lanes append at the END — the resolver preserves order, not intent.
# The check whose conclusion gates a merge (regex over check-run names). A run that
# registers instantly — a review bot — must never satisfy the wait on its own.
REQUIRED_CHECK=${REQUIRED_CHECK:-'^(Build & Sync Integrity Check|Verify Sync Engine)'}
APPEND_ONLY=${APPEND_ONLY:-'^(CHANGELOG\.md|docs/planning/[^/]+\.md|\.agents/session-log\.md)$'}

KEEP_BOTH='
import re, sys
path = sys.argv[1]
text = open(path).read()
merged = re.sub(r"<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n",
                lambda m: m.group(1) + m.group(2), text, flags=re.S)
if merged == text or "<<<<<<<" in merged:
    sys.exit("keep-both resolver made no progress on " + path)
open(path, "w").write(merged)
'

die() { echo "ERROR: $*" >&2; exit 1 }

# Auto-resolve the current merge, or fail. Only ordinary text conflicts (index stages
# 1+2+3, regular file, conflict markers present) in APPEND_ONLY paths are eligible.
resolve_append_only_or_die() {
  # NB: never name a local `path` in zsh — it is tied to $PATH and shadowing it
  # empties PATH inside the function (every git/awk/sort call then fails).
  local conflicts file stages
  # `git ls-files -u` is the canonical unmerged listing; `git diff --diff-filter=U`
  # carries diff exit-code semantics that vary with config.
  conflicts=$(git ls-files -u | awk '{print $4}' | sort -u)
  [[ -n "$conflicts" ]] || die "merge failed with no conflicted paths (check the working tree)"

  for file in ${(f)conflicts}; do
    echo "$file" | grep -qE "$APPEND_ONLY" \
      || { git merge --abort; die "UNEXPECTED CONFLICT in: ${conflicts//$'\n'/ }" }
    # 1=base 2=ours 3=theirs. Anything else is modify/delete or add/add of a special file.
    stages=$(git ls-files -u -- "$file" | awk '{print $3}' | sort -u | tr '\n' ',')
    [[ "$stages" == "1,2,3," ]] \
      || { git merge --abort; die "non-content conflict (stages $stages) in $file — resolve by hand" }
    git ls-files -u -- "$file" | awk '{print $1}' | grep -qv '^100644$' \
      && { git merge --abort; die "non-regular-file conflict in $file — resolve by hand" }
    grep -q '^<<<<<<< ' "$file" \
      || { git merge --abort; die "no conflict markers in $file (binary or already resolved) — resolve by hand" }
  done

  for file in ${(f)conflicts}; do
    python3 -c "$KEEP_BOTH" "$file" || { git merge --abort; die "keep-both failed on $file" }
    git add -- "$file" || { git merge --abort; die "git add failed for $file" }
  done

  [[ -z "$(git ls-files -u)" ]] \
    || { git merge --abort; die "unmerged entries remain after resolution" }
  git commit -q --no-edit || die "merge commit failed after resolution"
  echo "resolved append-only conflicts: ${conflicts//$'\n'/ }"
}

# Merge origin/$MAIN into the checked-out branch here, resolving only append-only files.
refresh_here() {
  git merge -q --no-edit "origin/$MAIN" || resolve_append_only_or_die
}

typeset -a WORKTREES BRANCHES
for spec in "$@"; do
  pr=${spec%%|*}; rest=${spec#*|}; worktree=${rest%%|*}; branch=${rest#*|}
  WORKTREES+=("$worktree"); BRANCHES+=("$branch")
  echo "=== PR #$pr ($branch)"

  cd "$REPO" || die "cannot cd to $REPO"
  git fetch -q origin "$MAIN" || die "git fetch origin $MAIN failed — refusing to merge against a stale ref"

  if [[ -n "$worktree" && -d "$worktree" ]]; then
    cd "$worktree" || die "cannot cd to $worktree"
    refresh_here
    git push -q origin "$branch" || die "push failed for $branch"
    pushed_sha=$(git rev-parse HEAD)
    cd "$REPO" || die "cannot cd back to $REPO"
  else
    # No worktree supplied: refresh in a throwaway one so this PR is not merged stale.
    # Detached at origin/<branch>, then push HEAD to the branch ref: `git worktree add`
    # refuses a branch that is already checked out somewhere else, which is the common
    # case (the main checkout, or another lane's worktree).
    git fetch -q origin "$branch" || die "cannot fetch $branch"
    tmp=$(mktemp -d "${TMPDIR:-/tmp}/merge-prs-XXXXXX") || die "mktemp failed"
    git worktree add -q --detach "$tmp" "origin/$branch" \
      || { rm -rf "$tmp"; die "cannot create temp worktree for $branch" }
    ( cd "$tmp" && refresh_here && git push -q origin "HEAD:refs/heads/$branch" ) \
      || { git worktree remove --force "$tmp"; die "refresh/push failed for $branch" }
    pushed_sha=$(git -C "$tmp" rev-parse HEAD)
    git worktree remove --force "$tmp" || die "cannot remove temp worktree $tmp"
  fi

  # Wait for the forge to REGISTER checks on the new head before watching them.
  # A fixed sleep is a race: when the refresh push outruns registration, `gh pr checks`
  # reports "no checks reported", `--fail-fast` treats that as a failure, and the merge
  # aborts on a PR that is perfectly healthy. Observed on #206. Poll for checks to
  # exist, then watch; a PR that genuinely has no checks configured still errors out,
  # but only after we have given the forge a fair chance to say so.
  # Poll the NEW HEAD's check-runs, not the PR's check list. `gh pr checks --json name`
  # answers at PR level and is satisfied by a check that registered instantly (a review
  # bot) or by one carried from the pre-refresh head — so it returns >0 while the head
  # that `--watch` resolves still has none, and the watch reports "no checks reported"
  # anyway. That is how the first version of this guard still lost the race, twice.
  # Re-read the head each pass rather than pinning it once: `--watch` resolves the PR's
  # head independently, so a push landing mid-poll would leave the guard asking about a
  # commit the watch has already moved past — the same guard-and-watch-disagree shape as
  # the bug this whole block exists to fix. An empty answer counts as not-yet-registered
  # rather than aborting, because a transient API hiccup is not a verdict.
  # Ask about the commit THIS script just pushed, never about whatever `gh` says the head
  # is. Observed on #224: after the refresh push, `gh pr view --json headRefOid` still
  # answered the previous SHA for a while; that SHA's runs had just been CANCELLED by the
  # new push, so "not success" read as a failed PR while the real head's checks were
  # pending. If the forge later reports a head that is not ours, someone else pushed —
  # stop rather than verify a commit we did not refresh.
  head_sha=$pushed_sha
  registered=0
  for _ in $(seq 1 40); do            # up to ~10 minutes at 15s
    forge_head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid 2>/dev/null || true)
    if [ -n "$forge_head" ] && [ "$forge_head" != "$head_sha" ] && [ "$(git merge-base --is-ancestor "$head_sha" "$forge_head" 2>/dev/null; echo $?)" = "0" ]; then
      die "PR #$pr head moved to $forge_head after our push of $head_sha — someone else pushed; not merging"
    fi
    if [ -n "$head_sha" ]; then
      n=$(gh api "repos/{owner}/{repo}/commits/$head_sha/check-runs" \
        --jq "[.check_runs[] | select(.name | test(\"$REQUIRED_CHECK\"))] | length" 2>/dev/null || echo 0)
      if [ "${n:-0}" -gt 0 ]; then registered=1; break; fi
    fi
    sleep 15
  done
  [ "$registered" -eq 1 ] \
    || { echo "NO CHECKS REGISTERED for #$pr after ~10m — not merging"; exit 1 }
  # Do NOT use `gh pr checks --watch` here. Observed on #217: the check-runs API for the
  # head reported 2 runs registered, and `--watch` on the same PR still said "no checks
  # reported" — the two resolve the head differently for a window after a push, and
  # `--fail-fast` turns that window into an aborted merge on a healthy PR. Poll the same
  # API the registration guard used, until every run has concluded.
  # Both loops key on REQUIRED_CHECK, not on "whatever has registered": observed on #222
  # and #219, a review bot's run registers and concludes within seconds of the push, so
  # "the list is non-empty and every run is completed" was true before the build workflow
  # had registered at all, and the script declared green beside a `pending` line. The
  # question is never "has everything so far finished" — it is "has the check that gates
  # this repo finished".
  echo "waiting for checks on $head_sha …"
  concluded=0
  for _ in $(seq 1 120); do          # up to ~30 minutes at 15s
    runs=$(gh api "repos/{owner}/{repo}/commits/$head_sha/check-runs" \
      --jq '[.check_runs[] | {n:.name, s:.status, c:.conclusion}]' 2>/dev/null || echo '[]')
    pending=$(printf '%s' "$runs" | python3 -c 'import json,sys;r=json.load(sys.stdin);print(sum(1 for x in r if x["s"]!="completed"))')
    required=$(printf '%s' "$runs" | python3 -c 'import json,sys,re;r=json.load(sys.stdin);print(sum(1 for x in r if re.search(sys.argv[1],x["n"])))' "$REQUIRED_CHECK")
    if [ "${pending:-1}" -eq 0 ] && [ "${required:-0}" -gt 0 ]; then
      concluded=1; break
    fi
    sleep 15
  done
  [ "$concluded" -eq 1 ] || { echo "CHECKS STILL PENDING for #$pr after ~30m — not merging"; exit 1 }
  bad=$(printf '%s' "$runs" | python3 -c 'import json,sys;r=json.load(sys.stdin);print(",".join(x["n"] for x in r if x["c"] not in ("success","neutral","skipped")))')
  [ -z "$bad" ] || { echo "CHECKS FAILED for #$pr: $bad"; gh pr checks "$pr"; exit 1 }
  echo "checks green on $head_sha"; gh pr checks "$pr" 2>&1 | tail -3
  gh pr merge "$pr" --squash || die "squash-merge failed for #$pr"
  echo "merged #$pr"
done

cd "$REPO" || die "cannot cd to $REPO"
for worktree in $WORKTREES; do
  [[ -n "$worktree" && -d "$worktree" ]] && git worktree remove --force "$worktree" \
    && echo "removed $worktree"
done
git worktree prune
for branch in $BRANCHES; do
  git branch -D "$branch" 2>/dev/null
  git push -q origin --delete "$branch" 2>/dev/null && echo "deleted origin/$branch"
done
git checkout -q "$MAIN" && git pull -q --ff-only origin "$MAIN" && git log --oneline -8
echo "ALL DONE"
