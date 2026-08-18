import { z } from "zod";

/** Canonical path consumed by bootstrap, the linter, and impact classification. */
export const LAYOUT_YAML_RELATIVE_PATH = ".architecture/layout.yaml";

export const DEFAULT_LAYOUT_LAYERS = [
  "domain",
  "application",
  "infrastructure",
] as const;

export const layoutSchema = z
  .object({
    version: z.union([z.number(), z.string()]).optional(),
    contexts: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .optional(),
    root: z.string().optional(),
    layers: z.array(z.string().min(1)).optional(),
    ignore: z.array(z.string().min(1)).optional(),
    workspaces: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type LayoutFile = z.infer<typeof layoutSchema>;
export type LayoutConfig = LayoutFile;
