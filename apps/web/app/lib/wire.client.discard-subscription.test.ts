/**
 * Guards the *removal* half of plan item 5.3(c).
 *
 * Extracting the purge cascade into the `discardProject` use case is only
 * correct if the inline `ProjectDiscarded` subscriber in the client
 * composition root is gone. Leave it in place and the extraction is additive:
 * every discard would purge chat persistence twice and generation results
 * twice, because `discardProject` publishes the very event the subscriber
 * listens for.
 *
 * The use-case suite cannot see that — it mocks `wire.client` away. So this
 * one drives the REAL composition root: it publishes a `ProjectDiscarded`
 * event on the real event bus and asserts the registered adapters are not
 * touched as a side effect of wiring.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_DISCARDED_EVENT } from "@hexagen/monaco-orchestration";
import {
  getEventBus,
  getChatPersistence,
  getGenerationResultPersistence,
  getMigrationReady,
} from "./wire.client";
import { useGovernanceThreadStore } from "../../features/governance-assistant/stores/useGovernanceThreadStore";

describe("wire.client — ProjectDiscarded is not subscribed at the composition root", () => {
  afterEach(() => {
    useGovernanceThreadStore.getState().clearAllThreads();
  });

  // The start-up steps run once, when wire.client is first imported, and their
  // record lives in localStorage, which other tests and teardowns may clear.
  // Read it once here, before any test in this file runs, so the assertion
  // below does not depend on the order of the tests.
  let completedStepsAtStart: string[] = [];
  beforeAll(async () => {
    await getMigrationReady();
    const raw = localStorage.getItem("hexagen:migration:status");
    completedStepsAtStart = raw
      ? (JSON.parse(raw) as { completedSteps: string[] }).completedSteps
      : [];
  });

  it("registers a remove-unused-secret-keys migration step at the composition root", () => {
    // If the step were dropped from wire.client.ts, the clean-up of the two
    // removed secret stores' keys would silently stop; nothing else observes
    // the step list.
    expect(completedStepsAtStart).toContain("remove-unused-secret-keys");
  });

  it("publishing ProjectDiscarded purges nothing and clears no thread", () => {
    const chatPersistence = getChatPersistence() as unknown as Record<
      string,
      unknown
    >;
    const generationResults =
      getGenerationResultPersistence() as unknown as Record<string, unknown>;

    const originalChatPurge = chatPersistence.purgeProjectData;
    const originalGenerationPurge = generationResults.purgeProjectResults;

    const calls: string[] = [];
    chatPersistence.purgeProjectData = async () => {
      calls.push("chat");
    };
    generationResults.purgeProjectResults = async () => {
      calls.push("generation");
    };

    useGovernanceThreadStore.getState().setThread("violations-step-1", []);

    try {
      getEventBus().publish({
        type: PROJECT_DISCARDED_EVENT,
        payload: {
          projectId: "proj-1",
          timestamp: new Date(),
          reason: "user_initiated" as const,
        },
        timestamp: Date.now(),
        source: "wire.client.discard-subscription.test",
      });

      expect(calls).toEqual([]);
      // The thread store is cleared synchronously by the old subscriber, so a
      // surviving subscription shows up here without any awaiting.
      expect(useGovernanceThreadStore.getState().threads.size).toBe(1);
    } finally {
      chatPersistence.purgeProjectData = originalChatPurge;
      generationResults.purgeProjectResults = originalGenerationPurge;
    }
  });
});
