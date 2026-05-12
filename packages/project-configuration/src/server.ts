// @hexagen-server-only
// This module uses Node.js built-ins. It must not be imported from:
//   - apps/web (client bundle)
//   - packages/web-driver
//   - packages/ui
//   - packages/visualization
// Enforcement: linter-config.yaml subpath_conventions (pending arch-linter v2)

export { mergeSplitManifest } from "./infrastructure/adapters/manifest-merge-loader.js";
export { loadWorkspaceConfig } from "./infrastructure/adapters/workspace-config-loader.js";
export { WorkspaceConfigSchema } from "./domain/model/workspace-config/workspace-config.schema.js";
export type { WorkspaceConfig } from "./domain/model/workspace-config/workspace-config.schema.js";
