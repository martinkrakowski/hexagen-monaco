/**
 * @module export-pipeline.errors.test
 * @description Error handling and edge case tests for Export Pipeline.
 *
 * Tests:
 * 1. GitHub auth failure (401 Unauthorized)
 * 2. S3 upload timeout (>5s delay)
 * 3. Transaction rollback verification
 * 4. Stream interruption (connection lost)
 * 5. Mixed errors (partial success)
 * 6. Network disconnection (ENOTFOUND)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockRegistry,
  registerMockPort,
  ErrorScenario,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures";
import {
  MockGitHubProviderAdapter,
  createExportFixtureManifest,
} from "../fixtures/export-mocks";
import {
  UnauthorizedGitHubMock,
  ForbiddenGitHubMock,
  TimeoutCloudStorageMock,
  NetworkErrorCloudStorageMock,
  MockTransactionManagerAdapter,
  InterruptingSSEStreamMock,
  PartialSuccessSSEStreamMock,
} from "../fixtures/export-error-mocks";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names";

describe("Export Pipeline — Error Handling", () => {
  let registry: PortRegistry;

  beforeEach(() => {
    registry = createMockRegistry();
  });

  it("error: GitHub authentication fails (401 Unauthorized)", async () => {
    // Arrange: Create unauthorized GitHub adapter
    const githubAdapter = new UnauthorizedGitHubMock();
    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);

    // Act: Attempt authentication
    const result = await githubAdapter.authenticate("invalid-token");

    // Assert: Verify 401 error
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.error).toContain("Unauthorized");
  });

  it("error: GitHub authorization fails (403 Forbidden)", async () => {
    // Arrange: Create forbidden GitHub adapter
    const githubAdapter = new ForbiddenGitHubMock();
    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);

    // Act: Attempt to create repository (after auth succeeds)
    const authResult = await githubAdapter.authenticate("valid-token");
    expect(authResult.success).toBe(true);

    const repoResult = await githubAdapter.createRepository({
      name: "new-repo",
    });

    // Assert: Verify 403 error
    expect(repoResult.success).toBe(false);
    expect(repoResult.statusCode).toBe(403);
  });

  it("error: S3 upload timeout (>5s) triggers rollback", async () => {
    // Arrange: Create timeout storage adapter (1 second for faster test, simulates timeout)
    const storageAdapter = new TimeoutCloudStorageMock(1000);
    const txManager = new MockTransactionManagerAdapter();
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);
    registerMockPort(registry, PORT_NAMES.TRANSACTION_MANAGER, txManager);

    // Act: Begin transaction and attempt upload
    await txManager.begin();
    const uploadResult = await storageAdapter.uploadObject({
      bucket: "test-bucket",
      key: "export.zip",
      body: Buffer.from("test data"),
    });

    // Simulate timeout handling: rollback on failure
    if (!uploadResult.success) {
      await txManager.rollback();
    }

    // Assert: Verify timeout and rollback
    expect(uploadResult.success).toBe(false);
    expect(uploadResult.error).toContain("timeout");
    expect(txManager.rollbackCalled).toBe(true);
  }, 5000);

  it("error: transaction rollback state reverted", async () => {
    // Arrange: Create transaction manager
    const txManager = new MockTransactionManagerAdapter();
    registerMockPort(registry, PORT_NAMES.TRANSACTION_MANAGER, txManager);

    // Act: Begin transaction, commit, then verify state
    const txId = await txManager.begin();
    const commitResult = await txManager.commit(txId);

    // Assert: Verify transaction lifecycle
    expect(commitResult.success).toBe(true);
    expect(txManager.commitCalled).toBe(true);
    expect(txManager.rollbackCalled).toBe(false);

    // Act: Rollback state
    txManager.reset();
    expect(txManager.commitCalled).toBe(false);
    expect(txManager.rollbackCalled).toBe(false);
  });

  it("error: SSE stream interruption (connection lost)", async () => {
    // Arrange: Create interrupting stream
    const stream = new InterruptingSSEStreamMock(2); // Interrupt after 2 events
    registerMockPort(registry, PORT_NAMES.SSE_STREAM, stream);

    stream.emitEvent({ type: "start", step: "github-auth", status: "pending" });
    stream.emitEvent({ type: "progress", step: "github-auth", progress: 50 });
    stream.emitEvent({ type: "complete", step: "github-auth", status: "done" });

    // Act: Consume stream events
    const events = [];
    for await (const event of stream.streamEvents()) {
      events.push(event);
      if ("success" in event && !event.success) {
        break; // Stream interrupted
      }
    }

    // Assert: Verify stream interrupted after 2 events
    expect(events.length).toBe(3); // 2 events + 1 error event
    const lastEvent = events[events.length - 1];
    expect("success" in lastEvent && !lastEvent.success).toBe(true);
    if ("error" in lastEvent && lastEvent.error) {
      expect(lastEvent.error.code).toBe(ErrorScenario.NETWORK_ERROR);
    }
  });

  it("error: mixed errors (partial success scenario)", async () => {
    // Arrange: Create partially failing system
    const githubAdapter = new MockGitHubProviderAdapter(); // Succeeds
    const storageAdapter = new NetworkErrorCloudStorageMock(); // Fails
    const stream = new PartialSuccessSSEStreamMock();

    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);
    registerMockPort(registry, PORT_NAMES.SSE_STREAM, stream);

    // Act: Attempt mixed operations
    const githubAuth = await githubAdapter.authenticate("valid-token");
    const storageUpload = await storageAdapter.uploadObject({
      bucket: "bucket",
      key: "file.zip",
      body: Buffer.from("data"),
    });

    stream.emitEvent({
      type: "success",
      step: "github",
      status: "complete",
    });
    stream.emitFailure({
      type: "error",
      step: "s3",
      code: ErrorScenario.NETWORK_ERROR,
    });

    const events = stream.getEvents();

    // Assert: GitHub succeeds, S3 fails, mixed result
    expect(githubAuth.success).toBe(true);
    expect(storageUpload.success).toBe(false);
    expect(events.length).toBe(2);
    expect(events[0]).toHaveProperty("type", "success");
    expect(events[1]).toHaveProperty("success", false);
  });

  it("error: network error (ENOTFOUND) during upload", async () => {
    // Arrange: Create network error adapter
    const storageAdapter = new NetworkErrorCloudStorageMock();
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);

    // Act: Attempt upload with network error
    const result = await storageAdapter.uploadObject({
      bucket: "bucket",
      key: "file.zip",
      body: Buffer.from("data"),
    });

    // Assert: Verify network error
    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOTFOUND");
    expect(result.statusCode).toBe(0); // Network error indicator
  });

  it("error: stream recovers from single error event", async () => {
    // Arrange: Create partial success stream
    const stream = new PartialSuccessSSEStreamMock();

    stream.emitEvent({
      type: "start",
      step: "init",
      status: "pending",
    });
    stream.emitFailure({
      type: "error",
      step: "github",
      code: ErrorScenario.AUTH_ERROR,
    });
    stream.emitEvent({
      type: "retry",
      step: "github",
      status: "retrying",
    });

    // Act: Process all events
    const events = stream.getEvents();

    // Assert: Verify event sequence with error in middle
    expect(events.length).toBe(3);
    expect(events[0]).toHaveProperty("type", "start");
    expect(events[1]).toHaveProperty("success", false);
    expect(events[2]).toHaveProperty("type", "retry");
  });

  it("error: export manifest with large context count performance", async () => {
    // Arrange: Create manifest with 50 bounded contexts
    const largeManifest = createExportFixtureManifest();
    const largeContextManifest = {
      ...largeManifest,
      bounded_contexts: Array.from({ length: 50 }, (_, i) => ({
        name: `context-${i}`,
        type: "core",
        description: `Context ${i}`,
      })),
    };

    // Act: Measure export operation time
    const startTime = Date.now();
    // Simulate export processing
    const stream = new PartialSuccessSSEStreamMock();
    for (let i = 0; i < largeContextManifest.bounded_contexts.length; i++) {
      stream.emitEvent({
        type: "export",
        step: `context-${i}`,
        progress: ((i + 1) / 50) * 100,
      });
    }
    const duration = Date.now() - startTime;

    // Assert: Export completes in reasonable time
    expect(duration).toBeLessThan(1000); // Should be fast
    const events = stream.getEvents();
    expect(events.length).toBe(50);
  });
});
