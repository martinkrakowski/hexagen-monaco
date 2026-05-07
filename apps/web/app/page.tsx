"use client";

import { useState } from "react";
import { ProjectWorkspace } from "../features/workspace-shell/ProjectWorkspace";
import { ErrorBoundary } from "../components/ErrorBoundary";
import type { ViewMode } from "../types/view-mode";

export default function Home() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");

  return (
    <ErrorBoundary>
      <ProjectWorkspace
        currentStepIndex={currentStepIndex}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onGoToStep={setCurrentStepIndex}
        onCloseMiddlePanel={() => {}}
        onCloseRightPanel={() => {}}
      />
    </ErrorBoundary>
  );
}
