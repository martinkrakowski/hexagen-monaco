// index.server.ts — server-only public barrel for @hexagen/project-configuration.
//
// The default public barrel (`./index.ts`) exposes only the layers that are
// safe to bundle for the browser: domain entities, application ports, and
// schema types. Infrastructure adapters live in `./infrastructure/**` and
// import Node-only modules (`node:fs/promises`, `node:path`, `js-yaml` server
// helpers, etc.) that must never reach a client bundle.
//
// Use this subpath export (`@hexagen/project-configuration/server`) from
// server-only contexts: API routes under `apps/web/app/api/**`, CLI tools
// under `tools/**`, test doubles that need to compose real adapters. See
// ADR-0026 followup on infrastructure-layer import hygiene.

export * from "./index.js";
export * from "./infrastructure/index.js";
