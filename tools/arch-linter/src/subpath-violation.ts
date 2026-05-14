export interface MarkerExclusion {
  package: string;
  reason: string;
}

export interface SubpathConvention {
  allowed_consumers: string[];
  enforcement: "error" | "warn";
  require_marker?: boolean;
  marker_exclusions?: MarkerExclusion[];
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
