# ADR-0065: Single-Container Compose Deployment

## Status

Accepted

## Context

The existing `k8s/deployment.yaml` manifests lack volume mounts and replica safety for the SQLite database. Attempting to deploy this to a multi-node Kubernetes cluster without a distributed database would result in state corruption and data loss, particularly due to SQLite's lack of concurrency control across separate disk volumes.

## Decision

We are removing the Kubernetes manifests (`k8s/deployment.yaml`). We commit to a single-container Docker compose deployment until Phase 2 multi-tenancy is built.

## Consequences

- **Positive:** Prevents data corruption by ensuring only one container interacts with the SQLite database. Simplifies the current deployment topology.
- **Negative:** We cannot scale out horizontally to multiple nodes until Phase 2 multi-tenancy is implemented with an appropriate distributed database or replication strategy.
