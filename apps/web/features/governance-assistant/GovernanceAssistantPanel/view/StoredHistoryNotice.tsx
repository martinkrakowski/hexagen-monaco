"use client";

import { Alert } from "@hexagen/ui";
import { Button } from "@hexagen/ui";

export interface StoredHistoryNoticeProps {
  count: number;
  error: boolean;
  onDownload: () => void;
  onDiscard: () => void;
}

export function StoredHistoryNotice({
  count,
  error,
  onDownload,
  onDiscard,
}: StoredHistoryNoticeProps) {
  const message =
    count === 1
      ? "This browser holds 1 assistant message from earlier sessions. They are no longer kept between sessions. Download a copy, or discard them."
      : `This browser holds ${count} assistant messages from earlier sessions. They are no longer kept between sessions. Download a copy, or discard them.`;

  return (
    <Alert tone="info" title="Stored assistant messages">
      <p className="mb-3">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onDownload}>
          Download
        </Button>
        <Button variant="outline" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive">
          The stored messages could not be removed. Try again.
        </p>
      )}
    </Alert>
  );
}
