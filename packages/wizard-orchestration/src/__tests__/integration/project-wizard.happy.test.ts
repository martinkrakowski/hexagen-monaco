/**
 * @module project-wizard.happy.test
 * @description Happy path tests for Project Wizard user journey.
 *
 * Tests: User scaffolds project → manifest generated successfully.
 * Verifies that the wizard can end-to-end process user input and produce valid output.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createMockRegistry,
  registerMockPort,
  getMockPort,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock.ts";
import {
  MockWizardPersistenceAdapter,
  MockProjectGeneratorAdapter,
  MockFileWriterAdapter,
  createWizardFixtureManifest,
} from "../fixtures/wizard-mocks";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names.ts";

describe("Project Wizard — Happy Path", () => {
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

  it("happy path: user scaffolds new project successfully", async () => {
    const projectInput = {
      projectName: "my-hexagen-project",
      description: "Test hexagonal architecture",
      patterns: ["layered", "clean"],
    };

    const result = await generatorAdapter.generateProject(projectInput);

    assert.strictEqual(result.success, true);
    assert.ok(result.manifest !== undefined);
    assert.ok("system" in (result.manifest as object));
    assert.deepStrictEqual(result.manifest?.system, "my-hexagen-project");
    assert.strictEqual(
      result.manifest?.description,
      "Test hexagonal architecture",
    );
    assert.ok((result.manifest?.patterns as string[]).includes("layered"));
  });

  it("happy path: generated manifest passes validation checks", async () => {
    const projectInput = {
      projectName: "valid-project",
      description: "A valid project",
    };

    const generatedResult =
      await generatorAdapter.generateProject(projectInput);

    assert.strictEqual(generatedResult.success, true);
    const manifest = generatedResult.manifest as Record<string, unknown>;

    assert.ok("system" in manifest);
    assert.ok("scope" in manifest);
    assert.ok("architecture" in manifest);
    assert.ok("generator" in manifest);

    if ("bounded_contexts" in manifest) {
      assert.ok(Array.isArray(manifest.bounded_contexts));
      assert.ok((manifest.bounded_contexts as unknown[]).length > 0);

      const contexts = manifest.bounded_contexts as Array<{
        name: string;
        type: string;
      }>;
      contexts.forEach((bc) => {
        assert.ok("name" in bc);
        assert.ok("type" in bc);
        assert.strictEqual(typeof bc.name, "string");
      });
    }
  });

  it("happy path: session state persists correctly", async () => {
    const sessionId = "session-123";
    const sessionState = {
      sessionId,
      projectName: "persistent-project",
      description: "Testing persistence",
      patterns: ["layered"],
      currentStep: "step-2",
      timestamp: Date.now(),
    };

    await persistenceAdapter.saveSession(sessionId, sessionState);
    const retrievedSession = await persistenceAdapter.getSession(sessionId);

    assert.ok(retrievedSession !== undefined);
    assert.deepStrictEqual(retrievedSession?.projectName, "persistent-project");
    assert.deepStrictEqual(retrievedSession?.currentStep, "step-2");
  });

  it("happy path: file writes are captured", async () => {
    const files = [
      {
        path: "manifest.yaml",
        content: "system: test\narchitecture: modular-monolith\n",
      },
      {
        path: "package.json",
        content: '{"name": "test-project", "version": "0.0.0"}\n',
      },
    ];

    for (const file of files) {
      await fileWriterAdapter.writeFile(file.path, file.content);
    }

    assert.strictEqual(fileWriterAdapter.hasFile("manifest.yaml"), true);
    assert.strictEqual(fileWriterAdapter.hasFile("package.json"), true);
    assert.ok(
      fileWriterAdapter.getFile("manifest.yaml").includes("modular-monolith"),
    );
  });

  it("happy path: registry provides mocks without errors", async () => {
    const persistence = getMockPort<MockWizardPersistenceAdapter>(
      registry,
      PORT_NAMES.WIZARD_PERSISTENCE,
    );
    const generator = getMockPort<MockProjectGeneratorAdapter>(
      registry,
      PORT_NAMES.PROJECT_GENERATOR,
    );
    const fileWriter = getMockPort<MockFileWriterAdapter>(
      registry,
      PORT_NAMES.FILE_WRITER,
    );

    assert.ok(persistence !== undefined);
    assert.ok(generator !== undefined);
    assert.ok(fileWriter !== undefined);

    assert.strictEqual(typeof persistence.saveSession, "function");
    assert.strictEqual(typeof generator.generateProject, "function");
    assert.strictEqual(typeof fileWriter.writeFile, "function");
  });

  it("happy path: fixture manifest loads correctly", async () => {
    const fixture = await createWizardFixtureManifest();

    assert.ok("system" in fixture);
    assert.ok("bounded_contexts" in fixture);
    assert.deepStrictEqual(fixture.system, "test-hexagen");

    const boundedContexts = (fixture as Record<string, unknown>)
      .bounded_contexts as Array<{ name: string }>;
    assert.ok(Array.isArray(boundedContexts));
    assert.ok(boundedContexts.length >= 5);

    const contextNames = boundedContexts.map((bc) => bc.name);
    assert.ok(contextNames.includes("core-domain"));
    assert.ok(contextNames.includes("shared"));
    assert.ok(contextNames.includes("wizard-orchestration"));
  });
});
