import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog";
import { FileDropZone } from "@/components/ui/FileDropZone";

interface LoadManifestDialogProps {
  open: boolean;
  onClose: () => void;
  onFileLoaded: (yamlContent: string) => void;
}

export function LoadManifestDialog({
  open,
  onClose,
  onFileLoaded,
}: LoadManifestDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Load Manifest</DialogTitle>
          <DialogDescription>
            Drop your existing{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              manifest.yaml
            </code>{" "}
            to populate the wizard.
          </DialogDescription>
        </DialogHeader>
        <FileDropZone onFileLoaded={onFileLoaded} />
      </DialogContent>
    </Dialog>
  );
}
