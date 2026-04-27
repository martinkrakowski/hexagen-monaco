/**
 * @module @hexagen/web-driver/__tests__/fixtures
 * @description Reusable test fixtures and mock factories exported for all test suites.
 */

export {
  createMockRegistry,
  registerMockPort,
  getMockPort,
} from "./port-registry.mock";
export type { MockPortRegistry, PortRegistry } from "./port-registry.mock";
