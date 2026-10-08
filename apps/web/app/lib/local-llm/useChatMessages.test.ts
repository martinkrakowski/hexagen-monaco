import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type {
  ChatMessage,
  ModelLifecyclePort,
  SendStructuredRequestPort,
} from "@hexagen/local-llm";
import type { EditorState as EditorContextState } from "@hexagen/prompt-compiler";

// Mock the wire module to intercept getChatPersistence calls
const fakePort = vi.hoisted(() => ({
  loadChatHistory: vi.fn(),
  saveChatHistory: vi.fn(),
  clearChatHistory: vi.fn(),
}));

vi.mock("@/lib/wire", () => ({
  getChatPersistence: () => fakePort,
  hasServerLLMAccessKey: vi.fn().mockReturnValue(false),
}));

const streamAssistantResponseMock = vi.hoisted(() => vi.fn());
vi.mock("./stream-assistant-response", () => ({
  streamAssistantResponse: streamAssistantResponseMock,
}));

import { useChatMessages } from "./useChatMessages";

type LocalLLMAdapter = ModelLifecyclePort & SendStructuredRequestPort;

function makeAdapter(): LocalLLMAdapter {
  return {
    getLoadedModel: vi.fn().mockReturnValue(null),
    streamStructuredRequest: vi.fn(),
  } as unknown as LocalLLMAdapter;
}

function makeProps() {
  return {
    adapterRef: { current: makeAdapter() },
    governancePayload: null,
    editorStateRef: {
      current: { content: "", lineEnd: 0 } as EditorContextState,
    },
  };
}

describe("useChatMessages — persistence removed", () => {
  beforeEach(() => {
    fakePort.loadChatHistory.mockReset();
    fakePort.saveChatHistory.mockReset();
    fakePort.clearChatHistory.mockReset();
    fakePort.loadChatHistory.mockResolvedValue({ success: true, value: [] });
    fakePort.saveChatHistory.mockResolvedValue({
      success: true,
      value: undefined,
    });
    streamAssistantResponseMock.mockReset();
  });

  it("does not call loadChatHistory on mount", async () => {
    renderHook(() => useChatMessages(makeProps()));

    // Wait for any pending effects
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fakePort.loadChatHistory).not.toHaveBeenCalled();
  });

  it("starts with an empty message list on every mount, even when the port holds a stored list", async () => {
    // The fake port holds a non-empty stored list — the old load effect would
    // have restored it. Now it must be ignored: the hook starts empty and
    // never calls loadChatHistory.
    fakePort.loadChatHistory.mockResolvedValue({
      success: true,
      value: [
        { id: "old", role: "user", content: "from storage", timestamp: 1 },
      ],
    });

    const { result } = renderHook(() => useChatMessages(makeProps()));

    // Let any pending effects flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The list is still empty despite the stored list being non-empty
    expect(result.current.messages).toEqual([]);
    // And the hook never called loadChatHistory
    expect(fakePort.loadChatHistory).not.toHaveBeenCalled();
  });

  it("does not call saveChatHistory after messages change", async () => {
    // Mock streamAssistantResponse to populate messages with content,
    // simulating what happens when a real assistant response streams in.
    streamAssistantResponseMock.mockImplementation(async (opts: unknown) => {
      const { setMessages } = opts as {
        setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
      };
      setMessages((prev: ChatMessage[]) => [
        ...prev,
        {
          id: "assistant-test",
          role: "assistant",
          content: "Hello",
          timestamp: Date.now(),
        },
      ]);
    });

    const adapter = makeAdapter();
    adapter.getLoadedModel = vi.fn().mockReturnValue({
      modelId: "qwen-coder-3b",
      contextLength: 32768,
    });

    const { result } = renderHook(() =>
      useChatMessages({
        adapterRef: { current: adapter },
        governancePayload: {
          project: { id: "test", name: "Test", description: "" },
          violations: [],
          suggestions: [],
          stepIndex: 0,
          stepCount: 1,
        } as never,
        editorStateRef: {
          current: {
            content: "test content",
            lineEnd: 11,
          } as EditorContextState,
        },
      }),
    );

    // Trigger a message send
    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    // Messages should now be non-empty
    expect(result.current.messages.length).toBeGreaterThan(0);

    // Wait for any pending effects to run
    await new Promise((resolve) => setTimeout(resolve, 50));

    // saveChatHistory must never be called - the save effect was removed
    expect(fakePort.saveChatHistory).not.toHaveBeenCalled();
    // loadChatHistory must never be called - the load effect was removed
    expect(fakePort.loadChatHistory).not.toHaveBeenCalled();
  });
});
