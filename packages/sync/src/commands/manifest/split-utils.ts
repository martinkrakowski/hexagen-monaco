type RawRecord = Record<string, unknown>;

const INDEX_FIELDS = new Set([
  "system",
  "scope",
  "architecture",
  "planes",
  "bounded_contexts",
  "apps",
  "invariants",
  "governance",
  "agent_instructions",
  "relationship_patterns",
  "monorepo",
  "workspaceDefaults",
  "rootFiles",
  "tsConfigRoot",
  "eslint",
  "generatorConfig",
  "turboConfig",
  "mvk",
  "legacy_config",
  "workspace_config",
]);

export function buildPlaneLookup(
  planes: Record<string, string[]> | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();
  if (!planes) return lookup;
  for (const [planeName, contextNames] of Object.entries(planes)) {
    for (const ctxName of contextNames) {
      lookup.set(ctxName, planeName);
    }
  }
  return lookup;
}

export function extractContextData(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!INDEX_FIELDS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

export function flattenStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) {
    throw new TypeError(
      `Expected array for adapter list, got "${typeof val}": ${JSON.stringify(val)}`,
    );
  }
  const result: string[] = [];
  for (const item of val) {
    if (typeof item === "string") {
      result.push(item);
    } else if (Array.isArray(item)) {
      result.push(...flattenStringArray(item));
    } else {
      throw new TypeError(
        `Invalid adapter entry type "${typeof item}" in layers.infrastructure.adapters, value: ${JSON.stringify(item)}`,
      );
    }
  }
  return result;
}

export function normalizeContextData(ctx: RawRecord): RawRecord {
  const out: RawRecord = { ...ctx };
  const layers = out.layers as RawRecord | undefined;
  if (layers) {
    const infra = layers.infrastructure as RawRecord | undefined;
    if (infra && Array.isArray(infra.adapters)) {
      layers.infrastructure = {
        ...infra,
        adapters: flattenStringArray(infra.adapters),
      };
    }
  }
  return out;
}

export { INDEX_FIELDS };
