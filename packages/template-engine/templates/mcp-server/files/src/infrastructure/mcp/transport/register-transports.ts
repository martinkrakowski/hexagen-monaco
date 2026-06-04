// @hexagen-server-only
/**
 * Static transport registrations. The base registers `stdio`. An addon adds a
 * transport here with one import + one `registerTransport(...)` line — e.g. the
 * `mcp-server-http` addon appends:
 *
 *   import { createHttpTransport } from "./http.js";
 *   registerTransport("streamable-http", createHttpTransport);
 *
 * so the composition root (`server.ts`) never needs to be rewritten.
 */
import { registerTransport } from "../server.js";
import { createStdioTransport } from "./stdio.js";

registerTransport("stdio", createStdioTransport);
