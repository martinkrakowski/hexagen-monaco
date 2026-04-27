/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * @module cross-boundary-registry
 * @description Integration test fixture for cross-boundary communication.
 *
 * Provides pre-configured registry with all 25 PORT_NAMES and utilities for
 * wiring multi-component workflows: Wizard → Persistence → Governance → Export.
 *
 * Designed for Phase 6C integration tests covering:
 * - Project Wizard + Persistence state handoff
 * - Governance + Wizard bidirectional feedback loops
 * - Export Orchestration (full user journey)
 * - Error recovery and transaction semantics
 * - Performance under concurrent load
 */

import type { PortName } from "../../infrastructure/constants/port-names";
import { PORT_NAMES } from "../../infrastructure/constants/port-names";
import {
  createMockRegistry,
  type MockPortRegistry,
} from "./port-registry.mock";

/**
 * Integration test scenarios for cross-boundary workflows.
 */
export enum IntegrationScenario {
  WIZARD_TO_EXPORT = "WIZARD_TO_EXPORT",
  GOVERNANCE_REFINEMENT = "GOVERNANCE_REFINEMENT",
  ERROR_RECOVERY = "ERROR_RECOVERY",
  LOAD_TEST = "LOAD_TEST",
}

/**
 * Manifest format for cross-boundary handoffs.
 * Ensures YAML round-trip safety and structural preservation.
 */
export interface CrossBoundaryManifest {
  _version: string; // UUID for version tracking
  _generatedAt: number; // Timestamp for cache invalidation
  system: string;
  scope: string;
  description?: string;
  architecture?: string;
  patterns?: string[];
  bounded_contexts?: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
  generator?: {
    version: string;
    sync?: {
      idempotent: boolean;
      createOnlyIfMissing: boolean;
    };
  };
  [key: string]: unknown;
}

/**
 * Create a registry pre-configured for cross-boundary integration tests.
 * All 25 PORT_NAMES are pre-registered with no-op implementations.
 *
 * @returns Fresh MockPortRegistry suitable for integration testing
 * @example
 *   const registry = createCrossBoundaryRegistry();
 *   wireWizardToPersistence(registry);
 *   wireGovernanceToManifestReader(registry);
 *   wireExportToGovernance(registry);
 */
export function createCrossBoundaryRegistry(): MockPortRegistry {
  const registry = createMockRegistry();

  // Pre-configure all ports with minimal no-op implementations
  // Tests override specific ports as needed
  const noOpAdapter = {
    execute: async () => ({ success: true }),
    process: async () => ({}),
    call: async () => undefined,
    get: async () => undefined,
    set: async () => undefined,
    read: async () => "",
    write: async () => undefined,
    scan: async () => ({ success: true, data: { isCompliant: true } }),
    generateProject: async () => ({
      success: true,
      manifest: createFixtureManifest(),
    }),
    validate: async () => ({ success: true }),
    lint: async () => ({ isCompliant: true, violations: [] }),
    buildGraph: async () => ({ nodes: [], edges: [] }),
    streamExport: async () => null,
  };

  // Ensure all PORT_NAMES are registered
  Object.values(PORT_NAMES).forEach((portName) => {
    try {
      registry.set(portName as PortName, noOpAdapter);
    } catch {
      // Port already registered, skip
    }
  });

  return registry;
}

/**
 * Wire Wizard outputs → Persistence (state sync).
 * Enables wizard-generated manifests to flow into persistence storage.
 *
 * @param registry The MockPortRegistry to configure
 * @example
 *   wireWizardToPersistence(registry);
 *   // Now wizard generates → persists → governance can read
 */
export function wireWizardToPersistence(registry: MockPortRegistry): void {
  // Ensure WIZARD_PERSISTENCE is available for wizard to store state
  if (!registry.has(PORT_NAMES.WIZARD_PERSISTENCE)) {
    registry.set(PORT_NAMES.WIZARD_PERSISTENCE, {
      async saveSession(
        sessionId: string,
        state: CrossBoundaryManifest,
      ): Promise<void> {
        // In-memory storage
      },
      async getSession(
        sessionId: string,
      ): Promise<CrossBoundaryManifest | null> {
        return null;
      },
    });
  }
}

/**
 * Wire Governance inputs ← Manifest Reader (read wizard-generated manifests).
 * Enables governance to validate manifests produced by the wizard.
 *
 * @param registry The MockPortRegistry to configure
 * @example
 *   wireGovernanceToManifestReader(registry);
 *   // Now governance can scan wizard-generated manifests
 */
export function wireGovernanceToManifestReader(
  registry: MockPortRegistry,
): void {
  // Ensure MANIFEST_READER is available for governance to load manifests
  if (!registry.has(PORT_NAMES.MANIFEST_READER)) {
    registry.set(PORT_NAMES.MANIFEST_READER, {
      async readManifest(path: string): Promise<CrossBoundaryManifest> {
        return createFixtureManifest();
      },
    });
  }

  // Ensure LINTER is available for governance to validate
  if (!registry.has(PORT_NAMES.LINTER)) {
    registry.set(PORT_NAMES.LINTER, {
      async lint(manifest: CrossBoundaryManifest): Promise<{
        isCompliant: boolean;
        violations: Array<{ code: string; message: string; details?: string }>;
      }> {
        return { isCompliant: true, violations: [] };
      },
    });
  }
}

