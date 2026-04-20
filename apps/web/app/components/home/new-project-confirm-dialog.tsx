import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import type { SavedProject } from "@/hooks/useSavedProjects";

interface NewProjectConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  loadedProject: SavedProject | null;
  onSaveAndNew: () => void;
  onDiscardAndNew: () => void;
  onCancel: () => void;
}

export function NewProjectConfirmDialog({
  open,
  onClose,
  loadedProject,
  onSaveAndNew,
  onDiscardAndNew,
  onCancel,
}: NewProjectConfirmDialogProps) {
  const projectName =
    loadedProject?.formState?.governance?.workspaceName ?? loadedProject?.name;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start a New Project?</DialogTitle>
          <DialogDescription>
            {projectName && (
              <span className="block font-medium text-foreground mb-1">
                {projectName}
              </span>
            )}
            You are currently editing a project. Would you like to save your
            changes before starting a new one, or discard them?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-4">
          <button
            type="button"
            onClick={onSaveAndNew}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
          >
            Save Changes &amp; Start New
          </button>
          <button
            type="button"
            onClick={onDiscardAndNew}
            className="w-full px-4 py-2 border border-destructive text-destructive rounded-md hover:bg-destructive/10 text-sm"
          >
            Discard Changes &amp; Start New
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
