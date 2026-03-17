#!/bin/bash
set -euo pipefail

# =============================================================================
# Deployment Script: hexagen-monaco
#
# Usage:
#   ./scripts/deploy.sh                           # Uses .env values
#   ./scripts/deploy.sh -t myregistry.io -g v1.0.0  # Override values
#
# Environment variables (set in .env or passed via CLI):
#   REGISTRY         Docker registry (e.g., registry.example.com)
#   IMAGE_NAME       Image name (e.g., library/hexagen-monaco)
#   TAG              Image tag (default: git short hash)
#   K8S_NAMESPACE    Kubernetes namespace (default: webapps)
#   HOST             Ingress hostname (e.g., hexagen.example.com)
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Extract deploy vars from .env (safer than sourcing - ignores commented lines)
# Use awk for more robust parsing
if [[ -f ".env" ]]; then
  REGISTRY=$(awk -F= '!/^#/ && /^REGISTRY=/ {print $2}' .env)
  IMAGE_NAME=$(awk -F= '!/^#/ && /^IMAGE_NAME=/ {print $2}' .env)
  TAG=$(awk -F= '!/^#/ && /^TAG=/ {print $2}' .env)
  K8S_NAMESPACE=$(awk -F= '!/^#/ && /^K8S_NAMESPACE=/ {print $2}' .env)
  HOST=$(awk -F= '!/^#/ && /^HOST=/ {print $2}' .env)
fi

# Defaults
REGISTRY="${REGISTRY:-}"
IMAGE_NAME="${IMAGE_NAME:-library/hexagen-monaco}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
K8S_NAMESPACE="${K8S_NAMESPACE:-webapps}"
HOST="${HOST:-}"
KUBECONFIG="${KUBECONFIG:-}"

# Parse arguments
while getopts "t:i:g:n:h:k:vh" opt; do
  case $opt in
    t) REGISTRY="$OPTARG" ;;
    i) IMAGE_NAME="$OPTARG" ;;
    g) TAG="$OPTARG" ;;
    n) K8S_NAMESPACE="$OPTARG" ;;
    h) HOST="$OPTARG" ;;
    k) KUBECONFIG="$OPTARG" ;;
    v) VERBOSE=1 ;;
    \?)
      echo "Usage: $0 [-t registry] [-i image] [-g tag] [-n namespace] [-h host] [-k kubeconfig] [-v]"
      echo ""
      echo "Options:"
      echo "  -t  Docker registry (required)"
      echo "  -i  Image name (default: library/hexagen-monaco)"
      echo "  -g  Image tag (default: git short hash)"
      echo "  -n  Kubernetes namespace (default: webapps)"
      echo "  -h  Ingress hostname (optional)"
      echo "  -k  Kubeconfig path (optional)"
      echo "  -v  Verbose output"
      echo ""
      echo "Or set values in .env file"
      exit 0
      ;;
  esac
done

# Validate required
if [[ -z "$REGISTRY" ]]; then
  echo -e "${RED}[ERROR]${NC} REGISTRY is required. Set in .env or use -t flag"
  exit 1
fi

# Derived values
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Pre-flight checks
log_info "Pre-flight checks..."

if ! command -v docker &> /dev/null; then
  log_error "Docker not found. Please install Docker."
  exit 1
fi

if ! command -v kubectl &> /dev/null; then
  log_warn "kubectl not found. Skipping cluster deployment."
  SKIP_KUBECTL=1
fi

if [[ ! -f "package.json" ]]; then
  log_error "Not in project root. Run from monorepo root."
  exit 1
fi

log_success "Pre-flight checks passed"

# =============================================================================
# Step 1: Build and Push
# =============================================================================
log_info "Building Docker image..."
log_info "  Registry: $REGISTRY"
log_info "  Image:   $IMAGE_NAME"
log_info "  Tag:     $TAG"

docker buildx build \
  --tag "$FULL_IMAGE" \
  --tag "$LATEST_IMAGE" \
  --file apps/web/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  --push \
  .

log_success "Image built and pushed: $FULL_IMAGE"

# =============================================================================
# Step 2: Deploy to Cluster
# =============================================================================
if [[ -n "${SKIP_KUBECTL:-}" ]]; then
  log_warn "Skipping cluster deployment (kubectl not available)"
  log_info "To deploy manually, run:"
  echo "  kubectl set image deployment/hexagen-web web=$FULL_IMAGE -n $K8S_NAMESPACE"
  exit 0
fi

if [[ -n "$KUBECONFIG" ]]; then
  export KUBECONFIG
  log_info "Using kubeconfig: $KUBECONFIG"
fi

if ! kubectl cluster-info &> /dev/null; then
  log_error "Cannot connect to cluster. Check kubeconfig."
  exit 1
fi

log_info "Deploying to Kubernetes..."

# Create temp dir for manifests
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Process deployment manifest
if [[ -f "k8s/deployment.yaml" ]]; then
  export FULL_IMAGE
  envsubst < k8s/deployment.yaml > "$TMP_DIR/deployment.yaml"
fi

# Process ingress manifest if host provided
if [[ -n "$HOST" ]] && [[ -f "k8s/ingress.yaml" ]]; then
  export HOST
  envsubst < k8s/ingress.yaml > "$TMP_DIR/ingress.yaml"
fi

# Apply manifests
kubectl apply -f "$TMP_DIR/deployment.yaml" -n "$K8S_NAMESPACE"

if [[ -n "$HOST" ]] && [[ -f "$TMP_DIR/ingress.yaml" ]]; then
  kubectl apply -f "$TMP_DIR/ingress.yaml" -n "$K8S_NAMESPACE"
fi

log_info "Waiting for rollout..."
kubectl rollout status deployment/hexagen-web -n "$K8S_NAMESPACE" --timeout=120s

log_success "Deployed to cluster!"
kubectl get pods -l app=hexagen-web -n "$K8S_NAMESPACE"

echo ""
log_success "Deployment complete!"
log_info "Image: $FULL_IMAGE"
if [[ -n "$HOST" ]]; then
  log_info "URL: http://$HOST"
fi
