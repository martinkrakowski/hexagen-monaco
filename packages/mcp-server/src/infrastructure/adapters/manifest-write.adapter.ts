import type { Result } from "@hexagen/shared";
import type {
  AddDependencyCommand,
  ManifestWritePort,
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
}
