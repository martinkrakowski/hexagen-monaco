# Wire Pattern Documentation

## Overview

The wire pattern is a **dependency injection composition layer** that centralizes all port implementations and their lifecycle. Instead of scattering `new Adapter()` calls throughout the application, wire files provide a single source of truth for configuring how domain ports are satisfied by infrastructure adapters.

**Why split client/server/shared?**

- **Shared**: Factories that work in any context (Node.js, Browser, Deno, etc.)
- **Client**: Browser-only adapters (localStorage, IndexedDB, WebLLM, etc.)
- **Server**: Node.js-only adapters (execSync → async, fs, child_process, etc.)

This separation ensures webpack only bundles client-safe code into the Next.js bundle.

**When to use which file?**

- **wire.shared.ts** — Create environment-agnostic factories for LoggerPort, buses, LLM providers
- **wire.client.ts** — Register browser adapters (localStorage, IndexedDB, WebGPU, ephemeral vault)
- **wire.server.ts** — Project generation, architecture modification, manifest mutation (all async)
- **wire.ts** — Barrel export; use for imports in components/routes

## File Organization

### wire.shared.ts

**Purpose**: Environment-agnostic dependency factories.

**Pattern**:

```typescript
export const createWebLogger = (): LoggerPort => ({
  info: (msg) => console.log(`[web] ${msg}`),
  warn: (msg) => console.warn(`[web] ${msg}`),
  // ...
});

export const createEventBus = (): EventBusPort => new InMemoryEventBusAdapter();

export const createLLMProvider = (): LLMProviderPort => {
  const apiKey = process.env.NEXT_PUBLIC_LLM_API_KEY || "";
  return new ServerLLMAdapter(apiKey, baseUrl, model);
};
```

**Key constraint**: No browser-only APIs; no Node.js-only APIs. Import freely from packages using these factories.

### wire.client.ts

**Purpose**: Browser-only composition. Registers all client adapters.

**Pattern**:

```typescript
import { PORT_NAMES } from "@hexagen/web-driver/infrastructure/constants";

export const wireDependencies = () => {
  const registry = new Map<string, unknown>();

  const localStorageAdapter = new LocalStoragePersistenceAdapter();
  registry.set(
    PORT_NAMES.MONACO_PERSISTENCE,
    localStorageAdapter satisfies MonacoPersistencePort,
  );

  // ... register all client ports

  return {
    get: <T>(portName: string): T => {
      const instance = registry.get(portName);
      if (!instance) {
        throw new Error(`No implementation registered for port: ${portName}`);
      }
      return instance as T;
    },
  };
};

export const dependencies = wireDependencies();

// Typed convenience getters
export const getMonacoPersistence = () =>
  dependencies.get<MonacoPersistencePort>(PORT_NAMES.MONACO_PERSISTENCE);
```

**Key rules**:

- Always use `PORT_NAMES.<CONSTANT>` instead of string literals
- Type adapters with `satisfies InterfacePort` for compile-time safety
- Never import client-only libraries in server contexts

### wire.server.ts

**Purpose**: Server-only composition. Handles project generation, architecture modification.

**Pattern**:

```typescript
export const getModifyArchitectureUseCase = (
  mode: PipelineMode = "in-memory",
): ModifyArchitectureUseCase => {
  const llmSender = createLLMSender(mode);
  const reconcileUseCase = new ReconcileUseCase(
    new StructuredDiffReconciliationAdapter(),
    // ...
  );

  const deps: ModifyArchitectureDeps = {
    nlParser: new InMemoryNLParserAdapter(),
    promptCompiler: new InMemoryPromptCompilerAdapter(),
    llmSender,
    reconcileUseCase,
    transactionManager: new InMemoryTransactionManager(),
    // ...
  };

  return new ModifyArchitectureUseCase(deps);
};
```

**Key constraint**: Use `async` adapters (no `execSync`, no `readFileSync`). Return results via Promise.

### wire.ts

**Purpose**: Backward-compatible barrel export.

**Pattern**:

```typescript
export * from "./wire.shared.js";

// Client-only getters available in browser context
export * from "./wire.client.js" with { ssr: false };

// Server-only getters available in API routes
export * from "./wire.server.js" with { ssr: false };
```

## Adding a New Port

### Step 1: Define the Port Interface

Create `packages/web-driver/src/application/ports/in/my-feature.port.ts`:

```typescript
export interface MyFeaturePort {
  execute(input: MyInput): Promise<MyOutput>;
}
```

### Step 2: Create the Adapter

Create `packages/web-driver/src/infrastructure/adapters/my-feature.adapter.ts`:

