import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
import { useWizardLifecycleContext } from "./contexts/WizardLifecycleContext";

interface NewProjectConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pendingRoute: React.MutableRefObject<string | null>;
  router: ReturnType<typeof import("next/navigation").useRouter>;
}

export function NewProjectConfirmDialog({
  isOpen,
  onClose,
  pendingRoute,
  router,
}: NewProjectConfirmDialogProps) {
  const lifecycle = useWizardLifecycleContext();
  const projectName =
    lifecycle.loadedProject?.formState?.governance?.workspaceName ??
    lifecycle.loadedProject?.name;

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
    >
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
            onClick={async () => {
              const route = pendingRoute.current;
              try {
                await lifecycle.handleSaveAndNew();
              } finally {
                pendingRoute.current = null;
              }
              if (route) router.push(route);
            }}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
          >
            Save Changes &amp; Start New
          </button>
          <button
            type="button"
            onClick={async () => {
              const route = pendingRoute.current;
              try {
                await lifecycle.handleDiscardAndNew();
              } finally {
                pendingRoute.current = null;
              }
              if (route) router.push(route);
            }}
            className="w-full px-4 py-2 border border-destructive text-destructive rounded-md hover:bg-destructive/10 text-sm"
          >
            Discard Changes &amp; Start New
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 border border-input bg-background rounded-md hover:bg-muted text-sm"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
