import type { Result } from "@hexagen/shared";
import type {
  AddDependencyCommand,
  ManifestWritePort,
  RegisterBoundedContextCommand,
} from "../../application/ports/out/manifest-write.port.js";
import { readManifestDocument, writeManifestDocument } from "./manifest-io.js";

export class ManifestWriteAdapter implements ManifestWritePort {
  constructor(private readonly workspaceRoot: string) {}

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

      await writeManifestDocument(this.workspaceRoot, manifest);
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

      contexts.push({
        name: command.name,
        type: command.type ?? "core",
        description: "",
        layers: {
          domain: { entities: [], value_objects: [] },
          application: { use_cases: [], ports: { in: [], out: [] } },
          infrastructure: { adapters: [] },
        },
      });

      manifest.bounded_contexts = contexts;
      await writeManifestDocument(this.workspaceRoot, manifest);

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
}
