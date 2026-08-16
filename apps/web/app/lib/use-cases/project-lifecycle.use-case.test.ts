/**
 * Behavioural pins for the project-discard purge cascade.
 *
 * ADR-0051 §Consequences records HEX-020's surviving residue: the
 * `ProjectDiscarded` purge cascade was wired inline in the client composition
 * root (`wire.client.ts`) as an event subscriber, and belongs in the existing
 * `discardProject` use case (plan item 5.3(c)).
 *
 * These tests describe the cascade as a property of the USE CASE, so they hold
 * regardless of where the work is wired. Before the extraction, only the chat
 * purge lived here — the generation-results purge and the thread-store clear
 * were reachable only by going through the real composition root and its
 * event bus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_DISCARDED_EVENT } from "@hexagen/monaco-orchestration";

interface PublishedEvent {
  type: string;
  payload: { projectId: string; reason: string; timestamp: Date };
  source: string;
}

const published: PublishedEvent[] = [];
const chatPurges: string[] = [];
const generationPurges: string[] = [];

let chatPurgeImpl: (projectId: string) => Promise<void> = async () => {};
let generationPurgeImpl: (projectId: string) => Promise<void> = async () => {};

// The use case reaches its collaborators through the client composition root.
// Importing the real one would construct IndexedDB adapters; stub the getters.
vi.mock("@/lib/wire.client", () => ({
  getEventBus: () => ({
    publish: (event: PublishedEvent) => {
      published.push(event);
    },
  }),
  getChatPersistence: () => ({
    purgeProjectData: async (projectId: string) => {
      chatPurges.push(projectId);
      await chatPurgeImpl(projectId);
    },
  }),
  getGenerationResultPersistence: () => ({
    purgeProjectResults: async (projectId: string) => {
      generationPurges.push(projectId);
      await generationPurgeImpl(projectId);
    },
  }),
}));

const loggedErrors: string[] = [];
vi.mock("../../../lib/structured-logger", () => ({
  logger: {
    error: (message: string) => {
      loggedErrors.push(message);
    },
    warn: () => {},
    info: () => {},
    debug: () => {},
  },
}));

const { discardProject } = await import("./project-lifecycle.use-case");
const { useGovernanceThreadStore } =
  await import("../../../features/governance-assistant/stores/useGovernanceThreadStore");

describe("discardProject — purge cascade", () => {
  beforeEach(() => {
    published.length = 0;
    chatPurges.length = 0;
    generationPurges.length = 0;
    loggedErrors.length = 0;
    chatPurgeImpl = async () => {};
    generationPurgeImpl = async () => {};
    useGovernanceThreadStore.getState().setThread("violations-step-1", []);
  });

  afterEach(() => {
    useGovernanceThreadStore.getState().clearAllThreads();
  });

  it("purges chat persistence for the discarded project", async () => {
    await discardProject({ projectId: "proj-1" });
    expect(chatPurges).toEqual(["proj-1"]);
  });

  it("purges generation results for the discarded project", async () => {
    await discardProject({ projectId: "proj-1" });
    expect(generationPurges).toEqual(["proj-1"]);
  });

  it("clears the in-memory governance thread store", async () => {
    expect(useGovernanceThreadStore.getState().threads.size).toBe(1);
    await discardProject({ projectId: "proj-1" });
    expect(useGovernanceThreadStore.getState().threads.size).toBe(0);
  });

  it("still publishes ProjectDiscarded for any other subscriber", async () => {
    await discardProject({ projectId: "proj-1" });

    expect(published).toHaveLength(1);
    expect(published[0]!.type).toBe(PROJECT_DISCARDED_EVENT);
    expect(published[0]!.payload.projectId).toBe("proj-1");
    expect(published[0]!.payload.reason).toBe("user_initiated");
  });

  it("purges each store exactly once (no double purge)", async () => {
    // The pre-extraction wiring purged chat persistence TWICE per discard —
    // once in this use case and once again in the wire.client subscriber the
    // use case's own publish() triggered. Idempotent, but a real duplicate.
    await discardProject({ projectId: "proj-1" });

    expect(chatPurges).toHaveLength(1);
    expect(generationPurges).toHaveLength(1);
  });

  it("does not await one purge before starting the other", async () => {
    // The inline subscriber fired both purges without awaiting either, so they
    // overlapped. A naive sequential `await a; await b;` extraction would be a
    // latency regression on the discard path; this pins the concurrency.
    let releaseChat = () => {};
    const chatStarted = new Promise<void>((resolveStarted) => {
      chatPurgeImpl = async () => {
        resolveStarted();
        await new Promise<void>((r) => {
          releaseChat = r;
        });
      };
    });

    const discarding = discardProject({ projectId: "proj-1" });
    await chatStarted;

    // Chat purge is still in flight; the generation purge must already be
    // under way rather than queued behind it.
    expect(generationPurges).toEqual(["proj-1"]);

    releaseChat();
    await discarding;
  });

  describe("failure isolation (each purge previously had its own .catch)", () => {
    it("still purges generation results when the chat purge rejects", async () => {
      chatPurgeImpl = async () => {
        throw new Error("idb unavailable");
      };

      const result = await discardProject({ projectId: "proj-1" });

      expect(generationPurges).toEqual(["proj-1"]);
      expect(result.success).toBe(true);
      expect(loggedErrors).toContain("Failed to purge chat persistence data:");
    });

    it("still purges chat persistence when the generation purge rejects", async () => {
      generationPurgeImpl = async () => {
        throw new Error("idb unavailable");
      };

      const result = await discardProject({ projectId: "proj-1" });

      expect(chatPurges).toEqual(["proj-1"]);
      expect(result.success).toBe(true);
      expect(loggedErrors).toContain("Failed to purge generation results:");
    });

    it("still clears threads and resolves successfully when both purges reject", async () => {
      chatPurgeImpl = async () => {
        throw new Error("idb unavailable");
      };
      generationPurgeImpl = async () => {
        throw new Error("idb unavailable");
      };

      const result = await discardProject({ projectId: "proj-1" });

      expect(result.success).toBe(true);
      expect(useGovernanceThreadStore.getState().threads.size).toBe(0);
    });
  });
});
