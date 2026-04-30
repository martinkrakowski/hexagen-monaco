import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@hexagen/ui";
import { WelcomeScreen } from "../manifest-generation/WelcomeScreen";

interface WelcomeManifestDialogProps {
  open: boolean;
  onClose: () => void;
  onUseManifest?: (manifest: string) => void;
}

export function WelcomeManifestDialog({
  open,
  onClose,
  onUseManifest,
}: WelcomeManifestDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent className="w-full max-w-4xl">
        <DialogHeader>
          <DialogTitle>Generate Manifest from AI</DialogTitle>
          <DialogDescription>
            Describe your project in natural language to generate a complete
            hexagonal architecture manifest
          </DialogDescription>
        </DialogHeader>
        <WelcomeScreen onUseManifest={onUseManifest} />
      </DialogContent>
    </Dialog>
  );
}