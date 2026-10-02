#!/bin/sh
# Build the web image from tracked files, push it to Harbor, and update the
# hexagen-web deployment on the staging k3s node. See README.md.
set -eu

usage() {
  echo "usage: yarn deploy:staging [--yes | --dry-run]" >&2
  exit 2
}

MODE=ask
if [ "$#" -gt 1 ]; then usage; fi
if [ "$#" -eq 1 ]; then
  case "$1" in
    --yes) MODE=yes ;;
    --dry-run) MODE=dry ;;
    *) usage ;;
  esac
fi

shift "$#" # "$@" is reused below for the build arguments

cd "$(git rev-parse --show-toplevel)"
DIR=deploy/k8s/staging

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty; commit or stash first (the image is built from HEAD)." >&2
  exit 1
fi

TAG=$(git rev-parse --short HEAD)
REPO=registry.midnight.lan/library/hexagen-monaco
IMAGE=$REPO:$TAG
CONTEXT=${STAGING_DOCKER_CONTEXT:-midnight}
NODE=${STAGING_SSH:-m}
NS=webapps
SECRET=hexagen-web-env
REQUIRED="NEXTAUTH_SECRET GITHUB_ID GITHUB_SECRET LLM_API_KEY LLM_BASE_URL LLM_MODEL WEB_LLM_API_KEY INCEPTION_API_KEY INCEPTION_MODEL"

# shellcheck disable=SC2029 # expanding on the client side is intended
remote() { ssh "$NODE" "KUBECONFIG=\$HOME/.kube/config $*"; }

# Read KEY=VALUE lines without sourcing or evaluating the file. Each line must
# be NEXT_PUBLIC_*=<value> with a conservative value charset; the values become
# positional parameters, so nothing is ever re-parsed by the shell.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  case "$line" in
    NEXT_PUBLIC_*=*) ;;
    *) echo "error: unexpected line in $DIR/build-args.env" >&2; exit 1 ;;
  esac
  value=${line#*=}
  case "$value" in
    ''|*[!A-Za-z0-9._/:=-]*)
      echo "error: build-args.env: value for ${line%%=*} is empty or has a character outside [A-Za-z0-9._/:=-]" >&2
      exit 1 ;;
  esac
  set -- "$@" --build-arg "$line"
done < "$DIR/build-args.env"

# Names and decoded lengths are produced on the node by kubectl's go-template,
# so values never leave it. Per key the node reports the length and a "quoted"
# flag when the value starts with a quote character (kubectl's go-template has
# no arithmetic, so the closing quote cannot be inspected). `--from-env-file`
# keeps quotes, so KEY="v" is stored with them. stderr is kept: kubectl error text carries no data.
# shellcheck disable=SC2016 # the $k/$v are go-template variables, not shell
SECRET_TPL='{{range $k,$v := .data}}{{$d := base64decode $v}}{{$k}} {{len $d}}{{if gt (len $d) 0}}{{$f := slice $d 0 1}}{{if or (eq $f "\"") (eq $f (printf "%c" 39))}} quoted{{end}}{{end}}{{"\n"}}{{end}}'

check_secret() {
  errf=$(mktemp)
  if ! out=$(remote "kubectl -n $NS get secret $SECRET -o go-template='$SECRET_TPL'" 2>"$errf"); then
    if grep -qiE 'NotFound|not found' "$errf"; then
      echo "secret check: Secret $NS/$SECRET was not found." >&2
    else
      echo "secret check: kubectl failed:" >&2
      cat "$errf" >&2
    fi
    echo "See $DIR/README.md, section \"Secret\"." >&2
    rm -f "$errf"
    return 1
  fi
  rm -f "$errf"
  missing=""
  for want in $REQUIRED; do
    row=$(printf '%s\n' "$out" | while read -r name n flag; do
      if [ "$name" = "$want" ]; then echo "$n ${flag:-ok}"; fi
    done)
    len=${row%% *}
    flag=${row#* }
    case "$len" in
      '') echo "  $want: MISSING"; missing="$missing $want" ;;
      0) echo "  $want: EMPTY"; missing="$missing $want" ;;
      *[!0-9]*) echo "  $want: UNREADABLE"; missing="$missing $want" ;;
      *)
        if [ "$flag" = quoted ]; then
          echo "  $want: length $len, QUOTED (value is wrapped in quotes; --from-env-file keeps them, remove the quotes)"
          missing="$missing $want"
        else
          echo "  $want: length $len"
        fi ;;
    esac
  done
  if [ -n "$missing" ]; then
    echo "secret check: missing or empty:$missing" >&2
    echo "See $DIR/README.md, section \"Secret\"." >&2
    return 1
  fi
}

render() {
  kubectl kustomize "$DIR" | sed "s#$REPO:latest#$IMAGE#"
}

if [ "$MODE" = dry ]; then
  echo "== rendered manifests (image $IMAGE) =="
  render
  echo "== secret check (read-only) =="
  check_secret || echo "(secret check failed; a real deploy would stop here)"
  echo "== would run (not executed) =="
  printf '%s ' git archive --format=tar HEAD '|' docker --context "$CONTEXT" build -f apps/web/Dockerfile -t "$IMAGE" "$@" -
  echo
  printf '%s ' docker --context "$CONTEXT" push "$IMAGE"
  echo
  echo "== apply --dry-run=server =="
  render | remote "kubectl apply --dry-run=server -f -"
  echo "== diff against live objects =="
  # kubectl diff exits 1 when there are differences; that is not an error here.
  render | remote "kubectl diff -f -" || [ "$?" -eq 1 ]
  exit 0
fi

echo "Deploying $IMAGE to $NS/hexagen-web via ssh $NODE and docker context $CONTEXT."
if [ "$MODE" = ask ]; then
  if [ ! -t 0 ]; then
    echo "error: no TTY to confirm; pass --yes to proceed." >&2
    exit 1
  fi
  printf 'Proceed? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "aborted."; exit 1 ;; esac
fi

echo "== checking Secret $SECRET =="
check_secret || exit 1

echo "== building $IMAGE =="
# POSIX sh has no pipefail, so a failing `git archive` is not seen directly.
# docker rejects a truncated tar, so the build (and the script) still fails.
git archive --format=tar HEAD | docker --context "$CONTEXT" build -f apps/web/Dockerfile -t "$IMAGE" "$@" -

echo "== pushing $IMAGE =="
pushlog=$(mktemp)
statf=$(mktemp)
{ docker --context "$CONTEXT" push "$IMAGE" 2>&1; echo $? > "$statf"; } | tee "$pushlog"
if [ "$(cat "$statf")" != 0 ]; then
  if grep -q x509 "$pushlog"; then
    echo "error: the midnight docker daemon does not trust Harbor's certificate; see $DIR/README.md (Harbor trust)." >&2
  fi
  rm -f "$pushlog" "$statf"
  exit 1
fi
rm -f "$pushlog" "$statf"

echo "== applying =="
render | remote "kubectl apply -f -"
remote "kubectl -n $NS rollout status deployment/hexagen-web --timeout=10m"

echo "Deployed tag $TAG: https://hexagen.midnight.lan"
