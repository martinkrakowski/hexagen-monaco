import type { Result } from "@hexagen/shared";

export interface AddDependencyCommand {
  sourceModule: string;
  targetModule: string;
}

export interface RegisterBoundedContextCommand {
  name: string;
  type?: "core" | "supporting" | "driver" | "shared-kernel";
}

export interface ManifestWritePort {
  validateDependency(
    command: AddDependencyCommand,
  ): Promise<Result<{ valid: boolean; errors: string[] }>>;
  addDependency(
    command: AddDependencyCommand,
  ): Promise<Result<{ updated: boolean }>>;
  registerBoundedContext(
    command: RegisterBoundedContextCommand,
  ): Promise<Result<{ registered: boolean; alreadyExisted: boolean }>>;
}
