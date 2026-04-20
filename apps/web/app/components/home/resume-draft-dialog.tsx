import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import { wizardSteps } from "@/components/project-wizard/config";
import type { WizardDraft } from "@hexagen/shared";
import type { ProjectConfig } from "@hexagen/project-configuration";

interface ResumeDraftDialogProps {
  open: boolean;
  onClose: () => void;
  draft: WizardDraft | null;
  totalSteps: number;
  onResume: () => void;
  onDiscard: () => void;
}

export function ResumeDraftDialog({
  open,
  onClose,
  draft,
  totalSteps,
  onResume,
  onDiscard,
}: ResumeDraftDialogProps) {
  const formState = draft?.formState as ProjectConfig | undefined;
  const workspaceName = formState?.governance?.workspaceName;
  const updatedAt = draft?.updatedAt;
  const savedAtStep = draft?.savedAtStep ?? 0;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resume Your Project?</DialogTitle>
          <DialogDescription>
            {workspaceName && (
              <span className="block font-medium text-foreground mb-1">
                {workspaceName}
              </span>
            )}
            You have an unsaved project last edited{" "}
            {updatedAt
              ? new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(updatedAt))
              : "recently"}
            . It was last saved on{" "}
            <span className="font-medium text-foreground">
              Step {savedAtStep + 1} of {totalSteps}
              {" — "}
              {wizardSteps[savedAtStep]?.title ?? ""}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={onResume}
            className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
          >
            Resume — Step {savedAtStep + 1} of {totalSteps}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="flex-1 px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm"
          >
            Discard
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Clicking &quot;Discard&quot; will permanently delete your unsaved
          progress.
        </p>
      </DialogContent>
    </Dialog>
  );
}
