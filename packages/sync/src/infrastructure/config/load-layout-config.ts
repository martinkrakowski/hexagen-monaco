import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  LAYOUT_YAML_RELATIVE_PATH,
  layoutSchema,
  type LayoutFile,
} from "./layout-schema.js";

/**
 * Load the canonical layout file. Missing is legitimate (defaults apply).
 * A file that exists and fails the schema is fatal — silent fallback would
 * classify every file against the wrong layer names.
 */
export function loadLayoutConfig(
  workspaceRoot: string,
): LayoutFile | undefined {
  const filePath = path.join(
    workspaceRoot,
    ...LAYOUT_YAML_RELATIVE_PATH.split("/"),
  );
  if (!existsSync(filePath)) return undefined;

  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(filePath, "utf8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid ${LAYOUT_YAML_RELATIVE_PATH}: ${message}`);
  }

  const parsed = layoutSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid ${LAYOUT_YAML_RELATIVE_PATH}: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}
