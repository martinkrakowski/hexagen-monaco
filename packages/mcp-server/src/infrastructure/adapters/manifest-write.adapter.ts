import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { Result } from "@hexagen/shared";
import { isIndexManifest } from "@hexagen/project-configuration";
import type {
  AddDependencyCommand,
  ManifestWritePort,
  RegisterBoundedContextCommand,
  RegisterPortCommand,
  RegisterAdapterCommand,
  RemoveAdapterCommand,
  RemoveDependencyCommand,
  RemovePortCommand,
  RemoveContextCommand,
} from "../../application/ports/out/manifest-write.port.js";
import { readManifestDocument, type ManifestDocument } from "./manifest-io.js";

type ManifestContexts = NonNullable<ManifestDocument["bounded_contexts"]>;

// GOVERNANCE GATE — hostile-input validation. Remove commands arrive from the
// MCP tool layer (untrusted). Every check below is O(1) per command field.
const MAX_COMMAND_FIELD_LENGTH = 4096;
const PROTOTYPE_POLLUTING_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function assertPlainCommandObject(command: unknown): void {
  if (
    command === null ||
    command === undefined ||
    typeof command !== "object" ||
    Array.isArray(command)
  ) {
    throw new Error(
      "Invalid command: expected a plain object with named fields.",
    );
  }
  // Plain-prototype gate: only Object.prototype (or null) is accepted. An
  // object inheriting from anything else (class instance, Object.create with
  // a custom proto, Proxy over one) is refused BEFORE any field read, so an
  // inherited getter is never triggered. O(1).
  const proto = Object.getPrototypeOf(command);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(
      "Invalid command: expected a plain object with named fields.",
    );
  }
  for (const key of Object.keys(command)) {
    if (PROTOTYPE_POLLUTING_KEYS.has(key)) {
      throw new Error(`Invalid command: prohibited key "${key}".`);
    }
  }
  // Every field must be an own data property — a getter or setter on any own
  // key is refused without invoking it (descriptor inspection only). O(fields).
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(command),
  )) {
    if (
      typeof descriptor.get === "function" ||
      typeof descriptor.set === "function"
    ) {
      throw new Error(`Invalid command: property "${key}" is a getter.`);
    }
  }
}

function asCommandString(value: unknown, field: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Invalid ${field}: must be a non-blank string.`);
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${field}: must be a string.`);
  }
  if (value.length > MAX_COMMAND_FIELD_LENGTH) {
    throw new Error(
      `Invalid ${field}: exceeds maximum length of ${MAX_COMMAND_FIELD_LENGTH}.`,
    );
  }
  if (value.trim().length === 0) {
    throw new Error(`Invalid ${field}: must be a non-blank string.`);
  }
  return value;
}

// Inspect own property descriptors only — a getter is never invoked.
function assertNoGetter(source: object, key: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor && typeof descriptor.get === "function") {
    throw new Error(`Invalid command: property "${key}" is a getter.`);
  }
}

// Real arrays only: Array.isArray (not array-likes), no holes. O(N) over the
// collection, bounded by manifest size.
function assertRealArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  if (value.length > 0 && !(0 in value)) {
    throw new Error(`${label} must not contain holes.`);
  }
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) {
      throw new Error(`${label} must not contain holes.`);
    }
  }
  return value;
}

/**
 * Returns a dependency path from `from` to `to` following `depends_on`
 * edges (BFS), or null when `to` is unreachable. Used to refuse
 * dependency additions that would close a cycle.
 */
function findDependencyPath(
  contexts: ManifestContexts,
  from: string,
  to: string,
): string[] | null {
  const byName = new Map(contexts.map((ctx) => [ctx.name, ctx]));
  const queue: string[][] = [[from]];
  const visited = new Set<string>([from]);

  while (queue.length > 0) {
    const pathSoFar = queue.shift()!;
    const current = byName.get(pathSoFar[pathSoFar.length - 1]);
    for (const dep of current?.depends_on ?? []) {
      if (dep === to) return [...pathSoFar, dep];
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push([...pathSoFar, dep]);
      }
    }
  }
  return null;
}

export class ManifestWriteAdapter implements ManifestWritePort {
  constructor(private readonly workspaceRoot: string) {}

