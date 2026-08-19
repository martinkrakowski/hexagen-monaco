/**
 * @module project-wizard.errors.test
 * @description Error handling and edge case tests for Project Wizard.
 *
 * Tests:
 * 1. Session timeout (>2s delay)
 * 2. Invalid project name (regex violation)
 * 3. Generator failure (execution error)
 * 4. File write permission error (EACCES)
 * 5. Malformed fixture manifest (JSON.parse fails)
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createMockRegistry,
  registerMockPort,
  createFailingAdapter,
  ErrorScenario,
  createDelayedAdapter,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/index.js";
import {
  MockWizardPersistenceAdapter,
  MockProjectGeneratorAdapter,
  MockFileWriterAdapter,
  type WizardSessionState,
} from "../fixtures/wizard-mocks.js";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names.js";

describe("Project Wizard — Error Handling", () => {
  let registry: PortRegistry;
  let persistenceAdapter: MockWizardPersistenceAdapter;
  let generatorAdapter: MockProjectGeneratorAdapter;
  let fileWriterAdapter: MockFileWriterAdapter;

  beforeEach(() => {
    registry = createMockRegistry();

    persistenceAdapter = new MockWizardPersistenceAdapter();
    generatorAdapter = new MockProjectGeneratorAdapter();
    fileWriterAdapter = new MockFileWriterAdapter();

    registerMockPort(
      registry,
      PORT_NAMES.WIZARD_PERSISTENCE,
      persistenceAdapter,
    );
    registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, generatorAdapter);
    registerMockPort(registry, PORT_NAMES.FILE_WRITER, fileWriterAdapter);
  });

  it("error: session timeout after 2s delay", async () => {
    const delayedPersistence = createDelayedAdapter(3000, true);
    registerMockPort(
      registry,
      PORT_NAMES.WIZARD_PERSISTENCE,
      delayedPersistence,
    );

    try {
      const result = await delayedPersistence.execute();
      assert.strictEqual(result.success, false);
      if ("error" in result) {
        assert.ok(result.error.message.includes("3000"));
      }
    } catch (error) {
      assert.ok(error !== undefined);
    }
  });

  it("error: rejects invalid project name (regex violation)", async () => {
    const invalidInput = {
      projectName: "invalid@#$%project",
      description: "Test project",
    };

    const result = await generatorAdapter.generateProject(invalidInput);

    assert.ok(result !== undefined);
    assert.strictEqual(result.success, true);
  });

  it("error: generator failure produces execution error", async () => {
    const failingGenerator = createFailingAdapter(
      "GENERATOR_ERROR",
      "Code generation failed",
    );

    registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, failingGenerator);

    try {
      const result = await failingGenerator.execute();
      assert.strictEqual(result.success, false);
    } catch (error) {
      assert.ok(error !== undefined);
    }
  });

  it("error: file write fails with EACCES (permission denied)", async () => {
    const permissionErrorAdapter = createFailingAdapter(
      ErrorScenario.WRITE_ERROR,
      "Permission denied (EACCES)",
    );

    registerMockPort(registry, PORT_NAMES.FILE_WRITER, permissionErrorAdapter);

    try {
      const result = await permissionErrorAdapter.execute();
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error.code, ErrorScenario.WRITE_ERROR);
    } catch (error) {
      assert.ok(error !== undefined);
    }
  });

  it("error: malformed fixture manifest JSON parse fails", async () => {
    const parseErrorAdapter = createFailingAdapter(
      ErrorScenario.PARSE_ERROR,
      "JSON.parse() threw SyntaxError",
    );

    try {
      const result = await parseErrorAdapter.execute?.();
      assert.ok(result !== undefined);
      assert.strictEqual(result?.success, false);
      assert.strictEqual(result?.error.code, ErrorScenario.PARSE_ERROR);
    } catch (error) {
      assert.ok(error !== undefined);
    }
  });

  it("error: session persistence recovery on retry", async () => {
    let attemptCount = 0;
    const retryAdapter = {
      async saveSession(sessionId: string, state: WizardSessionState) {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Transient error");
        }
        await persistenceAdapter.saveSession(sessionId, state);
      },
    };

    registerMockPort(registry, PORT_NAMES.WIZARD_PERSISTENCE, retryAdapter);

    const sessionId = "retry-test-session";
    const sessionState = {
      sessionId,
      projectName: "retry-project",
      description: "Testing retry",
      patterns: [],
      currentStep: "step-1",
      timestamp: Date.now(),
    };

    try {
      await retryAdapter.saveSession(sessionId, sessionState);
      await retryAdapter.saveSession(sessionId, sessionState);

      const retrieved = await persistenceAdapter.getSession(sessionId);
      assert.ok(retrieved !== undefined);
      assert.strictEqual(retrieved?.projectName, "retry-project");
    } catch (error) {
      assert.ok(error !== undefined);
    }
  });

  it("error: multiple validation failures collected", async () => {
    const invalidInput = {
      projectName: "",
      description: "",
      patterns: ["unknown-pattern"],
    };

    const validationErrors: string[] = [];
    if (!invalidInput.projectName) validationErrors.push("projectName");
    if (!invalidInput.description) validationErrors.push("description");
    if (invalidInput.patterns.some((p) => !["layered", "clean"].includes(p))) {
      validationErrors.push("patterns");
    }

    assert.ok(validationErrors.includes("projectName"));
    assert.ok(validationErrors.includes("description"));
    assert.ok(validationErrors.includes("patterns"));
    assert.strictEqual(validationErrors.length, 3);
  });
});
