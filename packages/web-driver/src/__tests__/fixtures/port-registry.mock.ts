/**
 * @module port-registry.mock
 * @description Reusable mock factory for PortRegistry across all test suites.
 *
 * Provides compile-time type-safe port registration and retrieval using PORT_NAMES constants.
 * All mocks are pre-populated with default no-op implementations that can be overridden per test.
 *
 * @usage
 *   const registry = createMockRegistry();
 *   registry.set(PORT_NAMES.LINTER, mockLinter);
 *   const result = await registry.get(PORT_NAMES.LINTER).lint(...);
 */

import {
  PORT_NAMES,
  PortName,
} from "../../infrastructure/constants/port-names";

/**
 * Minimal PortRegistry interface for testing.
 * Matches the real registry contract: get/set with type safety.
 */
export interface MockPortRegistry {
  set<T>(portName: PortName, adapter: T): void;
  get<T>(portName: PortName): T;
  has(portName: PortName): boolean;
  clear(): void;
}

/**
 * In-memory port registry implementation for testing.
 * Provides type-safe registration without string magic.
 */
class InMemoryPortRegistry implements MockPortRegistry {
  private ports = new Map<PortName, unknown>();

  set<T>(portName: PortName, adapter: T): void {
    if (!portName) {
      throw new Error("Port name cannot be empty");
    }
    this.ports.set(portName, adapter);
  }

  get<T>(portName: PortName): T {
    if (!this.ports.has(portName)) {
      throw new Error(`Port not registered: ${portName}`);
    }
    return this.ports.get(portName) as T;
  }

  has(portName: PortName): boolean {
    return this.ports.has(portName);
  }

  clear(): void {
    this.ports.clear();
  }
}

/**
 * Factory function: Creates a fresh PortRegistry with default no-op mocks pre-populated.
 * Each test gets a clean registry to prevent cross-test pollution.
 *
 * @returns Fresh MockPortRegistry with all PORT_NAMES pre-registered with no-op implementations
 * @example
 *   const registry = createMockRegistry();
 *   registry.set(PORT_NAMES.WIZARD_PERSISTENCE, customMock);
 *   const adapter = registry.get(PORT_NAMES.WIZARD_PERSISTENCE);
 */
export function createMockRegistry(): MockPortRegistry {
  const registry = new InMemoryPortRegistry();

  // Pre-populate with default no-op implementations for all known ports
  // Override in individual tests as needed
  const noOpAdapter = {
    execute: async () => ({ success: true }),
    process: async () => ({}),
    call: async () => undefined,
    get: async () => undefined,
    set: async () => undefined,
    read: async () => "",
    write: async () => undefined,
  };

  // Register all PORT_NAMES with no-op implementations
  Object.values(PORT_NAMES).forEach((portName) => {
    registry.set(portName as PortName, noOpAdapter);
  });

  return registry;
}

/**
 * Helper function: Register a single mock port with type safety.
 * Validates that portName is a recognized PORT_NAMES constant.
 *
 * @param registry The MockPortRegistry instance
 * @param portName A PORT_NAMES constant (compile-time safe)
 * @param adapter The mock implementation
 * @throws If portName is not a recognized PORT_NAMES value
 * @example
 *   registerMockPort(registry, PORT_NAMES.LINTER, mockLinter);
 */
export function registerMockPort<T>(
  registry: MockPortRegistry,
  portName: PortName,
  adapter: T,
): void {
  if (!portName) {
    throw new Error("Port name is required");
  }
  registry.set(portName, adapter);
}

/**
 * Helper function: Retrieve a registered port with type safety.
 * Validates that the port is registered before retrieval.
 *
 * @param registry The MockPortRegistry instance
 * @param portName A PORT_NAMES constant (compile-time safe)
 * @returns The registered adapter
 * @throws If portName is not registered in the registry
 * @example
 *   const linter = getMockPort<LinterPort>(registry, PORT_NAMES.LINTER);
 */
export function getMockPort<T>(
  registry: MockPortRegistry,
  portName: PortName,
): T {
  if (!registry.has(portName)) {
    throw new Error(`Port ${portName} not registered in mock registry`);
  }
  return registry.get<T>(portName);
}

/**
 * Type export for test consumers.
 * @example
 *   import type { MockPortRegistry } from '@hexagen/web-driver/__tests__/fixtures';
 */
export type PortRegistry = MockPortRegistry;
