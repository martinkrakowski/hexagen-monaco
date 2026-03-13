# ADR-0006: Project Generation Runtime Resolution

## Status

Accepted

## Date

2025-03-13

## Context

The `/api/generate` endpoint needed to import `@hexagen/project-generation` at runtime to execute the `GenerateProjectUseCase`. However, several blockers existed:

### Blocker 1: TypeScript Configuration

The `project-generation` package had `emitDeclarationOnly: true` in its `tsconfig.json`:

```json
{
  "compilerOptions": {
    "emitDeclarationOnly": true  // Only emits .d.ts, no .js files
  }
}
```

This prevented Next.js from resolving the package at runtime because there were no JavaScript files to import.

### Blocker 2: Turbopack Resolution

Turbopack (Next.js's fast refresh engine) lacks support for `extensionAlias` resolution, which is required to map `.js` imports back to `.ts` source files in the monorepo.

### Blocker 3: Node.js Dependencies in Client Bundle

The initial wiring attempted to import `ExternalSyncEngineAdapter` and `JsZipCreatorAdapter` in `wire.ts`. These adapters use Node.js modules (`node:path`, `node:fs`, `os`), which cannot be bundled into client-side React components.

## Decision

### 1. Enable JavaScript Emission

Changed `emitDeclarationOnly` to `false` in `packages/project-generation/tsconfig.json`:

```json
{
  "compilerOptions": {
    "emitDeclarationOnly": false  // Emits both .js and .d.ts files
  }
}
```

This mirrors the fix applied to the `sync` package in ADR-0002.

### 2. Server-Side Wiring Pattern

Created a separate wiring file `apps/web/app/lib/wire.project-generation.ts` that:

- Imports only the project-generation adapters
- Uses lazy initialization to create the use case singleton
- Is imported only by API routes (server-side)

```typescript
// wire.project-generation.ts — server-only
let generateProjectUseCase: GenerateProjectUseCase | null = null;

export const getGenerateProject = (): GenerateProjectUseCase => {
  if (!generateProjectUseCase) {
    const externalGenerator = new ExternalSyncEngineAdapter();
    const zipCreator = new JsZipCreatorAdapter();
    generateProjectUseCase = new GenerateProjectUseCase(
      externalGenerator,
      zipCreator,
    );
  }
  return generateProjectUseCase;
};
```

The main `wire.ts` only imports browser-compatible adapters (localStorage), keeping Node.js dependencies isolated.

### 3. ZIP Binary Response

Implemented ZIP download by returning binary data from the API route:

```typescript
if (zipBuffer) {
  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${project.name}-${Date.now()}.zip"`,
    },
  });
}
```

The `Content-Disposition: attachment` header triggers the browser to auto-download the file.

## Consequences

### Positive

- ✅ Project generation works end-to-end
- ✅ ZIP files auto-download in browser
- ✅ Node.js dependencies isolated to server-side code
- ✅ Follows hexagonal architecture (use case receives ports, not implementations)
- ✅ Pattern can be reused for other server-only packages

### Negative

- ⚠️ Webpack required for dev/build (`--webpack` flag)
- ⚠️ Two-step wiring pattern adds slight complexity
- ⚠️ Temp directories accumulate in `/tmp` until system cleanup

### Known Limitations

- Windows 260-character path limit may affect deeply nested project structures
- Large projects load entire ZIP into memory (streaming not implemented)

## Related ADRs

- [ADR-0000](./0000-nextjs-webpack-over-vite.md) — Webpack over Vite
- [ADR-0002](./0002-sync-engine-structural-fixes.md) — Sync engine emitDeclarationOnly fix
- [ADR-0003](./0003-external-project-generation-mvp.md) — External project generation

## References

- [Phase 3.1: Wire Project Generation](./decisions/)
- [Phase 3.2: ZIP Download](./decisions/)