/**
 * Wire Export inputs ← Governance (read governance-validated manifests).
 * Enables export to verify governance compliance before starting streams.
 *
 * @param registry The MockPortRegistry to configure
 * @example
 *   wireExportToGovernance(registry);
 *   // Now export can check governance compliance before export
 */
export function wireExportToGovernance(registry: MockPortRegistry): void {
  // Ensure ports for export validation chain are available
  if (!registry.has(PORT_NAMES.LINTER)) {
    registry.set(PORT_NAMES.LINTER, {
      async lint(manifest: CrossBoundaryManifest): Promise<{
        isCompliant: boolean;
        violations: Array<{ code: string; message: string }>;
      }> {
        return { isCompliant: true, violations: [] };
      },
    });
  }

  if (!registry.has(PORT_NAMES.TRANSACTION_MANAGER)) {
    registry.set(PORT_NAMES.TRANSACTION_MANAGER, {
      async begin(): Promise<string> {
        return `tx-${Date.now()}`;
      },
      async commit(txId: string): Promise<void> {
        // noop
      },
      async rollback(txId: string): Promise<void> {
        // noop
      },
    });
  }

  if (!registry.has(PORT_NAMES.GITHUB_PROVIDER)) {
    registry.set(PORT_NAMES.GITHUB_PROVIDER, {
      async createRepository(
        name: string,
      ): Promise<{ repoUrl: string; success: boolean }> {
        return { repoUrl: `https://github.com/test/${name}`, success: true };
      },
      async cleanup(repoUrl: string): Promise<void> {
        // noop
      },
    });
  }

  if (!registry.has(PORT_NAMES.CLOUD_STORAGE)) {
    registry.set(PORT_NAMES.CLOUD_STORAGE, {
      async uploadFile(key: string, data: unknown): Promise<string> {
        return `s3://bucket/${key}`;
      },
      async deleteFile(key: string): Promise<void> {
        // noop
      },
    });
  }
}

/**
 * Create a fixture manifest for testing cross-boundary workflows.
 * Returns a valid, minimal manifest structure.
 *
 * @returns CrossBoundaryManifest suitable for wizard/governance/export tests
 */
export function createFixtureManifest(): CrossBoundaryManifest {
  return {
    _version: `uuid-${Date.now()}`,
    _generatedAt: Date.now(),
    system: "integration-test-project",
    scope: "hexagen",
    description: "Integration test fixture manifest",
    architecture: "modular-monolith",
    patterns: ["layered"],
    bounded_contexts: [
      {
        name: "core-domain",
        type: "core",
        description: "Core domain context",
      },
      {
        name: "shared-kernel",
        type: "shared-kernel",
        description: "Shared kernel",
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

/**
 * Create a fixture manifest with violations for testing refinement loops.
 * Includes invalid port names and other governance violations.
 *
 * @returns CrossBoundaryManifest with known violations
 */
export function createNonCompliantFixtureManifest(): CrossBoundaryManifest {
  return {
    _version: `uuid-${Date.now()}`,
    _generatedAt: Date.now(),
    system: "non-compliant-project",
    scope: "hexagen",
    description: "Non-compliant fixture for testing refinement",
    architecture: "monolith",
    patterns: [],
    bounded_contexts: [
      {
        name: "invalid_port_name_123", // Violation: snake_case instead of camelCase
        type: "invalid-type", // Violation: invalid type
        description: "Problematic context",
      },
    ],
    generator: {
      version: "0.1.0",
      sync: {
        idempotent: false,
        createOnlyIfMissing: false,
      },
    },
  };
}

/**
 * Clone a registry for isolated concurrent test sessions.
 * Prevents cross-test pollution in load tests.
 *
 * @param sourceRegistry The registry to clone
 * @returns A new registry with the same port mappings
 */
export function cloneRegistry(
  sourceRegistry: MockPortRegistry,
): MockPortRegistry {
  const newRegistry = createCrossBoundaryRegistry();
  // Ports already pre-configured by createCrossBoundaryRegistry
  return newRegistry;
}

/**
 * Helper to extract persistence adapter from registry.
 * Used for verifying manifest persistence in tests.
 *
 * @param registry The MockPortRegistry to query
 * @returns The persistence adapter
 */
export function getPersistenceAdapter(registry: MockPortRegistry): any {
  return registry.get<any>(PORT_NAMES.WIZARD_PERSISTENCE);
}

/**
 * Helper to extract linter adapter from registry.
 * Used for verifying governance compliance checks in tests.
 *
 * @param registry The MockPortRegistry to query
 * @returns The linter adapter
 */
export function getLinterAdapter(registry: MockPortRegistry): any {
  return registry.get<any>(PORT_NAMES.LINTER);
}

/**
 * Helper to extract transaction manager from registry.
 * Used for verifying rollback semantics in tests.
 *
 * @param registry The MockPortRegistry to query
 * @returns The transaction manager adapter
 */
export function getTransactionManager(registry: MockPortRegistry): any {
  return registry.get<any>(PORT_NAMES.TRANSACTION_MANAGER);
}
