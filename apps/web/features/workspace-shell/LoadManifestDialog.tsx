import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
import { ManifestFileDropZone } from "./ManifestFileDropZone";

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
        <ManifestFileDropZone onFileLoaded={onFileLoaded} />
      </DialogContent>
    </Dialog>
  );
}
