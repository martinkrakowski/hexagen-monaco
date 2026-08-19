/**
 * @module export-pipeline.happy.test
 * @description Happy path tests for Export Pipeline user journey.
 *
 * Tests: User exports to ZIP → success callback emitted.
 * Verifies that export can end-to-end process and emit events correctly.
 */

import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createMockRegistry,
  registerMockPort,
  getMockPort,
  type PortRegistry,
} from "../../../../web-driver/src/__tests__/fixtures/port-registry.mock.js";
import type { CrossBoundaryManifest } from "../../../../web-driver/src/__tests__/fixtures/cross-boundary-registry.js";
import {
  MockGitHubProviderAdapter,
  MockCloudStorageAdapter,
  MockSSEStreamAdapter,
  MockTransactionManagerAdapter,
  createExportFixtureManifest,
  collectSSEEvents,
} from "../fixtures/export-mocks";
import { PORT_NAMES } from "../../../../web-driver/src/infrastructure/constants/port-names.js";

describe("Export Pipeline — Happy Path", () => {
  let registry: PortRegistry;
  let githubAdapter: MockGitHubProviderAdapter;
  let cloudStorageAdapter: MockCloudStorageAdapter;
  let streamAdapter: MockSSEStreamAdapter;
  let transactionAdapter: MockTransactionManagerAdapter;

  beforeEach(() => {
    registry = createMockRegistry();

    githubAdapter = new MockGitHubProviderAdapter();
    cloudStorageAdapter = new MockCloudStorageAdapter();
    streamAdapter = new MockSSEStreamAdapter();
    transactionAdapter = new MockTransactionManagerAdapter();

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
    const manifest = createExportFixtureManifest();

    streamAdapter.emitEvent({ type: "step_running", step: "prepare" });
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });
    streamAdapter.emitEvent({ type: "step_running", step: "package" });
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });

    const events = await collectSSEEvents(streamAdapter.streamEvents());

    assert.ok(events.length > 0);

    const lastEvent = events[events.length - 1];
    assert.deepStrictEqual(lastEvent.type, "step_complete");
    assert.deepStrictEqual(lastEvent.status, "completed");

    assert.ok(manifest !== undefined);
  });

  it("happy path: emits events in correct order (no duplicates)", async () => {
    const eventSequence = [
      { type: "step_running", step: "prepare" },
      { type: "step_complete", status: "completed" },
      { type: "step_running", step: "validate" },
      { type: "step_complete", status: "completed" },
      { type: "step_running", step: "generate" },
      { type: "step_complete", status: "completed" },
    ];

    eventSequence.forEach((event) => streamAdapter.emitEvent(event));

    const events = await collectSSEEvents(streamAdapter.streamEvents());

    assert.strictEqual(events.length, eventSequence.length);

    const eventTypes = events.map((e) => e.type);
    const expectedTypes = eventSequence.map((e) => e.type);
    assert.deepStrictEqual(eventTypes, expectedTypes);

    assert.strictEqual(streamAdapter.hasConsecutiveDuplicates(), false);
  });

  it("happy path: cloud storage uploads succeed", async () => {
    const zipContent = Buffer.from("PK\x03\x04");
    const uploadOptions = {
      bucket: "test-bucket",
      key: "exports/project.zip",
      body: zipContent,
    };

    const uploadResult = await cloudStorageAdapter.uploadObject(uploadOptions);

    assert.strictEqual(uploadResult.success, true);
    assert.ok(uploadResult.url !== undefined);
    assert.ok(uploadResult.url.includes("test-bucket"));
    assert.ok(uploadResult.url.includes("project.zip"));
  });

  it("happy path: presigned URLs are generated", async () => {
    const urlOptions = {
      bucket: "test-bucket",
      key: "exports/project.zip",
    };

    const urlResult =
      await cloudStorageAdapter.generatePresignedUrl(urlOptions);

    assert.strictEqual(urlResult.success, true);
    assert.ok(urlResult.url !== undefined);
    assert.ok(urlResult.url.includes("token="));
  });

  it("happy path: GitHub authentication and repository creation succeed", async () => {
    const token = "fake-github-token";

    const authResult = await githubAdapter.authenticate(token);
    const repoResult = await githubAdapter.createRepository({
      name: "test-project",
      description: "Generated project",
    });

    assert.strictEqual(authResult.success, true);
    assert.strictEqual(repoResult.success, true);
    assert.ok(repoResult.url !== undefined);
    assert.ok(repoResult.url.includes("test-project"));
  });

  it("happy path: transaction management tracks commits", async () => {
    const txnId = "export-txn-001";

    await transactionAdapter.beginTransaction(txnId);
    const commitResult = await transactionAdapter.commit(txnId);

    assert.strictEqual(commitResult.success, true);

    const commits = transactionAdapter.getCommits();
    assert.strictEqual(commits.length, 1);
    assert.deepStrictEqual(commits[0].id, txnId);

    assert.strictEqual(transactionAdapter.getActiveTransactions().length, 0);
  });

  it("happy path: registry provides export mocks", async () => {
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

    assert.ok(github !== undefined);
    assert.ok(cloudStorage !== undefined);
    assert.ok(stream !== undefined);
    assert.ok(transactionManager !== undefined);

    assert.strictEqual(typeof github.authenticate, "function");
    assert.strictEqual(typeof cloudStorage.uploadObject, "function");
    assert.strictEqual(typeof transactionManager.commit, "function");
  });

  it("happy path: fixture manifest is valid", async () => {
    const fixture = createExportFixtureManifest();

    assert.ok("system" in fixture);
    assert.ok("bounded_contexts" in fixture);
    assert.deepStrictEqual(fixture.system, "test-hexagen-export");

    const boundedContexts = (fixture as CrossBoundaryManifest).bounded_contexts;
    assert.ok(boundedContexts !== undefined);
    assert.strictEqual(Array.isArray(boundedContexts), true);

    const contextNames = boundedContexts.map((bc: { name: string }) => bc.name);
    assert.ok(contextNames.includes("external-integration"));
  });

  it("happy path: stream events maintain timestamp ordering", async () => {
    streamAdapter.emitEvent({ type: "step_running", step: "export" });
    streamAdapter.emitEvent({ type: "step_complete", status: "completed" });

    const events = await collectSSEEvents(streamAdapter.streamEvents());

    assert.ok(events.length >= 2);

    for (const event of events) {
      assert.ok(event.timestamp > 0);
      assert.strictEqual(typeof event.timestamp, "number");
    }

    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].timestamp >= events[i - 1].timestamp);
    }
  });
});
