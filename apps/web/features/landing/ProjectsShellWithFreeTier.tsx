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
  const { showFreeTierBadge, usingWebLLM, currentModelName, openModal } =
    useFreeTier();

  const badgeLabel = usingWebLLM
    ? `WebLLM: ${currentModelName ?? ""}`
    : `Free Tier Model${currentModelName ? `: ${currentModelName}` : ""}`;

  const finalHeaderContent =
    headerContent ??
    (title ? (
      <div className="flex items-center justify-between w-full">
        <span className="font-semibold text-sm truncate">{title}</span>
        {(showFreeTierBadge || usingWebLLM) && (
          <button onClick={openModal} className="ml-auto">
            <Badge variant="secondary">{badgeLabel}</Badge>
          </button>
        )}
      </div>
    ) : null);

  return (
    <ProjectsShell headerContent={finalHeaderContent} footer={footer}>
      {children}
    </ProjectsShell>
  );
}
