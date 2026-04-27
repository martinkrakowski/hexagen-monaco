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

export {
  ErrorScenario,
  createErrorInjectingRegistry,
  createTimeoutAdapter,
  createFailingAdapter,
  createDelayedAdapter,
  createValidationErrorAdapter,
  createParseErrorAdapter,
  createAuthErrorAdapter,
  ERROR_SEVERITY_MAP,
  ERROR_RECOVERABILITY_MAP,
} from "./error-adapters";
export type { ErrorResult } from "./error-adapters";

export {
  IntegrationScenario,
  createCrossBoundaryRegistry,
  wireWizardToPersistence,
  wireGovernanceToManifestReader,
  wireExportToGovernance,
  createFixtureManifest,
  createNonCompliantFixtureManifest,
  cloneRegistry,
  getPersistenceAdapter,
  getLinterAdapter,
  getTransactionManager,
} from "./cross-boundary-registry";
export type { CrossBoundaryManifest } from "./cross-boundary-registry";
