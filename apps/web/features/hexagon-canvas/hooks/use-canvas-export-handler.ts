"use client";

import { useCallback, useRef, useEffect } from "react";
import { toPng } from "html-to-image";
import type { Result } from "@hexagen/shared";

interface UseCanvasExportHandlerOptions {
  onExportClick?: (handler: () => Promise<Result<Blob, Error>>) => void;
}

export function useCanvasExportHandler({
  onExportClick,
}: UseCanvasExportHandlerOptions = {}): () => Promise<Result<Blob, Error>> {
  const initialExportDone = useRef(false);

  const handleExportClick = useCallback(async (): Promise<
    Result<Blob, Error>
  > => {
    try {
      const viewport = document.querySelector(
        ".react-flow__viewport",
      ) as HTMLElement | null;
      if (!viewport) {
        return { success: false, error: new Error("Viewport not found") };
      }

      const bgChannels = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      const backgroundColor = bgChannels ? `hsl(${bgChannels})` : "#ffffff";

      const dataUrl = await toPng(viewport, {
        backgroundColor,
        pixelRatio: 2,
      });

      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return { success: true, value: blob };
    } catch (err) {
      return { success: false, error: err as Error };
    }
  }, []);

  useEffect(() => {
    if (onExportClick && !initialExportDone.current) {
      initialExportDone.current = true;
      onExportClick(handleExportClick);
    }
  }, [onExportClick, handleExportClick]);

  return handleExportClick;
}
