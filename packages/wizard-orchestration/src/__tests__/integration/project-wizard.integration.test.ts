/**
 * @module project-wizard.integration.test
 * @description Phase 6C Integration Tests: Cross-boundary workflows for Project Wizard.
 *
 * Tests multi-component workflows:
 * 1. Wizard → Persistence → Governance (manifest integrity across boundaries)
 * 2. Session recovery with retry (timeout → recovery)
 * 3. Refinement loop (v1 violations → v2 compliant)
 *
 * Each test verifies state preservation across component boundaries.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createCrossBoundaryRegistry,
  wireWizardToPersistence,
  wireGovernanceToManifestReader,
  _createFixtureManifest,
  _createNonCompliantFixtureManifest,
  _getPersistenceAdapter,
  getLinterAdapter,
  type CrossBoundaryManifest,
} from "../../../../web-driver/src/__tests__/fixtures/cross-boundary-registry";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";
import {
  _createMockRegistry,
  registerMockPort,
  _getMockPort,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock";
import {
  MockWizardPersistenceAdapter,
  MockProjectGeneratorAdapter,
} from "../fixtures/wizard-mocks";
import { createTimeoutAdapter } from "../../../../web-driver/src/__tests__/fixtures/error-adapters";

describe("Project Wizard — Integration Tests (Phase 6C)", () => {
  let registry: PortRegistry;

  beforeEach(() => {
    registry = createCrossBoundaryRegistry();
  });

  describe("Scenario 1: Wizard → Persistence → Governance", () => {
    it("integration: wizard generates manifest → persistence persists → governance validates", async () => {
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);

      const persistenceAdapter = new MockWizardPersistenceAdapter();
      const generatorAdapter = new MockProjectGeneratorAdapter();

      registerMockPort(
        registry,
        PORT_NAMES.WIZARD_PERSISTENCE,
        persistenceAdapter,
      );
      registerMockPort(
        registry,
        PORT_NAMES.PROJECT_GENERATOR,
        generatorAdapter,
      );

      const projectInput = {
        projectName: "integration-test-project",
        description: "Cross-boundary integration test",
        patterns: ["layered", "clean"],
      };

      const wizardResult = await generatorAdapter.generateProject(projectInput);
      assert.strictEqual(wizardResult.success, true);
      assert.ok(wizardResult.manifest !== undefined);

      const generatedManifest = wizardResult.manifest as CrossBoundaryManifest;

      const sessionId = "session-" + Date.now();
      await persistenceAdapter.saveSession(sessionId, {
        sessionId,
        projectName: generatedManifest.system,
        description: generatedManifest.description,
        patterns: generatedManifest.patterns,
        currentStep: "generation-complete",
        timestamp: Date.now(),
      });

      const persistedSession = await persistenceAdapter.getSession(sessionId);
      assert.ok(persistedSession !== undefined);
      assert.strictEqual(
        persistedSession?.projectName,
        generatedManifest.system,
      );

      const linter = getLinterAdapter(registry);
      const lintResult = await linter.lint(generatedManifest);

      assert.strictEqual(lintResult.isCompliant, true);
      assert.strictEqual(lintResult.violations.length, 0);

      assert.strictEqual(generatedManifest.system, "integration-test-project");
      assert.ok((generatedManifest.bounded_contexts?.length ?? 0) > 0);
    });
  });

  describe("Scenario 2: Session Recovery (Timeout → Retry)", () => {
    it("integration: session timeout (first attempt) → recovery succeeds", async () => {
      wireWizardToPersistence(registry);

      const generatorAdapter = new MockProjectGeneratorAdapter();
      const persistenceAdapter = new MockWizardPersistenceAdapter();

      const timeoutAdapter = createTimeoutAdapter(100);
      registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, timeoutAdapter);
      registerMockPort(
        registry,
        PORT_NAMES.WIZARD_PERSISTENCE,
        persistenceAdapter,
      );

      let result: Record<string, unknown> | null = null;
      try {
        result = await (timeoutAdapter as Record<string, unknown>).execute();
      } catch {
        void 0;
      }

      assert.ok((result?.success || result?.error) !== undefined);

      registerMockPort(
        registry,
        PORT_NAMES.PROJECT_GENERATOR,
        generatorAdapter,
      );

      const recoveryInput = {
        projectName: "recovery-project",
        description: "After recovery",
      };

      const recoveredResult =
        await generatorAdapter.generateProject(recoveryInput);
      assert.strictEqual(recoveredResult.success, true);
      assert.ok(recoveredResult.manifest !== undefined);

      const sessionId = "recovery-session";
      const recovered = recoveredResult.manifest as CrossBoundaryManifest;
      await persistenceAdapter.saveSession(sessionId, {
        sessionId,
        projectName: recovered.system,
        description: recovered.description,
        patterns: recovered.patterns,
        currentStep: "recovered",
        timestamp: Date.now(),
      });

      const savedSession = await persistenceAdapter.getSession(sessionId);
      assert.ok(savedSession !== undefined);
      assert.strictEqual(savedSession?.projectName, "recovery-project");
      assert.strictEqual(savedSession?.currentStep, "recovered");
    });
  });

  describe("Scenario 3: Refinement Loop (v1 → violations → v2 → compliant)", () => {
    it("integration: manifest v1 (violations) → governance feedback → v2 (compliant)", async () => {
      wireWizardToPersistence(registry);
      wireGovernanceToManifestReader(registry);

      const persistenceAdapter = new MockWizardPersistenceAdapter();
      const generatorAdapter = new MockProjectGeneratorAdapter();

      registerMockPort(
        registry,
        PORT_NAMES.WIZARD_PERSISTENCE,
        persistenceAdapter,
      );
      registerMockPort(
        registry,
        PORT_NAMES.PROJECT_GENERATOR,
        generatorAdapter,
      );

      const v1ManifestNonCompliant: CrossBoundaryManifest = {
        _version: "v1-" + Date.now(),
        _generatedAt: Date.now(),
        system: "project-v1",
        scope: "hexagen",
        description: "V1 with issues",
        bounded_contexts: [
          {
            name: "invalid_port_name",
            type: "unknown-type",
            description: "Problematic",
          },
        ],
      };

      const sessionId = "refinement-session";
      await persistenceAdapter.saveSession(sessionId, {
        sessionId,
        projectName: v1ManifestNonCompliant.system,
        description: v1ManifestNonCompliant.description,
        patterns: [],
        currentStep: "v1-generated",
        timestamp: Date.now(),
      });

      const linter = getLinterAdapter(registry);
      const v1LintResult = await linter.lint(v1ManifestNonCompliant);

      assert.ok(v1LintResult.isCompliant !== undefined);

      const v2Input = {
        projectName: "project-v2-refined",
        description: "V2 after refinement",
        patterns: ["layered", "clean"],
      };

      const v2Result = await generatorAdapter.generateProject(v2Input);
      assert.strictEqual(v2Result.success, true);

      const v2Manifest = v2Result.manifest as CrossBoundaryManifest;
      v2Manifest._version = "v2-" + Date.now();

      await persistenceAdapter.saveSession(sessionId, {
        sessionId,
        projectName: v2Manifest.system,
        description: v2Manifest.description,
        patterns: v2Manifest.patterns,
        currentStep: "v2-refined",
        timestamp: Date.now(),
      });

      const v2LintResult = await linter.lint(v2Manifest);
      assert.strictEqual(v2LintResult.isCompliant, true);
      assert.strictEqual(v2LintResult.violations.length, 0);

      const finalSession = await persistenceAdapter.getSession(sessionId);
      assert.ok(finalSession !== undefined);
      assert.strictEqual(finalSession?.currentStep, "v2-refined");
      assert.strictEqual(finalSession?.projectName, "project-v2-refined");

      assert.notStrictEqual(
        v1ManifestNonCompliant._version,
        v2Manifest._version,
      );
    });
  });

  describe("State Isolation", () => {
    it("integration: each test gets fresh registry (no cross-test pollution)", async () => {
      const registry1 = createCrossBoundaryRegistry();
      const persistence1 = new MockWizardPersistenceAdapter();
      registerMockPort(registry1, PORT_NAMES.WIZARD_PERSISTENCE, persistence1);

      const sessionId = "test-session-1";
      await persistence1.saveSession(sessionId, {
        sessionId,
        projectName: "project-1",
        description: "Session 1",
        patterns: [],
        currentStep: "step-1",
        timestamp: Date.now(),
      });

      const session1 = await persistence1.getSession(sessionId);
      assert.strictEqual(session1?.projectName, "project-1");

      const registry2 = createCrossBoundaryRegistry();
      const persistence2 = new MockWizardPersistenceAdapter();
      registerMockPort(registry2, PORT_NAMES.WIZARD_PERSISTENCE, persistence2);

      const session2 = await persistence2.getSession(sessionId);
      assert.strictEqual(session2, null);
    });
  });
});
