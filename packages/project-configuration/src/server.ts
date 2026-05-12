// @hexagen-server-only
// This module uses Node.js built-ins. It must not be imported from:
//   - apps/web (client bundle)
//   - packages/web-driver
//   - packages/ui
//   - packages/visualization
// Enforcement: linter-config.yaml subpath_conventions (pending arch-linter v2)

export { mergeSplitManifest } from "./infrastructure/adapters/manifest-merge-loader.js";
