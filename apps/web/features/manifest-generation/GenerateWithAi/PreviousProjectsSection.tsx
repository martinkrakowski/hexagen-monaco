import { Folder } from "lucide-react";
import { useSavedProjects } from "@/hooks/useSavedProjects";
import type { PreviousProjectsSectionProps } from "./types";

export function PreviousProjectsSection({
  onLoadProject,
}: PreviousProjectsSectionProps) {
  const { projects } = useSavedProjects();

  if (!projects || projects.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-foreground">
        Previous Projects:
      </h3>
      <div className="flex flex-col space-y-1">
        {projects.map((project, index) => (
          <button
            key={project.id}
            onClick={() => onLoadProject(project.id)}
            className="group flex w-full items-center space-x-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted-foreground/50">{index + 1}.</span>
            <Folder className="h-4 w-4" />
            <span className="truncate">{project.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
