// @hexagen-server-only
/**
 * Static tool registrations. Add a real tool with one import + one
 * `registerTool(...)` line below — copy `tools/example.tool.ts` as a starting
 * point. The template engine can't codegen a loop over a selected tool set, so
 * this list is yours to extend by hand.
 */
import { registerTool } from "./tool-registry.js";
import { exampleTool } from "../tools/example.tool.js";

registerTool(exampleTool);
