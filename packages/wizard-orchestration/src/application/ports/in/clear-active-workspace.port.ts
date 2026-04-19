import type { Result } from "@hexagen/shared";

export interface ClearActiveWorkspacePort {
  clearActiveWorkspace(): Promise<Result<void, Error>>;
}