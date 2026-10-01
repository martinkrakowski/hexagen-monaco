"use client";

import { useSearchParams } from "next/navigation";
import { projectMode } from "@hexagen/shared";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import { BrownfieldViewerPage } from "@/brownfield-workbook/BrownfieldViewerPage";

/**
 * Container for the brownfield viewer: resolves `?project=<id>` to a saved
 * workbook and hands its name to the presentational page. It mounts no
 * governance, push or generate surface (BW-D7).
 */
export function BrownfieldViewerClient() {
  const searchParams = useSearchParams();
  const id = searchParams.get("project");
  const { projects, isLoading } = useSavedProjects();

  if (isLoading) return <BrownfieldViewerPage name={null} status="loading" />;
  const project = id ? projects.find((p) => p.id === id) : undefined;
  if (!project || projectMode(project) !== "brownfield") {
    return <BrownfieldViewerPage name={null} status="missing" />;
  }
  return <BrownfieldViewerPage name={project.name} status="ready" />;
}
