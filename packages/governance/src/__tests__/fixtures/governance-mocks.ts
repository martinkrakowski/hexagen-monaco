/**
 * @module governance-mocks
 * @description Test doubles for Governance Assistant.
 *
 * Provides in-memory implementations of all ports required by governance use-cases.
 * All mocks support fast execution and 0-violation happy path.
 */

/**
 * Type for bounded context in manifest (simplified for testing).
 */
export interface BoundedContextFixture {
  name: string;
  type: string;
  description?: string;
  layers?: Record<string, unknown>;
}

/**
 * Type for architecture graph (simplified for testing).
 */
export interface ArchitectureGraph {
  nodes: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

/**
 * Type for linter report (simplified).
 */
export interface LinterReportSummary {
  isCompliant: boolean;
  violations: Array<{
    id: string;
    message: string;
    severity: "error" | "warning";
  }>;
}

/**
 * Mock Architecture Graph Provider Adapter — Returns fixture graph.
 *
 * Simulates graph extraction from manifest without parsing YAML.
 * Returns a pre-built graph structure instantly.
 */
export class MockArchitectureGraphProviderAdapter {
  async buildGraph(
    manifest: Record<string, unknown>,
  ): Promise<ArchitectureGraph> {
    // Extract bounded contexts from manifest if available
    const boundedContexts =
      (manifest.bounded_contexts as BoundedContextFixture[]) || [];

    return {
      nodes: boundedContexts.map((bc: BoundedContextFixture, idx: number) => ({
        id: `bc-${idx}`,
        name: bc.name || `bounded-context-${idx}`,
        type: bc.type || "core",
      })),
      edges: boundedContexts.slice(0, -1).map((_, idx: number) => ({
        source: `bc-${idx}`,
        target: `bc-${idx + 1}`,
        type: "dependency",
      })),
    };
  }
}

/**
 * Mock Linter Adapter — Returns 0 violations (happy path).
 *
 * Simulates linting without running actual rules.
 * Always returns compliant result for happy path testing.
 */
export class MockLinterAdapter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async lint(_manifest: Record<string, unknown>): Promise<LinterReportSummary> {
    // Happy path: no violations
    return {
      isCompliant: true,
      violations: [],
    };
  }
}

/**
 * Mock Manifest Reader Adapter — Parses YAML from string.
 *
 * Simulates manifest parsing without file I/O.
 * For now, assumes input is already parsed; can be extended for YAML parsing.
 */
export class MockManifestReaderAdapter {
  async parseManifest(yamlContent: string): Promise<Record<string, unknown>> {
    // Simplified: assumes input is already a parsed object or JSON string
    if (typeof yamlContent === "string") {
      try {
        return JSON.parse(yamlContent);
      } catch {
        // Return basic structure if parsing fails
        return {
          system: "unknown",
          bounded_contexts: [],
        };
      }
    }
    return yamlContent as Record<string, unknown>;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async readManifestFile(_filePath: string): Promise<Record<string, unknown>> {
    // Mock: return fixture manifest without actually reading file
    return this.createGovernanceFixtureManifest();
  }

  private createGovernanceFixtureManifest(): Record<string, unknown> {
    return {
      system: "test-hexagen-gov",
      scope: "hexagen",
      architecture: "modular-monolith",
      bounded_contexts: [
        {
          name: "core-domain",
          type: "core",
          description: "Semantic kernel",
        },
        {
          name: "shared",
          type: "shared-kernel",
          description: "Shared primitives",
        },
        {
          name: "governance",
          type: "core",
          description: "Governance",
        },
      ],
      generator: {
        version: "0.2.0",
        sync: {
          idempotent: true,
        },
      },
    };
  }
}

/**
 * Helper: Create fixture manifest for governance tests.
 *
 * Returns a valid, compliant manifest that passes all linting rules.
 *
 * @returns Record<string, unknown> - The fixture manifest
 */
export function createGovernanceFixtureManifest(): Record<string, unknown> {
  return {
    system: "test-hexagen-gov",
    scope: "hexagen",
    architecture: "modular-monolith",
    bounded_contexts: [
      {
        name: "core-domain",
        type: "core",
        description: "Semantic kernel for domain model contracts",
        layers: {
          domain: {
            entities: ["DomainNode"],
            value_objects: ["NodeKind"],
          },
          application: {
            ports: {
              in: [],
              out: [],
            },
          },
          infrastructure: {
            adapters: [],
          },
        },
      },
      {
        name: "shared",
        type: "shared-kernel",
        description: "Shared primitives and utilities",
        layers: {
          domain: {
            value_objects: ["CustomError"],
          },
          application: {
            ports: { in: [], out: [] },
          },
          infrastructure: {
            adapters: [],
          },
        },
      },
      {
        name: "project-configuration",
        type: "core",
        description: "Manifest parsing and validation",
        layers: {
          domain: {
            entities: ["ProjectSpec", "BoundedContext"],
          },
          application: {
            use_cases: ["ValidateSpecUseCase"],
            ports: {
              in: ["ValidateSpecPort"],
              out: ["ProjectGeneratorPort"],
            },
          },
          infrastructure: {
            adapters: [],
          },
        },
      },
      {
        name: "governance",
        type: "core",
        description: "Architecture governance and linting",
        layers: {
          domain: {
            entities: ["LinterReport"],
          },
          application: {
            use_cases: ["ScanManifestUseCase"],
            ports: {
              in: ["ScanManifestPort"],
              out: ["ArchitectureGraphProviderPort", "LinterPort"],
            },
          },
          infrastructure: {
            adapters: [],
          },
        },
      },
      {
        name: "external-integration",
        type: "core",
        description: "External system integration",
        layers: {
          domain: {
            entities: ["AuthSession"],
          },
          application: {
            use_cases: ["InitiateAuthUseCase"],
            ports: {
              in: ["InitiateAuthPort"],
              out: ["OAuthProviderPort"],
            },
          },
          infrastructure: {
            adapters: [],
          },
        },
      },
    ],
    generator: {
      version: "0.2.0",
      sync: {
        idempotent: true,
        createOnlyIfMissing: true,
      },
    },
  };
}
