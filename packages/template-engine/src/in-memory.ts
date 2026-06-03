/**
 * Dedicated subpath entrypoint: `@hexagen/template-engine/in-memory`.
 *
 * Kept OFF the package root (`.`) on purpose — `createInMemoryMaterializer`
 * imports the generated bundle, whose top-level `JSON.parse(...)` parses and
 * retains ~0.7 MB at module init. Routing it through this subpath means only
 * the web/serverless generation path pays that cost; consumers of the package
 * root (e.g. the sync CLI) never load the bundle.
 */
export { createInMemoryMaterializer } from "./infrastructure/create-in-memory-materializer.js";
export type { MaterializeAddOnsResult } from "./infrastructure/in-memory-add-on-materializer.js";
