import type { DomainPackageAllowlistEntry } from "./layer-purity-violation.js";

export type { DomainPackageAllowlistEntry };

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
  /**
   * Per-context exceptions to the domain npm-package ban (ADR-0054 §2c).
   * Declarative on purpose: a project states its exception here rather than the
   * linter hard-coding one. Empty by default in generated projects.
   */
  domain_package_allowlist?: DomainPackageAllowlistEntry[];
  package_rules?: {
    name: string;
    restricted_to?: string[];
    cannot_import?: string[];
    /** Config grants beyond the manifest (ADR-0043 ladder step 6). Honored at runtime since the closures era; the type previously omitted it. */
    allowed_imports?: string[];
  }[];
  test_double_rules?: {
    paths?: string[];
    allowed_cross_package_imports?: boolean;
  };
  subpath_conventions?: SubpathConventionConfig;
  /**
   * Opt-in for the `context-declaration-drift` rule (ADR-0057 registry
   * accuracy). ABSENT MEANS OFF, deliberately.
   *
   * The rule asserts that every declared `layers.*` entry names a symbol the
   * context exports. That is true of a CURATED registry, which is what
   * `.architecture/contexts/**` is in this repository. It is false of a
   * GENERATED project's manifest, which is a specification of intent: entries
   * are spelled as file names (`Prisma.adapter.ts`, `rest-controller.in-port.ts`)
   * rather than exported symbols, and with `generator.sync.stubs.enabled: false`
   * the elements they name are deliberately never materialised.
   *
   * Defaulting to on therefore red-walled every scaffolded project and every
   * published consumer whose manifest is a spec — observed on the capstone
   * `Generate -> gate (minimal-addons)` job. A project states that its manifest
   * is a registry by setting this; nothing else turns the rule on.
   */
  context_declarations?: {
    enforce?: boolean;
  };
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
