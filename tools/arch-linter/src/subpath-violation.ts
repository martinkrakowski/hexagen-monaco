export interface SubpathConvention {
  allowed_consumers: string[];
  enforcement: "error" | "warn";
}

export interface SubpathConventionConfig {
  server?: SubpathConvention;
  client?: SubpathConvention;
}

export interface LinterConfig {
  global_whitelist?: string[];
  package_rules?: {
    name: string;
    restricted_to?: string[];
    cannot_import?: string[];
  }[];
  test_double_rules?: {
    paths?: string[];
    allowed_cross_package_imports?: boolean;
  };
  subpath_conventions?: SubpathConventionConfig;
}

const escapeRegExp = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function isSubpathViolation(
  fromPackage: string,
  moduleSpecifier: string,
  scope: string,
  config: LinterConfig,
): {
  violation: true;
  enforcement: "error" | "warn";
  subpathType: "server" | "client";
} | null {
  const conventions = config.subpath_conventions;
  if (!conventions) return null;

  // TODO: DEBT-001 — remove this bypass when @hexagen/local-llm/client is added to allowed_consumers
  const debtMigratingPackages = ["agentic-interaction", "manifest-generation"];
  if (
    moduleSpecifier === `${scope}/local-llm/client` &&
    debtMigratingPackages.includes(fromPackage)
  ) {
    return null;
  }

  const escapedScope = escapeRegExp(scope);
  const subpathMatch = moduleSpecifier.match(
    new RegExp(`^${escapedScope}/([\\w-]+)/(server|client)$`),
  );
  if (!subpathMatch) return null;

  const [, , subpathType] = subpathMatch;
  const convention = conventions[subpathType as "server" | "client"];
  if (!convention) return null;

  const allowedConsumers = convention.allowed_consumers ?? [];
  if (allowedConsumers.includes(fromPackage)) return null;

  return {
    violation: true,
    enforcement: convention.enforcement,
    subpathType: subpathType as "server" | "client",
  };
}
