"use client";

import { FolderOpen } from "lucide-react";

/**
 * Rendered when there are no saved projects and no draft in progress.
 */
export function ProjectsEmptyState() {
  return (
    <div className="text-center py-12">
      <FolderOpen
        aria-hidden="true"
        className="h-12 w-12 mx-auto text-muted-foreground mb-4"
      />
      <p className="text-muted-foreground">No saved projects yet.</p>
      <p className="text-sm text-muted-foreground mt-1">
        Generate a project to save it here.
      </p>
    </div>
  );
}
