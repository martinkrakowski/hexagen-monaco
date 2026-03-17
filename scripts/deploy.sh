#!/bin/bash
set -euo pipefail

# =============================================================================
# Deployment Script: hexagen-monaco
# 
# Usage:
#   ./scripts/deploy.sh                           # Interactive mode
#   ./scripts/deploy.sh -t myregistry.io -e dev # Dev environment
#   ./scripts/deploy.sh -t myregistry.io -e prod # Prod environment
#   ./scripts/deploy.sh -i myimage -g v1.0.0    # Override image name and tag
# =============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
REGISTRY="${DOCKER_REGISTRY:-docker.io}"
IMAGE_NAME="${DOCKER_IMAGE_NAME:-hexagen-monaco}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
KUBECONFIG="${KUBECONFIG:-}"

# Parse arguments
while getopts "t:e:k:i:g:vh" opt; do
  case $opt in
    t) REGISTRY="$OPTARG" ;;
    e) ENVIRONMENT="$OPTARG" ;;
    k) KUBECONFIG="$OPTARG" ;;
    i) IMAGE_NAME="$OPTARG" ;;
    g) TAG="$OPTARG" ;;
    v) VERBOSE=1 ;;
    h)
      echo "Usage: $0 [-t registry] [-e environment] [-k kubeconfig] [-i image] [-g tag] [-v]"
      echo ""
      echo "Options:"
      echo "  -t  Docker registry (default: docker.io)"
      echo "  -e  Environment: dev|staging|prod (default: dev)"
      echo "  -k  Kubeconfig path (default: ~/.kube/config)"
      echo "  -i  Image name (default: hexagen-monaco)"
      echo "  -g  Image tag (default: git short hash)"
      echo "  -v  Verbose output"
      echo ""
      echo "Environment variables:"
      echo "  DOCKER_REGISTRY      Docker registry (default: docker.io)"
      echo "  DOCKER_IMAGE_NAME    Image name (default: hexagen-monaco)"
      echo "  TAG                  Image tag (default: git short hash)"
      exit 0
      ;;
    \?) exit 1 ;;
  esac
done

# Derived values
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Pre-flight checks
log_info "Pre-flight checks..."

# Check Docker
if ! command -v docker &> /dev/null; then
  log_error "Docker not found. Please install Docker."
  exit 1
fi

# Check kubectl (optional for local build only)
if ! command -v kubectl &> /dev/null; then
  log_warn "kubectl not found. Skipping cluster deployment."
  SKIP_KUBECTL=1
fi

# Check we're in the right directory
if [[ ! -f "package.json" ]]; then
  log_error "Not in project root. Run from monorepo root."
  exit 1
fi

# Validate environment
case $ENVIRONMENT in
  dev|staging|prod) ;;
  *)
    log_error "Invalid environment: $ENVIRONMENT (use: dev, staging, prod)"
    exit 1
    ;;
esac

log_success "Pre-flight checks passed"

# =============================================================================
# Step 1: Build
# =============================================================================
log_info "Building Docker image..."
log_info "  Registry: $REGISTRY"
log_info "  Image:   $IMAGE_NAME"
log_info "  Tag:     $TAG"

# Build with buildx for multi-platform support
docker buildx build \
  --tag "$FULL_IMAGE" \
  --tag "$LATEST_IMAGE" \
  --file apps/web/Dockerfile \
  --load \
  .

log_success "Docker image built: $FULL_IMAGE"

# =============================================================================
# Step 2: Push
# =============================================================================
log_info "Pushing to registry..."

docker push "$FULL_IMAGE"
docker push "$LATEST_IMAGE"

log_success "Image pushed to registry"

# =============================================================================
# Step 3: Deploy to Cluster (if kubectl available)
# =============================================================================
if [[ -n "${SKIP_KUBECTL:-}" ]]; then
  log_warn "Skipping cluster deployment (kubectl not available)"
  log_info "To deploy manually, run:"
  echo "  kubectl set image deployment/hexagen-web web=$FULL_IMAGE"
  exit 0
fi

# Set kubeconfig if provided
if [[ -n "$KUBECONFIG" ]]; then
  export KUBECONFIG
  log_info "Using kubeconfig: $KUBECONFIG"
fi

# Check cluster connectivity
if ! kubectl cluster-info &> /dev/null; then
  log_error "Cannot connect to cluster. Check kubeconfig."
  exit 1
fi

# Apply deployment
log_info "Deploying to $ENVIRONMENT environment..."

# Replace image in k8s manifest
K8S_MANIFEST="k8s/deployment.yaml"
if [[ -f "$K8S_MANIFEST" ]]; then
  # Use envsubst or sed to replace IMAGE_NAME
  IMAGE_PLACEHOLDER="IMAGE_NAME"
  
  # Create temp file
  TMP_MANIFEST=$(mktemp)
  
  # Replace placeholder
  sed "s|$IMAGE_PLACEHOLDER|$FULL_IMAGE|g" "$K8S_MANIFEST" > "$TMP_MANIFEST"
  
  # Apply
  kubectl apply -f "$TMP_MANIFEST"
  
  # Rollout status
  log_info "Waiting for rollout..."
  kubectl rollout status deployment/hexagen-web -n "$K8S_NAMESPACE" --timeout=120s
  
  # Cleanup
  rm -f "$TMP_MANIFEST"
  
  log_success "Deployed to cluster!"
  
  # Show status
  kubectl get pods -l app=hexagen-web -n "$K8S_NAMESPACE"
else
  log_warn "K8s manifest not found at $K8S_MANIFEST"
  log_info "To deploy manually:"
  echo "  kubectl set image deployment/hexagen-web web=$FULL_IMAGE"
fi

echo ""
log_success "Deployment complete!"
log_info "Image: $FULL_IMAGE"
log_info "Environment: $ENVIRONMENT"