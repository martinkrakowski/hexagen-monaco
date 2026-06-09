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
  RemovePortCommand,
  RemoveContextCommand,
} from "../../application/ports/out/manifest-write.port.js";
import { readManifestDocument, type ManifestDocument } from "./manifest-io.js";

type ManifestContexts = NonNullable<ManifestDocument["bounded_contexts"]>;

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
      const appLayer = (layer.application ?? {}) as Record<string, unknown>;
      const ports = (appLayer.ports ?? { in: [], out: [] }) as Record<
        string,
        string[]
      >;
      const knownPorts = [...(ports.in ?? []), ...(ports.out ?? [])];
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
