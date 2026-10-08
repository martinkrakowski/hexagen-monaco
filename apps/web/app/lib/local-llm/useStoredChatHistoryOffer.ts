import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, ChatPersistencePort } from "@hexagen/local-llm";
import type { Result } from "@hexagen/shared";
import { getChatPersistence } from "@/lib/wire";

import { formatChatTranscript } from "./format-chat-transcript";

export type OfferError = "download" | "discard" | null;

export interface StoredChatHistoryOffer {
  count: number;
  error: OfferError;
  download: () => Promise<void>;
  discard: () => Promise<void>;
}

export type DownloadFileFn = (content: string, filename: string) => void;

export interface UseStoredChatHistoryOfferOptions {
  persistencePort?: ChatPersistencePort;
  downloadFile?: DownloadFileFn;
}

const defaultDownloadFile: DownloadFileFn = (content, filename) => {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

function formatDateYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function useStoredChatHistoryOffer(
  options?: UseStoredChatHistoryOfferOptions,
): StoredChatHistoryOffer | null {
  const {
    persistencePort = getChatPersistence(),
    downloadFile = defaultDownloadFile,
  } = options ?? {};

  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<OfferError>(null);

  useEffect(() => {
    let cancelled = false;
    let ignore = false;

    void persistencePort
      .loadChatHistory()
      .then((result: Result<ChatMessage[]>) => {
        if (cancelled || ignore) return;
        if (result.success && result.value.length > 0) {
          setMessages(result.value);
        } else {
          setMessages(null);
        }
      })
      .catch(() => {
        if (cancelled || ignore) return;
        setMessages(null);
      });

    return () => {
      cancelled = true;
      ignore = true;
    };
  }, [persistencePort]);

  const download = useCallback(async () => {
    if (!messages) return;

    const exportedAt = new Date();
    const transcript = formatChatTranscript(messages, exportedAt);
    const filename = `hexagen-assistant-messages-${formatDateYYYYMMDD(exportedAt)}.md`;

    try {
      downloadFile(transcript, filename);
    } catch {
      setError("download");
      return;
    }
    // download does NOT clear; the offer stays so the user can retry
  }, [messages, downloadFile]);

  const discard = useCallback(async () => {
    const clearResult = await persistencePort.clearChatHistory();
    if (clearResult.success) {
      setMessages(null);
      setError(null);
    } else {
      setError("discard");
    }
  }, [persistencePort]);

  if (!messages) return null;

  return {
    count: messages.length,
    error,
    download,
    discard,
  };
}
