import { Upload, Wand2, GitBranch } from "lucide-react";
import type { EntryPointsSectionProps } from "./types";

export function EntryPointsSection({
  onImportManifest,
  onStartWizard,
  onImportGithub,
}: EntryPointsSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <button
        onClick={onImportManifest}
        className="group relative flex flex-col items-center justify-center space-y-2 rounded-lg border border-border bg-card p-6 text-center transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Upload className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-foreground" />
        <span className="text-sm font-medium">Import Manifest</span>
      </button>

      <button
        onClick={onStartWizard}
        className="group relative flex flex-col items-center justify-center space-y-2 rounded-lg border border-border bg-card p-6 text-center transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Wand2 className="h-6 w-6 text-muted-foreground transition-colors group-hover:text-foreground" />
        <span className="text-sm font-medium">Start Wizard</span>
      </button>

      <button
        onClick={onImportGithub}
        disabled
        title="Coming soon"
        className="group relative flex flex-col items-center justify-center space-y-2 rounded-lg border border-border bg-card p-6 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GitBranch className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">Import GitHub</span>
      </button>
    </div>
  );
}
