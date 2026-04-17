import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { Result } from "@hexagen/shared";
import type {
  AddDependencyCommand,
  ManifestWritePort,
  RegisterBoundedContextCommand,
  RegisterPortCommand,
  RegisterAdapterCommand,
  RemovePortCommand,
  RemoveContextCommand,
} from "../../application/ports/out/manifest-write.port.js";
import { readManifestDocument } from "./manifest-io.js";

export class ManifestWriteAdapter implements ManifestWritePort {
  constructor(private readonly workspaceRoot: string) {}

  private async atomicWrite(manifest: Record<string, unknown>): Promise<void> {
    const manifestPath = path.join(
      this.workspaceRoot,
      ".architecture",
      "manifest.yaml",
    );
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

      for (const ctx of filtered) {
        if (ctx.depends_on) {
          ctx.depends_on = ctx.depends_on.filter(
            (dep) => dep !== command.contextName,
          );
        }
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
