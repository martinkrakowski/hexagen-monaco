/**
 * @module export-mocks
 * @description Test doubles for Export Pipeline.
 *
 * Provides in-memory implementations of external integration ports.
 * All mocks support streaming events, transaction tracking, and fast execution.
 */

/**
 * Type for SSE (Server-Sent Events) event.
 */
export interface SSEEvent {
  type: string;
  step?: string;
  status?: string;
  progress?: number;
  message?: string;
  timestamp: number;
}

/**
 * Mock GitHub Provider Adapter — Fakes GitHub API.
 *
 * Simulates GitHub OAuth and repository operations.
 * Returns success without making real API calls.
 */
export class MockGitHubProviderAdapter {
  private isAuthenticated = false;

  async authenticate(token: string): Promise<{ success: boolean }> {
    if (!token) {
      return { success: false };
    }
    this.isAuthenticated = true;
    return { success: true };
  }

  async createRepository(options: {
    name: string;
    description?: string;
  }): Promise<{ success: boolean; url?: string }> {
    if (!this.isAuthenticated) {
      return { success: false };
    }
    return {
      success: true,
      url: `https://github.com/test/${options.name}`,
    };
  }

  async pushFiles(options: {
    repositoryUrl: string;
    files: Array<{ path: string; content: string }>;
    commitMessage: string;
  }): Promise<{ success: boolean }> {
    if (!this.isAuthenticated || !options.repositoryUrl) {
      return { success: false };
    }
    return { success: true };
  }

  reset(): void {
    this.isAuthenticated = false;
  }
}

/**
 * Mock Cloud Storage Adapter — Fakes S3/GCS.
 *
 * Simulates cloud storage operations without real upload.
 * Returns fake presigned URLs for testing.
 */
export class MockCloudStorageAdapter {
  private uploadedObjects = new Map<string, Buffer>();

  async uploadObject(options: {
    bucket: string;
    key: string;
    body: Buffer;
  }): Promise<{ success: boolean; url?: string }> {
    if (!options.bucket || !options.key || !options.body) {
      return { success: false };
    }
    this.uploadedObjects.set(`${options.bucket}/${options.key}`, options.body);
    return {
      success: true,
      url: `https://storage.googleapis.com/${options.bucket}/${options.key}`,
    };
  }

  async generatePresignedUrl(options: {
    bucket: string;
    key: string;
  }): Promise<{ success: boolean; url?: string }> {
    return {
      success: true,
      url: `https://storage.googleapis.com/${options.bucket}/${options.key}?token=fake-token`,
    };
  }

  getUploadedObjects(): Map<string, Buffer> {
    return new Map(this.uploadedObjects);
  }

  reset(): void {
    this.uploadedObjects.clear();
  }
}

/**
 * Mock SSE Stream Adapter — Collects events for assertion.
 *
 * Type-safe event collector that maintains event ordering.
 * Allows tests to verify stream progression and event completeness.
 */
export class MockSSEStreamAdapter {
  private events: SSEEvent[] = [];
  private isStreaming = false;

  async *streamEvents(): AsyncGenerator<SSEEvent, void, unknown> {
    this.isStreaming = true;
    for (const event of this.events) {
      yield event;
      // Simulate network latency
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    this.isStreaming = false;
  }

  emitEvent(event: Omit<SSEEvent, "timestamp">): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });
  }

  getEvents(): SSEEvent[] {
    return [...this.events];
  }

  getEventTypes(): string[] {
    return this.events.map((e) => e.type);
  }

  hasConsecutiveDuplicates(): boolean {
    for (let i = 1; i < this.events.length; i++) {
      if (
        this.events[i].type === this.events[i - 1].type &&
        this.events[i].step === this.events[i - 1].step
      ) {
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.events = [];
    this.isStreaming = false;
  }
}

/**
 * Mock Transaction Manager Adapter — Tracks commit/rollback calls.
 *
 * Simulates distributed transaction coordination.
 * Allows tests to verify transaction state and recovery behavior.
 */
export class MockTransactionManagerAdapter {
  private commits: Array<{ id: string; timestamp: number }> = [];
  private rollbacks: Array<{ id: string; reason: string; timestamp: number }> =
    [];
  private activeTransactions = new Map<string, { status: string }>();

  async beginTransaction(transactionId: string): Promise<{ success: boolean }> {
    this.activeTransactions.set(transactionId, { status: "active" });
    return { success: true };
  }

  async commit(transactionId: string): Promise<{ success: boolean }> {
    if (!this.activeTransactions.has(transactionId)) {
      return { success: false };
    }
    this.commits.push({
      id: transactionId,
      timestamp: Date.now(),
    });
    this.activeTransactions.delete(transactionId);
    return { success: true };
  }

  async rollback(
    transactionId: string,
    reason: string,
  ): Promise<{ success: boolean }> {
    if (!this.activeTransactions.has(transactionId)) {
      return { success: false };
    }
    this.rollbacks.push({
      id: transactionId,
      reason,
      timestamp: Date.now(),
    });
    this.activeTransactions.delete(transactionId);
    return { success: true };
  }

  getCommits(): Array<{ id: string; timestamp: number }> {
    return [...this.commits];
  }

  getRollbacks(): Array<{ id: string; reason: string; timestamp: number }> {
    return [...this.rollbacks];
  }

  getActiveTransactions(): Array<string> {
    return Array.from(this.activeTransactions.keys());
  }

  reset(): void {
    this.commits = [];
    this.rollbacks = [];
    this.activeTransactions.clear();
  }
}

/**
 * Helper: Create fixture manifest for export tests.
 *
 * Returns a valid manifest suitable for export scenarios.
 *
 * @returns Record<string, unknown> - The fixture manifest
 */
export function createExportFixtureManifest(): Record<string, unknown> {
  return {
    system: "test-hexagen-export",
    scope: "hexagen",
    architecture: "modular-monolith",
    bounded_contexts: [
      {
        name: "core-domain",
        type: "core",
        description: "Semantic kernel",
        layers: {
          domain: {
            entities: ["DomainNode"],
            value_objects: ["NodeKind"],
          },
        },
      },
      {
        name: "shared",
        type: "shared-kernel",
        description: "Shared primitives",
        layers: {
          domain: {
            value_objects: ["CustomError"],
          },
        },
      },
      {
        name: "external-integration",
        type: "core",
        description: "External system integration",
        layers: {
          domain: {
            entities: ["AuthSession"],
          },
          application: {
            use_cases: ["InitiateAuthUseCase", "ExportManifestUseCase"],
            ports: {
              in: ["InitiateAuthPort", "ExportManifestPort"],
              out: ["OAuthProviderPort", "GitHubProviderPort"],
            },
          },
        },
      },
      {
        name: "project-configuration",
        type: "core",
        description: "Manifest parsing",
        layers: {
          domain: {
            entities: ["ProjectSpec"],
          },
        },
      },
    ],
    generator: {
      version: "0.2.0",
      sync: {
        idempotent: true,
      },
    },
  };
}

/**
 * Helper: Collect SSE events from async generator.
 *
 * Utility for test assertions on event streams.
 *
 * @param stream AsyncGenerator of SSE events
 * @returns Promise<SSEEvent[]> - Collected events in order
 */
export async function collectSSEEvents(
  stream: AsyncGenerator<SSEEvent, void, unknown>,
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
