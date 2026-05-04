"use client";

import { Loader2 } from "lucide-react";
import { UnavailableCard } from "../UnavailableCard";
import { WakingUpCard } from "../WakingUpCard";
import type { ModeWrapperProps } from "./types";

type LocalModeBootViewProps = Pick<
  ModeWrapperProps,
  | "showBootSpinner"
  | "showUnavailable"
  | "showWakingUp"
  | "llmEngineState"
  | "onCancelDownload"
>;

function LifecycleCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function LocalModeBootView({
  showBootSpinner,
  showUnavailable,
  showWakingUp,
  llmEngineState,
  onCancelDownload,
}: LocalModeBootViewProps) {
  if (showBootSpinner) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (showUnavailable) {
    const unavailableStatus = llmEngineState.status as
      | "no_webgpu"
      | "unsupported_browser";
    return (
      <div className="h-full">
        <LifecycleCard>
          <UnavailableCard status={unavailableStatus} />
        </LifecycleCard>
      </div>
    );
  }

  if (showWakingUp) {
    return (
      <div className="h-full">
        <LifecycleCard>
          <WakingUpCard onCancel={onCancelDownload} />
        </LifecycleCard>
      </div>
    );
  }

  return null;
}
