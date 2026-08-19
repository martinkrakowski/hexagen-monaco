/**
 * @module export-error-mocks
 * @description Error-injecting test doubles for Export Pipeline.
 *
 * Extends export-mocks with failure scenarios:
 * - GitHub auth failures (401, 403)
 * - S3 timeouts
 * - Stream interruptions
 * - Transaction rollback scenarios
 */

import {
  ErrorScenario,
  type ErrorResult,
} from "../../../../web-driver/src/__tests__/fixtures/error-adapters";
import type { SSEEvent } from "./export-mocks";

/**
 * Unauthorized GitHub mock adapter.
 * Simulates 401 authentication failure.
 *
 * @example
 *   const adapter = new UnauthorizedGitHubMock();
 *   const result = await adapter.authenticate(token);
 *   // result.success === false, statusCode === 401
 */
export class UnauthorizedGitHubMock {
  async authenticate(
    token: string,
  ): Promise<
    | { success: true; statusCode?: number }
    | { success: false; statusCode: number; error: string }
  > {
    return {
      success: false,
      statusCode: 401,
      error:
        token.length === 0
          ? "Unauthorized: empty token"
          : "Unauthorized: Invalid token",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRepository(__options: {
    name: string;
    description?: string;
  }): Promise<{ success: boolean; statusCode?: number }> {
    return {
      success: false,
      statusCode: 401,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async pushFiles(__options: {
    repositoryUrl: string;
    files: Array<{ path: string; content: string }>;
    commitMessage: string;
  }): Promise<{ success: boolean; statusCode?: number }> {
    return {
      success: false,
      statusCode: 401,
    };
  }
}

/**
 * Forbidden GitHub mock adapter.
 * Simulates 403 permission denied error.
 *
 * @example
 *   const adapter = new ForbiddenGitHubMock();
 *   const result = await adapter.createRepository({ name: "test" });
 *   // result.success === false, statusCode === 403
 */
export class ForbiddenGitHubMock {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async authenticate(__token: string): Promise<{
    success: boolean;
    statusCode?: number;
  }> {
    return { success: true, statusCode: 200 };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createRepository(__options: {
    name: string;
    description?: string;
  }): Promise<{ success: boolean; statusCode?: number }> {
    return {
      success: false,
      statusCode: 403,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async pushFiles(__options: {
    repositoryUrl: string;
    files: Array<{ path: string; content: string }>;
    commitMessage: string;
  }): Promise<{ success: boolean; statusCode?: number }> {
    return {
      success: false,
      statusCode: 403,
    };
  }
}

/**
 * Timeout cloud storage mock adapter.
 * Delays response beyond configured timeout threshold.
 *
 * @example
 *   const adapter = new TimeoutCloudStorageMock(6000);
 *   const result = await adapter.uploadObject(...); // Delays 6000ms
 */
export class TimeoutCloudStorageMock {
  constructor(private delayMs: number = 6000) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadObject(__options: {
    bucket: string;
    key: string;
    body: Buffer;
  }): Promise<{ success: true } | { success: false; error: string }> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      success: false,
      error: `Upload timeout after ${this.delayMs}ms`,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generatePresignedUrl(__options: {
    bucket: string;
    key: string;
  }): Promise<{ success: boolean; url?: string }> {
    return {
      success: true,
      url: "https://fake-url.com/file?token=test",
    };
  }
}

/**
 * Network error cloud storage mock.
 * Simulates ENOTFOUND (DNS resolution failure).
 *
 * @example
 *   const adapter = new NetworkErrorCloudStorageMock();
 *   const result = await adapter.uploadObject(...);
 *   // result.success === false, error.code === 'ENOTFOUND'
 */
export class NetworkErrorCloudStorageMock {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async uploadObject(__options: {
    bucket: string;
    key: string;
    body: Buffer;
  }): Promise<
    | { success: true; statusCode?: number }
    | { success: false; statusCode: number; error: string }
  > {
    return {
      success: false,
      statusCode: 0, // Network error
      error: "ENOTFOUND: Failed to resolve DNS",
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generatePresignedUrl(__options: {
    bucket: string;
    key: string;
  }): Promise<{ success: boolean; url?: string }> {
    return {
      success: true,
      url: "https://fake-url.com/file?token=test",
    };
  }
}

/**
 * Transaction manager that tracks rollback calls.
 * Used to verify transaction safety in error scenarios.
 *
 * @example
 *   const txManager = new MockTransactionManagerAdapter();
 *   await txManager.rollback();
 *   expect(txManager.rollbackCalled).toBe(true);
 */
export class MockTransactionManagerAdapter {
  rollbackCalled = false;
  commitCalled = false;
  private txId: string | null = null;

  async begin(): Promise<string> {
    this.txId = `tx-${Date.now()}`;
    return this.txId;
  }

  async commit(txId: string): Promise<{ success: boolean }> {
    if (txId === this.txId) {
      this.commitCalled = true;
      return { success: true };
    }
    return { success: false };
  }

  async rollback(): Promise<{ success: boolean }> {
    this.rollbackCalled = true;
    return { success: true };
  }

  reset(): void {
    this.rollbackCalled = false;
    this.commitCalled = false;
    this.txId = null;
  }
}

/**
 * Interrupting SSE stream mock.
 * Emits events then closes stream with error.
 *
 * @example
 *   const stream = new InterruptingSSEStreamMock();
 *   stream.emitEvent({ type: "start", step: "github-auth" });
 *   for await (const event of stream.streamEvents()) {
 *     // Processes events until interruption
 *   }
 */
export class InterruptingSSEStreamMock {
  private events: SSEEvent[] = [];
  private interruptAfterCount: number;

  constructor(interruptAfterCount: number = 2) {
    this.interruptAfterCount = interruptAfterCount;
  }

  async *streamEvents(): AsyncGenerator<SSEEvent | ErrorResult, void, unknown> {
    let count = 0;
    for (const event of this.events) {
      if (count >= this.interruptAfterCount) {
        yield {
          success: false,
          error: {
            code: ErrorScenario.NETWORK_ERROR,
            message: "Stream interrupted: Connection lost",
          },
        };
        break;
      }
      yield event;
      count++;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
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
}

/**
 * Partial success SSE stream mock.
 * Some operations succeed, others fail.
 *
 * @example
 *   const stream = new PartialSuccessSSEStreamMock();
 *   stream.emitEvent({ type: "success", step: "zip" });
 *   stream.emitFailure({ type: "error", step: "github" });
 */
export class PartialSuccessSSEStreamMock {
  private events: (SSEEvent | ErrorResult)[] = [];

  async *streamEvents(): AsyncGenerator<SSEEvent | ErrorResult, void, unknown> {
    for (const event of this.events) {
      yield event;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  emitEvent(event: Omit<SSEEvent, "timestamp">): void {
    this.events.push({
      ...event,
      timestamp: Date.now(),
    });
  }

  emitFailure(error: { type: string; step?: string; code?: string }): void {
    this.events.push({
      success: false,
      error: {
        code: error.code || ErrorScenario.NETWORK_ERROR,
        message: `${error.step || "Unknown"} failed`,
      },
    });
  }

  getEvents(): (SSEEvent | ErrorResult)[] {
    return [...this.events];
  }
}
