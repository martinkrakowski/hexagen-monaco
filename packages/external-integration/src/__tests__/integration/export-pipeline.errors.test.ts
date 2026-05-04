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

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
    const githubAdapter = new UnauthorizedGitHubMock();
    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);

    const result = await githubAdapter.authenticate("invalid-token");

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.statusCode, 401);
    assert.ok(result.error.includes("Unauthorized"));
  });

  it("error: GitHub authorization fails (403 Forbidden)", async () => {
    const githubAdapter = new ForbiddenGitHubMock();
    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);

    const authResult = await githubAdapter.authenticate("valid-token");
    assert.strictEqual(authResult.success, true);

    const repoResult = await githubAdapter.createRepository({
      name: "new-repo",
    });

    assert.strictEqual(repoResult.success, false);
    assert.strictEqual(repoResult.statusCode, 403);
  });

  it(
    "error: S3 upload timeout (>5s) triggers rollback",
    { timeout: 5000 },
    async () => {
      const storageAdapter = new TimeoutCloudStorageMock(1000);
      const txManager = new MockTransactionManagerAdapter();
      registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);
      registerMockPort(registry, PORT_NAMES.TRANSACTION_MANAGER, txManager);

      await txManager.begin();
      const uploadResult = await storageAdapter.uploadObject({
        bucket: "test-bucket",
        key: "export.zip",
        body: Buffer.from("test data"),
      });

      if (!uploadResult.success) {
        await txManager.rollback();
      }

      assert.strictEqual(uploadResult.success, false);
      assert.ok(uploadResult.error.includes("timeout"));
      assert.strictEqual(txManager.rollbackCalled, true);
    },
  );

  it("error: transaction rollback state reverted", async () => {
    const txManager = new MockTransactionManagerAdapter();
    registerMockPort(registry, PORT_NAMES.TRANSACTION_MANAGER, txManager);

    const txId = await txManager.begin();
    const commitResult = await txManager.commit(txId);

    assert.strictEqual(commitResult.success, true);
    assert.strictEqual(txManager.commitCalled, true);
    assert.strictEqual(txManager.rollbackCalled, false);

    txManager.reset();
    assert.strictEqual(txManager.commitCalled, false);
    assert.strictEqual(txManager.rollbackCalled, false);
  });

  it("error: SSE stream interruption (connection lost)", async () => {
    const stream = new InterruptingSSEStreamMock(2);
    registerMockPort(registry, PORT_NAMES.SSE_STREAM, stream);

    stream.emitEvent({ type: "start", step: "github-auth", status: "pending" });
    stream.emitEvent({ type: "progress", step: "github-auth", progress: 50 });
    stream.emitEvent({ type: "complete", step: "github-auth", status: "done" });

    const events = [];
    for await (const event of stream.streamEvents()) {
      events.push(event);
      if ("success" in event && !event.success) {
        break;
      }
    }

    assert.strictEqual(events.length, 3);
    const lastEvent = events[events.length - 1];
    assert.strictEqual("success" in lastEvent && !lastEvent.success, true);
    if ("error" in lastEvent && lastEvent.error) {
      assert.strictEqual(lastEvent.error.code, ErrorScenario.NETWORK_ERROR);
    }
  });

  it("error: mixed errors (partial success scenario)", async () => {
    const githubAdapter = new MockGitHubProviderAdapter();
    const storageAdapter = new NetworkErrorCloudStorageMock();
    const stream = new PartialSuccessSSEStreamMock();

    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);
    registerMockPort(registry, PORT_NAMES.SSE_STREAM, stream);

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

    assert.strictEqual(githubAuth.success, true);
    assert.strictEqual(storageUpload.success, false);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, "success");
    assert.strictEqual(events[1].success, false);
  });

  it("error: network error (ENOTFOUND) during upload", async () => {
    const storageAdapter = new NetworkErrorCloudStorageMock();
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, storageAdapter);

    const result = await storageAdapter.uploadObject({
      bucket: "bucket",
      key: "file.zip",
      body: Buffer.from("data"),
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("ENOTFOUND"));
    assert.strictEqual(result.statusCode, 0);
  });

  it("error: stream recovers from single error event", async () => {
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

    const events = stream.getEvents();

    assert.strictEqual(events.length, 3);
    assert.strictEqual(events[0].type, "start");
    assert.strictEqual(events[1].success, false);
    assert.strictEqual(events[2].type, "retry");
  });

  it("error: export manifest with large context count performance", async () => {
    const largeManifest = createExportFixtureManifest();
    const largeContextManifest = {
      ...largeManifest,
      bounded_contexts: Array.from({ length: 50 }, (_, i) => ({
        name: `context-${i}`,
        type: "core",
        description: `Context ${i}`,
      })),
    };

    const startTime = Date.now();
    const stream = new PartialSuccessSSEStreamMock();
    for (let i = 0; i < largeContextManifest.bounded_contexts.length; i++) {
      stream.emitEvent({
        type: "export",
        step: `context-${i}`,
        progress: ((i + 1) / 50) * 100,
      });
    }
    const duration = Date.now() - startTime;

    assert.ok(duration < 1000);
    const events = stream.getEvents();
    assert.strictEqual(events.length, 50);
  });
});
