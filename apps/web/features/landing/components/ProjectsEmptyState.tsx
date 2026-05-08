"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";

export function ProjectsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in-up">
      <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">
        No projects yet
      </h3>
      <p className="text-sm text-muted-foreground mb-6">
        Create your first project to get started
      </p>
      <Link
        href="/projects/new"
        className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        New Project
      </Link>
    </div>
  );
}
