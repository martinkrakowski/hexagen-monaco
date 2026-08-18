# ADR-0064: Deploy Topology Is Single-Container

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Operations
**Runbook ID:** D-4
**Relates to:** ADR-0063 (quota-D2 — metering policy, not topology); `apps/web/lib/quota-store.ts`, `apps/web/lib/byok-store.ts`; `deploy/docker-compose.prod.yml`

> Numbering note: Phase −1 batch. The historical ADR-0009/0010 numbering collisions are not reused.

## Context

The live deploy is a single web container. `deploy/docker-compose.prod.yml` mounts the named volume `hexagen-monaco-quota-data` at `/data` and sets:

- `QUOTA_DB_PATH=/data/quota.db`
- `BYOK_DB_PATH=/data/byok.db`

Both stores document the same contract: better-sqlite3, single process, WAL. Production defaults in code are `/data/quota.db` and `/data/byok.db` when `NODE_ENV=production`.

`k8s/deployment.yaml` contradicted that topology: `replicas: 2`, no volume, no mount, no db-path env. Applying the manifest as written gives each replica an ephemeral empty SQLite. Free-tier quotas double and reset per-pod. Revoked BYOK keys silently un-revoke (AUD-007's exact failure mode). The in-process rate limiter (`apps/web/lib/rate-limiter.ts`) is a per-process `Map` and has the same replica problem.

The database story for >1 process (Postgres, tenancy) is Phase 2 work, gated on this topology decision. The k8s contradiction is a today-level footgun, not a Phase 2 prerequisite.

Two same-day options: delete the k8s manifests, or fix them so they cannot be applied as a 2-replica ephemeral SQLite.

## Decision

**Single-container is the live topology until a later amendment.** Do not delete the k8s manifests. Fix them:

- `replicas: 1`
- a `PersistentVolumeClaim` mounted at `/data`
- `QUOTA_DB_PATH=/data/quota.db` and `BYOK_DB_PATH=/data/byok.db` (the same env names and paths `quota-store` / `byok-store` and `deploy/docker-compose.prod.yml` already use)
- `strategy: Recreate`, so a rolling update cannot deadlock on the `ReadWriteOnce` volume
- pod `securityContext.fsGroup` / `runAsUser` / `runAsGroup`: `1001` (the image `USER nextjs`), so the PVC is writable — a k8s volume does not inherit the Dockerfile `chown` that makes the compose named volume work

A second replica, a shared SQLite, or a Postgres cutover is out of scope. Those are Phase 2, and they require amending this ADR first. ADR-0063 continues to freeze metering _behavior_; this ADR only makes the existing SQLite files survive a pod.

## Consequences

- Applying `k8s/deployment.yaml` can no longer create two pods with empty local DBs.
- Phase 2 persistence / tenancy work honors this topology: schema lands on the single-container SQLite (or an explicit successor decided later), not on an assumed multi-replica cluster.
- The compose deploy remains the production path. k8s is now a non-lying description of the same topology, not an accidental HA sketch.
- `rate-limiter.ts` stays an in-process `Map`. Moving it to the DB is required only if replicas ever exceed 1, which this ADR forbids until amended.
