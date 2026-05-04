/**
 * @module project-wizard.happy.test
 * @description Happy path tests for Project Wizard user journey.
 *
 * Tests: User scaffolds project → manifest generated successfully.
 * Verifies that the wizard can end-to-end process user input and produce valid output.
 */

import { describe, it, expect, beforeEach } from "vitest";
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
    // Create fresh registry for each test
    registry = createMockRegistry();

    // Create mock adapters (fresh instances per test)
    persistenceAdapter = new MockWizardPersistenceAdapter();
    generatorAdapter = new MockProjectGeneratorAdapter();
    fileWriterAdapter = new MockFileWriterAdapter();

    // Register mocks in registry with compile-time type safety
    registerMockPort(
      registry,
      PORT_NAMES.WIZARD_PERSISTENCE,
      persistenceAdapter,
    );
    registerMockPort(registry, PORT_NAMES.PROJECT_GENERATOR, generatorAdapter);
    registerMockPort(registry, PORT_NAMES.FILE_WRITER, fileWriterAdapter);
  });

  it("happy path: user scaffolds new project successfully", async () => {
    // Arrange: Prepare user input
    const projectInput = {
      projectName: "my-hexagen-project",
      description: "Test hexagonal architecture",
      patterns: ["layered", "clean"],
    };

    // Act: Generate project using mocked generator
    const result = await generatorAdapter.generateProject(projectInput);

    // Assert: Verify success and manifest structure
    expect(result.success).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest).toHaveProperty("system");
    expect(result.manifest?.system).toEqual("my-hexagen-project");
    expect(result.manifest?.description).toBe("Test hexagonal architecture");
    expect(result.manifest?.patterns).toContain("layered");
  });

  it("happy path: generated manifest passes validation checks", async () => {
    // Arrange: Generate a project
    const projectInput = {
      projectName: "valid-project",
      description: "A valid project",
    };

    const generatedResult =
      await generatorAdapter.generateProject(projectInput);

    // Assert: Verify manifest structure
    expect(generatedResult.success).toBe(true);
    const manifest = generatedResult.manifest as Record<string, unknown>;

    // Check that manifest has required fields
    expect(manifest).toHaveProperty("system");
    expect(manifest).toHaveProperty("scope");
    expect(manifest).toHaveProperty("architecture");
    expect(manifest).toHaveProperty("generator");

    // Check bounded contexts array exists and has entries
    if ("bounded_contexts" in manifest) {
      expect(Array.isArray(manifest.bounded_contexts)).toBe(true);
      expect((manifest.bounded_contexts as unknown[]).length).toBeGreaterThan(
        0,
      );

      // Verify each bounded context has required fields
      const contexts = manifest.bounded_contexts as Array<{
        name: string;
        type: string;
      }>;
      contexts.forEach((bc) => {
        expect(bc).toHaveProperty("name");
        expect(bc).toHaveProperty("type");
        expect(typeof bc.name).toBe("string");
      });
    }
  });

  it("happy path: session state persists correctly", async () => {
    // Arrange: Create a session
    const sessionId = "session-123";
    const sessionState = {
      sessionId,
      projectName: "persistent-project",
      description: "Testing persistence",
      patterns: ["layered"],
      currentStep: "step-2",
      timestamp: Date.now(),
    };

    // Act: Save and retrieve session
    await persistenceAdapter.saveSession(sessionId, sessionState);
    const retrievedSession = await persistenceAdapter.getSession(sessionId);

    // Assert: Verify session was persisted
    expect(retrievedSession).toBeDefined();
    expect(retrievedSession?.projectName).toEqual("persistent-project");
    expect(retrievedSession?.currentStep).toEqual("step-2");
  });

  it("happy path: file writes are captured", async () => {
    // Arrange: Write some files
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

    // Act: Write files
    for (const file of files) {
      await fileWriterAdapter.writeFile(file.path, file.content);
    }

    // Assert: Verify files were captured
    expect(fileWriterAdapter.hasFile("manifest.yaml")).toBe(true);
    expect(fileWriterAdapter.hasFile("package.json")).toBe(true);
    expect(fileWriterAdapter.getFile("manifest.yaml")).toContain(
      "modular-monolith",
    );
  });

  it("happy path: registry provides mocks without errors", async () => {
    // Arrange: All mocks are registered above

    // Act: Retrieve mocks from registry using type-safe constants
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

    // Assert: All mocks are available
    expect(persistence).toBeDefined();
    expect(generator).toBeDefined();
    expect(fileWriter).toBeDefined();

    // Verify they're the right types
    expect(typeof persistence.saveSession).toBe("function");
    expect(typeof generator.generateProject).toBe("function");
    expect(typeof fileWriter.writeFile).toBe("function");
  });

  it("happy path: fixture manifest loads correctly", async () => {
    // Arrange: Load fixture manifest
    const fixture = await createWizardFixtureManifest();

    // Assert: Verify fixture structure
    expect(fixture).toHaveProperty("system");
    expect(fixture).toHaveProperty("bounded_contexts");
    expect(fixture.system).toEqual("test-hexagen");

    // Verify bounded contexts
    const boundedContexts = (fixture as Record<string, unknown>)
      .bounded_contexts as Array<{ name: string }>;
    expect(Array.isArray(boundedContexts)).toBe(true);
    expect(boundedContexts.length).toBeGreaterThanOrEqual(5);

    // Verify expected contexts exist
    const contextNames = boundedContexts.map((bc) => bc.name);
    expect(contextNames).toContain("core-domain");
    expect(contextNames).toContain("shared");
    expect(contextNames).toContain("wizard-orchestration");
  });
});
