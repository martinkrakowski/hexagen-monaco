/**
 * `.architecture/layout.yaml` — maps a foreign repo's directories onto
 * Hexagen contexts and hexagonal layers.
 *
 * Invalid config is fatal (the caller exits 2). Absent or empty config keeps
 * today's convention-mode behaviour. Unknown keys are rejected so a typo
 * cannot silently produce a partial report.
 */
import { z } from "zod";
import {
  loadOptionalYamlConfig,
  type OptionalYamlConfig,
} from "./optional-yaml-config.js";

export const HEXAGONAL_LAYER_NAMES = [
  "domain",
  "application",
  "infrastructure",
  "presentation",
] as const;

export type HexagonalLayerName = (typeof HEXAGONAL_LAYER_NAMES)[number];

const HexagonalLayerNameSchema = z.enum(HEXAGONAL_LAYER_NAMES);

const ContextLayoutSchema = z
  .object({
    root: z.string().min(1),
    layers: z
      .record(HexagonalLayerNameSchema, z.array(z.string().min(1)))
      .optional(),
  })
  .strict();

export const LayoutConfigSchema = z
  .object({
    contexts: z.record(z.string().min(1), ContextLayoutSchema).optional(),
    ignore: z.array(z.string().min(1)).optional(),
    tsconfig: z.string().optional(),
    scopes: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type LayoutConfig = z.infer<typeof LayoutConfigSchema>;
export type ContextLayout = z.infer<typeof ContextLayoutSchema>;

export type LayoutParseResult =
  | { ok: true; value: LayoutConfig }
  | { ok: false; reason: string };

function formatZodIssue(issue: z.ZodIssue): string {
  const at = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `${at}: ${issue.message}`;
}

export function parseLayoutConfig(value: unknown): LayoutParseResult {
  const result = LayoutConfigSchema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: formatZodIssue(result.error.issues[0]) };
}

/** Path-segment ignore match: `src` does not match `src-gen/` or `srcfoo.ts`. */
export function matchesIgnorePattern(
  relativePosix: string,
  patterns: readonly string[],
): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.length === 0) return false;
    const prefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
    return (
      relativePosix === normalized.replace(/\/+$/, "") ||
      relativePosix.startsWith(prefix)
    );
  });
}

export function isEmptyLayout(config: LayoutConfig): boolean {
  return (
    config.contexts === undefined &&
    config.ignore === undefined &&
    config.tsconfig === undefined &&
    config.scopes === undefined
  );
}

export async function loadLayoutConfig(
  filePath: string,
  readFile: (path: string) => Promise<string>,
): Promise<OptionalYamlConfig<LayoutConfig>> {
  const loaded = await loadOptionalYamlConfig<unknown>(filePath, readFile);
  if (loaded.kind !== "loaded") return loaded;
  const parsed = parseLayoutConfig(loaded.value);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };
  return { kind: "loaded", value: parsed.value };
}
