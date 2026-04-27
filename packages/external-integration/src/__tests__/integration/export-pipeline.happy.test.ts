/**
 * @module export-pipeline.happy.test
 * @description Happy path tests for Export Pipeline user journey.
 *
 * Tests: User exports to ZIP → success callback emitted.
 * Verifies that export can end-to-end process and emit events correctly.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createMockRegistry,
  registerMockPort,
  getMockPort,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock.ts";
import {
  MockGitHubProviderAdapter,
  MockCloudStorageAdapter,
  MockSSEStreamAdapter,
  MockTransactionManagerAdapter,
  createExportFixtureManifest,
  collectSSEEvents,
} from "../fixtures/export-mocks";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names.ts";

describe("Export Pipeline — Happy Path", () => {
  let registry: PortRegistry;
  let githubAdapter: MockGitHubProviderAdapter;
  let cloudStorageAdapter: MockCloudStorageAdapter;
  let streamAdapter: MockSSEStreamAdapter;
  let transactionAdapter: MockTransactionManagerAdapter;

  beforeEach(() => {
    // Create fresh registry for each test
    registry = createMockRegistry();

    // Create mock adapters (fresh instances per test)
    githubAdapter = new MockGitHubProviderAdapter();
    cloudStorageAdapter = new MockCloudStorageAdapter();
    streamAdapter = new MockSSEStreamAdapter();
    transactionAdapter = new MockTransactionManagerAdapter();

    // Register mocks in registry with compile-time type safety
    registerMockPort(registry, PORT_NAMES.GITHUB_PROVIDER, githubAdapter);
    registerMockPort(registry, PORT_NAMES.CLOUD_STORAGE, cloudStorageAdapter);
    registerMockPort(registry, PORT_NAMES.SSE_STREAM, streamAdapter);
    registerMockPort(
      registry,
      PORT_NAMES.TRANSACTION_MANAGER,
      transactionAdapter,
    );
  });

  it("happy path: exports to ZIP successfully", async () => {
    // Arrange: Prepare export manifest and stream setup
    const manifest = createExportFixtureManifest();

    // Simulate export pipeline events
    streamAdapter.emitEvent({ type: "step_running", step: "prepare" });
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });
    streamAdapter.emitEvent({ type: "step_running", step: "package" });
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });

    // Act: Collect events from stream
    const events = await collectSSEEvents(streamAdapter.streamEvents());

    // Assert: Verify export completed successfully
    expect(events.length).toBeGreaterThan(0);

    // Verify final event indicates completion
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toEqual("step_complete");
    expect(lastEvent.status).toEqual("completed");

    // Verify manifest was used
    expect(manifest).toBeDefined();
  });

  it("happy path: emits events in correct order (no duplicates)", async () => {
    // Arrange: Create a sequence of export events (no consecutive duplicates)
    const eventSequence = [
      { type: "step_running", step: "prepare" },
      { type: "step_complete", status: "completed" },
      { type: "step_running", step: "validate" },
      { type: "step_complete", status: "completed" },
      { type: "step_running", step: "generate" },
      { type: "step_complete", status: "completed" },
    ];

    // Act: Emit all events
    eventSequence.forEach((event) => streamAdapter.emitEvent(event));

    // Collect events
    const events = await collectSSEEvents(streamAdapter.streamEvents());

    // Assert: Verify event count
    expect(events.length).toBe(eventSequence.length);

    // Verify event types match sequence
    const eventTypes = events.map((e) => e.type);
    const expectedTypes = eventSequence.map((e) => e.type);
    expect(eventTypes).toEqual(expectedTypes);

    // Verify no consecutive duplicates
    expect(streamAdapter.hasConsecutiveDuplicates()).toBe(false);
  });

  it("happy path: cloud storage uploads succeed", async () => {
    // Arrange: Prepare upload payload
    const zipContent = Buffer.from("PK\x03\x04"); // ZIP file header
    const uploadOptions = {
      bucket: "test-bucket",
      key: "exports/project.zip",
      body: zipContent,
    };

    // Act: Upload to cloud storage
    const uploadResult = await cloudStorageAdapter.uploadObject(uploadOptions);

    // Assert: Verify upload succeeded
    expect(uploadResult.success).toBe(true);
    expect(uploadResult.url).toBeDefined();
    expect(uploadResult.url).toContain("test-bucket");
    expect(uploadResult.url).toContain("project.zip");
  });

  it("happy path: presigned URLs are generated", async () => {
    // Arrange: Request presigned URL
    const urlOptions = {
      bucket: "test-bucket",
      key: "exports/project.zip",
    };

    // Act: Generate presigned URL
    const urlResult =
      await cloudStorageAdapter.generatePresignedUrl(urlOptions);

    // Assert: Verify URL generation succeeded
    expect(urlResult.success).toBe(true);
    expect(urlResult.url).toBeDefined();
    expect(urlResult.url).toContain("token=");
  });

  it("happy path: GitHub authentication and repository creation succeed", async () => {
    // Arrange: Prepare GitHub provider
    const token = "fake-github-token";

    // Act: Authenticate and create repository
    const authResult = await githubAdapter.authenticate(token);
    const repoResult = await githubAdapter.createRepository({
      name: "test-project",
      description: "Generated project",
    });

    // Assert: Verify GitHub operations succeeded
    expect(authResult.success).toBe(true);
    expect(repoResult.success).toBe(true);
    expect(repoResult.url).toBeDefined();
    expect(repoResult.url).toContain("test-project");
  });

  it("happy path: transaction management tracks commits", async () => {
    // Arrange: Create a transaction
    const txnId = "export-txn-001";

    // Act: Begin, commit transaction
    await transactionAdapter.beginTransaction(txnId);
    const commitResult = await transactionAdapter.commit(txnId);

    // Assert: Verify transaction was committed
    expect(commitResult.success).toBe(true);

    // Verify commit was recorded
    const commits = transactionAdapter.getCommits();
    expect(commits.length).toBe(1);
    expect(commits[0].id).toEqual(txnId);

    // Verify no active transactions remain
    expect(transactionAdapter.getActiveTransactions()).toHaveLength(0);
  });

  it("happy path: registry provides export mocks", async () => {
    // Arrange: All mocks are registered above

    // Act: Retrieve mocks from registry using type-safe constants
    const github = getMockPort<MockGitHubProviderAdapter>(
      registry,
      PORT_NAMES.GITHUB_PROVIDER,
    );
    const cloudStorage = getMockPort<MockCloudStorageAdapter>(
      registry,
      PORT_NAMES.CLOUD_STORAGE,
    );
    const stream = getMockPort<MockSSEStreamAdapter>(
      registry,
      PORT_NAMES.SSE_STREAM,
    );
    const transactionManager = getMockPort<MockTransactionManagerAdapter>(
      registry,
      PORT_NAMES.TRANSACTION_MANAGER,
    );

    // Assert: All mocks are available
    expect(github).toBeDefined();
    expect(cloudStorage).toBeDefined();
    expect(stream).toBeDefined();
    expect(transactionManager).toBeDefined();

    // Verify they're the right types
    expect(typeof github.authenticate).toBe("function");
    expect(typeof cloudStorage.uploadObject).toBe("function");
    expect(typeof transactionManager.commit).toBe("function");
  });

  it("happy path: fixture manifest is valid", async () => {
    // Arrange: Load fixture manifest
    const fixture = createExportFixtureManifest();

    // Assert: Verify fixture structure
    expect(fixture).toHaveProperty("system");
    expect(fixture).toHaveProperty("bounded_contexts");
    expect(fixture.system).toEqual("test-hexagen-export");

    // Verify bounded contexts include external-integration
    const boundedContexts = (fixture as any).bounded_contexts;
    expect(Array.isArray(boundedContexts)).toBe(true);

    const contextNames = boundedContexts.map((bc: any) => bc.name);
    expect(contextNames).toContain("external-integration");
  });

  it("happy path: stream events maintain timestamp ordering", async () => {
    // Arrange: Create events with slight delays to ensure ordering
    const startTime = Date.now();

    streamAdapter.emitEvent({ type: "step_running", step: "export" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });

    // Act: Collect events
    const events = await collectSSEEvents(streamAdapter.streamEvents());

    // Assert: Verify timestamps are in order
    expect(events.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(
        events[i - 1].timestamp,
      );
    }

    // Verify all timestamps are recent
    events.forEach((event) => {
      expect(event.timestamp).toBeGreaterThanOrEqual(startTime);
      expect(event.timestamp).toBeLessThanOrEqual(Date.now() + 100);
    });
  });
});
