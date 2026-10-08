import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ChatMessage, ChatPersistencePort } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";

import {
  useStoredChatHistoryOffer,
  type DownloadFileFn,
} from "./useStoredChatHistoryOffer";

const okResult = { success: true as const, value: undefined };

describe("useStoredChatHistoryOffer", () => {
  let port: ChatPersistencePort;
  let downloadFile: ReturnType<typeof vi.fn>;
  let loadChatHistory: ReturnType<typeof vi.fn>;
  let clearChatHistory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    loadChatHistory = vi.fn();
    clearChatHistory = vi.fn();
    downloadFile = vi.fn();
    port = {
      loadChatHistory,
      saveChatHistory: vi.fn(),
      clearChatHistory,
      loadGovernanceThread: vi.fn(),
      saveGovernanceThread: vi.fn(),
      clearGovernanceThread: vi.fn(),
      purgeProjectData: vi.fn(),
    } as unknown as ChatPersistencePort;
  });

  const threeMessages: ChatMessage[] = [
    { id: "u1", role: "user", content: "hi", timestamp: 1735684800000 },
    {
      id: "a1",
      role: "assistant",
      content: "hello",
      timestamp: 1735684810000,
    },
    { id: "u2", role: "user", content: "bye", timestamp: 1735684820000 },
  ];

  it("exposes an offer with count when stored list is non-empty", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current).toBeDefined());
    await waitFor(() => expect(result.current?.count).toBe(3));
    expect(result.current?.error).toBeFalsy();
  });

  it("exposes null when stored list is empty", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: [],
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    // Let the async load settle before asserting
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("exposes null when load fails and does not call clearChatHistory", async () => {
    loadChatHistory.mockRejectedValue(new Error("IDB boom"));

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    // Let the async load settle before asserting
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
    expect(clearChatHistory).not.toHaveBeenCalled();
  });

  it("download calls the file function with the transcript and filename, then clears, then offer becomes null", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    clearChatHistory.mockResolvedValue(okResult);

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));

    await act(async () => {
      await result.current!.download();
    });

    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [transcript, filename] = downloadFile.mock.calls[0]!;
    expect(typeof transcript).toBe("string");
    expect(transcript).toContain("# Assistant messages stored in this browser");
    expect(transcript).toContain("Count: 3");
    expect(transcript).toContain("hello");
    expect(transcript).toContain("bye");
    expect(filename).toMatch(
      /^hexagen-assistant-messages-\d{4}-\d{2}-\d{2}\.md$/,
    );
    expect(clearChatHistory).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current).toBeNull());
  });

  it("download does NOT clear when the file function throws", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    clearChatHistory.mockResolvedValue(okResult);
    downloadFile.mockImplementation(() => {
      throw new Error("download failed");
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));

    await act(async () => {
      await expect(result.current!.download()).rejects.toThrow(
        "download failed",
      );
    });

    expect(clearChatHistory).not.toHaveBeenCalled();
    expect(result.current?.count).toBe(3);
  });

  it("discard clears the stored list and the offer becomes null", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    clearChatHistory.mockResolvedValue(okResult);

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));

    await act(async () => {
      await result.current!.discard();
    });

    expect(clearChatHistory).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("when clearChatHistory fails during download, the offer stays with error flag true", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    clearChatHistory.mockResolvedValue({
      success: false,
      error: new Error("clear failed"),
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));

    await act(async () => {
      await result.current!.download();
    });

    expect(clearChatHistory).toHaveBeenCalledTimes(1);
    expect(result.current?.error).toBe(true);
    expect(result.current?.count).toBe(3);
  });

  it("when clearChatHistory fails during discard, the offer stays with error flag true", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    clearChatHistory.mockResolvedValue({
      success: false,
      error: new Error("clear failed"),
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));

    await act(async () => {
      await result.current!.discard();
    });

    expect(clearChatHistory).toHaveBeenCalledTimes(1);
    expect(result.current?.error).toBe(true);
    expect(result.current?.count).toBe(3);
  });

  it("when load returns a failed Result (success:false), exposes null and does not call clearChatHistory", async () => {
    loadChatHistory.mockResolvedValue({
      success: false,
      error: new Error("IDB read error"),
    } as Result<ChatMessage[], Error>);

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    // Let the async load settle before asserting
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
    expect(clearChatHistory).not.toHaveBeenCalled();
  });

  it("does not expose error flag before any failing clear", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await waitFor(() => expect(result.current?.count).toBe(3));
    expect(result.current?.error).toBeFalsy();
  });
});
