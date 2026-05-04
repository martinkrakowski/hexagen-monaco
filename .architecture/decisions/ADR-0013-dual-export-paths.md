# ADR-0013: Project Generation — Dual Export Paths (Zip + GitHub)

**Date:** 2026-04-07
**Status:** Accepted
**Type:** Architecture

## Context

The project generation system needed to support multiple export destinations beyond just creating a zip file in a temp directory. Specifically, users wanted to initialize their generated hexagonal architecture directly on GitHub rather than downloading a zip.

The challenge was integrating this without violating hexagonal architecture — the domain logic (GenerateProjectUseCase) should remain decoupled from the delivery mechanism.

## Decision

**Introduce a ProjectExporterPort that abstracts the export destination, with two implementations: ArchiveExporterAdapter (zip) and GitHubExporterAdapter (GitHub API).**

### Architecture Change

Before:

```
GenerateProjectUseCase
  ├── ExternalSyncEngineAdapter.generateAt() → /tmp/dir
  └── ZipCreatorAdapter.createZip() → Buffer
```

After:

```
GenerateProjectUseCase
  ├── ExternalSyncEngineAdapter.generateAt() → /tmp/dir
  └── ProjectExporterPort.export()
        ├── ArchiveExporterAdapter (zip)
        └── GitHubExporterAdapter (GitHub REST API)
```

### Port Interface

```typescript
export type ExportDestination = "archive" | "github";

export interface ExportConfig {
  destination: ExportDestination;
  github?: {
    token: string;
    owner: string;
    repoName: string;
    isPrivate: boolean;
  };
}

export interface ProjectExporterPort {
  export(sourceDirectory: string, config: ExportConfig): Promise<ExportResult>;
}
```

## Rationale

- **Separation of concerns** — Use case orchestrates; exporter handles delivery
- **Extensibility** — New destinations (S3, FTP) just need new adapter
- **Testability** — Each adapter can be unit tested in isolation
- **Serverless-compatible** — GitHub exporter uses REST API, not git CLI

## GitHub Implementation

The GitHubExporterAdapter uses the Git Database API (not the naive file-by-file API) to create a single atomic commit:

1. Create repo via `POST /user/repos`
2. Read files from temp directory
3. Create blobs in parallel via `POST /repos/{owner}/{repo}/git/blobs`
4. Create tree via `POST /repos/{owner}/{repo}/git/trees`
5. Create commit via `POST /repos/{owner}/{repo}/git/commits`
6. Update main ref via `PATCH /repos/{owner}/{repo}/git/refs/heads/main`

This approach avoids rate limits by creating one commit rather than N file operations.

## Security

The GitHub token and owner are injected server-side, not passed from the client:

- Client sends: `destination: "github"`, `repoName: "my-app"`, `isPrivate: true`
- Server injects: `token` (from session/env), `owner` (from session/env)

This prevents token exposure in client-side JavaScript and keeps authentication logic in the adapter layer.

## Consequences

### Positive

- Clean hexagonal boundaries maintained
- Easy to add new export destinations
- GitHub integration works on serverless (Vercel, etc.)
- Single atomic commit, no rate limit issues

### Negative

- More complexity in use case (temp dir lifecycle)
- Need to handle cleanup of temp directory after export
- GitHub token management requires external auth solution (NextAuth)

## References

- `packages/project-generation/src/application/ports/out/project-exporter.port.ts`
- `packages/project-generation/src/infrastructure/adapters/github-exporter.adapter.ts`
- `apps/web/app/api/generate/route.ts`
- ADR-0014 (Code Generation as Post-Bootstrap Event)
