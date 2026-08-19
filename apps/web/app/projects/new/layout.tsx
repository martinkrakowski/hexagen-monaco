"use client";

import { createPortal } from "react-dom";
import { useLocalLLMConfig } from "@/lib/local-llm-context";
import { ModelProgressCard } from "@/ModelProgressCard";
import {
  LLMLoadingModalProvider,
  useLLMLoadingModalSuppressed,
} from "@/contexts/LLMLoadingModalContext";
import { useIsMounted } from "@/hooks/useIsMounted";
import type {
  DomainModelId,
  LLMEngineStatus,
  ModelMetadata,
} from "@hexagen/local-llm";

function NewProjectLayoutInner({ children }: { children: React.ReactNode }) {
  const { engineState, loadedModel, initializeModel, cancelDownload } =
    useLocalLLMConfig();
  const isSuppressed = useLLMLoadingModalSuppressed();
  const mounted = useIsMounted();

  const status = engineState.status;
  const isModelLoading =
    status === "downloading" ||
    (status === "loading_vram" && !engineState.autoLoading);
  const isModelError = status === "error";

  return (
    <>
      {children}
      {mounted &&
        !isSuppressed &&
        (isModelLoading || isModelError) &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
            aria-modal="true"
            role="dialog"
          >
            <div
              className="w-full max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <ModelProgressCard
                status={status as LLMEngineStatus}
                progress={engineState.progress}
                errorMessage={engineState.errorMessage}
                onCancel={() => cancelDownload()}
                onRetry={() => {
                  const modelId = engineState.loadedModelId;
                  if (modelId) void initializeModel(modelId as DomainModelId);
                }}
                model={loadedModel as ModelMetadata | null}
                modelId={engineState.loadedModelId as DomainModelId | undefined}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export default function NewProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LLMLoadingModalProvider>
      <NewProjectLayoutInner>{children}</NewProjectLayoutInner>
    </LLMLoadingModalProvider>
  );
}
