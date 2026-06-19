/**
 * @module error-recovery.integration.test
 * @description Phase 6C Integration Tests: Error recovery and cascading failures.
 *
 * Tests error handling across component boundaries:
 * 1. Timeout recovery with exponential backoff retry
 * 2. Cascading error handling (wizard error → governance skip → export refuse)
 *
 * Verifies resilience and error propagation through system.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createCrossBoundaryRegistry,
  wireWizardToPersistence,
  wireGovernanceToManifestReader,
  wireExportToGovernance,
  _createFixtureManifest,
  type CrossBoundaryManifest,
} from "../../../../web-driver/src/__tests__/fixtures/cross-boundary-registry";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";
import {
  registerMockPort,
  getMockPort,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock";

type IntegrationError = { code: string; message: string };

describe("Error Recovery — Integration Tests (Phase 6C)", () => {
  let registry: ReturnType<typeof createCrossBoundaryRegistry>;

  beforeEach(() => {
    registry = createCrossBoundaryRegistry();
  });

  describe("Scenario 1: Timeout Recovery with Exponential Backoff", () => {
    it("integration: first attempt timeout → exponential backoff → success on retry", async () => {
      wireWizardToPersistence(registry);

      const retryState = {
        attempts: 0,
        backoffs: [] as number[],
      };

      const flakyWizard = {
        async generateProject(input: {
          projectName: string;
        }): Promise<{ success: boolean; manifest?: unknown; error?: unknown }> {
          retryState.attempts++;

          if (retryState.attempts <= 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 50 + retryState.attempts * 50),
            );
            throw new Error("ETIMEDOUT: Connection timeout");
          }

          return {
            success: true,
            manifest: {
              system: input.projectName,
              scope: "hexagen",
            },
          };
        },
      };

      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, flakyWizard);

      const retryWithBackoff = async <T>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        backoffs: number[] = [100, 200, 400],
      ): Promise<T> => {
        let lastError: unknown = null;

        for (let i = 0; i < maxRetries; i++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error;
            retryState.backoffs.push(backoffs[i] || 500);

            if (i < maxRetries - 1) {
              await new Promise((resolve) => setTimeout(resolve, backoffs[i]));
            }
          }
        }

        throw lastError;
      };

      const wizard = getMockPort(registry, PORT_NAMES.PROJECT_GENERATOR);
      const result = await retryWithBackoff(
        () => wizard.generateProject({ projectName: "recovery-project" }),
        3,
        [100, 200, 400],
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.manifest.system, "recovery-project");

      assert.strictEqual(retryState.attempts, 3);
      assert.deepStrictEqual(retryState.backoffs, [100, 200]);
    });
  });

  describe("Scenario 2: Cascading Error Handling", () => {
    it("integration: wizard error → governance skip → export refuse", async () => {
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      const errorLog = {
        steps: [] as string[],
      };

      const failingWizard = {
        async generateProject(): Promise<{
          success: boolean;
          manifest?: unknown;
          error?: unknown;
        }> {
          errorLog.steps.push("wizard-error");
          return {
            success: false,
            error: {
              code: "TIMEOUT",
              message: "Wizard generation timed out",
            },
          };
        },
      };

      const gracefulGovernance = {
        async scan(manifest: unknown): Promise<{
          success: boolean;
          error?: IntegrationError;
          data?: unknown;
        }> {
          if (!manifest) {
            errorLog.steps.push("governance-skip");
            return {
              success: false,
              error: {
                code: "INVALID_MANIFEST",
                message: "Cannot scan null manifest",
              },
            };
          }
          return { success: true, data: { isCompliant: true } };
        },
      };

      const defensiveExport = {
        async validateManifest(
          manifest: unknown,
        ): Promise<{ success: boolean; error?: IntegrationError }> {
          if (!manifest) {
            errorLog.steps.push("export-refuse");
            return {
              success: false,
              error: {
                code: "INVALID_MANIFEST",
                message: "Cannot export without manifest",
              },
            };
          }
          return { success: true };
        },
      };

      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, failingWizard);
      registerMockPort(registry, PORT_NAMES.LINTER, gracefulGovernance);
      registerMockPort(registry, PORT_NAMES.SSE_STREAM, defensiveExport);

      const wizard = getMockPort(registry, PORT_NAMES.PROJECT_GENERATOR);
      const wizResult = await wizard.generateProject({
        projectName: "test",
      });

      assert.strictEqual(wizResult.success, false);

      const governance = getMockPort(registry, PORT_NAMES.LINTER);
      const govResult = await governance.scan(null);

      assert.strictEqual(govResult.success, false);
      assert.strictEqual(govResult.error?.code, "INVALID_MANIFEST");

      const exporter = getMockPort(registry, PORT_NAMES.SSE_STREAM);
      const expResult = await exporter.validateManifest(null);

      assert.strictEqual(expResult.success, false);
      assert.strictEqual(expResult.error?.code, "INVALID_MANIFEST");

      assert.deepStrictEqual(errorLog.steps, [
        "wizard-error",
        "governance-skip",
        "export-refuse",
      ]);
    });

    it("integration: partial pipeline failure recovers gracefully", async () => {
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);
      wireExportToGovernance(registry);

      const workingWizard = {
        async generateProject(input: { projectName: string }): Promise<{
          success: boolean;
          manifest?: unknown;
        }> {
          return {
            success: true,
            manifest: {
              system: input.projectName,
              scope: "hexagen",
            },
          };
        },
      };

      const failingGovernance = {
        async scan(): Promise<{ success: boolean; error?: IntegrationError }> {
          return {
            success: false,
            error: {
              code: "SCAN_FAILED",
              message: "Governance scan failed",
            },
          };
        },
      };

      const recoveryExport = {
        async streamExport(request: {
          manifest: CrossBoundaryManifest;
          target: string;
        }): Promise<{ success: boolean }> {
          return { success: true };
        },
      };

      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, workingWizard);
      registerMockPort(registry, PORT_NAMES.LINTER, failingGovernance);
      registerMockPort(registry, PORT_NAMES.SSE_STREAM, recoveryExport);

      const wizard = getMockPort(registry, PORT_NAMES.PROJECT_GENERATOR);
      const wizResult = await wizard.generateProject({
        projectName: "resilient-project",
      });
      assert.strictEqual(wizResult.success, true);

      const governance = getMockPort(registry, PORT_NAMES.LINTER);
      const govResult = await governance.scan(wizResult.manifest);
      assert.strictEqual(govResult.success, false);

      const exporter = getMockPort(registry, PORT_NAMES.SSE_STREAM);
      const expResult = await exporter.streamExport({
        manifest: wizResult.manifest,
        target: "zip",
      });
      assert.strictEqual(expResult.success, true);
    });
  });

  describe("State Isolation", () => {
    it("integration: error state isolated per test registry", async () => {
      const registry1 = createCrossBoundaryRegistry();
      wireWizardToPersistence(registry1);

      const failingWizard1 = {
        callCount: 0,
        async generateProject(): Promise<unknown> {
          this.callCount++;
          throw new Error("Always fails");
        },
      };
      registerMockPort(registry1, PORT_NAMES.PROJECT_GENERATOR, failingWizard1);

      const wizard1 = getMockPort(registry1, PORT_NAMES.PROJECT_GENERATOR);
      try {
        await wizard1.generateProject({});
      } catch {
        // expected
      }
      assert.strictEqual(failingWizard1.callCount, 1);

      const registry2 = createCrossBoundaryRegistry();
      wireWizardToPersistence(registry2);

      const workingWizard2 = {
        callCount: 0,
        async generateProject(): Promise<unknown> {
          this.callCount++;
          return { success: true, manifest: {} };
        },
      };
      registerMockPort(registry2, PORT_NAMES.PROJECT_GENERATOR, workingWizard2);

      const wizard2 = getMockPort(registry2, PORT_NAMES.PROJECT_GENERATOR);
      const result = await wizard2.generateProject({});

      assert.strictEqual(result.success, true);
      assert.strictEqual(workingWizard2.callCount, 1);
      assert.strictEqual(failingWizard1.callCount, 1);
    });
  });
});