```typescript
import type { MyFeaturePort } from "../../../application/ports/in/my-feature.port.js";

export class MyFeatureAdapter implements MyFeaturePort {
  async execute(input: MyInput): Promise<MyOutput> {
    // Implementation
  }
}
```

### Step 3: Add to PORT_NAMES Constants

Update `packages/web-driver/src/infrastructure/constants/port-names.ts`:

```typescript
export const PORT_NAMES = {
  // ... existing ports
  MY_FEATURE: "MyFeaturePort", // Add here
};
```

### Step 4: Register in Wire (Client or Server)

**For browser adapters** (wire.client.ts):

```typescript
registry.set(
  PORT_NAMES.MY_FEATURE,
  new MyFeatureAdapter() satisfies MyFeaturePort,
);
```

**For server adapters** (wire.server.ts):

```typescript
export const getMyFeature = (): MyFeaturePort => new MyFeatureAdapter();
```

### Step 5: Create Typed Getter

**Client**:

```typescript
export const getMyFeature = () =>
  dependencies.get<MyFeaturePort>(PORT_NAMES.MY_FEATURE);
```

**Server** (already done in Step 4).

## Common Pitfalls

### ❌ Importing wire.server in React Component

```typescript
// DON'T DO THIS
import { getModifyArchitecture } from "@/lib/wire.server";

export function MyComponent() {
  const useCase = getModifyArchitecture(); // ERROR: runs on server when hydrating
}
```

**Fix**: Only import wire.server in API routes.

### ❌ Using Magic Strings Instead of PORT_NAMES

```typescript
// DON'T DO THIS
registry.set("MonacoPersistencePort", adapter);
const adapter = registry.get("MonacoPersistencePort"); // String typo not caught until runtime
```

**Fix**: Always use PORT_NAMES constants:

```typescript
registry.set(PORT_NAMES.MONACO_PERSISTENCE, adapter);
const adapter = registry.get(PORT_NAMES.MONACO_PERSISTENCE); // Type-safe
```

### ❌ Forgetting to Await Async Adapters

```typescript
// DON'T DO THIS
export async function POST() {
  const violations = runViolations(manifest); // Forgot await
  return violations; // Type mismatch: Promise<Violation[]> ≠ Violation[]
}
```

**Fix**: Always await async functions:

```typescript
export async function POST() {
  const violations = await runViolations(manifest);
  return violations;
}
```

### ✅ Best Practices

1. **Use constants**: `PORT_NAMES.LOGGER` not `"LoggerPort"`
2. **Type adapters**: `new MyAdapter() satisfies MyPortInterface`
3. **Lazy load**: Return singleton getters for expensive adapters
4. **Async by default**: Replace `execSync` with `exec(...promisify)`
5. **Document errors**: Provide `isValidPortName()` runtime checks for fallback behavior

## Testing Your Wire

### Manual Verification

```typescript
// In browser console or test file
import { getMonacoPersistence } from "@/lib/wire";

const adapter = getMonacoPersistence();
console.log(adapter.read("test-key")); // Should work
```

### Integration Test

```typescript
import { getModifyArchitecture } from "@/lib/wire.server";

describe("wire.server", () => {
  it("getModifyArchitecture returns a valid use case", () => {
    const useCase = getModifyArchitecture("in-memory");
    expect(useCase.execute).toBeDefined();
  });
});
```

### Performance Check

Monitor wire initialization time:

```typescript
const start = performance.now();
const adapter = getMonacoPersistence();
const elapsed = performance.now() - start;
console.log(`Wire getter took ${elapsed}ms`); // Should be <1ms for lazy-loaded singletons
```

## Performance Considerations

**Lazy loading prevents webpack bundling Node.js code**:

- Import wire.server only in API routes (`"use server"` boundaries)
- Import wire.client only in browser components

**Async/await prevents UI blocking**:

- Replace `execSync("yarn lint:arch")` with `await execAsync("yarn lint:arch", { timeout: 30000 })`
- UI remains responsive during long-running operations

**Constants caught at compile-time**:

- Typos in `PORT_NAMES.MONACO_PERSISTENCE` caught before runtime
- No string lookup overhead; direct property access

## See Also

- Port definitions: `packages/web-driver/src/application/ports/`
- Adapter implementations: `packages/web-driver/src/infrastructure/adapters/`
- Constants: `packages/web-driver/src/infrastructure/constants/port-names.ts`
- Client entry: `apps/web/app/lib/wire.client.ts`
- Server entry: `apps/web/app/lib/wire.server.ts`
