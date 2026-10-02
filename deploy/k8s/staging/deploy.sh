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
REQUIRED="NEXTAUTH_SECRET GITHUB_ID GITHUB_SECRET LLM_API_KEY LLM_BASE_URL LLM_MODEL WEB_LLM_API_KEY INCEPTION_API_KEY INCEPTION_MODEL STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_REPO_MONTHLY"

# shellcheck disable=SC2029 # expanding on the client side is intended
remote() { ssh "$NODE" "KUBECONFIG=\$HOME/.kube/config $*"; }

# Read KEY=VALUE lines without sourcing the file as shell.
BUILD_ARGS=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
    NEXT_PUBLIC_*=*) BUILD_ARGS="$BUILD_ARGS --build-arg $line" ;;
    *) echo "error: unexpected line in $DIR/build-args.env: $line" >&2; exit 1 ;;
  esac
done < "$DIR/build-args.env"

# Runs entirely on the node: kubectl's jsonpath output is piped to a node
# one-liner there, and only key names and decoded lengths come back. Returns 0
# only when the Secret exists and every required key is present and non-empty.
CHECK_JS='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  if(!s.trim()){console.log("Secret not found");process.exit(2)}
  const data=JSON.parse(s);const bad=[];
  for(const k of process.env.REQUIRED.split(" ")){
    const n=k in data?Buffer.from(data[k],"base64").length:-1;
    console.log("  "+k+": "+(n<0?"MISSING":n===0?"EMPTY":"length "+n));
    if(n<=0)bad.push(k)}
  if(bad.length){console.log("missing or empty: "+bad.join(" "));process.exit(1)}})'

check_secret() {
  js64=$(printf '%s' "$CHECK_JS" | base64 | tr -d '\n')
  if ! remote "kubectl -n $NS get secret $SECRET -o jsonpath='{.data}' 2>/dev/null | REQUIRED='$REQUIRED' node -e \"\$(echo $js64 | base64 -d)\""; then
    echo "secret check failed for $NS/$SECRET; see $DIR/README.md, section \"Secret\"." >&2
    return 1
  fi
}

render() {
  kubectl kustomize "$DIR" | sed "s#$REPO:latest#$IMAGE#"
}

BUILD_CMD="git archive --format=tar HEAD | docker --context $CONTEXT build -f apps/web/Dockerfile -t $IMAGE$BUILD_ARGS -"
PUSH_CMD="docker --context $CONTEXT push $IMAGE"

if [ "$MODE" = dry ]; then
  echo "== rendered manifests (image $IMAGE) =="
  render
  echo "== secret check (read-only) =="
  check_secret || echo "(secret check failed; a real deploy would stop here)"
  echo "== would run (not executed) =="
  echo "$BUILD_CMD"
  echo "$PUSH_CMD"
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
eval "$BUILD_CMD"

echo "== pushing $IMAGE =="
if ! push_out=$($PUSH_CMD 2>&1); then
  printf '%s\n' "$push_out" >&2
  case "$push_out" in
    *x509*) echo "error: the midnight docker daemon does not trust Harbor's certificate; see $DIR/README.md (Harbor trust)." >&2 ;;
  esac
  exit 1
fi
printf '%s\n' "$push_out"

echo "== applying =="
render | remote "kubectl apply -f -"
remote "kubectl -n $NS rollout status deployment/hexagen-web --timeout=10m"

echo "Deployed tag $TAG: https://hexagen.midnight.lan"
