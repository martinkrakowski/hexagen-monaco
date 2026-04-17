import type { Result } from "@hexagen/shared";

export interface AddDependencyCommand {
  sourceModule: string;
  targetModule: string;
}

export interface RegisterBoundedContextCommand {
  name: string;
  type?: "core" | "supporting" | "driver" | "shared-kernel";
  description?: string;
}

export interface RegisterPortCommand {
  contextName: string;
  portName: string;
  direction: "in" | "out";
}

export interface RegisterAdapterCommand {
  contextName: string;
  adapterName: string;
  portName: string;
}

export interface RemovePortCommand {
  contextName: string;
  portName: string;
  direction: "in" | "out";
}

export interface RemoveContextCommand {
  contextName: string;
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
  registerPort(
    command: RegisterPortCommand,
  ): Promise<Result<{ registered: boolean }>>;
  registerAdapter(
    command: RegisterAdapterCommand,
  ): Promise<Result<{ registered: boolean }>>;
  removePort(command: RemovePortCommand): Promise<Result<{ removed: boolean }>>;
  removeContext(
    command: RemoveContextCommand,
  ): Promise<Result<{ removed: boolean }>>;
}
