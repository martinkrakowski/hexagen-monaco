const INDEX_FIELDS = new Set([
  "system",
  "scope",
  "architecture",
  "planes",
  "bounded_contexts",
  "apps",
  "invariants",
  "agent_instructions",
  "governance",
  "relationship_patterns",
  "monorepo",
  "workspaceDefaults",
  "rootFiles",
  "tsConfigRoot",
  "eslint",
  "archInvariants",
  "linterConfig",
  "generatorConfig",
  "turboConfig",
  "mvk",
  "legacy_config",
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

export { INDEX_FIELDS };
