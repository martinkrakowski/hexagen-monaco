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
    await waitFor(() => expect(result.current?.error).toBe(null));
    expect(loadChatHistory).toHaveBeenCalledTimes(1);
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

    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
    expect(loadChatHistory).toHaveBeenCalledTimes(1);
  });

  it("exposes null when load fails and does not call clearChatHistory", async () => {
    loadChatHistory.mockRejectedValue(new Error("IDB boom"));

    const { result } = renderHook(() =>
      useStoredChatHistoryOffer({
        persistencePort: port,
        downloadFile: downloadFile as unknown as DownloadFileFn,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
    expect(clearChatHistory).not.toHaveBeenCalled();
    expect(loadChatHistory).toHaveBeenCalledTimes(1);
  });

  it("download calls the file function with the transcript and filename, does NOT clear, offer stays with same count", async () => {
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

    // CRITICAL: download must NOT clear the stored messages
    expect(clearChatHistory).not.toHaveBeenCalled();

    // The offer stays with the same count (no re-render that changes it)
    expect(result.current?.count).toBe(3);
  });

  it("calling download twice calls the file function twice", async () => {
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

    await act(async () => {
      await result.current!.download();
    });
    await act(async () => {
      await result.current!.download();
    });

    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(clearChatHistory).not.toHaveBeenCalled();
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

  it("discard after download clears and the offer becomes null", async () => {
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

    // Download first (should not clear)
    await act(async () => {
      await result.current!.download();
    });
    expect(clearChatHistory).not.toHaveBeenCalled();
    expect(result.current?.count).toBe(3);

    // Then discard (should clear)
    await act(async () => {
      await result.current!.discard();
    });
    expect(clearChatHistory).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("when clearChatHistory fails during download, download does not clear and error is null", async () => {
    // Download no longer calls clearChatHistory, so a failing clear should
    // never be reached by download.
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

    // Download never calls clearChatHistory
    expect(clearChatHistory).not.toHaveBeenCalled();
    // Offer stays, no error from download
    expect(result.current?.count).toBe(3);
  });

  it("when clearChatHistory fails during discard, the offer stays with discard error", async () => {
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
    expect(result.current?.error).toBe("discard");
    expect(result.current?.count).toBe(3);
  });

  it("when download throws, the offer stays with download error and clear is not called", async () => {
    loadChatHistory.mockResolvedValue({
      success: true,
      value: threeMessages,
    });
    downloadFile = vi.fn().mockImplementation(() => {
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
      await result.current!.download();
    });

    expect(clearChatHistory).not.toHaveBeenCalled();
    expect(result.current?.error).toBe("download");
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

    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() => expect(result.current).toBeNull());
    expect(clearChatHistory).not.toHaveBeenCalled();
    expect(loadChatHistory).toHaveBeenCalledTimes(1);
  });
});
