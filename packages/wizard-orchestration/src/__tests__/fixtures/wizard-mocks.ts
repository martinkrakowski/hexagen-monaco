/**
 * @module wizard-mocks
 * @description Test doubles for Project Wizard orchestration.
 *
 * Provides in-memory implementations of all ports required by the wizard use-case.
 * All mocks are clean-state per test (no shared state).
 */

/**
 * Type for wizard session state (simplified for testing).
 */
export interface WizardSessionState {
  sessionId: string;
  projectName: string;
  description?: string;
  patterns?: string[];
  currentStep: string;
  timestamp: number;
}

/**
 * Mock Wizard Persistence Adapter — In-memory session storage.
 *
 * Stores session state in memory; resets between tests.
 * Simulates successful persistence without I/O.
 */
export class MockWizardPersistenceAdapter {
  private sessions = new Map<string, WizardSessionState>();

  async saveSession(
    sessionId: string,
    state: WizardSessionState,
  ): Promise<void> {
    this.sessions.set(sessionId, { ...state, timestamp: Date.now() });
  }

  async getSession(sessionId: string): Promise<WizardSessionState | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async listSessions(): Promise<WizardSessionState[]> {
    return Array.from(this.sessions.values());
  }

  reset(): void {
    this.sessions.clear();
  }
}

/**
 * Mock Project Generator Adapter — Returns fixture manifest.
 *
 * Simulates project generation without calling LLM.
 * Returns pre-built fixture manifest instantly.
 */
export class MockProjectGeneratorAdapter {
  async generateProject(input: {
    projectName: string;
    description?: string;
    patterns?: string[];
  }): Promise<{
    success: boolean;
    manifest?: Record<string, unknown>;
    error?: string;
  }> {
    // Simulate successful generation
    return {
      success: true,
      manifest: {
        system: input.projectName,
        scope: "hexagen",
        architecture: "modular-monolith",
        description: input.description || `Project: ${input.projectName}`,
        patterns: input.patterns || [],
        bounded_contexts: [
          {
            name: "core-domain",
            type: "core",
            description: "Core domain",
          },
          {
            name: "shared",
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
      },
    };
  }
}

/**
 * Mock File Writer Adapter — Captures writes to memory.
 *
 * Simulates file system writes without touching disk.
 * Allows tests to assert on generated file content.
 */
export class MockFileWriterAdapter {
  private files = new Map<string, string>();

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async mkdir(_dirPath: string): Promise<void> {
    // No-op: in-memory storage doesn't need directories
  }

  getWrittenFiles(): Map<string, string> {
    return new Map(this.files);
  }

  getFile(filePath: string): string | undefined {
    return this.files.get(filePath);
  }

  hasFile(filePath: string): boolean {
    return this.files.has(filePath);
  }

  reset(): void {
    this.files.clear();
  }
}

/**
 * Helper: Create fixture manifest for wizard tests.
 *
 * Loads the pre-built fixture manifest from YAML.
 * Useful for tests that need to verify manifest structure post-generation.
 *
 * @returns Promise<Record<string, unknown>> - The fixture manifest
 */
export async function createWizardFixtureManifest(): Promise<
  Record<string, unknown>
> {
  // For now, return an in-memory fixture
  // In Phase 6B, we can load from the YAML file if needed
  return {
    system: "test-hexagen",
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
        name: "project-configuration",
        type: "core",
        description: "Manifest parsing",
      },
      {
        name: "wizard-orchestration",
        type: "core",
        description: "Wizard orchestration",
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
        createOnlyIfMissing: true,
      },
    },
  };
}
