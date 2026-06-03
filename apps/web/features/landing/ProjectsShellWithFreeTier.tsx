"use client";

import { Badge } from "@hexagen/ui";
import { ProjectsShell } from "./ProjectsShell";
import { useFreeTier } from "@/lib/free-tier/FreeTierContext";

interface ProjectsShellWithFreeTierProps {
  title?: string;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function ProjectsShellWithFreeTier({
  title,
  headerContent,
  children,
  footer,
}: ProjectsShellWithFreeTierProps) {
  const {
    showFreeTierBadge,
    usingWebLLM,
    currentModelName,
    openModal,
    freeTierModal,
  } = useFreeTier();

  const badgeLabel = usingWebLLM
    ? `WebLLM: ${currentModelName ?? ""}`
    : `Free Tier Model${currentModelName ? `: ${currentModelName}` : ""}`;

  const inner =
    headerContent ??
    (title ? (
      <span className="font-semibold text-sm truncate">{title}</span>
    ) : null);

  const showBadge = showFreeTierBadge || usingWebLLM;

  // Always render the model badge trailing the header content. The inner wrapper
  // keeps its own justify-between so multi-element headers (e.g. title + tabs)
  // still spread correctly within the available space, with the badge after.
  const finalHeaderContent =
    inner || showBadge ? (
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          {inner}
        </div>
        {showBadge && (
          <button type="button" onClick={openModal} className="shrink-0">
            <Badge variant="secondary">{badgeLabel}</Badge>
          </button>
        )}
      </div>
    ) : null;

  return (
    <>
      <ProjectsShell headerContent={finalHeaderContent} footer={footer}>
        {children}
      </ProjectsShell>
      {/* Render the model-settings modal so the badge's openModal works on
          every screen that uses this shell (it was previously only rendered by
          ImportProjectSpecPage). */}
      {freeTierModal}
    </>
  );
}
