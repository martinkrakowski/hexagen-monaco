import type { Result } from "@hexagen/shared";
import type { ActiveWorkspace } from "../../../domain/value-objects/active-workspace.js";

export interface QueryActiveWorkspacePort {
  getActiveWorkspace(): Promise<Result<ActiveWorkspace | null, Error>>;
}