  private async atomicWrite(manifest: Record<string, unknown>): Promise<void> {
    const manifestPath = path.join(
      this.workspaceRoot,
      ".architecture",
      "manifest.yaml",
    );

    // GOVERNANCE GATE — split-manifest guard. readManifestDocument MERGES a
    // v2.0 split manifest (index entries with `file:` pointers) into a single
    // document; dumping that merged document back over the index file would
    // destroy the split layout and inline every context file. The same guard
    // exists in writeManifestDocument (manifest-io.ts) — this adapter has its
    // own write path, so it needs its own check against the ON-DISK file.
    // NOTE: non-atomic check — a race between this read and the rename below
    // is possible; acceptable for single-operator local tooling (TUI/stdio).
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      if (isIndexManifest(yaml.load(raw))) {
        throw new Error(
          "Cannot write to a split (v2.0 index) manifest via MCP write tools: " +
            "the write would overwrite the index file with the merged document. " +
            "Edit the per-context files under .architecture/contexts/ instead.",
        );
      }
    } catch (error) {
      // A missing file cannot be an index manifest — allow the write to create it.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const tempPath = `${manifestPath}.tmp`;
    const content = yaml.dump(manifest, {
      indent: 2,
      sortKeys: false,
      lineWidth: 0,
    });
    await fs.writeFile(tempPath, content, "utf-8");
    await fs.rename(tempPath, manifestPath);
  }

  async validateDependency(
    command: AddDependencyCommand,
  ): Promise<Result<{ valid: boolean; errors: string[] }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const names = new Set(contexts.map((context) => context.name));
      const errors: string[] = [];

      if (!names.has(command.sourceModule)) {
        errors.push(`Source module not found: ${command.sourceModule}`);
      }
      if (!names.has(command.targetModule)) {
        errors.push(`Target module not found: ${command.targetModule}`);
      }
      if (command.sourceModule === command.targetModule) {
        errors.push("Source and target modules cannot be the same");
      }

      // GOVERNANCE GATE — cycle check. Refuse a dependency whose target
      // already reaches the source through existing depends_on edges.
      if (errors.length === 0) {
        const cyclePath = findDependencyPath(
          contexts,
          command.targetModule,
          command.sourceModule,
        );
        if (cyclePath) {
          errors.push(
            `Dependency would create a cycle: ${command.sourceModule} → ${cyclePath.join(" → ")}`,
          );
        }
      }

