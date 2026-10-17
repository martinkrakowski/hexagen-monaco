// @hexagen-server-only
// This module must not be imported from the client bundle (apps/web client
// code, packages/web-driver, packages/ui, packages/visualization). Jev is off
// by default (invariant 1): the real adapter lives behind this server subpath,
// never in the `.` barrel the client imports.
// Enforcement: linter-config.yaml subpath conventions (arch-linter server markers).

export { JevDecisionAdapter } from "./infrastructure/adapters/jev-decision.adapter.js";
export type { JevDecisionAdapterOptions } from "./infrastructure/adapters/jev-decision.adapter.js";
