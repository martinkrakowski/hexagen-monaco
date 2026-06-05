// @hexagen-server-only
/**
 * Static transport registrations. The base registers `stdio`; the
 * `mcp-server-http` addon re-emits this file to add `streamable-http` — the
 * seam's intended extension point (see the base file's note). Re-emitting this
 * tiny declarative file is the minimal-blast-radius way to extend the registry
 * without touching the composition root (`server.ts`). If you had hand-edited
 * it, your version is preserved as a `.hexagen-update` conflict copy.
 */
import { registerTransport } from "../server.js";
import { createStdioTransport } from "./stdio.js";
import { createHttpTransport } from "./http.js";

registerTransport("stdio", createStdioTransport);
registerTransport("streamable-http", createHttpTransport);
