# ADR-0065: Single-Container Compose Deployment

## Status

Accepted. **Supersedes ADR-0064** — that ADR decided to keep and fix the k8s manifests; this one removes them, and the tree follows this one (both landed in #528).

Amended 2026-10-08 by ADR-0071, see the amendment at the end of this document.

## Context

The existing `k8s/deployment.yaml` manifests lack volume mounts and replica safety for the SQLite database. Attempting to deploy this to a multi-node Kubernetes cluster without a distributed database would result in state corruption and data loss, particularly due to SQLite's lack of concurrency control across separate disk volumes.

## Decision

We are removing the Kubernetes manifests (`k8s/deployment.yaml`). We commit to a single-container Docker compose deployment until Phase 2 multi-tenancy is built.

## Consequences

- **Positive:** Prevents data corruption by ensuring only one container interacts with the SQLite database. Simplifies the current deployment topology.
- **Negative:** We cannot scale out horizontally to multiple nodes until Phase 2 multi-tenancy is implemented with an appropriate distributed database or replication strategy.

## Amendment — 2026-10-08: Postgres cutover allowed by ADR-0071

ADR-0071 records the owner's decision to move the platform database from SQLite to Postgres (plan `docs/planning/2026-10-07_indexeddb-to-postgres-migration-plan.md` §8, D-2, decided 2026-10-08). The original text above is unchanged. What changes:

- The Context sentence about SQLite on separate disk volumes, and the Consequences line "ensuring only one container interacts with the SQLite database", describe the old backend. For `platform.db` and `byok.db` they are replaced by ADR-0071. They stay true for `quota.db` (plan §8, D-2 and D-7, decided 2026-10-08).
- The Decision sentence "We commit to a single-container Docker compose deployment until Phase 2 multi-tenancy is built." is not changed by this amendment. `quota.db` and the in-process rate limiter still depend on one process (plan §8, D-7, decided 2026-10-08).
- The Negative consequence "We cannot scale out horizontally to multiple nodes until Phase 2 multi-tenancy is implemented with an appropriate distributed database or replication strategy." now has a shared database for the platform data. Scale-out is not decided here (plan §8, D-2, decided 2026-10-08).