      return {
        success: true,
        value: {
          valid: errors.length === 0,
          errors,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async addDependency(
    command: AddDependencyCommand,
  ): Promise<Result<{ updated: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const source = contexts.find(
        (context) => context.name === command.sourceModule,
      );

      if (!source) {
        return {
          success: false,
          error: new Error(`Source module not found: ${command.sourceModule}`),
        };
      }

      if (!contexts.some((context) => context.name === command.targetModule)) {
        return {
          success: false,
          error: new Error(`Target module not found: ${command.targetModule}`),
        };
      }

      // GOVERNANCE GATE — self-edge check. The BFS below cannot catch a fresh
      // self-edge (no existing edge reaches the source yet), so refuse it
      // explicitly, mirroring validateDependency.
      if (command.sourceModule === command.targetModule) {
        return {
          success: false,
          error: new Error(
            `Source and target modules cannot be the same: ${command.sourceModule}`,
          ),
        };
      }

      // GOVERNANCE GATE — cycle check (same rule as validateDependency, but
      // enforced here too: the write path must not trust callers to have
      // validated first).
      const cyclePath = findDependencyPath(
        contexts,
        command.targetModule,
        command.sourceModule,
      );
      if (cyclePath) {
        return {
          success: false,
          error: new Error(
            `Dependency would create a cycle: ${command.sourceModule} → ${cyclePath.join(" → ")}`,
          ),
        };
      }

      const dependsOn = source.depends_on ?? [];
      if (!dependsOn.includes(command.targetModule)) {
        source.depends_on = [...dependsOn, command.targetModule];
      }

      await this.atomicWrite(manifest as Record<string, unknown>);
      return {
        success: true,
        value: { updated: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async registerBoundedContext(
    command: RegisterBoundedContextCommand,
  ): Promise<Result<{ registered: boolean; alreadyExisted: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];

      const alreadyExisted = contexts.some((ctx) => ctx.name === command.name);
      if (alreadyExisted) {
        return {
          success: true,
          value: { registered: false, alreadyExisted: true },
        };
      }

      const newContext: Record<string, unknown> = {
        name: command.name,
        type: command.type ?? "core",
        layers: {
          domain: { entities: [], value_objects: [] },
          application: { use_cases: [], ports: { in: [], out: [] } },
          infrastructure: { adapters: [] },
        },
      };
      if (command.description) {
        newContext.description = command.description;
      }
      contexts.push(newContext as (typeof contexts)[number]);

      manifest.bounded_contexts = contexts;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { registered: true, alreadyExisted: false },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async registerPort(
    command: RegisterPortCommand,
  ): Promise<Result<{ registered: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const ctx = contexts.find((c) => c.name === command.contextName);

      if (!ctx) {
        return {
          success: false,
          error: new Error(`Bounded context not found: ${command.contextName}`),
        };
      }

      const layer = (ctx.layers ?? {}) as Record<string, unknown>;
      const appLayer = (layer.application ?? {}) as Record<string, unknown>;
      const ports = (appLayer.ports ?? { in: [], out: [] }) as Record<
        string,
        string[]
      >;
      const dirPorts = ports[command.direction] ?? [];

      if (dirPorts.includes(command.portName)) {
        return {
          success: true,
          value: { registered: false },
        };
      }

      ctx.layers = {
        ...layer,
        application: {
          ...appLayer,
          ports: {
            ...ports,
            [command.direction]: [...dirPorts, command.portName],
          },
        },
      };

      manifest.bounded_contexts = contexts;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { registered: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async registerAdapter(
    command: RegisterAdapterCommand,
  ): Promise<Result<{ registered: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const ctx = contexts.find((c) => c.name === command.contextName);

      if (!ctx) {
        return {
          success: false,
          error: new Error(`Bounded context not found: ${command.contextName}`),
        };
      }

      const layer = (ctx.layers ?? {}) as Record<string, unknown>;

      // GOVERNANCE GATE — referential check. An adapter implements a port;
      // refuse to register one against a port the context does not declare
      // (previously command.portName was accepted but silently ignored).
      // Ports may be declared as plain strings OR objects with a `name` key
      // (LegacyOrNewPortSchema in project-configuration) — normalize both.
      const appLayer = (layer.application ?? {}) as Record<string, unknown>;
      const ports = (appLayer.ports ?? { in: [], out: [] }) as Record<
        string,
        Array<string | { name?: string }>
      >;
      const knownPorts = [...(ports.in ?? []), ...(ports.out ?? [])].map((p) =>
        typeof p === "string" ? p : (p?.name ?? ""),
      );
      if (!knownPorts.includes(command.portName)) {
        return {
          success: false,
          error: new Error(
            `Port not found in context ${command.contextName}: ${command.portName}. ` +
              `Declared ports: ${knownPorts.length > 0 ? knownPorts.join(", ") : "(none)"}. ` +
              "Register the port first (register_port).",
          ),
        };
      }

      const infraLayer = (layer.infrastructure ?? {}) as Record<
        string,
        unknown
      >;
      const adapters = (infraLayer.adapters ?? []) as string[];

      if (adapters.includes(command.adapterName)) {
        return {
          success: true,
          value: { registered: false },
        };
      }

      ctx.layers = {
        ...layer,
        infrastructure: {
          ...infraLayer,
          adapters: [...adapters, command.adapterName],
        },
      };

      manifest.bounded_contexts = contexts;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { registered: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async removePort(
    command: RemovePortCommand,
  ): Promise<Result<{ removed: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const ctx = contexts.find((c) => c.name === command.contextName);

      if (!ctx) {
        return {
          success: false,
          error: new Error(`Bounded context not found: ${command.contextName}`),
        };
      }

      const layer = (ctx.layers ?? {}) as Record<string, unknown>;
      const appLayer = (layer.application ?? {}) as Record<string, unknown>;
      const ports = (appLayer.ports ?? { in: [], out: [] }) as Record<
        string,
        string[]
      >;
      const dirPorts = ports[command.direction] ?? [];

      const filtered = dirPorts.filter((p: string) => p !== command.portName);
      if (filtered.length === dirPorts.length) {
        return {
          success: true,
          value: { removed: false },
        };
      }

      ctx.layers = {
        ...layer,
        application: {
          ...appLayer,
          ports: {
            ...ports,
            [command.direction]: filtered,
          },
        },
      };

      manifest.bounded_contexts = contexts;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { removed: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async removeAdapter(
    command: RemoveAdapterCommand,
  ): Promise<Result<{ removed: boolean }>> {
    try {
      // Hostile-input gate — O(1) per command field.
      assertPlainCommandObject(command);
      assertNoGetter(command, "contextName");
      assertNoGetter(command, "adapterName");
      assertNoGetter(command, "portName");
      const contextName = asCommandString(command.contextName, "contextName");
      const adapterName = asCommandString(command.adapterName, "adapterName");
      const portName = asCommandString(command.portName, "portName");

      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = assertRealArray(
        manifest.bounded_contexts,
        "bounded_contexts",
      ) as ManifestContexts;
      const ctx = contexts.find((c) => c.name === contextName);

      if (!ctx) {
        return {
          success: false,
          error: new Error(`Bounded context not found: ${contextName}`),
        };
      }

      const layer = (ctx.layers ?? {}) as Record<string, unknown>;

      // Referential check — an adapter implements a port; refuse to remove
      // one against a port the context does not declare. Ports may be
      // declared as plain strings OR objects with a `name` key — normalize
      // both, as registerAdapter does.
      const appLayer = (layer.application ?? {}) as Record<string, unknown>;
      const ports = (appLayer.ports ?? { in: [], out: [] }) as Record<
        string,
        Array<string | { name?: string }>
      >;
      const knownPorts = [...(ports.in ?? []), ...(ports.out ?? [])].map((p) =>
        typeof p === "string" ? p : (p?.name ?? ""),
      );
      if (!knownPorts.includes(portName)) {
        return {
          success: false,
          error: new Error(
            `Port not found in context ${contextName}: ${portName}. ` +
              `Declared ports: ${knownPorts.length > 0 ? knownPorts.join(", ") : "(none)"}.`,
          ),
        };
      }

      const infraLayer = (layer.infrastructure ?? {}) as Record<
        string,
        unknown
      >;
      const adapters = assertRealArray(
        infraLayer.adapters,
        `adapters of context ${contextName}`,
      ) as string[];

      if (!adapters.includes(adapterName)) {
        return {
          success: false,
          error: new Error(
            `Adapter not found in context ${contextName}: ${adapterName}.`,
          ),
        };
      }

      ctx.layers = {
        ...layer,
        infrastructure: {
          ...infraLayer,
          adapters: adapters.filter((a) => a !== adapterName),
        },
      };

      manifest.bounded_contexts = contexts;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { removed: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async removeDependency(
    command: RemoveDependencyCommand,
  ): Promise<Result<{ removed: boolean }>> {
    try {
      // Hostile-input gate — O(1) per command field.
      assertPlainCommandObject(command);
      assertNoGetter(command, "sourceModule");
      assertNoGetter(command, "targetModule");
      const sourceModule = asCommandString(command.sourceModule, "sourceModule");
      const targetModule = asCommandString(command.targetModule, "targetModule");

      if (sourceModule === targetModule) {
        return {
          success: false,
          error: new Error(
            `Source and target modules cannot be the same: ${sourceModule}`,
          ),
        };
      }

      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = assertRealArray(
        manifest.bounded_contexts,
        "bounded_contexts",
      ) as ManifestContexts;
      const source = contexts.find(
        (context) => context.name === sourceModule,
      );

      if (!source) {
        return {
          success: false,
          error: new Error(`Source module not found: ${sourceModule}`),
        };
      }

      if (!contexts.some((context) => context.name === targetModule)) {
        return {
          success: false,
          error: new Error(`Target module not found: ${targetModule}`),
        };
      }

      const dependsOn = assertRealArray(
        source.depends_on,
        `depends_on of module ${sourceModule}`,
      ) as string[];

      if (!dependsOn.includes(targetModule)) {
        return {
          success: false,
          error: new Error(
            `Dependency not found: ${sourceModule} does not depend on ${targetModule}.`,
          ),
        };
      }

      source.depends_on = dependsOn.filter((d) => d !== targetModule);

      await this.atomicWrite(manifest as Record<string, unknown>);
      return {
        success: true,
        value: { removed: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async removeContext(
    command: RemoveContextCommand,
  ): Promise<Result<{ removed: boolean }>> {
    try {
      const manifest = await readManifestDocument(this.workspaceRoot);
      const contexts = manifest.bounded_contexts ?? [];
      const initial = contexts.length;

      const filtered = contexts.filter(
        (ctx) => ctx.name !== command.contextName,
      );
      if (filtered.length === initial) {
        return {
          success: true,
          value: { removed: false },
        };
      }

      // GOVERNANCE GATE — referential check. Refuse to remove a context other
      // contexts still depend on (previously their depends_on edges were
      // silently stripped, hiding the breakage from the operator).
      const dependents = filtered
        .filter((ctx) => ctx.depends_on?.includes(command.contextName))
        .map((ctx) => ctx.name);
      if (dependents.length > 0) {
        return {
          success: false,
          error: new Error(
            `Cannot remove context ${command.contextName}: still depended on by ` +
              `${dependents.join(", ")}. Remove those dependencies first.`,
          ),
        };
      }

      manifest.bounded_contexts = filtered;
      await this.atomicWrite(manifest as Record<string, unknown>);

      return {
        success: true,
        value: { removed: true },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
